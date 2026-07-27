#!/usr/bin/env python3
"""Audit and render photos that contain detected faces but have no people tags.

This is a private review aid. It compares every clustering-eligible face in a
zero-tag photo with all saved face profiles, groups repeated detections of the
same face, and renders two review surfaces:

1. full-photo sheets with every detected face boxed; and
2. face cards sorted by same-face cluster, with the closest saved profile.

It reads only the generated catalog, saved detector/signature artifacts,
committed face thumbnails, and local preview derivatives. It never opens or
changes a wedding original and never applies a tag.

Usage (from the repository root):
  uv run --no-project --python .venv-faces/bin/python \
      scripts/face/review-zero-tag-photos.py
"""

from __future__ import annotations

import base64
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

REPO = Path(__file__).resolve().parents[2]
CATALOG_PATH = REPO / "src" / "generated" / "gallery-v2.json"
OVERRIDES_PATH = REPO / "src" / "generated" / "person-overrides.json"
FACES_DIR = REPO / "metadata" / "faces"
DETECTIONS_PATH = FACES_DIR / "detections.jsonl"
SIGNATURES_PATH = FACES_DIR / "signatures.json"
DERIVATIVES_DIR = REPO / "metadata" / "import" / "derivatives" / "previews"
COMMITTED_FACES_DIR = REPO / "public" / "faces"
REPORT_JSON_PATH = FACES_DIR / "zero-tag-review.json"
REPORT_MD_PATH = FACES_DIR / "zero-tag-review.md"
PHOTO_SHEETS_DIR = FACES_DIR / "zero-tag-review" / "photo-sheets"
FACE_SHEETS_DIR = FACES_DIR / "zero-tag-review" / "face-sheets"

# Same calibrated eligibility and clustering thresholds as
# build-face-signatures.py. The stricter "usable" and "prominent" flags mirror
# audit-archive-tags.py and are included as review context, not acceptance.
MIN_CLUSTER_SCORE = 0.65
MIN_CLUSTER_FACE_FRAC = 0.018
T_EDGE = 0.60
T_MERGE = 0.52
MIN_USABLE_SCORE = 0.70
MIN_USABLE_FACE_FRAC = 0.025
MIN_PROMINENT_FACE_FRAC = 0.035

PARAMS = {
    "minClusterScore": MIN_CLUSTER_SCORE,
    "minClusterFaceFrac": MIN_CLUSTER_FACE_FRAC,
    "tEdge": T_EDGE,
    "tMerge": T_MERGE,
    "minUsableScore": MIN_USABLE_SCORE,
    "minUsableFaceFrac": MIN_USABLE_FACE_FRAC,
    "minProminentFaceFrac": MIN_PROMINENT_FACE_FRAC,
}

PHOTO_CELL_WIDTH = 900
PHOTO_CELL_HEIGHT = 600
PHOTO_COLS = 2
PHOTO_ROWS = 2
PHOTO_PER_SHEET = PHOTO_COLS * PHOTO_ROWS
FACE_CELL_WIDTH = 640
FACE_CELL_HEIGHT = 550
FACE_COLS = 3
FACE_ROWS = 2
FACE_PER_SHEET = FACE_COLS * FACE_ROWS
PROFILE_SIZE = 190
CANDIDATE_SIZE = 390


def load_detections() -> dict[str, dict]:
    records = {}
    with DETECTIONS_PATH.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                record = json.loads(line)
                records[record["photoId"]] = record
    return records


def decode_embeddings(faces: list[dict]) -> np.ndarray:
    if not faces:
        return np.empty((0, 512), dtype=np.float32)
    matrix = np.frombuffer(
        b"".join(base64.b64decode(face["emb"]) for face in faces),
        dtype=np.float32,
    ).reshape(len(faces), 512)
    matrix = np.ascontiguousarray(matrix)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return matrix / np.clip(norms, 1e-8, None)


def face_for_saved_crop(
    record: dict,
    crop: dict,
) -> tuple[np.ndarray, dict]:
    """Resolve a committed normalized crop to one contained detected face."""
    faces = record["faces"]
    if not faces:
        raise ValueError("saved crop photo has no detected faces")

    width = float(record["dw"])
    height = float(record["dh"])
    side = float(crop["size"]) * min(width, height)
    left = float(crop["x"]) * width
    top = float(crop["y"]) * height
    right = left + side
    bottom = top + side
    crop_center_x = left + side / 2
    crop_center_y = top + side / 2

    ranked = []
    for index, face in enumerate(faces):
        x1, y1, x2, y2 = (float(value) for value in face["bbox"])
        face_width = max(0.0, x2 - x1)
        face_height = max(0.0, y2 - y1)
        face_area = face_width * face_height
        if face_area <= 0:
            continue
        intersection_width = max(0.0, min(right, x2) - max(left, x1))
        intersection_height = max(0.0, min(bottom, y2) - max(top, y1))
        coverage = (intersection_width * intersection_height) / face_area
        face_center_x = (x1 + x2) / 2
        face_center_y = (y1 + y2) / 2
        center_inside = (
            left <= face_center_x <= right and top <= face_center_y <= bottom
        )
        center_distance = (
            (face_center_x - crop_center_x) ** 2
            + (face_center_y - crop_center_y) ** 2
        ) ** 0.5 / max(side, 1.0)
        if not center_inside or coverage < 0.80:
            continue
        ranked.append(
            (
                coverage,
                -center_distance,
                float(face["score"]),
                index,
                {
                    "faceIndex": face["i"],
                    "faceCoverage": round(coverage, 4),
                    "centerDistance": round(center_distance, 4),
                    "detScore": face["score"],
                },
            )
        )

    if not ranked:
        raise ValueError("saved crop does not contain a detected face")
    ranked.sort(reverse=True)
    if len(ranked) > 1:
        best = ranked[0]
        runner = ranked[1]
        if best[0] - runner[0] < 0.02 and best[1] - runner[1] < 0.05:
            raise ValueError("saved crop contains multiple ambiguous faces")

    embeddings = decode_embeddings(faces)
    selected_index = ranked[0][3]
    return embeddings[selected_index], ranked[0][4]


def saved_profile_matrix(
    catalog: dict,
    signatures: dict,
    overrides: dict,
    detections: dict[str, dict],
) -> tuple[np.ndarray, list[str], dict[str, str], dict[str, str], list[dict]]:
    people_by_slug = {person["slug"]: person["name"] for person in catalog["people"]}
    vectors: list[list[float] | np.ndarray] = []
    slugs: list[str] = []
    sources: dict[str, str] = {}
    learned_slugs = set()

    for person in signatures["people"]:
        slug = person["slug"]
        learned_slugs.add(slug)
        sources[slug] = "learned"
        for cluster in person["clusters"]:
            vectors.append(cluster["centroid"])
            slugs.append(slug)

    anchors = []
    for slug, choice in sorted(overrides.get("people", {}).items()):
        if slug in learned_slugs:
            continue
        record = detections.get(choice["photoId"])
        if record is None:
            raise ValueError(
                f"saved face for {slug} references missing detection "
                f"{choice['photoId']}"
            )
        embedding, fit = face_for_saved_crop(record, choice["crop"])
        vectors.append(embedding)
        slugs.append(slug)
        sources[slug] = "saved-crop"
        anchors.append({"slug": slug, "photoId": choice["photoId"], **fit})

    matrix = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    matrix = matrix / np.clip(norms, 1e-8, None)
    return matrix, slugs, people_by_slug, sources, anchors


def ranked_profile_matches(
    vector: np.ndarray,
    profile_matrix: np.ndarray,
    profile_slugs: list[str],
    people_by_slug: dict[str, str],
    profile_sources: dict[str, str],
    limit: int = 3,
) -> tuple[list[dict], float]:
    similarities = profile_matrix @ vector
    best_by_slug: dict[str, float] = {}
    for column, slug in enumerate(profile_slugs):
        value = float(similarities[column])
        best_by_slug[slug] = max(best_by_slug.get(slug, -1.0), value)
    ranked = sorted(best_by_slug.items(), key=lambda item: (-item[1], item[0]))
    matches = [
        {
            "slug": slug,
            "name": people_by_slug.get(slug, slug),
            "similarity": round(value, 3),
            "profileSource": profile_sources[slug],
        }
        for slug, value in ranked[:limit]
    ]
    runner = ranked[1][1] if len(ranked) > 1 else -1.0
    margin = ranked[0][1] - runner if ranked else 0.0
    return matches, round(margin, 3)


class UnionFind:
    def __init__(self, size: int):
        self.parent = list(range(size))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, left: int, right: int) -> None:
        root_left = self.find(left)
        root_right = self.find(right)
        if root_left == root_right:
            return
        if root_right < root_left:
            root_left, root_right = root_right, root_left
        self.parent[root_right] = root_left


def initial_components(faces: list[dict], matrix: np.ndarray) -> list[list[int]]:
    union_find = UnionFind(len(faces))
    similarities = matrix @ matrix.T
    for left in range(len(faces)):
        for right in range(left + 1, len(faces)):
            if faces[left]["photoId"] == faces[right]["photoId"]:
                continue
            if similarities[left, right] >= T_EDGE:
                union_find.union(left, right)
    groups: dict[int, list[int]] = defaultdict(list)
    for index in range(len(faces)):
        groups[union_find.find(index)].append(index)
    return [members for _, members in sorted(groups.items())]


def merge_components(
    components: list[list[int]],
    faces: list[dict],
    matrix: np.ndarray,
) -> list[list[int]]:
    """Reconnect pose fragments while guarding recurring same-photo conflicts."""
    clusters = [list(component) for component in components]
    centroids = []
    photo_sets = []
    for members in clusters:
        centroid = matrix[members].mean(axis=0)
        centroids.append(centroid / max(np.linalg.norm(centroid), 1e-8))
        photo_sets.append({faces[index]["photoId"] for index in members})
    centroid_matrix = np.stack(centroids)
    alive = [True] * len(clusters)

    similarities = centroid_matrix @ centroid_matrix.T
    np.fill_diagonal(similarities, -1.0)
    max_iterations = 10 * len(clusters) + 1000
    for _ in range(max_iterations):
        flat_index = int(np.argmax(similarities))
        left, right = divmod(flat_index, similarities.shape[1])
        if similarities[left, right] < T_MERGE:
            break
        if len(photo_sets[left] & photo_sets[right]) >= 2:
            similarities[left, right] = similarities[right, left] = -1.0
            continue
        if right < left:
            left, right = right, left
        clusters[left].extend(clusters[right])
        clusters[left].sort()
        clusters[right] = []
        alive[right] = False
        photo_sets[left] |= photo_sets[right]
        centroid = matrix[clusters[left]].mean(axis=0)
        centroid_matrix[left] = centroid / max(np.linalg.norm(centroid), 1e-8)
        row = centroid_matrix @ centroid_matrix[left]
        row[~np.asarray(alive)] = -1.0
        row[left] = -1.0
        similarities[left, :] = row
        similarities[:, left] = row
        similarities[right, :] = -1.0
        similarities[:, right] = -1.0
    return [cluster for cluster, keep in zip(clusters, alive) if keep and cluster]


def canonical_override_bytes(overrides: dict) -> bytes:
    return json.dumps(
        {
            "people": overrides.get("people", {}),
            "names": overrides.get("names", {}),
            "hidden": overrides.get("hidden", []),
            "added": overrides.get("added", {}),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def build_report() -> tuple[dict, dict[str, dict]]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    signatures = json.loads(SIGNATURES_PATH.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
    detections = load_detections()
    (
        profile_matrix,
        profile_slugs,
        people_by_slug,
        profile_sources,
        saved_crop_anchors,
    ) = saved_profile_matrix(catalog, signatures, overrides, detections)

    zero_tagged = [photo for photo in catalog["photos"] if not photo["peopleSlugs"]]
    photo_rows = []
    eligible_faces = []
    eligible_embeddings = []
    all_face_count = 0
    usable_face_count = 0
    prominent_face_count = 0

    for photo in sorted(zero_tagged, key=lambda item: item["originalRelativePath"]):
        detection = detections.get(photo["id"])
        if detection is None or not detection["faces"]:
            continue
        embeddings = decode_embeddings(detection["faces"])
        face_rows = []
        long_edge = max(detection["dw"], detection["dh"])
        for index, face in enumerate(detection["faces"]):
            all_face_count += 1
            face_frac = (face["bbox"][3] - face["bbox"][1]) / long_edge
            clustering_eligible = (
                face["score"] >= MIN_CLUSTER_SCORE
                and face_frac >= MIN_CLUSTER_FACE_FRAC
            )
            usable = (
                face["score"] >= MIN_USABLE_SCORE
                and face_frac >= MIN_USABLE_FACE_FRAC
            )
            prominent = usable and face_frac >= MIN_PROMINENT_FACE_FRAC
            if usable:
                usable_face_count += 1
            if prominent:
                prominent_face_count += 1
            matches, margin = ranked_profile_matches(
                embeddings[index],
                profile_matrix,
                profile_slugs,
                people_by_slug,
                profile_sources,
            )
            row = {
                "faceKey": f"{photo['id']}:{face['i']}",
                "photoId": photo["id"],
                "path": photo["originalRelativePath"],
                "event": photo["eventSlug"],
                "faceIndex": face["i"],
                "bbox": face["bbox"],
                "detScore": face["score"],
                "faceFrac": round(face_frac, 4),
                "clusteringEligible": clustering_eligible,
                "usable": usable,
                "prominent": prominent,
                "matches": matches,
                "margin": margin,
            }
            face_rows.append(row)
            if clustering_eligible:
                eligible_faces.append(row)
                eligible_embeddings.append(embeddings[index])
        photo_rows.append(
            {
                "photoId": photo["id"],
                "path": photo["originalRelativePath"],
                "event": photo["eventSlug"],
                "dw": detection["dw"],
                "dh": detection["dh"],
                "faces": face_rows,
            }
        )

    eligible_matrix = np.asarray(eligible_embeddings, dtype=np.float32)
    raw_clusters = []
    if eligible_faces:
        components = initial_components(eligible_faces, eligible_matrix)
        raw_clusters = merge_components(
            components,
            eligible_faces,
            eligible_matrix,
        )
    cluster_payload = []
    for members in raw_clusters:
        centroid = eligible_matrix[members].mean(axis=0)
        centroid /= max(np.linalg.norm(centroid), 1e-8)
        matches, margin = ranked_profile_matches(
            centroid,
            profile_matrix,
            profile_slugs,
            people_by_slug,
            profile_sources,
        )
        member_rows = [eligible_faces[index] for index in members]
        photo_ids = {row["photoId"] for row in member_rows}
        per_photo_counts: dict[str, int] = defaultdict(int)
        for row in member_rows:
            per_photo_counts[row["photoId"]] += 1
        cluster_payload.append(
            {
                "faceCount": len(member_rows),
                "photoCount": len(photo_ids),
                "samePhotoConflictCount": sum(
                    count - 1 for count in per_photo_counts.values() if count > 1
                ),
                "matches": matches,
                "margin": margin,
                "members": sorted(
                    (row["faceKey"] for row in member_rows),
                    key=lambda key: key,
                ),
            }
        )

    cluster_payload.sort(
        key=lambda cluster: (
            -cluster["photoCount"],
            -cluster["faceCount"],
            -cluster["matches"][0]["similarity"],
            cluster["members"][0],
        )
    )
    cluster_by_face = {}
    for index, cluster in enumerate(cluster_payload, start=1):
        cluster["clusterId"] = f"z{index:03d}"
        cluster["repeated"] = cluster["photoCount"] >= 2
        for face_key in cluster["members"]:
            cluster_by_face[face_key] = cluster["clusterId"]
    for photo in photo_rows:
        for face in photo["faces"]:
            face["clusterId"] = cluster_by_face.get(face["faceKey"])

    repeated = [cluster for cluster in cluster_payload if cluster["repeated"]]
    fingerprint = hashlib.sha256()
    fingerprint.update(CATALOG_PATH.read_bytes())
    fingerprint.update(DETECTIONS_PATH.read_bytes())
    fingerprint.update(SIGNATURES_PATH.read_bytes())
    fingerprint.update(canonical_override_bytes(overrides))
    fingerprint.update(json.dumps(PARAMS, sort_keys=True).encode())

    report = {
        "schemaVersion": 1,
        "inputsFingerprint": fingerprint.hexdigest(),
        "params": PARAMS,
        "savedCropAnchors": saved_crop_anchors,
        "summary": {
            "catalogPhotos": len(catalog["photos"]),
            "savedFaceProfiles": len(set(profile_slugs)),
            "zeroTagPhotos": len(zero_tagged),
            "zeroTagPhotosWithDetectedFaces": len(photo_rows),
            "detectedFaces": all_face_count,
            "clusteringEligibleFaces": len(eligible_faces),
            "usableFaces": usable_face_count,
            "prominentFaces": prominent_face_count,
            "sameFaceClusters": len(cluster_payload),
            "repeatedSameFaceClusters": len(repeated),
            "facesInRepeatedClusters": sum(
                cluster["faceCount"] for cluster in repeated
            ),
            "photosInRepeatedClusters": len(
                {
                    face_key.split(":", 1)[0]
                    for cluster in repeated
                    for face_key in cluster["members"]
                }
            ),
        },
        "clusters": cluster_payload,
        "photos": photo_rows,
    }
    return report, detections


def render_markdown(report: dict) -> str:
    summary = report["summary"]
    lines = [
        "# Zero-tagged photo face review",
        "",
        "Review aid only. No tag was applied. Wedding originals were not opened.",
        "",
        f"- Catalog photos with zero people tags: {summary['zeroTagPhotos']}",
        "- Zero-tag photos with at least one detected face: "
        f"{summary['zeroTagPhotosWithDetectedFaces']}",
        f"- Detected faces in those photos: {summary['detectedFaces']}",
        f"- Clustering-eligible faces: {summary['clusteringEligibleFaces']}",
        f"- Usable faces: {summary['usableFaces']}",
        f"- Prominent faces: {summary['prominentFaces']}",
        "- Repeated same-face clusters: "
        f"{summary['repeatedSameFaceClusters']} "
        f"({summary['facesInRepeatedClusters']} faces)",
        "",
        "## Repeated same-face clusters",
        "",
        "| cluster | photos | faces | closest saved profile | match | margin | sample photos |",
        "| --- | ---: | ---: | --- | ---: | ---: | --- |",
    ]
    faces_by_key = {
        face["faceKey"]: face
        for photo in report["photos"]
        for face in photo["faces"]
    }
    for cluster in report["clusters"]:
        if not cluster["repeated"]:
            continue
        top = cluster["matches"][0]
        sample_paths = []
        for face_key in cluster["members"]:
            path = faces_by_key[face_key]["path"]
            if path not in sample_paths:
                sample_paths.append(path)
            if len(sample_paths) == 3:
                break
        lines.append(
            f"| {cluster['clusterId']} | {cluster['photoCount']} | "
            f"{cluster['faceCount']} | {top['name']} | "
            f"{top['similarity']:.3f} | {cluster['margin']:.3f} | "
            f"{', '.join(sample_paths)} |"
        )

    lines += [
        "",
        "## Photos with detected faces and zero tags",
        "",
        "| photo | faces | eligible | usable | best saved-profile candidates |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for photo in report["photos"]:
        eligible = [face for face in photo["faces"] if face["clusteringEligible"]]
        usable = [face for face in photo["faces"] if face["usable"]]
        candidates = ", ".join(
            f"f{face['faceIndex']} {face['matches'][0]['name']} "
            f"{face['matches'][0]['similarity']:.3f}"
            for face in eligible
        )
        lines.append(
            f"| {photo['path']} | {len(photo['faces'])} | {len(eligible)} | "
            f"{len(usable)} | {candidates or '(none)'} |"
        )
    lines.append("")
    return "\n".join(lines)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    names = (
        ["Arial Bold.ttf", "Arial.ttf"]
        if bold
        else ["Arial.ttf", "Arial Bold.ttf"]
    )
    for name in names:
        candidates = [
            Path("/System/Library/Fonts/Supplemental") / name,
            Path("/Library/Fonts") / name,
        ]
        for path in candidates:
            if path.exists():
                return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def ellipsize(value: str, limit: int) -> str:
    return value if len(value) <= limit else f"{value[: limit - 1]}…"


def open_derivative(photo_id: str) -> Image.Image:
    directory = DERIVATIVES_DIR / photo_id
    for filename in ("1600.webp", "960.webp", "480.webp"):
        path = directory / filename
        if path.exists():
            with Image.open(path) as source:
                return source.convert("RGB")
    raise FileNotFoundError(f"no local WebP derivative for {photo_id}")


def face_crop(
    image: Image.Image,
    detection: dict,
    face_index: int,
) -> Image.Image:
    faces_by_index = {face["i"]: face for face in detection["faces"]}
    face = faces_by_index[face_index]
    x1, y1, x2, y2 = (float(value) for value in face["bbox"])
    scale_x = image.width / float(detection["dw"])
    scale_y = image.height / float(detection["dh"])
    x1 *= scale_x
    x2 *= scale_x
    y1 *= scale_y
    y2 *= scale_y
    side = max(x2 - x1, y2 - y1) * 2.15
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    left = max(0.0, center_x - side / 2)
    top = max(0.0, center_y - side / 2)
    right = min(float(image.width), center_x + side / 2)
    bottom = min(float(image.height), center_y + side / 2)
    return ImageOps.fit(
        image.crop((left, top, right, bottom)),
        (CANDIDATE_SIZE, CANDIDATE_SIZE),
        Image.Resampling.LANCZOS,
    )


def prepare_output_directory(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for old in directory.glob("sheet-*.jpg"):
        old.unlink()


def render_photo_sheets(report: dict) -> int:
    prepare_output_directory(PHOTO_SHEETS_DIR)
    title_font = font(22, bold=True)
    body_font = font(15)
    label_font = font(14, bold=True)

    for offset in range(0, len(report["photos"]), PHOTO_PER_SHEET):
        page = report["photos"][offset : offset + PHOTO_PER_SHEET]
        canvas = Image.new(
            "RGB",
            (PHOTO_CELL_WIDTH * PHOTO_COLS, PHOTO_CELL_HEIGHT * PHOTO_ROWS),
            (247, 243, 235),
        )
        draw = ImageDraw.Draw(canvas)
        for index, photo in enumerate(page):
            column = index % PHOTO_COLS
            row = index // PHOTO_COLS
            left = column * PHOTO_CELL_WIDTH
            top = row * PHOTO_CELL_HEIGHT
            draw.rectangle(
                (left, top, left + PHOTO_CELL_WIDTH - 1, top + PHOTO_CELL_HEIGHT - 1),
                outline=(195, 185, 166),
                width=2,
            )
            draw.text(
                (left + 16, top + 12),
                ellipsize(photo["path"], 72),
                fill=(45, 38, 31),
                font=title_font,
            )
            source = open_derivative(photo["photoId"])
            display = ImageOps.contain(
                source,
                (PHOTO_CELL_WIDTH - 32, 450),
                Image.Resampling.LANCZOS,
            )
            image_left = left + (PHOTO_CELL_WIDTH - display.width) // 2
            image_top = top + 50
            canvas.paste(display, (image_left, image_top))
            scale_x = display.width / float(photo["dw"])
            scale_y = display.height / float(photo["dh"])
            for face in photo["faces"]:
                x1, y1, x2, y2 = face["bbox"]
                box = (
                    image_left + x1 * scale_x,
                    image_top + y1 * scale_y,
                    image_left + x2 * scale_x,
                    image_top + y2 * scale_y,
                )
                color = (
                    (77, 116, 83)
                    if face["clusteringEligible"]
                    else (177, 117, 64)
                )
                draw.rectangle(box, outline=color, width=3)
                cluster = face["clusterId"] or "tiny"
                label = f"f{face['faceIndex']} {cluster}"
                label_box = draw.textbbox((0, 0), label, font=label_font)
                label_width = label_box[2] - label_box[0] + 8
                label_height = label_box[3] - label_box[1] + 6
                label_left = box[0]
                label_top = max(image_top, box[1] - label_height)
                draw.rectangle(
                    (
                        label_left,
                        label_top,
                        label_left + label_width,
                        label_top + label_height,
                    ),
                    fill=color,
                )
                draw.text(
                    (label_left + 4, label_top + 2),
                    label,
                    fill=(255, 255, 255),
                    font=label_font,
                )
            eligible = [
                face for face in photo["faces"] if face["clusteringEligible"]
            ]
            candidate_text = " · ".join(
                f"f{face['faceIndex']} {face['matches'][0]['name']} "
                f"{face['matches'][0]['similarity']:.3f}"
                for face in eligible[:6]
            )
            if len(eligible) > 6:
                candidate_text += f" · +{len(eligible) - 6} more"
            draw.text(
                (left + 16, top + 516),
                f"{len(photo['faces'])} detected · {len(eligible)} cluster-ready",
                fill=(95, 82, 67),
                font=body_font,
            )
            draw.text(
                (left + 16, top + 542),
                ellipsize(candidate_text or "No cluster-ready face", 104),
                fill=(95, 82, 67),
                font=body_font,
            )
        sheet_number = offset // PHOTO_PER_SHEET + 1
        canvas.save(
            PHOTO_SHEETS_DIR / f"sheet-{sheet_number:03d}.jpg",
            quality=92,
            optimize=True,
        )
    return (len(report["photos"]) + PHOTO_PER_SHEET - 1) // PHOTO_PER_SHEET


def render_face_sheets(report: dict, detections: dict[str, dict]) -> int:
    prepare_output_directory(FACE_SHEETS_DIR)
    face_by_key = {
        face["faceKey"]: face
        for photo in report["photos"]
        for face in photo["faces"]
    }
    cluster_order = {
        cluster["clusterId"]: index for index, cluster in enumerate(report["clusters"])
    }
    faces = [
        face
        for face in face_by_key.values()
        if face["clusteringEligible"]
    ]
    faces.sort(
        key=lambda face: (
            cluster_order[face["clusterId"]],
            face["path"],
            face["faceIndex"],
        )
    )
    title_font = font(25, bold=True)
    body_font = font(17)
    small_font = font(14)

    for offset in range(0, len(faces), FACE_PER_SHEET):
        page = faces[offset : offset + FACE_PER_SHEET]
        canvas = Image.new(
            "RGB",
            (FACE_CELL_WIDTH * FACE_COLS, FACE_CELL_HEIGHT * FACE_ROWS),
            (247, 243, 235),
        )
        draw = ImageDraw.Draw(canvas)
        for index, face in enumerate(page):
            column = index % FACE_COLS
            row = index // FACE_COLS
            left = column * FACE_CELL_WIDTH
            top = row * FACE_CELL_HEIGHT
            draw.rectangle(
                (left, top, left + FACE_CELL_WIDTH - 1, top + FACE_CELL_HEIGHT - 1),
                outline=(195, 185, 166),
                width=2,
            )
            top_match = face["matches"][0]
            draw.text(
                (left + 18, top + 12),
                ellipsize(
                    f"{face['clusterId']} · {top_match['name']}",
                    36,
                ),
                fill=(45, 38, 31),
                font=title_font,
            )
            quality = (
                "prominent"
                if face["prominent"]
                else "usable"
                if face["usable"]
                else "cluster-only"
            )
            draw.text(
                (left + 18, top + 48),
                f"match {top_match['similarity']:.3f} · "
                f"margin {face['margin']:.3f} · {quality}",
                fill=(95, 82, 67),
                font=body_font,
            )

            profile_path = COMMITTED_FACES_DIR / f"{top_match['slug']}.webp"
            with Image.open(profile_path) as profile_source:
                profile = ImageOps.fit(
                    profile_source.convert("RGB"),
                    (PROFILE_SIZE, PROFILE_SIZE),
                    Image.Resampling.LANCZOS,
                )
            derivative = open_derivative(face["photoId"])
            candidate = face_crop(
                derivative,
                detections[face["photoId"]],
                face["faceIndex"],
            )
            profile_left = left + 18
            image_top = top + 84
            candidate_left = left + 232
            canvas.paste(profile, (profile_left, image_top))
            canvas.paste(candidate, (candidate_left, image_top))
            draw.text(
                (profile_left, image_top + PROFILE_SIZE + 8),
                "closest saved profile",
                fill=(95, 82, 67),
                font=small_font,
            )
            runners = ", ".join(
                f"{match['name']} {match['similarity']:.3f}"
                for match in face["matches"][1:]
            )
            draw.text(
                (profile_left, top + 500),
                ellipsize(
                    f"f{face['faceIndex']} · {face['path']}",
                    76,
                ),
                fill=(95, 82, 67),
                font=small_font,
            )
            draw.text(
                (profile_left, top + 522),
                ellipsize(f"runners: {runners}", 82),
                fill=(95, 82, 67),
                font=small_font,
            )
        sheet_number = offset // FACE_PER_SHEET + 1
        canvas.save(
            FACE_SHEETS_DIR / f"sheet-{sheet_number:03d}.jpg",
            quality=92,
            optimize=True,
        )
    return (len(faces) + FACE_PER_SHEET - 1) // FACE_PER_SHEET


def main() -> None:
    report, detections = build_report()
    REPORT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON_PATH.write_text(
        f"{json.dumps(report, indent=1)}\n",
        encoding="utf-8",
    )
    REPORT_MD_PATH.write_text(render_markdown(report), encoding="utf-8")
    photo_sheet_count = render_photo_sheets(report)
    face_sheet_count = render_face_sheets(report, detections)
    summary = report["summary"]
    print(
        "zero-tag review:\n"
        f"  {summary['zeroTagPhotosWithDetectedFaces']} photos with detected faces "
        f"out of {summary['zeroTagPhotos']} zero-tag photos\n"
        f"  {summary['detectedFaces']} detected faces; "
        f"{summary['clusteringEligibleFaces']} clustering-eligible\n"
        f"  {summary['repeatedSameFaceClusters']} repeated same-face clusters "
        f"covering {summary['facesInRepeatedClusters']} faces\n"
        f"  rendered {photo_sheet_count} photo sheets and "
        f"{face_sheet_count} cluster-sorted face sheets\n"
        f"wrote {REPORT_JSON_PATH}\n"
        f"wrote {REPORT_MD_PATH}"
    )


if __name__ == "__main__":
    main()

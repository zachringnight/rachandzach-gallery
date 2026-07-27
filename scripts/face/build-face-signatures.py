#!/usr/bin/env python3
"""Build per-person face signatures from the confirmed-tagged wedding archive.

Local-only InsightFace (buffalo_l) pipeline. Two phases:

Phase 1 (slow, resumable): detect and embed every face in the 1,721-photo
clean master. Reads originals from the source master (READ-ONLY), decodes at
a bounded edge, runs detection at a bounded det size, and appends one JSON
line per photo to metadata/faces/detections.jsonl. Interrupt any time; the
next run skips photos already checkpointed.

Phase 2 (fast, deterministic): cluster face embeddings, resolve cluster ->
person identities by co-occurrence with the catalog's confirmed peopleSlugs
(solo and small-group photos anchor; a cluster must co-occur with a tag
across multiple photos before it earns the name), then write
metadata/faces/signatures.json with per-person centroids plus the clusters
that stayed unresolved.

Privacy: embeddings and signatures never leave local disk. metadata/faces/
is gitignored. Nothing here is guest-facing; this feeds an admin review
list only.

Usage (from the repo root):
  uv run --no-project --python .venv-faces/bin/python \
      scripts/face/build-face-signatures.py [--limit N]
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import queue
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MASTER = Path(
    os.environ.get("WEDDING_MASTER_ROOT")
    or os.environ.get("SOURCE_PHOTO_DIR")
    or "/Users/zsoskin/Rachel & Zach - Wedding Master Clean"
)
CATALOG_PATH = REPO / "src" / "generated" / "gallery-v2.json"
OUT_DIR = REPO / "metadata" / "faces"
DETECTIONS_PATH = OUT_DIR / "detections.jsonl"
SIGNATURES_PATH = OUT_DIR / "signatures.json"

# The archive has 100+ MP frames; it is a trusted local corpus, not untrusted input.
Image.MAX_IMAGE_PIXELS = None

# ---- Phase 1 knobs -----------------------------------------------------------
MAX_EDGE = 2048          # decode target (long edge, px); JPEG draft-scales first
DET_SIZE = 640           # SCRFD input size; benchmarked full recall on posed groups
DECODE_WORKERS = 3       # threads decoding ahead of the single inference thread
PREFETCH = 8             # bounded queue: caps resident decoded frames (~9 MB each)
PROGRESS_EVERY = 25

# ---- Phase 2 knobs (calibrated on this archive; see scripts/face/README.md) --
MIN_FACE_SCORE = 0.65    # detector confidence floor for clustering eligibility
MIN_FACE_FRAC = 0.018    # face bbox height / image long edge floor for clustering
T_EDGE = 0.60            # cosine sim for the initial union-find edges
T_MERGE = 0.52           # cosine sim for centroid-level cluster merges
MIN_SUPPORT_DEFAULT = 3  # photos of co-occurrence a cluster needs to earn a name
MIN_SUPPORT_RARE = 2     # floor for people with <= 4 tagged photos total
RARE_PHOTO_COUNT = 4
RATIO_MIN = 1.6          # top slug's weighted score must beat runner-up by this
NAMING_ITERATIONS = 4    # explaining-away passes
SCHEMA_VERSION = 1

PARAMS = {
    "maxEdge": MAX_EDGE,
    "detSize": DET_SIZE,
    "minFaceScore": MIN_FACE_SCORE,
    "minFaceFrac": MIN_FACE_FRAC,
    "tEdge": T_EDGE,
    "tMerge": T_MERGE,
    "minSupportDefault": MIN_SUPPORT_DEFAULT,
    "minSupportRare": MIN_SUPPORT_RARE,
    "rarePhotoCount": RARE_PHOTO_COUNT,
    "ratioMin": RATIO_MIN,
    "namingIterations": NAMING_ITERATIONS,
    "model": "insightface/buffalo_l",
}


def log(msg: str) -> None:
    print(msg, flush=True)


# =============================================================================
# Phase 1: detection + embedding, checkpointed
# =============================================================================

def load_catalog() -> dict:
    with CATALOG_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_checkpoint() -> dict[str, dict]:
    """Read detections.jsonl, tolerating a truncated final line from a crash."""
    records: dict[str, dict] = {}
    if not DETECTIONS_PATH.exists():
        return records
    raw = DETECTIONS_PATH.read_bytes()
    good_bytes = 0
    bad_lines = 0
    for line in raw.splitlines(keepends=True):
        stripped = line.strip()
        if not stripped:
            good_bytes += len(line)
            continue
        try:
            record = json.loads(stripped)
            records[record["photoId"]] = record
            good_bytes += len(line)
        except (json.JSONDecodeError, KeyError):
            bad_lines += 1
    if bad_lines:
        if good_bytes < len(raw):
            log(f"checkpoint: dropping {bad_lines} partial trailing line(s); truncating file")
            with DETECTIONS_PATH.open("r+b") as handle:
                handle.truncate(good_bytes)
        else:
            raise SystemExit(
                "detections.jsonl has corrupt lines that are not trailing; "
                "inspect the file or delete it to re-run detection from scratch"
            )
    return records


def decode_bgr(path: Path) -> np.ndarray:
    """Decode a JPEG to BGR at a bounded long edge, honoring EXIF orientation."""
    with Image.open(path) as source:
        source.draft("RGB", (MAX_EDGE, MAX_EDGE))  # DCT-domain fast downscale
        image = ImageOps.exif_transpose(source)
        image = image.convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    return np.asarray(image)[:, :, ::-1].copy()


def run_detection(photos: list[dict], master: Path, limit: int | None) -> None:
    done = load_checkpoint()
    todo = [p for p in photos if p["id"] not in done]
    if limit is not None:
        todo = todo[:limit]
    if not todo:
        log(f"phase 1: all {len(done)} photos already detected; nothing to do")
        return
    log(f"phase 1: {len(done)} checkpointed, {len(todo)} to detect")

    from insightface.app import FaceAnalysis  # deferred: heavy import

    app = FaceAnalysis(
        name="buffalo_l",
        providers=["CPUExecutionProvider"],
        allowed_modules=["detection", "recognition"],
    )
    app.prepare(ctx_id=0, det_size=(DET_SIZE, DET_SIZE))

    work: queue.Queue = queue.Queue()
    results: queue.Queue = queue.Queue(maxsize=PREFETCH)
    for photo in todo:
        work.put(photo)

    def decoder() -> None:
        while True:
            try:
                photo = work.get_nowait()
            except queue.Empty:
                return
            path = master / photo["originalRelativePath"]
            try:
                image = decode_bgr(path)
                results.put((photo, image, None))
            except Exception as exc:  # noqa: BLE001 - propagate decode failures per photo
                results.put((photo, None, f"{type(exc).__name__}: {exc}"))

    threads = [threading.Thread(target=decoder, daemon=True) for _ in range(DECODE_WORKERS)]
    for thread in threads:
        thread.start()

    started = time.time()
    processed = 0
    face_total = 0
    failures = 0
    with DETECTIONS_PATH.open("a", encoding="utf-8") as sink:
        for _ in range(len(todo)):
            photo, image, error = results.get()
            if error is not None:
                failures += 1
                log(f"DECODE FAILED {photo['originalRelativePath']}: {error}")
                continue
            faces = app.get(image)
            faces.sort(key=lambda f: (float(f.bbox[0]), float(f.bbox[1])))
            height, width = image.shape[:2]
            record = {
                "photoId": photo["id"],
                "path": photo["originalRelativePath"],
                "dw": width,
                "dh": height,
                "faces": [
                    {
                        "i": index,
                        "bbox": [round(float(v), 1) for v in face.bbox],
                        "score": round(float(face.det_score), 4),
                        "emb": base64.b64encode(
                            np.asarray(face.normed_embedding, dtype=np.float32).tobytes()
                        ).decode("ascii"),
                    }
                    for index, face in enumerate(faces)
                ],
            }
            sink.write(json.dumps(record, separators=(",", ":")) + "\n")
            sink.flush()
            processed += 1
            face_total += len(faces)
            if processed % PROGRESS_EVERY == 0 or processed == len(todo):
                elapsed = time.time() - started
                rate = processed / elapsed
                remaining = (len(todo) - processed) / rate if rate else 0
                log(
                    f"  {processed}/{len(todo)} photos  {face_total} faces  "
                    f"{rate:.2f}/s  eta {remaining/60:.1f} min"
                )
    if failures:
        log(f"phase 1: WARNING {failures} photos failed to decode (see above)")
    log(
        f"phase 1: done. {processed} photos, {face_total} faces, "
        f"{(time.time() - started)/60:.1f} min wall"
    )


# =============================================================================
# Phase 2: clustering + co-occurrence identity resolution
# =============================================================================

class Face:
    __slots__ = ("photo_id", "index", "bbox", "score", "frac", "row")

    def __init__(self, photo_id: str, index: int, bbox: list[float], score: float, frac: float):
        self.photo_id = photo_id
        self.index = index
        self.bbox = bbox
        self.score = score
        self.frac = frac
        self.row = -1  # row in the embedding matrix


def load_faces_for_clustering(records: dict[str, dict]) -> tuple[list[Face], np.ndarray, int]:
    faces: list[Face] = []
    embeddings: list[bytes] = []
    total = 0
    for photo_id in sorted(records):
        record = records[photo_id]
        long_edge = max(record["dw"], record["dh"])
        for face in record["faces"]:
            total += 1
            frac = (face["bbox"][3] - face["bbox"][1]) / long_edge
            if face["score"] < MIN_FACE_SCORE or frac < MIN_FACE_FRAC:
                continue
            item = Face(photo_id, face["i"], face["bbox"], face["score"], frac)
            item.row = len(faces)
            faces.append(item)
            embeddings.append(base64.b64decode(face["emb"]))
    matrix = np.frombuffer(b"".join(embeddings), dtype=np.float32).reshape(len(faces), 512)
    matrix = np.ascontiguousarray(matrix)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    matrix = matrix / np.clip(norms, 1e-8, None)
    return faces, matrix, total


class UnionFind:
    def __init__(self, size: int):
        self.parent = list(range(size))

    def find(self, a: int) -> int:
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if ra > rb:
                ra, rb = rb, ra
            self.parent[rb] = ra


def initial_components(faces: list[Face], matrix: np.ndarray) -> list[list[int]]:
    """Union faces whose cosine sim >= T_EDGE, never within the same photo."""
    n = len(faces)
    uf = UnionFind(n)
    block = 512
    for start in range(0, n, block):
        stop = min(start + block, n)
        sims = matrix[start:stop] @ matrix.T  # (block, n)
        for local in range(stop - start):
            gi = start + local
            row = sims[local, gi + 1:]
            for offset in np.nonzero(row >= T_EDGE)[0]:
                gj = gi + 1 + int(offset)
                if faces[gi].photo_id != faces[gj].photo_id:
                    uf.union(gi, gj)
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[uf.find(i)].append(i)
    return [sorted(members) for _, members in sorted(groups.items())]


def merge_components(
    components: list[list[int]], faces: list[Face], matrix: np.ndarray
) -> list[list[int]]:
    """Greedy centroid-level merges above T_MERGE.

    Cannot-link guard: two clusters that appear together in >= 2 photos are two
    different people (one person cannot be in the same frame twice), so they
    never merge no matter how similar (siblings, twins).
    """
    clusters = [list(c) for c in components]
    centroids = []
    photo_sets = []
    for members in clusters:
        centroid = matrix[members].mean(axis=0)
        centroids.append(centroid / max(np.linalg.norm(centroid), 1e-8))
        photo_sets.append({faces[i].photo_id for i in members})
    centroid_matrix = np.stack(centroids)
    alive = [True] * len(clusters)

    def overlap_blocked(a: int, b: int) -> bool:
        return len(photo_sets[a] & photo_sets[b]) >= 2

    sims = centroid_matrix @ centroid_matrix.T
    np.fill_diagonal(sims, -1.0)
    iterations = 0
    max_iterations = 10 * len(clusters) + 10000
    while True:
        iterations += 1
        if iterations > max_iterations:
            log("phase 2: WARNING merge loop hit its safety cap; keeping current clusters")
            break
        flat = np.argmax(sims)
        a, b = int(flat // sims.shape[1]), int(flat % sims.shape[1])
        if sims[a, b] < T_MERGE:
            break
        if overlap_blocked(a, b):
            sims[a, b] = sims[b, a] = -1.0
            continue
        if b < a:
            a, b = b, a
        clusters[a].extend(clusters[b])
        clusters[a].sort()
        clusters[b] = []
        alive[b] = False
        photo_sets[a] |= photo_sets[b]
        centroid = matrix[clusters[a]].mean(axis=0)
        centroid_matrix[a] = centroid / max(np.linalg.norm(centroid), 1e-8)
        row = centroid_matrix @ centroid_matrix[a]
        row[~np.asarray(alive)] = -1.0
        row[a] = -1.0
        sims[a, :] = row
        sims[:, a] = row
        sims[b, :] = -1.0
        sims[:, b] = -1.0
    return [c for c, ok in zip(clusters, alive) if ok and c]


def resolve_identities(
    clusters: list[list[int]],
    faces: list[Face],
    catalog: dict,
) -> tuple[dict[int, str], dict, dict]:
    """Assign clusters to peopleSlugs via weighted, explained-away co-occurrence.

    Evidence rule: in a photo tagged with k people, only the k most prominent
    clustered faces carry tag evidence, each at weight 1/k. Solo photos are
    the strongest anchors (k=1, full weight, dominant face only).
    """
    photo_tags = {p["id"]: p["peopleSlugs"] for p in catalog["photos"]}
    person_photo_count: dict[str, int] = defaultdict(int)
    for tags in photo_tags.values():
        for slug in tags:
            person_photo_count[slug] += 1

    cluster_of_face = {}
    for cluster_id, members in enumerate(clusters):
        for i in members:
            cluster_of_face[i] = cluster_id

    # Per photo: clustered faces present, ranked by prominence (bbox height frac).
    photo_faces: dict[str, list[Face]] = defaultdict(list)
    for face in faces:
        if face.row in cluster_of_face:
            photo_faces[face.photo_id].append(face)

    # evidence_by_cluster[cluster][slug] -> list of (photo_id, weight, k)
    evidence_by_cluster: dict[int, dict[str, list[tuple[str, float, int]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    cluster_photos: dict[int, set[str]] = defaultdict(set)
    photo_cluster_sets: dict[str, set[int]] = {}
    for photo_id, present in photo_faces.items():
        tags = photo_tags.get(photo_id, [])
        present_sorted = sorted(present, key=lambda f: (-f.frac, f.index))
        present_clusters = []
        seen = set()
        for face in present_sorted:
            cluster_id = cluster_of_face[face.row]
            cluster_photos[cluster_id].add(photo_id)
            if cluster_id not in seen:
                seen.add(cluster_id)
                present_clusters.append(cluster_id)
        photo_cluster_sets[photo_id] = seen
        if not tags:
            continue
        k = len(tags)
        weight = 1.0 / k
        for cluster_id in present_clusters[:k]:
            for slug in tags:
                evidence_by_cluster[cluster_id][slug].append((photo_id, weight, k))

    assigned: dict[int, str] = {}
    person_clusters: dict[str, list[int]] = defaultdict(list)
    diagnostics: dict[int, dict] = {}

    def photo_explained(photo_id: str, slug: str, exclude_cluster: int) -> bool:
        for cluster_id in photo_cluster_sets[photo_id]:
            if cluster_id != exclude_cluster and assigned.get(cluster_id) == slug:
                return True
        return False

    for _ in range(NAMING_ITERATIONS):
        candidates = []
        for cluster_id, slug_rows in evidence_by_cluster.items():
            if cluster_id in assigned:
                continue
            scores: dict[str, float] = defaultdict(float)
            supports: dict[str, int] = defaultdict(int)
            solos: dict[str, int] = defaultdict(int)
            for slug, rows in slug_rows.items():
                for photo_id, weight, k in rows:
                    if photo_explained(photo_id, slug, cluster_id):
                        continue
                    scores[slug] += weight
                    supports[slug] += 1
                    if k == 1:
                        solos[slug] += 1
            if not scores:
                continue
            ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
            top_slug, top_score = ranked[0]
            runner_score = ranked[1][1] if len(ranked) > 1 else 0.0
            support = supports[top_slug]
            min_support = (
                MIN_SUPPORT_RARE
                if person_photo_count.get(top_slug, 0) <= RARE_PHOTO_COUNT
                else MIN_SUPPORT_DEFAULT
            )
            if support < min_support:
                continue
            if runner_score > 0 and top_score < RATIO_MIN * runner_score:
                continue
            # Same person twice in one frame is impossible: a new cluster for a
            # slug must not co-appear with that slug's existing clusters.
            conflict = any(
                len(cluster_photos[cluster_id] & cluster_photos[other]) >= 2
                for other in person_clusters[top_slug]
            )
            if conflict:
                continue
            margin = top_score / (top_score + runner_score) if top_score else 0.0
            support_factor = support / (support + 3.0)
            confidence = min(0.99, margin * support_factor + 0.02 * min(solos[top_slug], 3))
            candidates.append(
                (
                    top_score,
                    cluster_id,
                    top_slug,
                    {
                        "score": round(top_score, 3),
                        "runnerUpScore": round(runner_score, 3),
                        "support": support,
                        "soloSupport": solos[top_slug],
                        "confidence": round(confidence, 3),
                    },
                )
            )
        if not candidates:
            break
        candidates.sort(key=lambda item: (-item[0], item[1]))
        added = 0
        for _, cluster_id, slug, info in candidates:
            if cluster_id in assigned:
                continue
            conflict = any(
                len(cluster_photos[cluster_id] & cluster_photos[other]) >= 2
                for other in person_clusters[slug]
            )
            if conflict:
                continue
            assigned[cluster_id] = slug
            person_clusters[slug].append(cluster_id)
            diagnostics[cluster_id] = info
            added += 1
        if not added:
            break

    aux = {"clusterPhotos": cluster_photos, "evidenceByCluster": evidence_by_cluster}
    return assigned, diagnostics, aux


def build_signatures(records: dict[str, dict], catalog: dict) -> dict:
    faces, matrix, total_faces = load_faces_for_clustering(records)
    log(
        f"phase 2: {total_faces} faces detected, {len(faces)} eligible for clustering "
        f"(score>={MIN_FACE_SCORE}, frac>={MIN_FACE_FRAC})"
    )
    components = initial_components(faces, matrix)
    log(f"phase 2: {len(components)} components at edge sim >= {T_EDGE}")
    clusters = merge_components(components, faces, matrix)
    multi = sum(1 for c in clusters if len(c) >= 2)
    log(f"phase 2: {len(clusters)} clusters after centroid merges (>=2 faces: {multi})")

    assigned, diagnostics, aux = resolve_identities(clusters, faces, catalog)
    cluster_photos = aux["clusterPhotos"]
    evidence_by_cluster = aux["evidenceByCluster"]
    people_by_slug = {p["slug"]: p for p in catalog["people"]}

    def centroid_of(members: list[int]) -> np.ndarray:
        centroid = matrix[members].mean(axis=0)
        return centroid / max(np.linalg.norm(centroid), 1e-8)

    # Calibration stats: genuine = assigned faces vs their own centroid;
    # impostor = assigned centroids vs faces of OTHER assigned people.
    genuine: list[float] = []
    impostor_max = 0.0
    impostor: list[float] = []
    assigned_items = sorted(assigned.items())
    centroid_cache = {cid: centroid_of(clusters[cid]) for cid, _ in assigned_items}
    for cid, slug in assigned_items:
        sims = matrix[clusters[cid]] @ centroid_cache[cid]
        genuine.extend(float(s) for s in sims)
        for other_cid, other_slug in assigned_items:
            if other_slug == slug:
                continue
            cross = matrix[clusters[other_cid]] @ centroid_cache[cid]
            peak = float(cross.max())
            impostor.append(peak)
            impostor_max = max(impostor_max, peak)
    genuine_arr = np.array(genuine) if genuine else np.array([0.0])
    impostor_arr = np.array(impostor) if impostor else np.array([0.0])
    calibration = {
        "genuineP05": round(float(np.percentile(genuine_arr, 5)), 3),
        "genuineP25": round(float(np.percentile(genuine_arr, 25)), 3),
        "genuineMedian": round(float(np.percentile(genuine_arr, 50)), 3),
        "impostorP95": round(float(np.percentile(impostor_arr, 95)), 3),
        "impostorP99": round(float(np.percentile(impostor_arr, 99)), 3),
        "impostorMax": round(impostor_max, 3),
    }

    person_entries = []
    for slug in sorted({slug for slug in assigned.values()}):
        cluster_ids = sorted(cid for cid, s in assigned.items() if s == slug)
        cluster_payload = []
        for cid in cluster_ids:
            members = clusters[cid]
            info = diagnostics[cid]
            samples = sorted(members, key=lambda i: -faces[i].frac)[:3]
            cluster_payload.append(
                {
                    "clusterId": f"c{cid:04d}",
                    "faceCount": len(members),
                    "photoCount": len(cluster_photos[cid]),
                    "support": info["support"],
                    "soloSupport": info["soloSupport"],
                    "score": info["score"],
                    "runnerUpScore": info["runnerUpScore"],
                    "confidence": info["confidence"],
                    "centroid": [round(float(v), 5) for v in centroid_cache[cid]],
                    "sampleFaces": [
                        {
                            "photoId": faces[i].photo_id,
                            "faceIndex": faces[i].index,
                            "bbox": faces[i].bbox,
                        }
                        for i in samples
                    ],
                }
            )
        person_entries.append(
            {
                "slug": slug,
                "name": people_by_slug.get(slug, {}).get("name", slug),
                "taggedPhotoCount": people_by_slug.get(slug, {}).get("photoCount", 0),
                "clusters": cluster_payload,
                "faceCount": sum(c["faceCount"] for c in cluster_payload),
                "bestConfidence": max(c["confidence"] for c in cluster_payload),
            }
        )

    unresolved = []
    for cid, members in enumerate(clusters):
        if cid in assigned or len(members) < 2:
            continue
        top_tags = []
        pair_rows = list(evidence_by_cluster.get(cid, {}).items())
        for slug, rows in sorted(
            pair_rows, key=lambda kv: (-sum(w for _, w, _ in kv[1]), kv[0])
        )[:3]:
            top_tags.append(
                {
                    "slug": slug,
                    "score": round(sum(w for _, w, _ in rows), 3),
                    "support": len(rows),
                }
            )
        ordered = sorted(members, key=lambda i: -faces[i].frac)
        def face_ref(i: int) -> dict:
            return {
                "photoId": faces[i].photo_id,
                "faceIndex": faces[i].index,
                "bbox": faces[i].bbox,
            }
        unresolved.append(
            {
                "clusterId": f"c{cid:04d}",
                "faceCount": len(members),
                "photoCount": len(cluster_photos[cid]),
                "topCoTags": top_tags,
                # The three biggest faces, for a quick read of who this is.
                "sampleFaces": [face_ref(i) for i in ordered[:3]],
                # Every face in the cluster. Naming a cluster tags all of
                # them, so a truncated list would silently drop photos: the
                # largest cluster here is 21 faces against 3 samples.
                "members": [face_ref(i) for i in ordered],
            }
        )
    unresolved.sort(key=lambda entry: (-entry["faceCount"], entry["clusterId"]))

    resolved_slugs = set(assigned.values())
    tagged_slugs = {s for p in catalog["photos"] for s in p["peopleSlugs"]}
    fingerprint = hashlib.sha256()
    fingerprint.update(CATALOG_PATH.read_bytes())
    fingerprint.update(DETECTIONS_PATH.read_bytes())
    fingerprint.update(json.dumps(PARAMS, sort_keys=True).encode())

    return {
        "schemaVersion": SCHEMA_VERSION,
        "inputsFingerprint": fingerprint.hexdigest(),
        "params": PARAMS,
        "calibration": calibration,
        "summary": {
            "photosDetected": len(records),
            "facesDetected": total_faces,
            "facesClustered": len(faces),
            "clusters": len(clusters),
            "clustersWithTwoPlusFaces": multi,
            "resolvedPeople": len(resolved_slugs),
            "taggedPeopleInCatalog": len(tagged_slugs),
            "peopleInCatalog": len(catalog["people"]),
            "unresolvedClustersListed": len(unresolved),
            "unlistedSingletonClusters": sum(
                1 for cid, m in enumerate(clusters) if cid not in assigned and len(m) < 2
            ),
        },
        "people": person_entries,
        "unresolvedClusters": unresolved,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None,
                        help="detect at most N new photos this run (smoke tests)")
    parser.add_argument("--master-root", type=Path, default=DEFAULT_MASTER,
                        help="source master root (read-only)")
    args = parser.parse_args()

    if not args.master_root.is_dir():
        raise SystemExit(f"source master not found: {args.master_root}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    catalog = load_catalog()
    photos = catalog["photos"]
    log(f"catalog: {len(photos)} photos, {len(catalog['people'])} people")

    started = time.time()
    run_detection(photos, args.master_root, args.limit)

    records = load_checkpoint()
    missing = len(photos) - len([p for p in photos if p["id"] in records])
    if missing:
        log(
            f"phase 2: skipped — {missing} photos still undetected "
            f"(re-run without --limit to finish phase 1 first)"
        )
        return

    signatures = build_signatures(records, catalog)
    tmp_path = SIGNATURES_PATH.with_suffix(".json.tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(signatures, handle, separators=(",", ":"))
        handle.write("\n")
    tmp_path.replace(SIGNATURES_PATH)
    summary = signatures["summary"]
    log(
        f"signatures: {summary['resolvedPeople']}/{summary['taggedPeopleInCatalog']} tagged people "
        f"resolved, {summary['unresolvedClustersListed']} unresolved multi-face clusters, "
        f"calibration {signatures['calibration']}"
    )
    log(f"total wall time {(time.time() - started)/60:.1f} min")
    log(f"wrote {SIGNATURES_PATH}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Backward audit: compare detected face identities against catalog tags.

Consumes the artifacts written by build-face-signatures.py plus the committed
admin face picks in src/generated/person-overrides.json (no model inference
here, pure numpy over saved embeddings, so re-runs take seconds and are
byte-for-byte idempotent for unchanged inputs). The learned signatures cover
the people with enough existing tags; a hand-picked crop supplies the missing
single-face anchor for people who could not be learned from co-occurrence.
Together those are the saved face profiles used by the gallery.

Produces a ranked REVIEW LIST for a human. It never edits tags, the catalog,
or anything else.

Two buckets:
  (a) tagged-but-no-matching-face: a confirmed tag whose person's signature
      matches no detected face in that photo. Severity separates "plenty of
      other identified faces, this person is just not among them" (likely a
      mistag) from "few or no usable faces" (probably back-of-head or
      occlusion, tag likely fine).
  (b) confident-face-but-untagged: a prominent, high-confidence face that
      matches a person's signature while that person is missing from the tags.
      Incidental background guests are excluded by design: small faces and
      sub-threshold matches are never flagged.

Usage (from the repo root):
  uv run --no-project --python .venv-faces/bin/python \
      scripts/face/audit-archive-tags.py

Bucket (b)'s floors are flags so a wider review wave can surface the
mid-ground guests the calibrated defaults exclude. Run bare to reproduce the
calibrated report; widen into a SEPARATE report so the baseline survives:
  ... audit-archive-tags.py --min-untagged-face-frac 0.015 \
      --min-untagged-det-score 0.60 \
      --report-json metadata/faces/audit-report-wide.json \
      --report-md metadata/faces/audit-report-wide.md
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
CATALOG_PATH = REPO / "src" / "generated" / "gallery-v2.json"
FACES_DIR = REPO / "metadata" / "faces"
DETECTIONS_PATH = FACES_DIR / "detections.jsonl"
SIGNATURES_PATH = FACES_DIR / "signatures.json"
OVERRIDES_PATH = REPO / "src" / "generated" / "person-overrides.json"
# Slugs whose learned signature is the wrong person; see the file's own
# "purpose" note. Optional: absent file means no corrections, which is the
# behaviour every run before this existed.
CORRECTIONS_PATH = REPO / "metadata" / "face-profile-corrections.json"
REPORT_JSON_PATH = FACES_DIR / "audit-report.json"
REPORT_MD_PATH = FACES_DIR / "audit-report.md"

# ---- Thresholds (calibrated on this archive; see scripts/face/README.md) ----
# Bucket (a): a tag counts as "matched" when any face in the photo reaches
# T_PRESENT against that person's centroid(s). Below T_ABSENT_HARD the person's
# face is definitively not visible in the frame.
T_PRESENT = 0.36
T_ABSENT_HARD = 0.30
# A face is "identified" as a person when it reaches T_IDENT (used to explain
# which people ARE visible in a flagged photo).
T_IDENT = 0.50
# Bucket (b): untagged-person flags require a prominent face (fraction of the
# image long edge), a confident detection, a strong match, and a clear margin
# over the runner-up person, so incidental background guests never surface.
MIN_UNTAGGED_FACE_FRAC = 0.035
MIN_UNTAGGED_DET_SCORE = 0.70
T_UNTAGGED = 0.55
T_UNTAGGED_STRONG = 0.62
MIN_UNTAGGED_MARGIN = 0.08
# Faces counted as "usable" when judging whether everyone tagged could have
# been matched at all.
MIN_USABLE_DET_SCORE = 0.70
MIN_USABLE_FACE_FRAC = 0.025


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # Bucket (b) floors only. Every default is the calibrated constant above,
    # so a bare run reproduces the existing report byte for byte; the params
    # feed the inputs fingerprint, so a widened run cannot be mistaken for a
    # calibrated one. Bucket (a) and the "usable face" floors stay fixed:
    # they define what the audit considers answerable at all.
    parser.add_argument(
        "--min-untagged-face-frac", type=float, default=MIN_UNTAGGED_FACE_FRAC,
        help="face height as a fraction of the image long edge (default "
             f"{MIN_UNTAGGED_FACE_FRAC}; lower to surface background guests)",
    )
    parser.add_argument(
        "--min-untagged-det-score", type=float, default=MIN_UNTAGGED_DET_SCORE,
        help=f"detector confidence floor (default {MIN_UNTAGGED_DET_SCORE})",
    )
    parser.add_argument(
        "--min-untagged-sim", type=float, default=T_UNTAGGED,
        help=f"cosine similarity floor (default {T_UNTAGGED})",
    )
    parser.add_argument(
        "--min-untagged-margin", type=float, default=MIN_UNTAGGED_MARGIN,
        help="required lead over the runner-up PERSON (default "
             f"{MIN_UNTAGGED_MARGIN}; this is what keeps lookalike relatives "
             "apart, so lower it with care)",
    )
    parser.add_argument(
        "--untagged-strong-sim", type=float, default=T_UNTAGGED_STRONG,
        help=f"strong-tier similarity (default {T_UNTAGGED_STRONG})",
    )
    parser.add_argument("--report-json", type=Path, default=REPORT_JSON_PATH)
    parser.add_argument("--report-md", type=Path, default=REPORT_MD_PATH)
    return parser.parse_args()


def load_detections() -> dict[str, dict]:
    records = {}
    with DETECTIONS_PATH.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            records[record["photoId"]] = record
    return records


def decode_embeddings(faces: list[dict]) -> np.ndarray:
    """Decode the unit face vectors stored by build-face-signatures.py."""
    return np.frombuffer(
        b"".join(base64.b64decode(face["emb"]) for face in faces),
        dtype=np.float32,
    ).reshape(len(faces), 512)


def face_for_saved_crop(record: dict, crop: dict) -> tuple[dict, np.ndarray, dict]:
    """Resolve one normalized admin crop to exactly one saved detection.

    Face crops use source-image normalized coordinates:
      x = left / width, y = top / height, size = side / min(width, height).
    The detector's bounded decode preserves the source aspect ratio, so the
    same formula maps the crop onto dw/dh without opening an original.

    A valid admin crop should fully contain its intended detected face. We
    rank eligible faces by center containment, face coverage, and distance to
    the crop center; ambiguity fails closed rather than learning the wrong
    person.
    """
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
        # Two nearly identical crop fits would make the identity ambiguous.
        if best[0] - runner[0] < 0.02 and best[1] - runner[1] < 0.05:
            raise ValueError("saved crop contains multiple ambiguous faces")

    selected_index = ranked[0][3]
    embeddings = decode_embeddings(faces)
    return faces[selected_index], embeddings[selected_index], ranked[0][4]


def load_corrections() -> dict[str, dict]:
    """Slugs whose learned signature is a different person entirely."""
    if not CORRECTIONS_PATH.exists():
        return {}
    data = json.loads(CORRECTIONS_PATH.read_text(encoding="utf-8"))
    return {c["slug"]: c for c in data.get("corrections", [])}


def saved_crop_anchors(
    detections: dict[str, dict],
    overrides: dict,
    learned_slugs: set[str],
    corrected: dict[str, dict] | None = None,
) -> tuple[list[tuple[str, np.ndarray]], list[dict]]:
    """Return authoritative single-face anchors not already learned."""
    corrected = corrected or {}
    anchors = []
    details = []
    for slug, choice in sorted(overrides.get("people", {}).items()):
        # Learned multi-photo signatures are more robust. The crop is the
        # authoritative fallback only for the profiles co-occurrence could
        # not resolve -- OR for a slug whose learned signature is recorded as
        # the wrong person, where one correct frame beats many wrong ones.
        if slug in learned_slugs and slug not in corrected:
            continue
        photo_id = choice["photoId"]
        record = detections.get(photo_id)
        if record is None:
            raise ValueError(
                f"saved face for {slug} references missing detection {photo_id}"
            )
        _face, embedding, fit = face_for_saved_crop(record, choice["crop"])
        anchors.append((slug, embedding))
        details.append({"slug": slug, "photoId": photo_id, **fit})
    return anchors, details


def main() -> None:
    args = parse_args()
    params = {
        "tPresent": T_PRESENT,
        "tAbsentHard": T_ABSENT_HARD,
        "tIdent": T_IDENT,
        "minUntaggedFaceFrac": args.min_untagged_face_frac,
        "minUntaggedDetScore": args.min_untagged_det_score,
        "tUntagged": args.min_untagged_sim,
        "tUntaggedStrong": args.untagged_strong_sim,
        "minUntaggedMargin": args.min_untagged_margin,
        "minUsableDetScore": MIN_USABLE_DET_SCORE,
        "minUsableFaceFrac": MIN_USABLE_FACE_FRAC,
    }

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    signatures = json.loads(SIGNATURES_PATH.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
    corrections = load_corrections()
    detections = load_detections()

    people_by_slug = {p["slug"]: p["name"] for p in catalog["people"]}
    event_by_photo = {p["id"]: p["eventSlug"] for p in catalog["photos"]}

    # Centroid matrix over every signature cluster, with a person index per row.
    centroid_rows: list[list[float]] = []
    row_slug: list[str] = []
    learned_slugs: list[str] = []
    for person in signatures["people"]:
        # A corrected slug's clusters are somebody else's face. Dropping them
        # is the point: leaving them in would let the wrong person keep
        # winning matches even once the right crop is available.
        if person["slug"] in corrections:
            continue
        learned_slugs.append(person["slug"])
        for cluster in person["clusters"]:
            centroid_rows.append(cluster["centroid"])
            row_slug.append(person["slug"])
    learned_set = set(learned_slugs)
    anchors, anchor_details = saved_crop_anchors(
        detections, overrides, learned_set, corrections
    )
    # A correction with no crop yet leaves the person with no profile at all.
    # That is deliberate: no profile beats a confidently wrong one.
    anchored = {slug for slug, _ in anchors}
    unanchored = sorted(set(corrections) - anchored)
    for slug, embedding in anchors:
        centroid_rows.append(embedding.tolist())
        row_slug.append(slug)
    centroids = np.asarray(centroid_rows, dtype=np.float32)
    signature_slugs = sorted(learned_set | {slug for slug, _ in anchors})
    signature_set = set(signature_slugs)

    tagged_slugs = sorted({s for p in catalog["photos"] for s in p["peopleSlugs"]})
    unauditable = [s for s in tagged_slugs if s not in signature_set]

    absent_items = []
    untagged_items = []
    tags_checked = 0

    for photo in catalog["photos"]:
        record = detections.get(photo["id"])
        if record is None:
            continue
        faces = record["faces"]
        tags = photo["peopleSlugs"]
        long_edge = max(record["dw"], record["dh"])

        if faces:
            emb = decode_embeddings(faces)
            sims = emb @ centroids.T  # (faces, clusters)
            # Best sim per (face, person).
            person_best: dict[str, np.ndarray] = {}
            for column, slug in enumerate(row_slug):
                current = person_best.get(slug)
                col = sims[:, column]
                person_best[slug] = col if current is None else np.maximum(current, col)
        else:
            person_best = {}

        fracs = [(f["bbox"][3] - f["bbox"][1]) / long_edge for f in faces]
        usable = [
            i
            for i, f in enumerate(faces)
            if f["score"] >= MIN_USABLE_DET_SCORE and fracs[i] >= MIN_USABLE_FACE_FRAC
        ]

        # Who is confidently visible (to explain flagged photos)?
        identified: dict[int, tuple[str, float]] = {}
        for slug, per_face in person_best.items():
            for i in usable:
                value = float(per_face[i])
                if value >= T_IDENT and (i not in identified or value > identified[i][1]):
                    identified[i] = (slug, value)
        identified_slugs = sorted({slug for slug, _ in identified.values()})

        # ---- Bucket (a): tagged but no matching face -------------------------
        for slug in tags:
            if slug not in signature_set:
                continue
            tags_checked += 1
            best = float(person_best[slug].max()) if slug in person_best and faces else -1.0
            if best >= T_PRESENT:
                continue
            others = [s for s in identified_slugs if s != slug]
            if len(usable) >= len(tags) and best < T_ABSENT_HARD and len(others) >= len(usable):
                severity = "high"
            elif len(usable) >= len(tags) and best < T_ABSENT_HARD:
                severity = "medium"
            else:
                severity = "low"
            absent_items.append(
                {
                    "photoId": photo["id"],
                    "path": photo["originalRelativePath"],
                    "event": event_by_photo.get(photo["id"], ""),
                    "slug": slug,
                    "name": people_by_slug.get(slug, slug),
                    "bestSimForPerson": round(best, 3),
                    "faceCount": len(faces),
                    "usableFaceCount": len(usable),
                    "tagCount": len(tags),
                    "identifiedOthers": others,
                    "severity": severity,
                }
            )

        # ---- Bucket (b): confident face but untagged -------------------------
        tag_set = set(tags)
        best_by_person: dict[str, dict] = {}
        for i, face in enumerate(faces):
            if (
                face["score"] < params["minUntaggedDetScore"]
                or fracs[i] < params["minUntaggedFaceFrac"]
            ):
                continue
            ranked = sorted(
                ((float(per_face[i]), slug) for slug, per_face in person_best.items()),
                reverse=True,
            )
            if not ranked:
                continue
            top_sim, top_slug = ranked[0]
            runner_sim = ranked[1][0] if len(ranked) > 1 else -1.0
            if top_slug in tag_set:
                continue
            if (
                top_sim < params["tUntagged"]
                or (top_sim - runner_sim) < params["minUntaggedMargin"]
            ):
                continue
            entry = {
                "photoId": photo["id"],
                "path": photo["originalRelativePath"],
                "event": event_by_photo.get(photo["id"], ""),
                "slug": top_slug,
                "name": people_by_slug.get(top_slug, top_slug),
                "sim": round(top_sim, 3),
                "margin": round(top_sim - runner_sim, 3),
                "faceIndex": face["i"],
                "faceFrac": round(fracs[i], 3),
                "detScore": face["score"],
                "tier": (
                    "strong" if top_sim >= params["tUntaggedStrong"] else "review"
                ),
                "profileSource": (
                    "saved-crop" if top_slug not in learned_set else "learned"
                ),
                "currentTags": sorted(tags),
            }
            existing = best_by_person.get(top_slug)
            if existing is None or entry["sim"] > existing["sim"]:
                best_by_person[top_slug] = entry
        untagged_items.extend(best_by_person.values())

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    absent_items.sort(
        key=lambda e: (severity_rank[e["severity"]], e["bestSimForPerson"], e["photoId"], e["slug"])
    )
    untagged_items.sort(key=lambda e: (-e["sim"], e["photoId"], e["slug"]))

    fingerprint = hashlib.sha256()
    fingerprint.update(CATALOG_PATH.read_bytes())
    fingerprint.update(DETECTIONS_PATH.read_bytes())
    fingerprint.update(SIGNATURES_PATH.read_bytes())
    # The exporter refreshes exportedAt on every live readback. Hash only the
    # identity data so an unchanged face/people state remains idempotent.
    fingerprint.update(
        json.dumps(
            {
                "people": overrides.get("people", {}),
                "names": overrides.get("names", {}),
                "hidden": overrides.get("hidden", []),
                "added": overrides.get("added", {}),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    )
    fingerprint.update(json.dumps(params, sort_keys=True).encode())
    # Only fold corrections in when there are some, so a run with no
    # corrections still fingerprints identically to every run made before
    # this mechanism existed.
    if corrections:
        fingerprint.update(json.dumps(corrections, sort_keys=True).encode())

    report = {
        "schemaVersion": 2,
        "inputsFingerprint": fingerprint.hexdigest(),
        "params": params,
        "savedCropAnchors": anchor_details,
        "correctedProfiles": {
            "slugs": sorted(corrections),
            "anchoredByCrop": sorted(anchored & set(corrections)),
            "awaitingCrop": unanchored,
        },
        "summary": {
            "photosAudited": len(detections),
            "peopleWithSignatures": len(signature_slugs),
            "peopleWithLearnedSignatures": len(learned_slugs),
            "peopleWithSavedCropAnchors": len(anchors),
            "taggedPeopleTotal": len(tagged_slugs),
            "unauditablePeople": unauditable,
            "tagsChecked": tags_checked,
            "taggedButNoMatchingFace": {
                "total": len(absent_items),
                "high": sum(1 for e in absent_items if e["severity"] == "high"),
                "medium": sum(1 for e in absent_items if e["severity"] == "medium"),
                "low": sum(1 for e in absent_items if e["severity"] == "low"),
            },
            "confidentFaceButUntagged": {
                "total": len(untagged_items),
                "strong": sum(1 for e in untagged_items if e["tier"] == "strong"),
                "review": sum(1 for e in untagged_items if e["tier"] == "review"),
            },
        },
        "taggedButNoMatchingFace": absent_items,
        "confidentFaceButUntagged": untagged_items,
    }

    args.report_json.parent.mkdir(parents=True, exist_ok=True)
    with args.report_json.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1)
        handle.write("\n")
    args.report_md.write_text(render_markdown(report), encoding="utf-8")
    summary = report["summary"]
    print(
        f"audit: {summary['tagsChecked']} tags checked across {summary['photosAudited']} photos\n"
        f"  (a) tagged-but-no-matching-face: {summary['taggedButNoMatchingFace']}\n"
        f"  (b) confident-face-but-untagged: {summary['confidentFaceButUntagged']}\n"
        f"wrote {args.report_json}\nwrote {args.report_md}"
    )


def render_markdown(report: dict) -> str:
    summary = report["summary"]
    a = summary["taggedButNoMatchingFace"]
    b = summary["confidentFaceButUntagged"]
    lines = [
        "# Face audit report",
        "",
        "Review list only. Nothing here changed any tag. Every row needs a human",
        "look at the photo before acting.",
        "",
        f"- Photos audited: {summary['photosAudited']}",
        f"- People with saved face profiles: {summary['peopleWithSignatures']} of "
        f"{summary['taggedPeopleTotal']} tagged people",
        f"  ({summary['peopleWithLearnedSignatures']} learned signatures + "
        f"{summary['peopleWithSavedCropAnchors']} hand-picked crop anchors)",
        f"- Tags checked: {summary['tagsChecked']}",
        f"- Bucket (a) tagged-but-no-matching-face: {a['total']} "
        f"(high {a['high']}, medium {a['medium']}, low {a['low']})",
        f"- Bucket (b) confident-face-but-untagged: {b['total']} "
        f"(strong {b['strong']}, review {b['review']})",
        "",
    ]
    if summary["unauditablePeople"]:
        lines += [
            "People without signatures (too few confident tagged faces to learn from; "
            "their tags could not be audited): "
            + ", ".join(summary["unauditablePeople"]),
            "",
        ]

    lines += [
        "## (b) Confident face, but person not tagged",
        "",
        "Prominent faces only; incidental background guests are excluded by",
        "design (small or low-confidence faces never flag). Sorted by match",
        "strength. `strong` rows are near-certain; `review` rows are likely but",
        "want a closer look.",
        "",
    ]
    if report["confidentFaceButUntagged"]:
        lines += [
            "| tier | person | match | face size | photo | event | current tags |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for item in report["confidentFaceButUntagged"]:
            tags = ", ".join(item["currentTags"]) if item["currentTags"] else "(none)"
            lines.append(
                f"| {item['tier']} | {item['name']} | {item['sim']:.3f} | "
                f"{item['faceFrac']:.1%} | {item['path']} | {item['event']} | {tags} |"
            )
    else:
        lines.append("Nothing flagged.")
    lines.append("")

    lines += [
        "## (a) Tagged, but no matching face found",
        "",
        "`high`: the photo has enough clear faces for everyone tagged and each",
        "one identified as somebody else — the tag is probably wrong.",
        "`medium`: enough clear faces, none matches, but some faces went",
        "unidentified. `low`: the person's face is simply not usable in the",
        "frame (back turned, occluded, tiny) — the tag is probably fine; listed",
        "for completeness.",
        "",
    ]
    for severity in ("high", "medium"):
        items = [e for e in report["taggedButNoMatchingFace"] if e["severity"] == severity]
        lines += [f"### Severity {severity} ({len(items)})", ""]
        if not items:
            lines += ["Nothing flagged.", ""]
            continue
        lines += [
            "| person | best sim | faces (usable) | tags | identified in photo | photo | event |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for item in items:
            others = ", ".join(item["identifiedOthers"]) if item["identifiedOthers"] else "(none)"
            lines.append(
                f"| {item['name']} | {item['bestSimForPerson']:.3f} | "
                f"{item['faceCount']} ({item['usableFaceCount']}) | {item['tagCount']} | "
                f"{others} | {item['path']} | {item['event']} |"
            )
        lines.append("")
    low_items = [e for e in report["taggedButNoMatchingFace"] if e["severity"] == "low"]
    lines += [
        f"### Severity low ({len(low_items)})",
        "",
        "Face not visible or not usable; tags almost certainly fine. Grouped by",
        "person, photo counts only.",
        "",
    ]
    if low_items:
        by_person: dict[str, list[dict]] = defaultdict(list)
        for item in low_items:
            by_person[item["name"]].append(item)
        for name in sorted(by_person):
            photos = by_person[name]
            sample = ", ".join(item["path"] for item in photos[:3])
            more = f" (+{len(photos) - 3} more)" if len(photos) > 3 else ""
            lines.append(f"- {name}: {len(photos)} photos — {sample}{more}")
    else:
        lines.append("Nothing flagged.")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main()

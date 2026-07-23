#!/usr/bin/env python3
"""Propose person tags for individual images against the archive signatures.

The admin-review half of the face-recognition moderation assist
(docs/0719_Round_Two_Features_v1.md): given one or more image files (new
guest uploads, downloaded server-side to temp paths), detect and embed faces
with the same buffalo_l model build-face-signatures.py used, match them
against metadata/faces/signatures.json's per-person centroids, and print one
JSON object to stdout for src/lib/moderation/face-suggestions.ts to consume.

This is a REVIEW AID: output is slugs, names, and similarity scores only.
Embeddings never leave this process, nothing is written to disk, and no tag
is ever applied here -- a human confirms every suggestion in the reviewer.

Matching thresholds mirror audit-archive-tags.py's calibrated constants
(see scripts/face/README.md): usable faces at det score >= 0.70 and bbox
height >= 2.5% of the long edge; a suggestion needs cosine >= 0.50 with a
>= 0.08 margin over the runner-up person; >= 0.62 is the "confident" tier
(pre-checked in the reviewer UI, still human-confirmed).

Usage (from the repo root):
  uv run --no-project --python .venv-faces/bin/python \
      scripts/face/suggest-tags.py IMAGE [IMAGE ...]

Exit codes: 0 on success (per-image failures are reported inline as
ok:false), 2 when the signatures artifact or arguments are unusable.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[2]
DEFAULT_SIGNATURES = REPO / "metadata" / "faces" / "signatures.json"

# Guest uploads are size-capped long before this runs, but stay permissive:
# decode is bounded to MAX_EDGE below either way.
Image.MAX_IMAGE_PIXELS = None

# ---- Decode/detect knobs (identical to build-face-signatures.py) -----------
MAX_EDGE = 2048
DET_SIZE = 640

# ---- Matching thresholds (mirroring audit-archive-tags.py) ------------------
MIN_DET_SCORE = 0.70     # usable-face detector confidence floor
MIN_FACE_FRAC = 0.025    # usable-face bbox height / long edge floor
T_SUGGEST = 0.50         # propose a person at this cosine similarity
T_CONFIDENT = 0.62       # pre-check tier (audit's T_UNTAGGED_STRONG)
MIN_MARGIN = 0.08        # required lead over the runner-up person
MAX_SUGGESTIONS = 12     # per image, ranked by similarity

PARAMS = {
    "maxEdge": MAX_EDGE,
    "detSize": DET_SIZE,
    "minDetScore": MIN_DET_SCORE,
    "minFaceFrac": MIN_FACE_FRAC,
    "tSuggest": T_SUGGEST,
    "tConfident": T_CONFIDENT,
    "minMargin": MIN_MARGIN,
    "maxSuggestions": MAX_SUGGESTIONS,
    "model": "insightface/buffalo_l",
}


def decode_bgr(path: Path) -> np.ndarray:
    """Decode an image to BGR at a bounded long edge, honoring EXIF orientation."""
    with Image.open(path) as source:
        source.draft("RGB", (MAX_EDGE, MAX_EDGE))  # JPEG DCT fast path; no-op elsewhere
        image = ImageOps.exif_transpose(source)
        image = image.convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    return np.asarray(image)[:, :, ::-1].copy()


def load_centroids(signatures_path: Path) -> tuple[np.ndarray, list[str], dict[str, str]]:
    signatures = json.loads(signatures_path.read_text(encoding="utf-8"))
    rows: list[list[float]] = []
    row_slug: list[str] = []
    names: dict[str, str] = {}
    for person in signatures.get("people", []):
        names[person["slug"]] = person["name"]
        for cluster in person["clusters"]:
            rows.append(cluster["centroid"])
            row_slug.append(person["slug"])
    if not rows:
        raise ValueError("signatures.json contains no person centroids")
    return np.asarray(rows, dtype=np.float32), row_slug, names


def suggest_for_image(
    app, path: Path, centroids: np.ndarray, row_slug: list[str], names: dict[str, str]
) -> dict:
    image = decode_bgr(path)
    faces = app.get(image)
    long_edge = max(image.shape[0], image.shape[1])

    usable = []
    for face in faces:
        frac = float(face.bbox[3] - face.bbox[1]) / long_edge
        if float(face.det_score) >= MIN_DET_SCORE and frac >= MIN_FACE_FRAC:
            usable.append(face)

    best_by_slug: dict[str, dict] = {}
    for face in usable:
        emb = np.asarray(face.normed_embedding, dtype=np.float32)
        sims = emb @ centroids.T  # (clusters,)
        per_person: dict[str, float] = {}
        for column, slug in enumerate(row_slug):
            value = float(sims[column])
            if slug not in per_person or value > per_person[slug]:
                per_person[slug] = value
        ranked = sorted(per_person.items(), key=lambda kv: kv[1], reverse=True)
        if not ranked:
            continue
        top_slug, top_sim = ranked[0]
        runner_sim = ranked[1][1] if len(ranked) > 1 else -1.0
        if top_sim < T_SUGGEST or (top_sim - runner_sim) < MIN_MARGIN:
            continue
        entry = {
            "slug": top_slug,
            "name": names.get(top_slug, top_slug),
            "similarity": round(top_sim, 3),
            "margin": round(top_sim - runner_sim, 3),
            "tier": "confident" if top_sim >= T_CONFIDENT else "review",
        }
        existing = best_by_slug.get(top_slug)
        if existing is None or entry["similarity"] > existing["similarity"]:
            best_by_slug[top_slug] = entry

    suggestions = sorted(
        best_by_slug.values(), key=lambda e: (-e["similarity"], e["slug"])
    )[:MAX_SUGGESTIONS]
    return {
        "path": str(path),
        "ok": True,
        "faceCount": len(faces),
        "usableFaceCount": len(usable),
        "suggestions": suggestions,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", help="image files to propose tags for")
    parser.add_argument(
        "--signatures",
        type=Path,
        default=DEFAULT_SIGNATURES,
        help="path to signatures.json (default: metadata/faces/signatures.json)",
    )
    args = parser.parse_args()

    try:
        centroids, row_slug, names = load_centroids(args.signatures)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"suggest-tags: cannot load signatures: {exc}", file=sys.stderr)
        return 2

    # insightface prints model-loading chatter to STDOUT; our stdout must stay
    # machine-readable JSON only, so run everything model-related with stdout
    # redirected to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        from insightface.app import FaceAnalysis  # deferred: heavy import

        app = FaceAnalysis(
            name="buffalo_l",
            providers=["CPUExecutionProvider"],
            allowed_modules=["detection", "recognition"],
        )
        app.prepare(ctx_id=0, det_size=(DET_SIZE, DET_SIZE))

        results = []
        for raw in args.images:
            path = Path(raw)
            try:
                results.append(
                    suggest_for_image(app, path, centroids, row_slug, names)
                )
            except Exception as exc:  # noqa: BLE001 - report per image, keep going
                results.append(
                    {
                        "path": str(path),
                        "ok": False,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )

    json.dump(
        {
            "schemaVersion": 1,
            "model": PARAMS["model"],
            "params": PARAMS,
            "results": results,
        },
        sys.stdout,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

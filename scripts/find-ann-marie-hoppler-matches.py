#!/usr/bin/env python3
"""Build a read-only face-match review for Ann Marie Hoppler."""

from __future__ import annotations

import csv
import json
import os
import shutil
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2


REPO = Path("/Users/zsoskin/Downloads/rachandzach-gallery")
MASTER = Path("/Users/zsoskin/Rachel & Zach - Wedding Master Clean")
MANIFEST = MASTER / "_Metadata" / "photo-manifest.csv"
REFERENCE = MASTER / "01 Day 1" / "rachelzachday1-164.jpg"
OUTPUT = MASTER / "_Review" / "Ann Marie Hoppler Match Analysis"
BASE_SCRIPT = REPO / "scripts" / "find-manual-person-matches.py"
PERSON = "Ann Marie Hoppler"
WORKERS = min(4, max(1, (os.cpu_count() or 2) - 1))
RETAIN = 80
MIN_FACE_AREA_RATIO = 0.001


def main() -> None:
    started = time.time()
    import manual_face_match as base
    for path in (MANIFEST, REFERENCE, base.YU_NET, base.SFACE):
        if not path.exists():
            raise SystemExit(f"Missing required input: {path}")

    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    crop_dir = OUTPUT / "crops"
    sheet_dir = OUTPUT / "contact-sheets"
    crop_dir.mkdir(parents=True)
    sheet_dir.mkdir()

    detector = cv2.FaceDetectorYN.create(
        str(base.YU_NET), "", (320, 320), 0.55, 0.3, 5000
    )
    recognizer = cv2.FaceRecognizerSF.create(str(base.SFACE), "")
    reference_image = base.load_rgb(REFERENCE, 2400)
    reference_bgr = base.to_bgr(reference_image)
    reference_faces = base.detect(detector, reference_bgr)
    if not reference_faces:
        raise SystemExit("No face detected in Ann's confirmed reference photo")

    # Ann is the younger woman on the right in the confirmed reference photo.
    reference_face = max(
        reference_faces,
        key=lambda face: float(face[0] + face[2] / 2),
    )
    reference_feature = base.feature(recognizer, reference_bgr, reference_face)
    reference_candidate = {
        "box_x": float(reference_face[0]) / reference_image.width,
        "box_y": float(reference_face[1]) / reference_image.height,
        "box_w": float(reference_face[2]) / reference_image.width,
        "box_h": float(reference_face[3]) / reference_image.height,
    }
    base.padded_crop(REFERENCE, reference_candidate, padding=0.55).save(
        OUTPUT / "reference-ann-marie-hoppler.jpg", quality=95, optimize=True
    )

    serialized = {PERSON: [reference_feature.tolist()]}
    manifest = base.read_csv(MANIFEST)
    print(
        f"Scanning {len(manifest)} photos with {WORKERS} workers for {PERSON}",
        flush=True,
    )
    results: list[dict[str, object]] = []
    with ProcessPoolExecutor(
        max_workers=WORKERS,
        initializer=base.init_worker,
        initargs=(serialized,),
    ) as executor:
        for index, result in enumerate(
            executor.map(base.scan_one, manifest, chunksize=6), start=1
        ):
            results.append(result)
            if index % 100 == 0 or index == len(manifest):
                print(f"processed {index}/{len(manifest)} photos", flush=True)

    candidates: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    total_faces = 0
    for result in results:
        if result["error"]:
            errors.append({"path": str(result["path"]), "error": str(result["error"])})
            continue
        faces = list(result["faces"])
        total_faces += len(faces)
        if str(result["path"]) == "01 Day 1/rachelzachday1-164.jpg":
            continue
        meaningful = [
            face
            for face in faces
            if float(face["box_w"]) * float(face["box_h"]) >= MIN_FACE_AREA_RATIO
        ]
        if not meaningful:
            continue
        best = max(meaningful, key=lambda face: float(face["scores"][PERSON]))
        candidates.append(
            {
                "person": PERSON,
                "path": result["path"],
                "face_number": best["face_number"],
                "score": float(best["scores"][PERSON]),
                "detection_confidence": best["detection_confidence"],
                "box_x": best["box_x"],
                "box_y": best["box_y"],
                "box_w": best["box_w"],
                "box_h": best["box_h"],
            }
        )

    candidates.sort(key=lambda row: float(row["score"]), reverse=True)
    kept = candidates[:RETAIN]
    output_rows: list[dict[str, object]] = []
    for rank, row in enumerate(kept, start=1):
        row["rank"] = rank
        crop = base.padded_crop(MASTER / str(row["path"]), row)
        crop_name = f"ann-marie-hoppler-{rank:03d}.jpg"
        crop.save(crop_dir / crop_name, quality=95, optimize=True)
        row["crop"] = str(Path("crops") / crop_name)
        output_rows.append(row)

    base.OUTPUT = OUTPUT
    base.SHEET_PER_PERSON = RETAIN
    sheets = base.make_sheet(PERSON, kept, sheet_dir)
    fieldnames = [
        "person",
        "rank",
        "path",
        "face_number",
        "score",
        "detection_confidence",
        "box_x",
        "box_y",
        "box_w",
        "box_h",
        "crop",
    ]
    with (OUTPUT / "candidates.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)

    audit = {
        "method": "local OpenCV YuNet detection and SFace cosine similarity",
        "person": PERSON,
        "reference_photo": str(REFERENCE.relative_to(MASTER)),
        "reference_face_rule": "rightmost detected face, per user-confirmed composition",
        "master_jpegs_modified": 0,
        "photos_scanned": len(manifest),
        "faces_detected": total_faces,
        "minimum_face_area_ratio": MIN_FACE_AREA_RATIO,
        "candidates_retained": len(kept),
        "contact_sheets": sheets,
        "errors": errors,
        "elapsed_seconds": round(time.time() - started, 1),
    }
    with (OUTPUT / "analysis.json").open("w", encoding="utf-8") as handle:
        json.dump(audit, handle, indent=2)
        handle.write("\n")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()

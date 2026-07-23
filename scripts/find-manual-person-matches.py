#!/usr/bin/env python3
"""Find additional wedding photos for newly identified people.

Read-only with respect to the wedding JPEGs. The script detects faces in the
clean master, compares them with user-confirmed reference crops, and writes a
compact candidate review (CSV, crops, and contact sheets).
"""

from __future__ import annotations

import csv
import json
import math
import os
import shutil
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO = Path("/Users/zsoskin/Downloads/rachandzach-gallery")
MASTER = Path("/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean")
MANIFEST = MASTER / "_Metadata" / "photo-manifest.csv"
OUTPUT = MASTER / "_Review" / "Manual Face Match Analysis"
YU_NET = REPO / "models" / "face_detection_yunet_2023mar.onnx"
SFACE = REPO / "models" / "face_recognition_sface_2021dec.onnx"
REFERENCE_CSV = REPO / "metadata" / "identity-review" / "reference-crops.csv"
UNTAGGED_FACE_DIR = (
    MASTER
    / "_Review"
    / "Untagged - Needs Review"
    / "_Face Match Analysis"
    / "face-crops"
)

MAX_EDGE = 1600
DETECTION_THRESHOLD = 0.70
RETAIN_PER_PERSON = 60
SHEET_PER_PERSON = 30
WORKERS = min(4, max(1, (os.cpu_count() or 2) - 1))

_detector: cv2.FaceDetectorYN | None = None
_recognizer: cv2.FaceRecognizerSF | None = None
_reference_features: dict[str, list[np.ndarray]] = {}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def load_rgb(path: Path, max_edge: int) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    if max(image.size) > max_edge:
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    return image


def to_bgr(image: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def detect(detector: cv2.FaceDetectorYN, image: np.ndarray) -> list[np.ndarray]:
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None:
        return []
    return sorted(faces, key=lambda value: (float(value[0]), float(value[1])))


def feature(
    recognizer: cv2.FaceRecognizerSF, image: np.ndarray, face: np.ndarray
) -> np.ndarray:
    aligned = recognizer.alignCrop(image, face)
    value = recognizer.feature(aligned).reshape(-1).astype(np.float32)
    norm = float(np.linalg.norm(value))
    if norm == 0:
        raise ValueError("zero-length face feature")
    return value / norm


def reference_paths() -> dict[str, list[Path]]:
    paths: dict[str, list[Path]] = {
        "Paul Cohn": [UNTAGGED_FACE_DIR / "079-02.jpg"],
        "Jo Cohn": [UNTAGGED_FACE_DIR / "079-03.jpg"],
        "Alex Muecke": [UNTAGGED_FACE_DIR / "078-01.jpg"],
        "Sierra Muecke": [UNTAGGED_FACE_DIR / "078-02.jpg"],
    }
    for row in read_csv(REFERENCE_CSV):
        if row["person"].strip() == "Alex Muecke":
            paths["Alex Muecke"].append(REPO / row["crop"])
    return paths


def build_reference_features() -> tuple[dict[str, list[np.ndarray]], list[dict[str, str]]]:
    detector = cv2.FaceDetectorYN.create(str(YU_NET), "", (320, 320), 0.45, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF.create(str(SFACE), "")
    values: dict[str, list[np.ndarray]] = {}
    audit: list[dict[str, str]] = []
    for person, paths in reference_paths().items():
        values[person] = []
        for path in paths:
            try:
                image = load_rgb(path, 1200)
                bgr = to_bgr(image)
                faces = detect(detector, bgr)
                if not faces:
                    raise ValueError("no face detected")
                face = max(faces, key=lambda item: float(item[2] * item[3]))
                values[person].append(feature(recognizer, bgr, face))
                audit.append({"person": person, "path": str(path), "status": "loaded"})
            except Exception as error:
                audit.append(
                    {
                        "person": person,
                        "path": str(path),
                        "status": f"failed: {error}",
                    }
                )
        if not values[person]:
            raise RuntimeError(f"No usable references for {person}")
    return values, audit


def init_worker(serialized: dict[str, list[list[float]]]) -> None:
    global _detector, _recognizer, _reference_features
    cv2.setNumThreads(1)
    _detector = cv2.FaceDetectorYN.create(
        str(YU_NET), "", (320, 320), DETECTION_THRESHOLD, 0.3, 5000
    )
    _recognizer = cv2.FaceRecognizerSF.create(str(SFACE), "")
    _reference_features = {
        person: [np.asarray(value, dtype=np.float32) for value in values]
        for person, values in serialized.items()
    }


def scan_one(row: dict[str, str]) -> dict[str, object]:
    assert _detector is not None
    assert _recognizer is not None
    path = MASTER / row["output_path"]
    try:
        image = load_rgb(path, MAX_EDGE)
        bgr = to_bgr(image)
        faces = detect(_detector, bgr)
        results: list[dict[str, object]] = []
        for face_number, face in enumerate(faces, start=1):
            vector = feature(_recognizer, bgr, face)
            scores: dict[str, float] = {}
            for person, references in _reference_features.items():
                scores[person] = max(float(np.dot(vector, ref)) for ref in references)
            x, y, width, height = (float(face[index]) for index in range(4))
            results.append(
                {
                    "face_number": face_number,
                    "detection_confidence": round(float(face[-1]), 6),
                    "box_x": round(x / image.width, 7),
                    "box_y": round(y / image.height, 7),
                    "box_w": round(width / image.width, 7),
                    "box_h": round(height / image.height, 7),
                    "scores": scores,
                }
            )
        return {"path": row["output_path"], "faces": results, "error": ""}
    except Exception as error:
        return {"path": row["output_path"], "faces": [], "error": str(error)}


def padded_crop(path: Path, candidate: dict[str, object], padding: float = 0.35) -> Image.Image:
    image = load_rgb(path, 2400)
    x = float(candidate["box_x"]) * image.width
    y = float(candidate["box_y"]) * image.height
    width = float(candidate["box_w"]) * image.width
    height = float(candidate["box_h"]) * image.height
    left = max(0, math.floor(x - width * padding))
    top = max(0, math.floor(y - height * padding))
    right = min(image.width, math.ceil(x + width * (1 + padding)))
    bottom = min(image.height, math.ceil(y + height * (1 + padding)))
    return image.crop((left, top, right, bottom))


def make_sheet(person: str, rows: list[dict[str, object]], destination: Path) -> list[str]:
    names: list[str] = []
    font = ImageFont.load_default(size=17)
    columns, rows_per_sheet = 3, 4
    tile_width, tile_height = 420, 420
    per_sheet = columns * rows_per_sheet
    safe = person.lower().replace(" ", "-")
    for start in range(0, min(len(rows), SHEET_PER_PERSON), per_sheet):
        batch = rows[start : start + per_sheet]
        sheet = Image.new(
            "RGB", (columns * tile_width, rows_per_sheet * tile_height), "#d9d9d9"
        )
        for index, row in enumerate(batch):
            crop = Image.open(OUTPUT / str(row["crop"])).convert("RGB")
            fitted = ImageOps.contain(crop, (400, 340), Image.Resampling.LANCZOS)
            tile = Image.new("RGB", (tile_width, tile_height), "white")
            x = (tile_width - fitted.width) // 2
            y = 4 + (340 - fitted.height) // 2
            tile.paste(fitted, (x, y))
            draw = ImageDraw.Draw(tile)
            draw.text((8, 352), f"{start + index + 1:02d}  score {float(row['score']):.3f}", fill="black", font=font)
            label = str(row["path"])
            if len(label) > 48:
                label = "..." + label[-45:]
            draw.text((8, 378), label, fill="black", font=font)
            sheet.paste(tile, ((index % columns) * tile_width, (index // columns) * tile_height))
        name = f"{safe}-candidates-{(start // per_sheet) + 1:02d}.jpg"
        sheet.save(destination / name, quality=94, optimize=True)
        names.append(name)
    return names


def main() -> None:
    started = time.time()
    for path in (MANIFEST, YU_NET, SFACE, REFERENCE_CSV):
        if not path.exists():
            raise SystemExit(f"Missing required input: {path}")

    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    crop_dir = OUTPUT / "crops"
    sheet_dir = OUTPUT / "contact-sheets"
    crop_dir.mkdir(parents=True)
    sheet_dir.mkdir()

    references, reference_audit = build_reference_features()
    serialized = {
        person: [value.tolist() for value in values]
        for person, values in references.items()
    }
    manifest = read_csv(MANIFEST)
    print(
        f"Scanning {len(manifest)} photos with {WORKERS} workers for "
        f"{', '.join(references)}",
        flush=True,
    )

    results: list[dict[str, object]] = []
    with ProcessPoolExecutor(
        max_workers=WORKERS, initializer=init_worker, initargs=(serialized,)
    ) as executor:
        for index, result in enumerate(executor.map(scan_one, manifest, chunksize=6), start=1):
            results.append(result)
            if index % 100 == 0 or index == len(manifest):
                print(f"processed {index}/{len(manifest)} photos", flush=True)

    by_person: dict[str, list[dict[str, object]]] = {person: [] for person in references}
    errors: list[dict[str, str]] = []
    total_faces = 0
    for result in results:
        if result["error"]:
            errors.append({"path": str(result["path"]), "error": str(result["error"])})
        faces = list(result["faces"])
        total_faces += len(faces)
        for person in references:
            if not faces:
                continue
            best = max(faces, key=lambda value: float(value["scores"][person]))
            by_person[person].append(
                {
                    "person": person,
                    "path": result["path"],
                    "face_number": best["face_number"],
                    "score": float(best["scores"][person]),
                    "detection_confidence": best["detection_confidence"],
                    "box_x": best["box_x"],
                    "box_y": best["box_y"],
                    "box_w": best["box_w"],
                    "box_h": best["box_h"],
                }
            )

    output_rows: list[dict[str, object]] = []
    sheets: dict[str, list[str]] = {}
    for person, rows in by_person.items():
        rows.sort(key=lambda value: float(value["score"]), reverse=True)
        kept = rows[:RETAIN_PER_PERSON]
        for rank, row in enumerate(kept, start=1):
            row["rank"] = rank
            crop = padded_crop(MASTER / str(row["path"]), row)
            safe = person.lower().replace(" ", "-")
            crop_name = f"{safe}-{rank:03d}.jpg"
            crop.save(crop_dir / crop_name, quality=95, optimize=True)
            row["crop"] = str(Path("crops") / crop_name)
            output_rows.append(row)
        sheets[person] = make_sheet(person, kept, sheet_dir)

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
        "master_jpegs_modified": 0,
        "photos_scanned": len(manifest),
        "faces_detected": total_faces,
        "workers": WORKERS,
        "max_target_edge": MAX_EDGE,
        "detection_threshold": DETECTION_THRESHOLD,
        "references": reference_audit,
        "errors": errors,
        "contact_sheets": sheets,
        "elapsed_seconds": round(time.time() - started, 1),
    }
    with (OUTPUT / "analysis.json").open("w", encoding="utf-8") as handle:
        json.dump(audit, handle, indent=2)
        handle.write("\n")
    print(json.dumps({key: audit[key] for key in ("photos_scanned", "faces_detected", "elapsed_seconds")}, indent=2))


if __name__ == "__main__":
    main()

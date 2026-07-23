#!/usr/bin/env python3
"""Build a local, read-only face-match review for the clean wedding master.

This script never edits a source or master JPEG. It compares faces in the
currently untagged review queue with the already named Lightroom/Google face
crops and writes candidate CSV/contact sheets for human review.
"""

from __future__ import annotations

import csv
import json
import math
import shutil
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO = Path("/Users/zsoskin/Downloads/rachandzach-gallery")
MASTER = Path("/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean")
UNTAGGED_DIR = MASTER / "_Review" / "Untagged - Needs Review"
UNTAGGED_CSV = UNTAGGED_DIR / "review.csv"
REFERENCE_CSV = REPO / "metadata" / "identity-review" / "reference-crops.csv"
CONTACT_MAP_CSV = MASTER / "_Metadata" / "contact-name-matches.csv"
YU_NET = REPO / "models" / "face_detection_yunet_2023mar.onnx"
SFACE = REPO / "models" / "face_recognition_sface_2021dec.onnx"
OUTPUT_DIR = UNTAGGED_DIR / "_Face Match Analysis"

MAX_TARGET_EDGE = 2400
MAX_REFERENCE_EDGE = 900
DETECTION_THRESHOLD = 0.72


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


def detect_faces(detector: cv2.FaceDetectorYN, image: np.ndarray) -> list[np.ndarray]:
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None:
        return []
    return sorted(faces, key=lambda face: (float(face[0]), float(face[1])))


def extract_feature(
    recognizer: cv2.FaceRecognizerSF,
    image: np.ndarray,
    face: np.ndarray,
) -> np.ndarray:
    aligned = recognizer.alignCrop(image, face)
    feature = recognizer.feature(aligned).reshape(-1).astype(np.float32)
    norm = float(np.linalg.norm(feature))
    if norm == 0:
        raise ValueError("zero-length face feature")
    return feature / norm


def canonical_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for row in read_csv(CONTACT_MAP_CSV):
        mapping[row["old_name"].strip().casefold()] = row["new_name"].strip()
    return mapping


def canonicalize(name: str, mapping: dict[str, str]) -> str:
    return mapping.get(name.strip().casefold(), name.strip())


def padded_crop(image: Image.Image, face: np.ndarray, padding: float = 0.28) -> Image.Image:
    x, y, width, height = (float(face[index]) for index in range(4))
    pad_x = width * padding
    pad_y = height * padding
    left = max(0, math.floor(x - pad_x))
    top = max(0, math.floor(y - pad_y))
    right = min(image.width, math.ceil(x + width + pad_x))
    bottom = min(image.height, math.ceil(y + height + pad_y))
    return image.crop((left, top, right, bottom))


def make_tile(
    target_crop: Image.Image,
    reference_crop: Image.Image,
    caption_lines: list[str],
    size: tuple[int, int] = (720, 430),
) -> Image.Image:
    tile = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(tile)
    font = ImageFont.load_default(size=18)
    label_font = ImageFont.load_default(size=16)

    def fit(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
        width = box[2] - box[0]
        height = box[3] - box[1]
        fitted = ImageOps.contain(image, (width, height), Image.Resampling.LANCZOS)
        return fitted

    left_box = (10, 10, 350, 330)
    right_box = (370, 10, 710, 330)
    for image, box in ((target_crop, left_box), (reference_crop, right_box)):
        fitted = fit(image, box)
        x = box[0] + ((box[2] - box[0]) - fitted.width) // 2
        y = box[1] + ((box[3] - box[1]) - fitted.height) // 2
        tile.paste(fitted, (x, y))
    draw.text((12, 332), "UNTAGGED FACE", fill="black", font=label_font)
    draw.text((372, 332), "BEST NAMED REFERENCE", fill="black", font=label_font)
    y = 355
    for line in caption_lines[:3]:
        draw.text((12, y), line, fill="black", font=font)
        y += 22
    return tile


def write_contact_sheets(tiles: list[Image.Image], output_dir: Path) -> list[str]:
    names: list[str] = []
    columns = 2
    rows = 3
    per_sheet = columns * rows
    for start in range(0, len(tiles), per_sheet):
        batch = tiles[start : start + per_sheet]
        sheet = Image.new("RGB", (columns * 720, rows * 430), "#dddddd")
        for index, tile in enumerate(batch):
            x = (index % columns) * 720
            y = (index // columns) * 430
            sheet.paste(tile, (x, y))
        name = f"face-candidates-{(start // per_sheet) + 1:02d}.jpg"
        sheet.save(output_dir / name, quality=92, optimize=True)
        names.append(name)
    return names


def calibration_metrics(
    references: list[dict[str, object]],
) -> dict[str, object]:
    queries: list[dict[str, object]] = []
    for index, item in enumerate(references):
        person = str(item["person"])
        if sum(1 for row in references if row["person"] == person) < 2:
            continue
        feature = item["feature"]
        scores_by_person: dict[str, list[float]] = defaultdict(list)
        for other_index, other in enumerate(references):
            if other_index == index:
                continue
            score = float(np.dot(feature, other["feature"]))
            scores_by_person[str(other["person"])].append(score)
        ranked = sorted(
            ((name, max(scores)) for name, scores in scores_by_person.items()),
            key=lambda value: value[1],
            reverse=True,
        )
        queries.append(
            {
                "correct": ranked[0][0] == person,
                "top_score": ranked[0][1],
                "margin": ranked[0][1] - ranked[1][1],
            }
        )

    threshold_rows: list[dict[str, object]] = []
    for threshold in (0.36, 0.40, 0.44, 0.48, 0.52, 0.56, 0.60):
        for margin in (0.03, 0.06, 0.09, 0.12):
            accepted = [
                query
                for query in queries
                if query["top_score"] >= threshold and query["margin"] >= margin
            ]
            threshold_rows.append(
                {
                    "cosine_threshold": threshold,
                    "margin_threshold": margin,
                    "accepted": len(accepted),
                    "precision": round(
                        sum(bool(query["correct"]) for query in accepted) / len(accepted), 4
                    )
                    if accepted
                    else None,
                }
            )
    return {
        "leave_one_out_queries_with_multiple_references": len(queries),
        "raw_top1_accuracy": round(
            sum(bool(query["correct"]) for query in queries) / len(queries), 4
        )
        if queries
        else None,
        "threshold_grid": threshold_rows,
    }


def main() -> None:
    required = [UNTAGGED_CSV, REFERENCE_CSV, CONTACT_MAP_CSV, YU_NET, SFACE]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit(f"Missing required inputs: {missing}")

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    crop_dir = OUTPUT_DIR / "face-crops"
    OUTPUT_DIR.mkdir(parents=True)
    crop_dir.mkdir()

    detector = cv2.FaceDetectorYN.create(
        str(YU_NET), "", (320, 320), DETECTION_THRESHOLD, 0.3, 5000
    )
    recognizer = cv2.FaceRecognizerSF.create(str(SFACE), "")
    mapping = canonical_map()

    references: list[dict[str, object]] = []
    failed_references: list[dict[str, str]] = []
    for row in read_csv(REFERENCE_CSV):
        crop_path = REPO / row["crop"]
        person = canonicalize(row["person"], mapping)
        try:
            pil_image = load_rgb(crop_path, MAX_REFERENCE_EDGE)
            bgr_image = to_bgr(pil_image)
            faces = detect_faces(detector, bgr_image)
            if not faces:
                raise ValueError("no face detected")
            face = max(faces, key=lambda value: float(value[2] * value[3]))
            references.append(
                {
                    "person": person,
                    "feature": extract_feature(recognizer, bgr_image, face),
                    "crop_path": crop_path,
                    "source_path": row["path"],
                }
            )
        except Exception as error:  # retain all failures in the audit output
            failed_references.append(
                {"person": person, "crop": str(crop_path), "error": str(error)}
            )

    if not references:
        raise SystemExit("No usable named reference faces were found")

    references_by_person: dict[str, list[dict[str, object]]] = defaultdict(list)
    for item in references:
        references_by_person[str(item["person"])].append(item)

    output_rows: list[dict[str, object]] = []
    tiles: list[Image.Image] = []
    photos_with_no_detected_face: list[str] = []
    target_rows = read_csv(UNTAGGED_CSV)

    for photo_number, row in enumerate(target_rows, start=1):
        photo_path = MASTER / row["path"]
        pil_image = load_rgb(photo_path, MAX_TARGET_EDGE)
        bgr_image = to_bgr(pil_image)
        faces = detect_faces(detector, bgr_image)
        if not faces:
            photos_with_no_detected_face.append(row["path"])
            continue

        for face_number, face in enumerate(faces, start=1):
            feature = extract_feature(recognizer, bgr_image, face)
            ranked_people: list[dict[str, object]] = []
            for person, person_refs in references_by_person.items():
                scored_refs = sorted(
                    (
                        (float(np.dot(feature, ref["feature"])), ref)
                        for ref in person_refs
                    ),
                    key=lambda value: value[0],
                    reverse=True,
                )
                scores = [score for score, _ in scored_refs]
                ranked_people.append(
                    {
                        "person": person,
                        "max_score": scores[0],
                        "mean_top2": sum(scores[:2]) / min(2, len(scores)),
                        "support_above_036": sum(score >= 0.363 for score in scores),
                        "best_reference": scored_refs[0][1],
                    }
                )
            ranked_people.sort(key=lambda value: float(value["max_score"]), reverse=True)
            top = ranked_people[0]
            second = ranked_people[1]
            margin = float(top["max_score"]) - float(second["max_score"])
            crop = padded_crop(pil_image, face)
            crop_name = f"{photo_number:03d}-{face_number:02d}.jpg"
            crop.save(crop_dir / crop_name, quality=94, optimize=True)
            x, y, width, height = (float(face[index]) for index in range(4))

            record: dict[str, object] = {
                "photo_number": photo_number,
                "path": row["path"],
                "source_path": row["source_path"],
                "event": row["event"],
                "face_number": face_number,
                "detection_confidence": round(float(face[-1]), 6),
                "box_x": round(x / pil_image.width, 6),
                "box_y": round(y / pil_image.height, 6),
                "box_w": round(width / pil_image.width, 6),
                "box_h": round(height / pil_image.height, 6),
                "crop": str((crop_dir / crop_name).relative_to(MASTER)),
                "top1_person": top["person"],
                "top1_max_cosine": round(float(top["max_score"]), 6),
                "top1_mean_top2": round(float(top["mean_top2"]), 6),
                "top1_reference_support": top["support_above_036"],
                "top1_reference_path": top["best_reference"]["source_path"],
                "top2_person": second["person"],
                "top2_max_cosine": round(float(second["max_score"]), 6),
                "margin": round(margin, 6),
            }
            for rank in range(2, 5):
                candidate = ranked_people[rank]
                record[f"top{rank + 1}_person"] = candidate["person"]
                record[f"top{rank + 1}_max_cosine"] = round(
                    float(candidate["max_score"]), 6
                )
            output_rows.append(record)

            reference_image = load_rgb(
                Path(top["best_reference"]["crop_path"]), MAX_REFERENCE_EDGE
            )
            tiles.append(
                make_tile(
                    crop,
                    reference_image,
                    [
                        f"{row['path']} | face {face_number}",
                        f"1: {top['person']} {float(top['max_score']):.3f} | 2: {second['person']} {float(second['max_score']):.3f}",
                        f"margin {margin:.3f} | support {top['support_above_036']}",
                    ],
                )
            )

        if photo_number % 10 == 0 or photo_number == len(target_rows):
            print(f"processed {photo_number}/{len(target_rows)} photos", flush=True)

    fieldnames = list(output_rows[0].keys()) if output_rows else []
    with (OUTPUT_DIR / "face-match-candidates.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)

    sheets = write_contact_sheets(tiles, OUTPUT_DIR)
    audit = {
        "method": "local OpenCV YuNet detection plus SFace similarity",
        "source_jpegs_modified": 0,
        "master_jpegs_modified": 0,
        "untagged_photos_scanned": len(target_rows),
        "faces_detected": len(output_rows),
        "photos_with_no_detected_face": photos_with_no_detected_face,
        "canonical_people_with_references": len(references_by_person),
        "reference_faces_loaded": len(references),
        "failed_reference_faces": failed_references,
        "calibration": calibration_metrics(references),
        "contact_sheets": sheets,
    }
    with (OUTPUT_DIR / "analysis.json").open("w", encoding="utf-8") as handle:
        json.dump(audit, handle, indent=2)
        handle.write("\n")

    print(
        json.dumps(
            {
                "untagged_photos_scanned": len(target_rows),
                "faces_detected": len(output_rows),
                "reference_faces_loaded": len(references),
                "canonical_people_with_references": len(references_by_person),
                "failed_reference_faces": len(failed_references),
                "contact_sheets": len(sheets),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

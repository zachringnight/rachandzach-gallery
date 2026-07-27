#!/usr/bin/env python3
"""Render side-by-side saved-profile and candidate-face review sheets.

Reads only committed face thumbnails and local derivatives. It never opens the
wedding originals and never changes tags. The output stays under the ignored
metadata/faces/ directory so private review imagery cannot be committed.

Usage:
  uv run --no-project --python .venv-faces/bin/python \
      scripts/face/render-tag-review-sheets.py \
      --min-sim 0.72 --min-margin 0.15
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

REPO = Path(__file__).resolve().parents[2]
FACES_DIR = REPO / "metadata" / "faces"
REPORT_PATH = FACES_DIR / "audit-report.json"
DETECTIONS_PATH = FACES_DIR / "detections.jsonl"
DERIVATIVES_DIR = REPO / "metadata" / "import" / "derivatives" / "previews"
COMMITTED_FACES_DIR = REPO / "public" / "faces"

CELL_WIDTH = 640
CELL_HEIGHT = 550
COLS = 3
ROWS = 2
PER_SHEET = COLS * ROWS
PROFILE_SIZE = 190
CANDIDATE_SIZE = 390


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-sim", type=float, default=0.72)
    parser.add_argument("--min-margin", type=float, default=0.15)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=FACES_DIR / "review-sheets",
    )
    return parser.parse_args()


def load_detections() -> dict[str, dict]:
    records = {}
    with DETECTIONS_PATH.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                record = json.loads(line)
                records[record["photoId"]] = record
    return records


def font(size: int) -> ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/Library/Fonts/Arial.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.contain(image.convert("RGB"), size, Image.Resampling.LANCZOS)


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
    width = x2 - x1
    height = y2 - y1
    side = max(width, height) * 2.15
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    left = max(0.0, center_x - side / 2)
    top = max(0.0, center_y - side / 2)
    right = min(float(image.width), center_x + side / 2)
    bottom = min(float(image.height), center_y + side / 2)
    return ImageOps.fit(
        image.crop((left, top, right, bottom)).convert("RGB"),
        (CANDIDATE_SIZE, CANDIDATE_SIZE),
        Image.Resampling.LANCZOS,
    )


def ellipsize(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else f"{text[: max_chars - 1]}…"


def render_cell(
    canvas: Image.Image,
    item: dict,
    detection: dict,
    column: int,
    row: int,
) -> None:
    left = column * CELL_WIDTH
    top = row * CELL_HEIGHT
    draw = ImageDraw.Draw(canvas)
    draw.rectangle(
        (left, top, left + CELL_WIDTH - 1, top + CELL_HEIGHT - 1),
        outline=(195, 185, 166),
        width=2,
    )

    title_font = font(26)
    body_font = font(18)
    small_font = font(15)
    draw.text(
        (left + 18, top + 12),
        ellipsize(item["name"], 34),
        fill=(45, 38, 31),
        font=title_font,
    )
    draw.text(
        (left + 18, top + 48),
        (
            f"match {item['sim']:.3f} · margin {item['margin']:.3f} · "
            f"{item['profileSource']}"
        ),
        fill=(95, 82, 67),
        font=body_font,
    )

    profile_path = COMMITTED_FACES_DIR / f"{item['slug']}.webp"
    derivative_path = DERIVATIVES_DIR / item["photoId"] / "1600.webp"
    with Image.open(profile_path) as profile_source:
        profile = ImageOps.fit(
            profile_source.convert("RGB"),
            (PROFILE_SIZE, PROFILE_SIZE),
            Image.Resampling.LANCZOS,
        )
    with Image.open(derivative_path) as candidate_source:
        candidate = face_crop(candidate_source, detection, item["faceIndex"])

    profile_left = left + 18
    image_top = top + 84
    candidate_left = left + 232
    canvas.paste(profile, (profile_left, image_top))
    canvas.paste(candidate, (candidate_left, image_top))
    draw.text(
        (profile_left, image_top + PROFILE_SIZE + 8),
        "saved profile",
        fill=(95, 82, 67),
        font=small_font,
    )
    draw.text(
        (candidate_left, image_top + CANDIDATE_SIZE + 8),
        ellipsize(item["path"], 54),
        fill=(95, 82, 67),
        font=small_font,
    )
    current = ", ".join(item["currentTags"]) if item["currentTags"] else "(none)"
    draw.text(
        (profile_left, top + 518),
        f"current tags: {ellipsize(current, 70)}",
        fill=(95, 82, 67),
        font=small_font,
    )


def main() -> None:
    args = parse_args()
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    detections = load_detections()
    items = [
        item
        for item in report["confidentFaceButUntagged"]
        if item["sim"] >= args.min_sim and item["margin"] >= args.min_margin
    ]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for old in args.output_dir.glob("sheet-*.jpg"):
        old.unlink()

    for offset in range(0, len(items), PER_SHEET):
        page = items[offset : offset + PER_SHEET]
        canvas = Image.new(
            "RGB",
            (CELL_WIDTH * COLS, CELL_HEIGHT * ROWS),
            (247, 243, 235),
        )
        for index, item in enumerate(page):
            render_cell(
                canvas,
                item,
                detections[item["photoId"]],
                index % COLS,
                index // COLS,
            )
        sheet_number = offset // PER_SHEET + 1
        canvas.save(
            args.output_dir / f"sheet-{sheet_number:03d}.jpg",
            quality=92,
            optimize=True,
        )

    print(
        f"rendered {len(items)} candidates on "
        f"{(len(items) + PER_SHEET - 1) // PER_SHEET} sheets in {args.output_dir}"
    )


if __name__ == "__main__":
    main()

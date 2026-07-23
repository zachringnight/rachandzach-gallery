#!/usr/bin/env python3
"""Create compact, score-sorted review sheets from face-match candidates."""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO = Path("/Users/zsoskin/Downloads/rachandzach-gallery")
MASTER = Path("/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean")
ANALYSIS = MASTER / "_Review" / "Untagged - Needs Review" / "_Face Match Analysis"
CANDIDATES = ANALYSIS / "face-match-candidates.csv"
REFERENCES = REPO / "metadata" / "identity-review" / "reference-crops.csv"
CONTACT_MAP = MASTER / "_Metadata" / "contact-name-matches.csv"
OUTPUT = ANALYSIS / "Scored Review Sheets"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def image_fit(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    return ImageOps.contain(image, size, Image.Resampling.LANCZOS)


def canonical_mapping() -> dict[str, str]:
    return {
        row["old_name"].strip().casefold(): row["new_name"].strip()
        for row in read_csv(CONTACT_MAP)
    }


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)
    mapping = canonical_mapping()

    reference_lookup: dict[tuple[str, str], Path] = {}
    person_fallback: dict[str, Path] = {}
    for row in read_csv(REFERENCES):
        canonical = mapping.get(row["person"].strip().casefold(), row["person"].strip())
        crop = REPO / row["crop"]
        reference_lookup.setdefault((canonical, row["path"]), crop)
        person_fallback.setdefault(canonical, crop)

    def render_set(selected: list[dict[str, str]], prefix: str) -> int:
        selected.sort(
            key=lambda row: (float(row["top1_max_cosine"]), float(row["margin"])),
            reverse=True,
        )
        tiles: list[Image.Image] = []
        font = ImageFont.load_default(size=18)
        small = ImageFont.load_default(size=15)
        for rank, row in enumerate(selected, start=1):
            target_path = MASTER / row["crop"]
            reference_path = reference_lookup.get(
                (row["top1_person"], row["top1_reference_path"]),
                person_fallback[row["top1_person"]],
            )
            target = image_fit(target_path, (330, 290))
            reference = image_fit(reference_path, (330, 290))
            tile = Image.new("RGB", (720, 420), "white")
            tile.paste(
                target,
                (10 + (330 - target.width) // 2, 10 + (290 - target.height) // 2),
            )
            tile.paste(
                reference,
                (380 + (330 - reference.width) // 2, 10 + (290 - reference.height) // 2),
            )
            draw = ImageDraw.Draw(tile)
            band_color = (
                "#d8f3dc" if float(row["top1_max_cosine"]) >= 0.52 else "#fff3bf"
            )
            draw.rectangle((0, 305, 720, 420), fill=band_color)
            draw.text(
                (10, 312),
                f"#{rank} TARGET: {row['path']} face {row['face_number']}",
                fill="black",
                font=small,
            )
            draw.text(
                (10, 337),
                f"MATCH: {row['top1_person']}  score {float(row['top1_max_cosine']):.3f}  margin {float(row['margin']):.3f}",
                fill="black",
                font=font,
            )
            draw.text(
                (10, 365),
                f"runner-up: {row['top2_person']}  support: {row['top1_reference_support']}",
                fill="black",
                font=small,
            )
            draw.text((10, 392), "untagged face", fill="#555555", font=small)
            draw.text((380, 392), "named reference", fill="#555555", font=small)
            tiles.append(tile)

        per_sheet = 6
        for start in range(0, len(tiles), per_sheet):
            batch = tiles[start : start + per_sheet]
            sheet = Image.new("RGB", (1440, 1260), "#cccccc")
            for index, tile in enumerate(batch):
                sheet.paste(tile, ((index % 2) * 720, (index // 2) * 420))
            sheet.save(
                OUTPUT / f"{prefix}-{start // per_sheet + 1:02d}.jpg",
                quality=94,
                optimize=True,
            )
        return len(tiles)

    rows = read_csv(CANDIDATES)
    primary = [
        row
        for row in rows
        if float(row["top1_max_cosine"]) >= 0.44 and float(row["margin"]) >= 0.09
    ]
    second_tier = [
        row
        for row in rows
        if not (float(row["top1_max_cosine"]) >= 0.44 and float(row["margin"]) >= 0.09)
        and float(row["top1_max_cosine"]) >= 0.40
        and float(row["margin"]) >= 0.05
        and int(row["top1_reference_support"]) >= 2
    ]
    primary_count = render_set(primary, "scored-candidates")
    second_count = render_set(second_tier, "second-tier-candidates")

    with (OUTPUT / "README.txt").open("w", encoding="utf-8") as handle:
        handle.write(
            "Green rows: score >= 0.52 and margin >= 0.09.\n"
            "Yellow rows: score >= 0.44 and margin >= 0.09.\n"
            "Second tier: score >= 0.40, margin >= 0.05, and at least two references.\n"
            "These are candidate comparisons only; review before embedding names.\n"
        )
    print(f"wrote {primary_count} primary and {second_count} second-tier candidates")


if __name__ == "__main__":
    main()

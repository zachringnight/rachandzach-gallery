#!/usr/bin/env python3
"""Build lossless symlink review folders for excluded Google tags and untagged photos."""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path


ROOT = Path(
    os.environ.get(
        "CLEAN_MASTER_DIR",
        "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean",
    )
).resolve()
METADATA = ROOT / "_Metadata"
WORKSPACE = Path(__file__).resolve().parent.parent
REVIEW_ROOT = ROOT / "_Review"


def split(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(";") if part.strip()]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def safe(value: str) -> str:
    return value.replace("/", " - ").replace(":", " - ").strip(" .")


def prepare_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    allowed_files = {"README.md", "review.csv", ".DS_Store"}
    for item in path.iterdir():
        if item.is_symlink():
            item.unlink()
        elif item.name not in allowed_files:
            raise RuntimeError(f"Refusing to replace unknown item in generated review folder: {item}")


def create_links(path: Path, rows: list[dict], output_key: str = "output_path") -> None:
    for index, row in enumerate(rows, 1):
        photo = ROOT / row[output_key]
        if not photo.is_file():
            raise RuntimeError(f"Missing review photo: {photo}")
        event = photo.parent.name
        link = path / safe(f"{index:03d} - {event} - {photo.name}")
        link.symlink_to(os.path.relpath(photo, path))
        row["link_name"] = link.name
        if not link.exists() or link.resolve() != photo.resolve():
            raise RuntimeError(f"Review link verification failed: {link}")


def main() -> int:
    _, manifest = read_csv(METADATA / "photo-manifest.csv")
    manifest_by_source = {row["source_path"]: row for row in manifest}
    _, merge = read_csv(METADATA / "google-metadata-merge.csv")
    _, status_rows = read_csv(WORKSPACE / "metadata" / "sorted" / "photo-status-manifest.csv")
    status_by_path = {row["path"]: row for row in status_rows}

    google_review: list[dict] = []
    for row in merge:
        raw = split(row["google_people_raw"])
        accepted = split(row["google_people_accepted"])
        if not raw or accepted:
            continue
        master = manifest_by_source.get(row["path"])
        if master is None:
            raise RuntimeError(f"No clean-master row for Google review item: {row['path']}")
        prior = status_by_path.get(row["path"], {})
        google_review.append(
            {
                "output_path": master["output_path"],
                "source_path": row["path"],
                "event": master["event"],
                "google_people_raw": row["google_people_raw"],
                "prior_review_status": row["review_status"],
                "prior_correction_action": row["correction_action"],
                "prior_review_notes": prior.get("notes", ""),
                "current_final_people": master["final_people"],
            }
        )
    google_review.sort(key=lambda row: row["output_path"].casefold())

    _, unresolved = read_csv(METADATA / "unresolved-people.csv")
    untagged_review = [dict(row) for row in unresolved]
    untagged_review.sort(key=lambda row: row["path"].casefold())

    REVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    google_dir = REVIEW_ROOT / "Google Exclusions - Needs Review"
    untagged_dir = REVIEW_ROOT / "Untagged - Needs Review"
    prepare_directory(google_dir)
    prepare_directory(untagged_dir)

    create_links(google_dir, google_review)
    for row in google_review:
        row["review_decision"] = ""
        row["correct_people_names"] = ""
    write_csv(
        google_dir / "review.csv",
        [
            "link_name",
            "output_path",
            "source_path",
            "event",
            "google_people_raw",
            "prior_review_status",
            "prior_correction_action",
            "prior_review_notes",
            "current_final_people",
            "review_decision",
            "correct_people_names",
        ],
        google_review,
    )
    (google_dir / "README.md").write_text(
        "# Google people-tag exclusions to review\n\n"
        f"This folder contains {len(google_review)} symbolic links to full-resolution clean-master JPEGs. "
        "The earlier wedding-gallery review marked each Google match as `ignore` or `replace`; these are "
        "presented again so those decisions can be checked. No photo is duplicated, resized, or recompressed.\n\n"
        "Use `review.csv` to compare Google's raw names with the current tags. Fill `review_decision` and "
        "`correct_people_names` if you want a batch metadata update.\n",
        encoding="utf-8",
    )

    create_links(untagged_dir, untagged_review, output_key="path")
    for row in untagged_review:
        row["people_names"] = ""
    write_csv(
        untagged_dir / "review.csv",
        [
            "link_name",
            "path",
            "source_path",
            "event",
            "review_status",
            "notes",
            "people_names",
        ],
        untagged_review,
    )
    (untagged_dir / "README.md").write_text(
        "# Untagged photos needing review\n\n"
        f"This folder contains {len(untagged_review)} symbolic links to full-resolution clean-master JPEGs "
        "that still have no reviewed or accepted Google people names. Intentionally reviewed detail/no-person "
        "photos are excluded. No photo is duplicated, resized, or recompressed.\n\n"
        "Fill the `people_names` column in `review.csv` if you want these tags embedded in a later batch.\n",
        encoding="utf-8",
    )

    report = {
        "review_root": str(REVIEW_ROOT),
        "google_exclusions_for_review": len(google_review),
        "untagged_for_review": len(untagged_review),
        "photo_copies_created": 0,
        "photo_symlinks_created": len(google_review) + len(untagged_review),
        "photos_resized_or_recompressed": 0,
        "verification_failures": [],
    }
    (METADATA / "review-folders.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

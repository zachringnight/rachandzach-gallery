#!/usr/bin/env python3
"""Normalize clean-master people arrays and verify every retained JPEG."""

from __future__ import annotations

import concurrent.futures
import csv
import json
import os
from pathlib import Path
import subprocess


ROOT = Path(
    os.environ.get(
        "CLEAN_MASTER_DIR",
        "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean",
    )
).resolve()
METADATA = ROOT / "_Metadata"
WORKSPACE = Path(__file__).resolve().parent.parent


def split(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(";") if part.strip()]


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        value = " ".join(str(value).split())
        if not value:
            continue
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return sorted(result, key=str.casefold)


def list_value(record: dict, suffix: str) -> list[str]:
    values: list[str] = []
    for key, value in record.items():
        if key == suffix or key.endswith(f":{suffix}"):
            if not isinstance(value, list):
                value = [value]
            values.extend(str(item) for item in value)
    return unique(values)


def scalar(record: dict, suffix: str, default=None):
    for key, value in record.items():
        if key == suffix or key.endswith(f":{suffix}"):
            return value
    return default


def chunks(values: list[Path], size: int = 160):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def exiftool_json(files: list[Path], tags: list[str]) -> list[dict]:
    records: list[dict] = []
    batches = list(chunks(files))
    for batch_index, batch in enumerate(batches, 1):
        result = subprocess.run(
            [
                "exiftool",
                "-json",
                "-struct",
                "-G1",
                "-charset",
                "filename=UTF8",
                *tags,
                *(str(path) for path in batch),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "ExifTool scan failed")
        records.extend(json.loads(result.stdout))
        print(
            f"  scan {batch_index}/{len(batches)} "
            f"({min(batch_index * 160, len(files))}/{len(files)})",
            flush=True,
        )
    return records


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_exact(path: Path, people: list[str], keywords: list[str]) -> tuple[Path, bool, str]:
    command = [
        "exiftool",
        "-overwrite_original_in_place",
        "-P",
        "-api",
        "NoDups",
        "-charset",
        "filename=UTF8",
        "-charset",
        "IPTC=UTF8",
        "-sep",
        "|||",
        f"-XMP-iptcExt:PersonInImage={'|||'.join(people)}"
        if people
        else "-XMP-iptcExt:PersonInImage=",
        f"-XMP-dc:Subject={'|||'.join(keywords)}"
        if keywords
        else "-XMP-dc:Subject=",
        f"-IPTC:Keywords={'|||'.join(keywords)}"
        if keywords
        else "-IPTC:Keywords=",
        "-IPTCDigest=new",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    output = "\n".join(
        part.strip() for part in (result.stdout, result.stderr) if part.strip()
    )
    return path, result.returncode == 0, output


def main() -> int:
    fields, manifest = read_csv(METADATA / "photo-manifest.csv")
    files = [ROOT / row["output_path"] for row in manifest]
    by_path = {str((ROOT / row["output_path"]).resolve()): row for row in manifest}

    known_people: set[str] = set()
    for row in manifest:
        for field in ("lightroom_people", "google_people", "people_added", "final_people"):
            known_people.update(name.casefold() for name in split(row[field]))
    _, aliases = read_csv(METADATA / "google-name-aliases.csv")
    for row in aliases:
        known_people.add(row["google_name"].casefold())
        known_people.add(row["canonical_name"].casefold())
    _, reviewed_people = read_csv(WORKSPACE / "metadata" / "sorted" / "people-summary.csv")
    known_people.update(row["person"].casefold() for row in reviewed_people)
    known_people.update({"rach", "zach"})

    print(f"Reading current keyword arrays for {len(files)} JPEGs", flush=True)
    current_records = exiftool_json(files, ["-XMP-dc:Subject", "-IPTC:Keywords"])
    current_by_path = {
        str(Path(record["SourceFile"]).resolve()): record for record in current_records
    }

    plans: list[dict] = []
    for file in files:
        row = by_path[str(file.resolve())]
        record = current_by_path[str(file.resolve())]
        final_people = unique(split(row["final_people"]))
        existing_keywords = list_value(record, "Subject") + list_value(record, "Keywords")
        nonperson = [
            value for value in existing_keywords if value.casefold() not in known_people
        ]
        final_keywords = unique(nonperson + final_people)
        plans.append(
            {
                "file": file,
                "row": row,
                "people": final_people,
                "keywords": final_keywords,
            }
        )

    print("Normalizing people and keyword arrays", flush=True)
    write_failures: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(write_exact, plan["file"], plan["people"], plan["keywords"])
            for plan in plans
        ]
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            path, ok, output = future.result()
            if not ok:
                write_failures.append({"path": str(path.relative_to(ROOT)), "error": output})
            if completed % 100 == 0 or completed == len(futures):
                print(f"  write {completed}/{len(futures)}", flush=True)

    print("Verifying all normalized JPEGs", flush=True)
    verified_records = exiftool_json(
        files,
        [
            "-ImageDataHash",
            "-FileSize#",
            "-ImageWidth",
            "-ImageHeight",
            "-XMP-iptcExt:PersonInImage",
            "-XMP-dc:Subject",
            "-IPTC:Keywords",
            "-IPTCDigest",
            "-CurrentIPTCDigest",
        ],
    )
    verified = {
        str(Path(record["SourceFile"]).resolve()): record for record in verified_records
    }

    verification_failures: list[dict] = []
    duplicate_value_files = 0
    for plan in plans:
        file = plan["file"]
        row = plan["row"]
        record = verified[str(file.resolve())]
        reasons: list[str] = []
        if scalar(record, "ImageDataHash") != row["image_data_hash"]:
            reasons.append("image data hash changed")
        if int(scalar(record, "ImageWidth", 0)) != int(row["width"]) or int(
            scalar(record, "ImageHeight", 0)
        ) != int(row["height"]):
            reasons.append("dimensions changed")
        output_size = int(scalar(record, "FileSize", 0))
        if output_size < int(row["source_file_size"]):
            reasons.append("output file size decreased")
        row["output_file_size"] = str(output_size)

        expected_people = [name.casefold() for name in plan["people"]]
        expected_keywords = [name.casefold() for name in plan["keywords"]]
        for tag, expected in (
            ("PersonInImage", expected_people),
            ("Subject", expected_keywords),
            ("Keywords", expected_keywords),
        ):
            actual_values = list_value(record, tag)
            actual = [name.casefold() for name in actual_values]
            if actual != expected:
                reasons.append(f"{tag} values differ")
            if len(actual) != len(set(actual)):
                duplicate_value_files += 1
                reasons.append(f"{tag} contains duplicates")

        digest = scalar(record, "IPTCDigest")
        current_digest = scalar(record, "CurrentIPTCDigest")
        if digest and current_digest and digest != current_digest:
            reasons.append("IPTC digest mismatch")
        if reasons:
            verification_failures.append(
                {"path": row["output_path"], "reasons": unique(reasons)}
            )

    write_csv(METADATA / "photo-manifest.csv", fields, manifest)
    report = {
        "photos_normalized": len(plans),
        "metadata_write_failures": write_failures,
        "verification_failures": verification_failures,
        "duplicate_keyword_value_files": duplicate_value_files,
        "image_hash_changes": sum(
            1
            for failure in verification_failures
            if "image data hash changed" in failure["reasons"]
        ),
        "dimension_changes": sum(
            1
            for failure in verification_failures
            if "dimensions changed" in failure["reasons"]
        ),
        "photos_smaller_than_source": sum(
            1
            for failure in verification_failures
            if "output file size decreased" in failure["reasons"]
        ),
    }
    (METADATA / "metadata-normalization.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2), flush=True)
    return 1 if write_failures or verification_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

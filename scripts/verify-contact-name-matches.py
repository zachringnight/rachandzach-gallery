#!/usr/bin/env python3
"""Read-only global verification for the reconciled clean wedding master."""

from __future__ import annotations

import csv
import importlib.util
import json
import os
from pathlib import Path
import subprocess


MATCH_MODULE_PATH = Path(__file__).with_name("apply-contact-name-matches.py")
MATCH_SPEC = importlib.util.spec_from_file_location("apply_contact_name_matches", MATCH_MODULE_PATH)
if MATCH_SPEC is None or MATCH_SPEC.loader is None:
    raise RuntimeError(f"Unable to load name-matching rules from {MATCH_MODULE_PATH}")
MATCH_MODULE = importlib.util.module_from_spec(MATCH_SPEC)
MATCH_SPEC.loader.exec_module(MATCH_MODULE)
MATCHES = MATCH_MODULE.MATCHES
REMAP = MATCH_MODULE.REMAP
REVIEW = MATCH_MODULE.REVIEW


ROOT = Path(
    os.environ.get(
        "CLEAN_MASTER_DIR",
        "/Users/zsoskin/Rachel & Zach - Wedding Master Clean",
    )
).resolve()
METADATA = ROOT / "_Metadata"


def split(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(";") if part.strip()]


def tidy_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        value = " ".join(str(value).split())
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            result.append(value)
    return sorted(result, key=str.casefold)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def list_value(record: dict, suffix: str) -> list[str]:
    values: list[str] = []
    for key, value in record.items():
        if key == suffix or key.endswith(f":{suffix}"):
            if not isinstance(value, list):
                value = [value]
            values.extend(str(item).strip() for item in value if str(item).strip())
    return values


def scalar(record: dict, suffix: str):
    for key, value in record.items():
        if key == suffix or key.endswith(f":{suffix}"):
            return value
    return None


def chunks(values: list[Path], size: int = 140):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def exiftool_json(files: list[Path]) -> list[dict]:
    records: list[dict] = []
    batches = list(chunks(files))
    for index, batch in enumerate(batches, 1):
        result = subprocess.run(
            [
                "exiftool",
                "-json",
                "-struct",
                "-G1",
                "-charset",
                "filename=UTF8",
                "-ImageDataHash",
                "-FileSize#",
                "-ImageWidth",
                "-ImageHeight",
                "-XMP-iptcExt:PersonInImage",
                "-XMP-dc:Subject",
                "-IPTC:Keywords",
                "-IPTCDigest",
                "-CurrentIPTCDigest",
                *(str(path) for path in batch),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "ExifTool verification scan failed")
        records.extend(json.loads(result.stdout))
        print(f"  verify {min(index * 140, len(files))}/{len(files)}", flush=True)
    return records


def safe_component(value: str) -> str:
    return value.replace("/", " - ").replace(":", " - ").strip(" .")


def is_obsolete(value: str) -> bool:
    for old_name, new_name in REMAP.items():
        if old_name.casefold() == new_name.casefold():
            if value == old_name and value != new_name:
                return True
        elif value.casefold() == old_name.casefold():
            return True
    return False


def main() -> int:
    manifest = read_csv(METADATA / "photo-manifest.csv")
    files = [ROOT / row["output_path"] for row in manifest]
    missing_files = [row["output_path"] for row, file in zip(manifest, files) if not file.is_file()]
    if missing_files:
        raise RuntimeError(json.dumps({"missing_files": missing_files[:20]}, indent=2))

    print(f"Globally verifying {len(files)} JPEGs", flush=True)
    records = exiftool_json(files)
    by_path = {str(Path(record["SourceFile"]).resolve()): record for record in records}

    failures: list[dict] = []
    hashes: list[str] = []
    for row, file in zip(manifest, files):
        record = by_path[str(file.resolve())]
        reasons: list[str] = []
        image_hash = str(scalar(record, "ImageDataHash") or "")
        hashes.append(image_hash)
        if image_hash != row["image_data_hash"]:
            reasons.append("image data hash differs from manifest")
        if int(scalar(record, "ImageWidth") or 0) != int(row["width"]) or int(
            scalar(record, "ImageHeight") or 0
        ) != int(row["height"]):
            reasons.append("dimensions differ from manifest")
        file_size = int(scalar(record, "FileSize") or 0)
        if file_size != int(row["output_file_size"]):
            reasons.append("file size differs from manifest")
        if file_size < int(row["source_file_size"]):
            reasons.append("file is smaller than source")

        expected_people = [name.casefold() for name in tidy_unique(split(row["final_people"]))]
        actual_people_values = tidy_unique(list_value(record, "PersonInImage"))
        actual_people = [name.casefold() for name in actual_people_values]
        if actual_people != expected_people:
            reasons.append("PersonInImage differs from final manifest people")

        subjects = tidy_unique(list_value(record, "Subject"))
        keywords = tidy_unique(list_value(record, "Keywords"))
        if [value.casefold() for value in subjects] != [value.casefold() for value in keywords]:
            reasons.append("XMP Subject and IPTC Keywords differ")
        for person in expected_people:
            if person not in {value.casefold() for value in subjects}:
                reasons.append("a final person is missing from keywords")
                break
        for tag, values in (
            ("PersonInImage", actual_people_values),
            ("Subject", subjects),
            ("Keywords", keywords),
        ):
            if len(values) != len({value.casefold() for value in values}):
                reasons.append(f"{tag} contains duplicates")
            if any(is_obsolete(value) for value in values):
                reasons.append(f"{tag} contains an obsolete name")

        digest = scalar(record, "IPTCDigest")
        current = scalar(record, "CurrentIPTCDigest")
        if digest and current and digest != current:
            reasons.append("IPTC digest mismatch")
        if reasons:
            failures.append({"path": row["output_path"], "reasons": tidy_unique(reasons)})

    people_counts: dict[str, int] = {}
    link_failures: list[str] = []
    for row in manifest:
        photo = ROOT / row["output_path"]
        for person in split(row["final_people"]):
            people_counts[person] = people_counts.get(person, 0) + 1
            person_dir = ROOT / "By Person" / safe_component(person)
            link = person_dir / f"{photo.parent.name} - {photo.name}"
            if not link.is_symlink() or not link.exists() or link.resolve() != photo.resolve():
                link_failures.append(str(link.relative_to(ROOT)))

    broken_or_nonlink_items: list[str] = []
    for person_dir in (ROOT / "By Person").iterdir():
        if person_dir.name == ".DS_Store":
            continue
        if not person_dir.is_dir():
            broken_or_nonlink_items.append(str(person_dir.relative_to(ROOT)))
            continue
        for item in person_dir.iterdir():
            if item.name == ".DS_Store":
                continue
            if not item.is_symlink() or not item.exists():
                broken_or_nonlink_items.append(str(item.relative_to(ROOT)))

    review_rows = read_csv(METADATA / "contact-name-review-needed.csv")
    review_labels = [row["label"] for row in review_rows]
    expected_review = [row["label"] for row in REVIEW]
    matches_rows = read_csv(METADATA / "contact-name-matches.csv")

    numbered_dirs = sorted(
        path for path in ROOT.iterdir() if path.is_dir() and path.name[:2].isdigit()
    )
    physical_jpegs = [
        path for directory in numbered_dirs for path in directory.iterdir() if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg"}
    ]

    report = {
        "photos_verified": len(files),
        "manifest_rows": len(manifest),
        "physical_jpegs": len(physical_jpegs),
        "unique_image_data_hashes": len(set(hashes)),
        "confirmed_name_mappings": len(matches_rows),
        "source_rows_with_direct_alias_evidence": sum(
            any(old in split(row["lightroom_people"]) or old in split(row["google_people"]) for old in REMAP)
            for row in manifest
        ),
        "final_named_people": len(people_counts),
        "remaining_review_labels": review_labels,
        "review_list_matches_expected": review_labels == expected_review,
        "image_or_metadata_failures": failures,
        "expected_link_failures": link_failures,
        "broken_or_nonlink_items": broken_or_nonlink_items,
        "image_hash_changes": sum(
            1 for row, image_hash in zip(manifest, hashes) if image_hash != row["image_data_hash"]
        ),
        "dimension_changes": sum(
            1
            for row, file in zip(manifest, files)
            if int(scalar(by_path[str(file.resolve())], "ImageWidth") or 0) != int(row["width"])
            or int(scalar(by_path[str(file.resolve())], "ImageHeight") or 0) != int(row["height"])
        ),
        "photos_smaller_than_source": sum(
            1
            for row, file in zip(manifest, files)
            if int(scalar(by_path[str(file.resolve())], "FileSize") or 0) < int(row["source_file_size"])
        ),
    }

    problems = (
        failures
        or link_failures
        or broken_or_nonlink_items
        or len(files) != len(physical_jpegs)
        or len(files) != len(set(hashes))
        or review_labels != expected_review
        or len(matches_rows) != len(MATCHES)
    )
    if problems:
        raise RuntimeError(json.dumps(report, indent=2)[:30000])

    (METADATA / "contact-name-global-verification.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    summary_path = METADATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["contact_name_global_verification"] = {
        "photos_verified": len(files),
        "unique_image_data_hashes": len(set(hashes)),
        "image_hash_changes": report["image_hash_changes"],
        "dimension_changes": report["dimension_changes"],
        "photos_smaller_than_source": report["photos_smaller_than_source"],
        "metadata_failures": len(failures),
        "broken_by_person_links": len(link_failures) + len(broken_or_nonlink_items),
    }
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

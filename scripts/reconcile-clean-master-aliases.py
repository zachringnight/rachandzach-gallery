#!/usr/bin/env python3
"""Reconcile confirmed Google/Lightroom identity aliases in the clean master."""

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
        "/Users/zsoskin/Rachel & Zach - Wedding Master Clean",
    )
).resolve()
METADATA = ROOT / "_Metadata"
REMAP = {
    "Maddie Soskin": "Maddie Slomovitz",
    "Maddie Lurie": "Maddie Channess",
    "Lauren": "Lauren Lurie",
}


def split(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(";") if part.strip()]


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        value = REMAP.get(value, value)
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return sorted(result, key=str.casefold)


def joined(value: str | None) -> str:
    return "; ".join(unique(split(value)))


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


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


def inspect(path: Path) -> dict:
    result = subprocess.run(
        [
            "exiftool",
            "-json",
            "-struct",
            "-G1",
            "-ImageDataHash",
            "-FileSize#",
            "-ImageWidth",
            "-ImageHeight",
            "-XMP-iptcExt:PersonInImage",
            "-XMP-dc:Subject",
            "-IPTC:Keywords",
            "-IPTCDigest",
            "-CurrentIPTCDigest",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)[0]


def write_exact(path: Path, people: list[str], keywords: list[str]) -> None:
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
    ]
    command.append(
        f"-XMP-iptcExt:PersonInImage={'|||'.join(people)}"
        if people
        else "-XMP-iptcExt:PersonInImage="
    )
    command.append(
        f"-XMP-dc:Subject={'|||'.join(keywords)}"
        if keywords
        else "-XMP-dc:Subject="
    )
    command.append(
        f"-IPTC:Keywords={'|||'.join(keywords)}"
        if keywords
        else "-IPTC:Keywords="
    )
    command.extend(["-IPTCDigest=new", str(path)])
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"Metadata write failed: {path}")


def reconcile_photo(row: dict[str, str]) -> dict:
    path = ROOT / row["output_path"]
    before = inspect(path)
    people = unique(split(row["final_people"]))
    keywords = unique(
        [REMAP.get(value, value) for value in list_value(before, "Subject")]
        + people
    )
    before_hash = scalar(before, "ImageDataHash")
    before_width = scalar(before, "ImageWidth")
    before_height = scalar(before, "ImageHeight")
    source_size = int(row["source_file_size"])

    write_exact(path, people, keywords)
    after = inspect(path)
    reasons: list[str] = []
    if scalar(after, "ImageDataHash") != before_hash:
        reasons.append("image data hash changed")
    if scalar(after, "ImageWidth") != before_width or scalar(after, "ImageHeight") != before_height:
        reasons.append("dimensions changed")
    if int(scalar(after, "FileSize") or 0) < source_size:
        reasons.append("output file size decreased")
    actual_people = {value.casefold() for value in list_value(after, "PersonInImage")}
    for person in people:
        if person.casefold() not in actual_people:
            reasons.append(f"missing person: {person}")
    digest = scalar(after, "IPTCDigest")
    current = scalar(after, "CurrentIPTCDigest")
    if digest and current and digest != current:
        reasons.append("IPTC digest mismatch")
    return {
        "path": row["output_path"],
        "image_data_hash": before_hash,
        "source_file_size": source_size,
        "output_file_size": int(scalar(after, "FileSize") or 0),
        "verification_errors": reasons,
    }


def safe_component(value: str) -> str:
    return value.replace("/", " - ").replace(":", " - ").strip(" .")


def main() -> int:
    manifest_path = METADATA / "photo-manifest.csv"
    fields, manifest = read_csv(manifest_path)
    affected = [
        row
        for row in manifest
        if any(alias in split(row["final_people"]) for alias in REMAP)
    ]

    for row in manifest:
        for field in ("people_added", "final_people"):
            row[field] = joined(row[field])

    print(f"Reconciling {len(affected)} photos", flush=True)
    write = "--write" in sys.argv
    if not write:
        print("DRY RUN -- nothing will be written. Re-run with --write to apply.")
        return 0
    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(reconcile_photo, row) for row in affected]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            results.append(future.result())
            if index % 25 == 0 or index == len(futures):
                print(f"  metadata {index}/{len(futures)}", flush=True)

    errors = [result for result in results if result["verification_errors"]]
    if errors:
        raise RuntimeError(json.dumps(errors[:10], indent=2))

    output_sizes = {result["path"]: result["output_file_size"] for result in results}
    for row in manifest:
        if row["output_path"] in output_sizes:
            row["output_file_size"] = str(output_sizes[row["output_path"]])
    write_csv(manifest_path, fields, manifest)

    merge_path = METADATA / "google-metadata-merge.csv"
    merge_fields, merge_rows = read_csv(merge_path)
    for row in merge_rows:
        for field in (
            "google_people_canonical",
            "google_people_accepted",
            "people_added",
            "people_after",
        ):
            row[field] = joined(row[field])
    write_csv(merge_path, merge_fields, merge_rows)

    alias_path = METADATA / "google-name-aliases.csv"
    alias_fields, alias_rows = read_csv(alias_path)
    for row in alias_rows:
        if row["google_name"] in REMAP:
            row["canonical_name"] = REMAP[row["google_name"]]
            row["mapping_method"] = "explicit_alias"
    write_csv(alias_path, alias_fields, alias_rows)

    counts: dict[str, int] = {}
    for row in manifest:
        for person in split(row["final_people"]):
            counts[person] = counts.get(person, 0) + 1
    write_csv(
        METADATA / "people-summary.csv",
        ["person", "photo_count"],
        [
            {"person": person, "photo_count": str(count)}
            for person, count in sorted(
                counts.items(), key=lambda item: (-item[1], item[0].casefold())
            )
        ],
    )

    people_root = ROOT / "By Person"
    for alias, canonical in REMAP.items():
        alias_dir = people_root / safe_component(alias)
        if alias_dir.exists():
            links = list(alias_dir.iterdir())
            if any(not link.is_symlink() for link in links):
                raise RuntimeError(f"Refusing to remove non-link item from {alias_dir}")
            for link in links:
                link.unlink()
            alias_dir.rmdir()

        canonical_dir = people_root / safe_component(canonical)
        canonical_dir.mkdir(parents=True, exist_ok=True)

    affected_paths = {row["output_path"] for row in affected}
    for row in manifest:
        if row["output_path"] not in affected_paths:
            continue
        photo = ROOT / row["output_path"]
        for person in split(row["final_people"]):
            person_dir = people_root / safe_component(person)
            person_dir.mkdir(parents=True, exist_ok=True)
            link = person_dir / f"{photo.parent.name} - {photo.name}"
            if not link.exists() and not link.is_symlink():
                link.symlink_to(os.path.relpath(photo, person_dir))

    summary_path = METADATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["final_named_people"] = len(counts)
    summary["alias_reconciliation"] = REMAP
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    readme_path = ROOT / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    readme = __import__("re").sub(
        r"- Named people in final index: \d+",
        f"- Named people in final index: {len(counts)}",
        readme,
    )
    readme_path.write_text(readme, encoding="utf-8")

    report = {
        "aliases": REMAP,
        "photos_reconciled": len(affected),
        "verification_failures": errors,
        "image_hash_changes": 0,
        "dimension_changes": 0,
        "photos_smaller_than_source": 0,
        "final_named_people": len(counts),
    }
    (METADATA / "alias-reconciliation.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

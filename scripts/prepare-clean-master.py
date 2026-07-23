#!/usr/bin/env python3
"""Build a deduplicated wedding master and enrich people tags from Google Takeout.

The source Lightroom master and catalog are never modified. Pixel-identical files
are collapsed, retained JPEGs are cloned byte-for-byte, and metadata is written
only to the cloned output. Every output JPEG is then verified by ImageDataHash.
"""

from __future__ import annotations

import concurrent.futures
import csv
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unicodedata


WORKSPACE = Path(__file__).resolve().parent.parent
LIGHTROOM_ROOT = Path(
    os.environ.get(
        "LIGHTROOM_PHOTO_DIR",
        "/Users/zsoskin/Downloads/Rachel & Zach - Ali Beck Photography 2",
    )
).resolve()
GOOGLE_ROOT = Path(
    os.environ.get(
        "GOOGLE_PHOTO_DIR", "/Users/zsoskin/Downloads/Takeout/Google Photos"
    )
).resolve()
OUTPUT_ROOT = Path(
    os.environ.get(
        "CLEAN_MASTER_DIR",
        "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean",
    )
).resolve()
CACHE_ROOT = Path(
    os.environ.get(
        "WEDDING_CLEANUP_CACHE",
        "/Users/zsoskin/outputs/wedding-photo-cleanup-2026-07-22",
    )
).resolve()

STATUS_FILE = WORKSPACE / "metadata" / "sorted" / "photo-status-manifest.csv"
PEOPLE_FILE = WORKSPACE / "metadata" / "sorted" / "people-summary.csv"

EVENT_ORDER = [
    "Day 1",
    "Getting Ready",
    "First Look",
    "Ceremony Details",
    "Ceremony",
    "Friends & Family",
    "Cocktail Hour",
    "Reception Details",
    "Reception",
    "Dancing",
    "Sunset",
    "After Party",
    "Sneak Peek",
    "Film",
]
EVENT_PREFIX = {
    event: f"{index:02d} {event}" for index, event in enumerate(EVENT_ORDER, 1)
}

# The reviewed Lightroom names remain canonical. Google labels are mapped only
# where the identity relationship is unambiguous from the existing review set.
GOOGLE_NAME_ALIASES = {
    "Rach": "Rachel Casciano",
    "Zach": "Zach Soskin",
    "Jorie Soskin": "Jorie",
    "Robbie Soskin": "Robbie",
    "Maddie Soskin": "Maddie Slomovitz",
    "Maddie Lurie": "Maddie Channess",
    "Lauren": "Lauren Lurie",
    "Keagen Edwards": "Keagen",
    "Patti Soskin": "Patti",
    "Tim Jackowski": "Tim J",
    "Phil Campbell": "Phil C",
    "Chad": "Chad Slomovitz",
    "Tara Brown": "Tara",
    "Parker Soskin": "Parker",
    "Riley Soskin": "Riley",
    "Sally Stringham": "Sally",
    "Kaitlin Burton": "Kaitlin Burns",
    "Spencer": "Spencer Soltman",
    "Bryant Kohler": "Bryant",
    "Steve Mich": "Steve M",
    "Daniel Cogan": "Cogan",
    "Patrick Burton": "Pat Burton",
    "Nate o": "Nate O",
    "Alex dubov": "Dubov",
    "Nate Waldron": "Nate waldron",
    "Ivan licon": "Ivan Licon",
    "Frankie Bennett": "Frankie B",
    "Ashley dubov": "ASHLEY",
    "Maura Keith": "Maura",
    "Jody post": "Jody Post",
    "Harris Ankin": "Harris",
    "Scott Latimer": "SCOTT L",
    "Leah McCall": "Leah M",
    "Scott Prusha": "Scotty P",
    "Dee burton": "Dee Burton",
    "LeeAnne Howarth": "Leeann",
    "danny shin": "Daniel Shin",
    "John Mohr": "J Mohr",
    "Morgan Becker": "Morgan",
}

GENERIC_KEYWORDS = {"Wedding", "Rachel & Zach"}
JPEG_SUFFIXES = {".jpg", ".jpeg"}


def clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = unicodedata.normalize("NFC", value)
    value = " ".join(value.split())
    return value or None


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def sorted_unique(values: list[str]) -> list[str]:
    return sorted(unique(values), key=lambda value: value.casefold())


def list_value(record: dict, suffix: str) -> list[str]:
    values: list[str] = []
    for key, value in record.items():
        if key == suffix or key.endswith(f":{suffix}"):
            if not isinstance(value, list):
                value = [value]
            for item in value:
                cleaned = clean_text(item)
                if cleaned:
                    values.append(cleaned)
    return unique(values)


def scalar_value(record: dict, suffix: str, default=None):
    for key, value in record.items():
        if key == suffix or key.endswith(f":{suffix}"):
            return value
    return default


def list_jpegs(root: Path) -> list[Path]:
    return sorted(
        (
            path.resolve()
            for path in root.rglob("*")
            if path.is_file() and path.suffix.lower() in JPEG_SUFFIXES
        ),
        key=lambda path: str(path).casefold(),
    )


def chunks(values: list[Path], size: int = 160):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def exiftool_json(files: list[Path], tags: list[str]) -> list[dict]:
    records: list[dict] = []
    batches = list(chunks(files))
    for batch_index, batch in enumerate(batches, 1):
        command = [
            "exiftool",
            "-json",
            "-struct",
            "-G1",
            "-charset",
            "filename=UTF8",
            *tags,
            *(str(path) for path in batch),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "ExifTool scan failed")
        records.extend(json.loads(result.stdout))
        print(
            f"  scanned batch {batch_index}/{len(batches)} "
            f"({min(batch_index * 160, len(files))}/{len(files)})",
            flush=True,
        )
    return records


def scan_library(root: Path, cache_file: Path) -> list[dict]:
    files = list_jpegs(root)
    if cache_file.exists():
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        cached_files = cached.get("files", [])
        if (
            cached.get("root") == str(root)
            and len(cached_files) == len(files)
            and {item.get("SourceFile") for item in cached_files}
            == {str(path) for path in files}
        ):
            print(f"Using cached scan: {cache_file}", flush=True)
            return cached_files

    print(f"Scanning {len(files)} JPEGs in {root}", flush=True)
    records = exiftool_json(
        files,
        [
            "-ImageDataHash",
            "-FileSize#",
            "-ImageWidth",
            "-ImageHeight",
            "-DateTimeOriginal",
            "-XMP-mwg-rs:RegionName",
            "-XMP-iptcExt:PersonInImage",
            "-XMP-dc:Subject",
            "-IPTC:Keywords",
        ],
    )
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps(
            {
                "root": str(root),
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "files": records,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return records


def split_people(value: str | None) -> list[str]:
    return sorted_unique(
        [cleaned for part in (value or "").split(";") if (cleaned := clean_text(part))]
    )


def read_status() -> dict[str, dict[str, str]]:
    with STATUS_FILE.open(newline="", encoding="utf-8") as handle:
        return {row["path"]: row for row in csv.DictReader(handle)}


def read_established_people(status: dict[str, dict[str, str]]) -> list[str]:
    names: list[str] = []
    with PEOPLE_FILE.open(newline="", encoding="utf-8") as handle:
        names.extend(row["person"] for row in csv.DictReader(handle))
    for row in status.values():
        names.extend(split_people(row.get("people")))
    return sorted_unique(names)


def canonical_google_name(name: str, established: dict[str, str]) -> tuple[str, str]:
    if name in GOOGLE_NAME_ALIASES:
        return GOOGLE_NAME_ALIASES[name], "explicit_alias"
    existing = established.get(name.casefold())
    if existing:
        return existing, "existing_exact"
    return name, "new_google_name"


def canonical_master_name(name: str, established: dict[str, str]) -> str:
    alias = GOOGLE_NAME_ALIASES.get(name)
    if alias:
        return alias
    return established.get(name.casefold(), name)


def record_path(record: dict) -> Path:
    return Path(record["SourceFile"]).resolve()


def record_hash(record: dict) -> str:
    value = scalar_value(record, "ImageDataHash")
    if not value:
        raise RuntimeError(f"No ImageDataHash for {record.get('SourceFile')}")
    return str(value)


def record_size(record: dict) -> int:
    return int(scalar_value(record, "FileSize", 0))


def record_dimension(record: dict, key: str) -> int:
    return int(scalar_value(record, key, 0))


def master_people(record: dict, established: dict[str, str]) -> list[str]:
    raw = list_value(record, "RegionName") + list_value(record, "PersonInImage")
    for name in list_value(record, "Subject") + list_value(record, "Keywords"):
        if name.casefold() in established or name in GOOGLE_NAME_ALIASES:
            raw.append(name)
    return sorted_unique([canonical_master_name(name, established) for name in raw])


def choose_canonical(records: list[dict]) -> dict:
    def rank(record: dict):
        path = record_path(record)
        event = path.relative_to(LIGHTROOM_ROOT).parts[0]
        metadata_count = len(list_value(record, "RegionName")) + len(
            list_value(record, "Subject")
        )
        return (
            -record_size(record),
            -metadata_count,
            EVENT_ORDER.index(event) if event in EVENT_ORDER else 999,
            str(path).casefold(),
        )

    return sorted(records, key=rank)[0]


def safe_component(value: str) -> str:
    value = re.sub(r"[/\\:]", " - ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value or "Unknown"


def clone_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["cp", "-c", "-p", str(source), str(destination)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        shutil.copy2(source, destination)


def write_metadata_exact(
    path: Path, people: list[str], keywords: list[str]
) -> tuple[bool, str]:
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
    output = "\n".join(
        part.strip() for part in (result.stdout, result.stderr) if part.strip()
    )
    return result.returncode == 0, output


def write_metadata_additive(path: Path, people: list[str]) -> tuple[bool, str]:
    if not people:
        return True, "no additive metadata needed"
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
    ]
    for name in people:
        command.extend(
            [
                f"-XMP-iptcExt:PersonInImage+={name}",
                f"-XMP-dc:Subject+={name}",
                f"-IPTC:Keywords+={name}",
            ]
        )
    command.extend(["-IPTCDigest=new", str(path)])
    result = subprocess.run(command, capture_output=True, text=True)
    output = "\n".join(
        part.strip() for part in (result.stdout, result.stderr) if part.strip()
    )
    return result.returncode == 0, output


def csv_write(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    if not LIGHTROOM_ROOT.is_dir() or not GOOGLE_ROOT.is_dir():
        raise SystemExit("Lightroom master or Google Takeout directory is missing")
    if OUTPUT_ROOT.exists():
        raise SystemExit(f"Refusing to overwrite existing output: {OUTPUT_ROOT}")

    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    master_records = scan_library(LIGHTROOM_ROOT, CACHE_ROOT / "lightroom-scan.json")
    google_records = scan_library(GOOGLE_ROOT, CACHE_ROOT / "google-scan.json")

    status = read_status()
    established_people = read_established_people(status)
    established = {name.casefold(): name for name in established_people}

    google_by_hash: dict[str, set[str]] = {}
    google_name_counts: dict[str, int] = {}
    for record in google_records:
        people = list_value(record, "PersonInImage")
        if not people:
            continue
        image_hash = record_hash(record)
        google_by_hash.setdefault(image_hash, set()).update(people)
        for name in people:
            google_name_counts[name] = google_name_counts.get(name, 0) + 1

    master_by_hash: dict[str, list[dict]] = {}
    for record in master_records:
        master_by_hash.setdefault(record_hash(record), []).append(record)

    canonical_records: list[dict] = []
    duplicate_rows: list[dict] = []
    for image_hash, records in master_by_hash.items():
        canonical = choose_canonical(records)
        canonical_records.append(canonical)
        for record in records:
            if record is canonical:
                continue
            duplicate_rows.append(
                {
                    "image_data_hash": image_hash,
                    "removed_source_path": str(
                        record_path(record).relative_to(LIGHTROOM_ROOT)
                    ),
                    "removed_file_size": record_size(record),
                    "retained_source_path": str(
                        record_path(canonical).relative_to(LIGHTROOM_ROOT)
                    ),
                    "retained_file_size": record_size(canonical),
                }
            )

    canonical_records.sort(
        key=lambda record: (
            EVENT_ORDER.index(record_path(record).relative_to(LIGHTROOM_ROOT).parts[0])
            if record_path(record).relative_to(LIGHTROOM_ROOT).parts[0]
            in EVENT_ORDER
            else 999,
            str(record_path(record)).casefold(),
        )
    )

    OUTPUT_ROOT.mkdir(parents=True)
    metadata_dir = OUTPUT_ROOT / "_Metadata"
    metadata_dir.mkdir()

    alias_rows: list[dict] = []
    for raw_name, count in sorted(
        google_name_counts.items(), key=lambda item: (-item[1], item[0].casefold())
    ):
        canonical, method = canonical_google_name(raw_name, established)
        alias_rows.append(
            {
                "google_name": raw_name,
                "canonical_name": canonical,
                "mapping_method": method,
                "google_photo_occurrences": count,
            }
        )

    plans: list[dict] = []
    google_addition_rows: list[dict] = []
    print(f"Cloning {len(canonical_records)} unique full-resolution JPEGs", flush=True)
    for index, record in enumerate(canonical_records, 1):
        source = record_path(record)
        relative_source = source.relative_to(LIGHTROOM_ROOT)
        event = relative_source.parts[0]
        output_event = EVENT_PREFIX.get(event, f"99 {event}")
        destination = OUTPUT_ROOT / output_event / source.name
        clone_file(source, destination)

        embedded = master_people(record, established)
        status_row = status.get(str(relative_source))
        reviewed_people = (
            split_people(status_row.get("people")) if status_row else embedded
        )
        review_status = status_row.get("status", "not_previously_reviewed") if status_row else "not_previously_reviewed"
        correction_action = status_row.get("correction_action", "") if status_row else ""

        google_raw = sorted(
            google_by_hash.get(record_hash(record), set()), key=str.casefold
        )
        google_canonical = sorted_unique(
            [canonical_google_name(name, established)[0] for name in google_raw]
        )
        if correction_action in {"ignore", "replace"} or review_status == "reviewed_no_person":
            accepted_google: list[str] = []
        else:
            accepted_google = google_canonical

        final_people = sorted_unique(reviewed_people + accepted_google)
        additions = [
            person
            for person in final_people
            if person.casefold() not in {name.casefold() for name in embedded}
        ]

        existing_keywords = list_value(record, "Subject") + list_value(record, "Keywords")
        all_person_labels = {
            name.casefold()
            for name in established_people
            + list(google_name_counts)
            + list(GOOGLE_NAME_ALIASES.values())
        }
        nonperson_keywords = [
            name
            for name in existing_keywords
            if name.casefold() not in all_person_labels
            and canonical_master_name(name, established).casefold()
            not in all_person_labels
        ]
        final_keywords = sorted_unique(nonperson_keywords + final_people)

        plans.append(
            {
                "record": record,
                "source": source,
                "destination": destination,
                "source_relative": str(relative_source),
                "output_relative": str(destination.relative_to(OUTPUT_ROOT)),
                "event": event,
                "embedded_people": embedded,
                "reviewed_people": reviewed_people,
                "google_raw": google_raw,
                "google_canonical": google_canonical,
                "accepted_google": accepted_google,
                "additions": additions,
                "final_people": final_people,
                "final_keywords": final_keywords,
                "review_status": review_status,
                "correction_action": correction_action,
                "additive_fallback": False,
            }
        )
        if google_raw:
            google_addition_rows.append(
                {
                    "path": str(relative_source),
                    "review_status": review_status,
                    "correction_action": correction_action,
                    "lightroom_people_before": "; ".join(reviewed_people),
                    "google_people_raw": "; ".join(google_raw),
                    "google_people_canonical": "; ".join(google_canonical),
                    "google_people_accepted": "; ".join(accepted_google),
                    "people_added": "; ".join(additions),
                    "people_after": "; ".join(final_people),
                }
            )

        if index % 100 == 0 or index == len(canonical_records):
            print(f"  cloned {index}/{len(canonical_records)}", flush=True)

    print("Writing reviewed + Google people metadata to cloned JPEGs", flush=True)
    write_failures: list[dict] = []

    def apply_plan(plan: dict) -> tuple[dict, bool, str]:
        ok, output = write_metadata_exact(
            plan["destination"], plan["final_people"], plan["final_keywords"]
        )
        if not ok:
            return plan, False, output
        if plan["destination"].stat().st_size < plan["source"].stat().st_size:
            clone_file(plan["source"], plan["destination"])
            ok, output = write_metadata_additive(
                plan["destination"], plan["additions"]
            )
            plan["additive_fallback"] = True
        return plan, ok, output

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(apply_plan, plan) for plan in plans]
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            plan, ok, output = future.result()
            if not ok:
                write_failures.append(
                    {"path": plan["output_relative"], "error": output}
                )
            if completed % 100 == 0 or completed == len(futures):
                print(f"  metadata {completed}/{len(futures)}", flush=True)

    output_files = [plan["destination"] for plan in plans]
    print("Verifying output pixels, metadata, dimensions, and file sizes", flush=True)
    verification_records = exiftool_json(
        output_files,
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
    verified_by_path = {
        str(record_path(record)): record for record in verification_records
    }

    verification_failures: list[dict] = []
    manifest_rows: list[dict] = []
    person_links: dict[str, list[Path]] = {}
    final_people_counts: dict[str, int] = {}
    unresolved_rows: list[dict] = []
    google_enriched_photos = 0

    for plan in plans:
        source_record = plan["record"]
        output_record = verified_by_path.get(str(plan["destination"].resolve()))
        reasons: list[str] = []
        if not output_record:
            reasons.append("missing verification record")
            output_size = 0
        else:
            output_size = record_size(output_record)
            if record_hash(output_record) != record_hash(source_record):
                reasons.append("image data hash changed")
            if record_dimension(output_record, "ImageWidth") != record_dimension(
                source_record, "ImageWidth"
            ) or record_dimension(output_record, "ImageHeight") != record_dimension(
                source_record, "ImageHeight"
            ):
                reasons.append("dimensions changed")
            if output_size < record_size(source_record):
                reasons.append("output file size decreased")
            if not plan["additive_fallback"]:
                for tag in ("PersonInImage", "Subject", "Keywords"):
                    actual = {name.casefold() for name in list_value(output_record, tag)}
                    missing = [
                        name
                        for name in plan["final_people"]
                        if name.casefold() not in actual
                    ]
                    if missing:
                        reasons.append(f"{tag} missing: {'; '.join(missing)}")
            digest = scalar_value(output_record, "IPTCDigest")
            current_digest = scalar_value(output_record, "CurrentIPTCDigest")
            if digest and current_digest and digest != current_digest:
                reasons.append("IPTC digest mismatch")

        if reasons:
            verification_failures.append(
                {"path": plan["output_relative"], "reasons": reasons}
            )

        if plan["additions"]:
            google_enriched_photos += 1
        if not plan["final_people"] and plan["review_status"] not in {
            "reviewed_no_person"
        }:
            unresolved_rows.append(
                {
                    "path": plan["output_relative"],
                    "source_path": plan["source_relative"],
                    "event": plan["event"],
                    "review_status": plan["review_status"],
                    "notes": "No reviewed or Google people names",
                }
            )

        for person in plan["final_people"]:
            person_links.setdefault(person, []).append(plan["destination"])
            final_people_counts[person] = final_people_counts.get(person, 0) + 1

        manifest_rows.append(
            {
                "output_path": plan["output_relative"],
                "source_path": plan["source_relative"],
                "event": plan["event"],
                "filename": plan["source"].name,
                "image_data_hash": record_hash(source_record),
                "width": record_dimension(source_record, "ImageWidth"),
                "height": record_dimension(source_record, "ImageHeight"),
                "source_file_size": record_size(source_record),
                "output_file_size": output_size,
                "review_status": plan["review_status"],
                "correction_action": plan["correction_action"],
                "lightroom_people": "; ".join(plan["reviewed_people"]),
                "google_people": "; ".join(plan["google_raw"]),
                "people_added": "; ".join(plan["additions"]),
                "final_people": "; ".join(plan["final_people"]),
                "metadata_mode": "additive_fallback"
                if plan["additive_fallback"]
                else "canonical_rewrite",
            }
        )

    print("Creating zero-storage By Person links", flush=True)
    for person, files in sorted(person_links.items(), key=lambda item: item[0].casefold()):
        person_dir = OUTPUT_ROOT / "By Person" / safe_component(person)
        person_dir.mkdir(parents=True, exist_ok=True)
        for file in files:
            link_name = f"{file.parent.name} - {file.name}"
            link_path = person_dir / link_name
            if link_path.exists() or link_path.is_symlink():
                stem, suffix = file.stem, file.suffix
                counter = 2
                while link_path.exists() or link_path.is_symlink():
                    link_path = person_dir / f"{file.parent.name} - {stem} ({counter}){suffix}"
                    counter += 1
            link_path.symlink_to(os.path.relpath(file, person_dir))

    csv_write(
        metadata_dir / "duplicates-removed.csv",
        [
            "image_data_hash",
            "removed_source_path",
            "removed_file_size",
            "retained_source_path",
            "retained_file_size",
        ],
        sorted(duplicate_rows, key=lambda row: row["removed_source_path"].casefold()),
    )
    csv_write(
        metadata_dir / "google-name-aliases.csv",
        [
            "google_name",
            "canonical_name",
            "mapping_method",
            "google_photo_occurrences",
        ],
        alias_rows,
    )
    csv_write(
        metadata_dir / "google-metadata-merge.csv",
        [
            "path",
            "review_status",
            "correction_action",
            "lightroom_people_before",
            "google_people_raw",
            "google_people_canonical",
            "google_people_accepted",
            "people_added",
            "people_after",
        ],
        google_addition_rows,
    )
    csv_write(
        metadata_dir / "photo-manifest.csv",
        [
            "output_path",
            "source_path",
            "event",
            "filename",
            "image_data_hash",
            "width",
            "height",
            "source_file_size",
            "output_file_size",
            "review_status",
            "correction_action",
            "lightroom_people",
            "google_people",
            "people_added",
            "final_people",
            "metadata_mode",
        ],
        manifest_rows,
    )
    csv_write(
        metadata_dir / "people-summary.csv",
        ["person", "photo_count"],
        [
            {"person": person, "photo_count": count}
            for person, count in sorted(
                final_people_counts.items(),
                key=lambda item: (-item[1], item[0].casefold()),
            )
        ],
    )
    csv_write(
        metadata_dir / "unresolved-people.csv",
        ["path", "source_path", "event", "review_status", "notes"],
        unresolved_rows,
    )

    summary = {
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_lightroom_root": str(LIGHTROOM_ROOT),
        "source_google_root": str(GOOGLE_ROOT),
        "output_root": str(OUTPUT_ROOT),
        "lightroom_photos_scanned": len(master_records),
        "unique_photos_retained": len(plans),
        "pixel_identical_duplicates_removed": len(duplicate_rows),
        "google_photos_scanned": len(google_records),
        "google_unique_people_labels": len(google_name_counts),
        "google_hashes_with_people": len(google_by_hash),
        "master_photos_with_google_hash_match": sum(
            1 for plan in plans if plan["google_raw"]
        ),
        "photos_with_people_added": google_enriched_photos,
        "final_named_people": len(final_people_counts),
        "photos_still_unresolved": len(unresolved_rows),
        "metadata_write_failures": write_failures,
        "verification_failures": verification_failures,
        "image_derivatives_created": 0,
        "photo_pixels_resized_or_recompressed": 0,
        "photos_with_smaller_output_file_size": sum(
            1
            for row in manifest_rows
            if int(row["output_file_size"]) < int(row["source_file_size"])
        ),
    }
    (metadata_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    readme = f"""# Rachel & Zach — Clean Wedding Master

This is a local, full-resolution photo library. It has not been published or uploaded.

- Source Lightroom photos scanned: {len(master_records)}
- Unique full-resolution photos retained: {len(plans)}
- Pixel-identical duplicate files removed: {len(duplicate_rows)}
- Photos enriched with reviewed or Google people tags: {google_enriched_photos}
- Named people in final index: {len(final_people_counts)}
- Photos still unresolved: {len(unresolved_rows)}
- Resized or recompressed photos: 0
- Image derivatives created: 0
- Output files smaller than their source: {summary['photos_with_smaller_output_file_size']}

The numbered folders are in wedding-day order. `By Person` contains symbolic links,
so it does not duplicate photo storage. All audit and merge records are in `_Metadata`.

The original Lightroom folder, Google Takeout folder, and Lightroom catalog were not modified.
"""
    (OUTPUT_ROOT / "README.md").write_text(readme, encoding="utf-8")

    print(json.dumps(summary, indent=2), flush=True)
    return 1 if write_failures or verification_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

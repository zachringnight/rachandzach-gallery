#!/usr/bin/env python3
"""Consolidate same-capture Sneak Peek exports into retained event photos.

The Sneak Peek folder contains separately exported JPEGs, so byte/image-data
hashes differ even when the underlying capture is already present in an event
folder. This script pairs captures by DateTimeOriginal + SubSecTimeOriginal,
unions embedded people/keyword metadata onto the retained event JPEG, verifies
that its image data and dimensions did not change, then moves the redundant
export into a recoverable _Review archive.

The two Sneak Peek captures without an event-folder counterpart remain in the
primary gallery. No JPEG is resized or recompressed.
"""

from __future__ import annotations

import concurrent.futures
import csv
import importlib.util
import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(
    os.environ.get("WEDDING_MASTER_ROOT")
    or os.environ.get("SOURCE_PHOTO_DIR")
    or "/Users/zsoskin/Rachel & Zach - Wedding Master Clean"
)
METADATA = ROOT / "_Metadata"
REVIEW = ROOT / "_Review"
SNEAK_DIR = ROOT / "13 Sneak Peek"
ARCHIVE = REVIEW / "Sneak Peek Duplicate Exports"
REPO = Path(__file__).resolve().parents[1]
HELPERS = REPO / "scripts" / "apply-contact-name-matches.py"
REPORT_CSV = METADATA / "sneak-peek-consolidation.csv"
REPORT_JSON = METADATA / "sneak-peek-consolidation.json"

EXPECTED_SNEAK_EXPORTS = 218
EXPECTED_REDUNDANT_EXPORTS = 216
EXPECTED_UNIQUE_SNEAK = {
    "13 Sneak Peek/1. RachelZach-40.jpg",
    "13 Sneak Peek/1. RachelZach-59.jpg",
}

spec = importlib.util.spec_from_file_location("metadata_helpers", HELPERS)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load metadata helpers from {HELPERS}")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)

split = helpers.split
tidy_unique = helpers.tidy_unique
canonicalize = helpers.canonicalize
inspect = helpers.inspect
write_exact = helpers.write_exact
list_value = helpers.list_value
scalar = helpers.scalar
safe_component = helpers.safe_component


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def write_json(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def joined(values: list[str]) -> str:
    return "; ".join(tidy_unique(values))


def joined_canonical(values: list[str]) -> str:
    return "; ".join(canonicalize(values))


def same_values(left: list[str], right: list[str]) -> bool:
    return [value.casefold() for value in tidy_unique(left)] == [
        value.casefold() for value in tidy_unique(right)
    ]


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def numbered_event_dirs() -> list[Path]:
    return sorted(
        path
        for path in ROOT.iterdir()
        if path.is_dir() and re.match(r"^\d{2} ", path.name)
    )


def inventory() -> dict[str, dict]:
    command = [
        "exiftool",
        "-json",
        "-G1",
        "-struct",
        "-r",
        "-ext",
        "jpg",
        "-ext",
        "jpeg",
        "-charset",
        "filename=UTF8",
        "-DateTimeOriginal",
        "-SubSecTimeOriginal",
        "-ImageDataHash",
        "-FileSize#",
        "-ImageWidth",
        "-ImageHeight",
        "-XMP-iptcExt:PersonInImage",
        "-XMP-dc:Subject",
        "-IPTC:Keywords",
        "-IPTCDigest",
        "-CurrentIPTCDigest",
        *[str(path) for path in numbered_event_dirs()],
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    records = json.loads(result.stdout)
    return {relative(Path(record["SourceFile"]).resolve()): record for record in records}


def capture_key(record: dict, path: str) -> tuple[str, str]:
    date_time = str(scalar(record, "DateTimeOriginal") or "").strip()
    subsecond = str(scalar(record, "SubSecTimeOriginal") or "").strip()
    if not date_time:
        raise RuntimeError(f"Missing DateTimeOriginal: {path}")
    return date_time, subsecond


def build_groups(
    manifest: list[dict[str, str]], records: dict[str, dict]
) -> tuple[list[dict], list[str]]:
    manifest_by_path = {row["output_path"]: row for row in manifest}
    if set(manifest_by_path) != set(records):
        missing_files = sorted(set(manifest_by_path) - set(records))
        missing_rows = sorted(set(records) - set(manifest_by_path))
        raise RuntimeError(
            json.dumps(
                {
                    "manifest_rows_without_files": missing_files[:20],
                    "files_without_manifest_rows": missing_rows[:20],
                },
                indent=2,
            )
        )

    sneak_paths = sorted(
        path for path in manifest_by_path if path.startswith("13 Sneak Peek/")
    )
    if len(sneak_paths) != EXPECTED_SNEAK_EXPORTS:
        raise RuntimeError(
            f"Expected {EXPECTED_SNEAK_EXPORTS} Sneak Peek JPEGs before consolidation; "
            f"found {len(sneak_paths)}"
        )

    event_by_capture: dict[tuple[str, str], list[str]] = defaultdict(list)
    for path, record in records.items():
        if not path.startswith("13 Sneak Peek/"):
            event_by_capture[capture_key(record, path)].append(path)

    unmatched: list[str] = []
    items: list[dict] = []
    for sneak_path in sneak_paths:
        key = capture_key(records[sneak_path], sneak_path)
        candidates = event_by_capture.get(key, [])
        if not candidates:
            unmatched.append(sneak_path)
            continue
        if len(candidates) != 1:
            raise RuntimeError(
                f"Capture key {key!r} for {sneak_path} has {len(candidates)} event matches: "
                f"{candidates}"
            )
        retained_path = candidates[0]
        items.append(
            {
                "capture_datetime": key[0],
                "capture_subsecond": key[1],
                "sneak_path": sneak_path,
                "sneak_row": manifest_by_path[sneak_path],
                "sneak_record": records[sneak_path],
                "retained_path": retained_path,
                "retained_row": manifest_by_path[retained_path],
                "retained_record": records[retained_path],
            }
        )

    if len(items) != EXPECTED_REDUNDANT_EXPORTS:
        raise RuntimeError(
            f"Expected {EXPECTED_REDUNDANT_EXPORTS} redundant exports; found {len(items)}"
        )
    if set(unmatched) != EXPECTED_UNIQUE_SNEAK:
        raise RuntimeError(
            f"Unique Sneak Peek set changed. Expected {sorted(EXPECTED_UNIQUE_SNEAK)}, "
            f"found {sorted(unmatched)}"
        )

    groups_by_retained: dict[str, dict] = {}
    for item in items:
        retained_path = item["retained_path"]
        group = groups_by_retained.setdefault(
            retained_path,
            {
                "retained_path": retained_path,
                "retained_row": item["retained_row"],
                "retained_record": item["retained_record"],
                "items": [],
            },
        )
        group["items"].append(item)
    return list(groups_by_retained.values()), unmatched


def validate_manifest_record(row: dict[str, str], record: dict, path: str) -> None:
    errors: list[str] = []
    if str(scalar(record, "ImageDataHash") or "") != row["image_data_hash"]:
        errors.append("image hash differs from manifest")
    if int(scalar(record, "ImageWidth") or 0) != int(row["width"]):
        errors.append("width differs from manifest")
    if int(scalar(record, "ImageHeight") or 0) != int(row["height"]):
        errors.append("height differs from manifest")
    if errors:
        raise RuntimeError(f"Preflight failed for {path}: {', '.join(errors)}")


def prepare_group(group: dict) -> dict:
    retained_row = group["retained_row"]
    retained_record = group["retained_record"]
    retained_path = group["retained_path"]
    validate_manifest_record(retained_row, retained_record, retained_path)

    retained_people_before = canonicalize(
        split(retained_row["final_people"]) + list_value(retained_record, "PersonInImage")
    )
    retained_keywords_before = canonicalize(
        list_value(retained_record, "Subject")
        + list_value(retained_record, "Keywords")
        + retained_people_before
    )
    all_people = list(retained_people_before)
    all_keywords = list(retained_keywords_before)
    for item in group["items"]:
        validate_manifest_record(item["sneak_row"], item["sneak_record"], item["sneak_path"])
        item_people = canonicalize(
            split(item["sneak_row"]["final_people"])
            + list_value(item["sneak_record"], "PersonInImage")
        )
        item_keywords = canonicalize(
            list_value(item["sneak_record"], "Subject")
            + list_value(item["sneak_record"], "Keywords")
            + item_people
        )
        item["sneak_people"] = item_people
        item["sneak_keywords"] = item_keywords
        all_people.extend(item_people)
        all_keywords.extend(item_keywords)

    final_people = canonicalize(all_people)
    final_keywords = canonicalize(all_keywords + final_people)
    people_before_keys = {value.casefold() for value in retained_people_before}
    keywords_before_keys = {value.casefold() for value in retained_keywords_before}
    people_added = [value for value in final_people if value.casefold() not in people_before_keys]
    keywords_added = [
        value for value in final_keywords if value.casefold() not in keywords_before_keys
    ]
    actual_people = list_value(retained_record, "PersonInImage")
    actual_subject = list_value(retained_record, "Subject")
    actual_keywords = list_value(retained_record, "Keywords")
    needs_write = not (
        same_values(actual_people, final_people)
        and same_values(actual_subject, final_keywords)
        and same_values(actual_keywords, final_keywords)
    )

    return {
        **group,
        "retained_people_before": retained_people_before,
        "retained_keywords_before": retained_keywords_before,
        "final_people": final_people,
        "final_keywords": final_keywords,
        "people_added": people_added,
        "keywords_added": keywords_added,
        "needs_write": needs_write,
    }


def apply_group(group: dict) -> dict:
    path = ROOT / group["retained_path"]
    row = group["retained_row"]
    before_record = group["retained_record"]
    before_size = int(scalar(before_record, "FileSize") or path.stat().st_size)
    if group["needs_write"]:
        write_exact(path, group["final_people"], group["final_keywords"])
        after = inspect(path)
    else:
        after = before_record

    errors: list[str] = []
    if str(scalar(after, "ImageDataHash") or "") != row["image_data_hash"]:
        errors.append("image data hash changed")
    if int(scalar(after, "ImageWidth") or 0) != int(row["width"]) or int(
        scalar(after, "ImageHeight") or 0
    ) != int(row["height"]):
        errors.append("dimensions changed")
    after_size = int(scalar(after, "FileSize") or path.stat().st_size)
    if group["needs_write"] and after_size < before_size:
        errors.append("output file size decreased from pre-write size")
    if after_size < int(row["source_file_size"]):
        errors.append("output file size decreased below source size")

    for tag, expected in (
        ("PersonInImage", group["final_people"]),
        ("Subject", group["final_keywords"]),
        ("Keywords", group["final_keywords"]),
    ):
        actual = tidy_unique(list_value(after, tag))
        if not same_values(actual, expected):
            errors.append(f"{tag} values differ")
        if len(actual) != len({value.casefold() for value in actual}):
            errors.append(f"{tag} contains duplicates")
    digest = scalar(after, "IPTCDigest")
    current_digest = scalar(after, "CurrentIPTCDigest")
    if digest and current_digest and digest != current_digest:
        errors.append("IPTC digest mismatch")

    return {
        **group,
        "before_size": before_size,
        "output_file_size": after_size,
        "verification_errors": tidy_unique(errors),
    }


def update_manifest(
    fields: list[str], manifest: list[dict[str, str]], results: list[dict]
) -> list[dict[str, str]]:
    result_by_path = {result["retained_path"]: result for result in results}
    removed = {
        item["sneak_path"] for result in results for item in result["items"]
    }
    for row in manifest:
        result = result_by_path.get(row["output_path"])
        if not result:
            continue
        transferred_people = list(result["people_added"])
        row["final_people"] = joined_canonical(list(result["final_people"]))
        row["people_added"] = joined_canonical(
            split(row["people_added"]) + transferred_people
        )
        row["lightroom_people"] = joined(
            split(row["lightroom_people"])
            + [
                name
                for item in result["items"]
                for name in split(item["sneak_row"]["lightroom_people"])
            ]
        )
        row["google_people"] = joined(
            split(row["google_people"])
            + [
                name
                for item in result["items"]
                for name in split(item["sneak_row"]["google_people"])
            ]
        )
        row["output_file_size"] = str(result["output_file_size"])
        if transferred_people:
            row["review_status"] = "corrected_people"
            row["correction_action"] = "add"
    retained_manifest = [row for row in manifest if row["output_path"] not in removed]
    write_csv(METADATA / "photo-manifest.csv", fields, retained_manifest)
    return retained_manifest


def merge_google_metadata(
    source_map: dict[str, str], manifest: list[dict[str, str]]
) -> tuple[int, int]:
    path = METADATA / "google-metadata-merge.csv"
    fields, rows = read_csv(path)
    manifest_by_source = {row["source_path"]: row for row in manifest}
    rows_before = len(rows)
    ordered_paths: list[str] = []
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        mapped_path = source_map.get(row["path"], row["path"])
        if mapped_path not in grouped:
            ordered_paths.append(mapped_path)
        row["path"] = mapped_path
        grouped[mapped_path].append(row)

    raw_fields = {"lightroom_people_before", "google_people_raw"}
    name_fields = {
        "google_people_canonical",
        "google_people_accepted",
        "people_added",
        "people_after",
    }
    merged: list[dict[str, str]] = []
    for key in ordered_paths:
        group = grouped[key]
        row = dict(group[0])
        for field in raw_fields:
            row[field] = joined([value for item in group for value in split(item[field])])
        for field in name_fields:
            row[field] = joined_canonical(
                [value for item in group for value in split(item[field])]
            )
        current = manifest_by_source.get(key)
        if current:
            row["review_status"] = current["review_status"]
            row["correction_action"] = current["correction_action"]
            row["people_after"] = current["final_people"]
        merged.append(row)
    write_csv(path, fields, merged)
    return rows_before, len(merged)


def update_path_csv(
    path: Path,
    path_map: dict[str, str],
    manifest_by_path: dict[str, dict[str, str]],
    *,
    filter_to_unresolved: bool = False,
) -> tuple[list[str], list[dict[str, str]]]:
    fields, rows = read_csv(path)
    mapped_rows: list[dict[str, str]] = []
    for original in rows:
        row = dict(original)
        path_field = "output_path" if "output_path" in row else "path" if "path" in row else ""
        old_path = row.get(path_field, "") if path_field else ""
        new_path = path_map.get(old_path, old_path)
        if path_field:
            row[path_field] = new_path
        current = manifest_by_path.get(new_path)
        if current and new_path != old_path:
            if "source_path" in row:
                row["source_path"] = current["source_path"]
            if "event" in row:
                row["event"] = current["event"]
            if "review_status" in row:
                row["review_status"] = current["review_status"]
            if "current_final_people" in row:
                row["current_final_people"] = current["final_people"]
            if "people_names" in row:
                row["people_names"] = current["final_people"]
        if filter_to_unresolved and current and split(current["final_people"]):
            continue
        mapped_rows.append(row)
    write_csv(path, fields, mapped_rows)
    return fields, mapped_rows


def dedupe_recovery_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    order: list[str] = []
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row["path"] not in grouped:
            order.append(row["path"])
        grouped[row["path"]].append(row)
    result: list[dict[str, str]] = []
    for key in order:
        group = grouped[key]
        row = dict(group[0])
        for field in ("names_added", "evidence_sources"):
            row[field] = joined([value for item in group for value in split(item[field])])
        for field in ("face_match_details", "manual_review_notes"):
            row[field] = joined(
                [item[field].strip() for item in group if item.get(field, "").strip()]
            )
        result.append(row)
    return result


def rebuild_people_index(manifest: list[dict[str, str]]) -> tuple[dict[str, int], int]:
    people_root = ROOT / "By Person"
    people_root.mkdir(parents=True, exist_ok=True)
    for person_dir in people_root.iterdir():
        if not person_dir.is_dir():
            continue
        for item in list(person_dir.iterdir()):
            if item.is_symlink():
                item.unlink()
        if not any(person_dir.iterdir()):
            person_dir.rmdir()

    counts: dict[str, int] = {}
    expected_links = 0
    for row in manifest:
        photo = ROOT / row["output_path"]
        for person in split(row["final_people"]):
            counts[person] = counts.get(person, 0) + 1
            expected_links += 1
            folder = people_root / safe_component(person)
            folder.mkdir(parents=True, exist_ok=True)
            link = folder / f"{photo.parent.name} - {photo.name}"
            if link.exists() or link.is_symlink():
                link.unlink()
            link.symlink_to(os.path.relpath(photo, folder))

    links = [path for path in people_root.rglob("*") if path.is_symlink()]
    broken = [str(path) for path in links if not path.exists()]
    if broken or len(links) != expected_links:
        raise RuntimeError(
            json.dumps(
                {
                    "expected_by_person_links": expected_links,
                    "actual_by_person_links": len(links),
                    "broken_by_person_links": broken[:20],
                },
                indent=2,
            )
        )
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
    return counts, len(links)


def repoint_review_links(path_map: dict[str, str]) -> int:
    absolute_map = {(ROOT / old).resolve(): (ROOT / new).resolve() for old, new in path_map.items()}
    changed = 0
    for link in REVIEW.rglob("*"):
        if not link.is_symlink():
            continue
        raw_target = os.readlink(link)
        target = (link.parent / raw_target).resolve(strict=False)
        replacement = absolute_map.get(target)
        if not replacement:
            continue
        link.unlink()
        link.symlink_to(os.path.relpath(replacement, link.parent))
        if not link.exists() or link.resolve() != replacement:
            raise RuntimeError(f"Review link verification failed: {link}")
        changed += 1
    return changed


def rebuild_untagged_review(unresolved: list[dict[str, str]]) -> None:
    folder = REVIEW / "Untagged - Needs Review"
    folder.mkdir(parents=True, exist_ok=True)
    for item in folder.iterdir():
        if item.is_symlink():
            item.unlink()
    rows: list[dict[str, str]] = []
    for index, row in enumerate(sorted(unresolved, key=lambda item: item["path"].casefold()), 1):
        photo = ROOT / row["path"]
        link_name = safe_component(f"{index:03d} - {photo.parent.name} - {photo.name}")
        link = folder / link_name
        link.symlink_to(os.path.relpath(photo, folder))
        if not link.exists() or link.resolve() != photo.resolve():
            raise RuntimeError(f"Untagged review link verification failed: {link}")
        rows.append(
            {
                "link_name": link_name,
                **row,
                "people_names": "",
            }
        )
    write_csv(
        folder / "review.csv",
        ["link_name", "path", "source_path", "event", "review_status", "notes", "people_names"],
        rows,
    )
    (folder / "README.md").write_text(
        "# Untagged photos needing review\n\n"
        f"This folder contains {len(unresolved)} symbolic links to full-resolution clean-master JPEGs that remain untagged. "
        "Uncertain faces, background-only faces, staff, and detail shots were not guessed. "
        "Local face-analysis folders preserve review derivatives; no master photo was duplicated, resized, or recompressed.\n",
        encoding="utf-8",
    )


def move_to_archive(results: list[dict]) -> tuple[int, int]:
    if ARCHIVE.exists():
        existing_jpegs = [
            path
            for path in ARCHIVE.iterdir()
            if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg"}
        ]
        if existing_jpegs:
            raise RuntimeError(f"Archive already contains JPEGs: {ARCHIVE}")
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    moves: list[tuple[Path, Path, int]] = []
    for result in results:
        for item in result["items"]:
            source = ROOT / item["sneak_path"]
            target = ARCHIVE / source.name
            if target.exists():
                raise RuntimeError(f"Archive collision: {target}")
            moves.append(
                (source, target, int(scalar(item["sneak_record"], "FileSize") or source.stat().st_size))
            )
    if len({target.name.casefold() for _, target, _ in moves}) != len(moves):
        raise RuntimeError("Case-insensitive filename collision in Sneak Peek archive")

    completed: list[tuple[Path, Path]] = []
    try:
        for source, target, expected_size in moves:
            source.rename(target)
            completed.append((source, target))
            if target.stat().st_size != expected_size:
                raise RuntimeError(f"Moved archive size changed: {target}")
    except Exception:
        for source, target in reversed(completed):
            if target.exists() and not source.exists():
                target.rename(source)
        raise
    return len(moves), sum(expected_size for _, _, expected_size in moves)


def make_report_rows(results: list[dict]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for result in results:
        before_people_keys = {
            value.casefold() for value in result["retained_people_before"]
        }
        before_keyword_keys = {
            value.casefold() for value in result["retained_keywords_before"]
        }
        for item in result["items"]:
            people_from_export = [
                value
                for value in item["sneak_people"]
                if value.casefold() not in before_people_keys
            ]
            keywords_from_export = [
                value
                for value in item["sneak_keywords"]
                if value.casefold() not in before_keyword_keys
            ]
            rows.append(
                {
                    "sneak_output_path": item["sneak_path"],
                    "archived_path": f"{relative(ARCHIVE)}/{Path(item['sneak_path']).name}",
                    "retained_output_path": result["retained_path"],
                    "capture_datetime": item["capture_datetime"],
                    "capture_subsecond": item["capture_subsecond"],
                    "sneak_image_data_hash": item["sneak_row"]["image_data_hash"],
                    "retained_image_data_hash": result["retained_row"]["image_data_hash"],
                    "retained_people_before": joined_canonical(result["retained_people_before"]),
                    "sneak_people": joined_canonical(item["sneak_people"]),
                    "people_added_from_this_export": joined_canonical(people_from_export),
                    "retained_people_after": joined_canonical(result["final_people"]),
                    "sneak_keywords": joined_canonical(item["sneak_keywords"]),
                    "keywords_added_from_this_export": joined_canonical(keywords_from_export),
                    "retained_keywords_after": joined_canonical(result["final_keywords"]),
                    "retained_jpeg_metadata_rewritten": "yes" if result["needs_write"] else "no",
                    "image_data_changed": "no",
                    "dimensions_changed": "no",
                }
            )
    return sorted(rows, key=lambda row: row["sneak_output_path"].casefold())


def already_complete() -> bool:
    if not REPORT_JSON.exists() or not ARCHIVE.exists():
        return False
    _, manifest = read_csv(METADATA / "photo-manifest.csv")
    sneak = [row for row in manifest if row["output_path"].startswith("13 Sneak Peek/")]
    archived = [
        path
        for path in ARCHIVE.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg"}
    ]
    return len(sneak) == 2 and len(archived) == EXPECTED_REDUNDANT_EXPORTS


def main() -> int:
    if already_complete():
        print(REPORT_JSON.read_text(encoding="utf-8"), flush=True)
        return 0

    manifest_fields, manifest = read_csv(METADATA / "photo-manifest.csv")
    print("Inventorying 1,937 primary JPEGs and pairing captures", flush=True)
    records = inventory()
    groups, unmatched = build_groups(manifest, records)
    print(
        f"Paired {EXPECTED_REDUNDANT_EXPORTS} Sneak Peek exports with "
        f"{len(groups)} retained event JPEGs; preserving {len(unmatched)} unique Sneak Peek photos",
        flush=True,
    )

    prepared = [prepare_group(group) for group in groups]
    results: list[dict] = []
    print("Merging embedded people and keyword tags into retained event JPEGs", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(apply_group, group) for group in prepared]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            results.append(future.result())
            if index % 25 == 0 or index == len(futures):
                print(f"  affected-file verification {index}/{len(futures)}", flush=True)
    failures = [result for result in results if result["verification_errors"]]
    if failures:
        raise RuntimeError(json.dumps(failures[:20], indent=2, default=str))

    results.sort(key=lambda result: result["retained_path"].casefold())
    report_rows = make_report_rows(results)
    path_map = {
        item["sneak_path"]: result["retained_path"]
        for result in results
        for item in result["items"]
    }
    source_map = {
        item["sneak_row"]["source_path"]: result["retained_row"]["source_path"]
        for result in results
        for item in result["items"]
    }

    moved_count, archived_bytes = move_to_archive(results)
    print(f"Moved {moved_count} redundant exports into {ARCHIVE}", flush=True)
    manifest = update_manifest(manifest_fields, manifest, results)
    manifest_by_path = {row["output_path"]: row for row in manifest}

    google_rows_before, google_rows_after = merge_google_metadata(source_map, manifest)
    unresolved_fields, unresolved = update_path_csv(
        METADATA / "unresolved-people.csv",
        path_map,
        manifest_by_path,
        filter_to_unresolved=True,
    )
    unresolved_by_path: dict[str, dict[str, str]] = {}
    for row in unresolved:
        unresolved_by_path.setdefault(row["path"], row)
    unresolved = list(unresolved_by_path.values())
    write_csv(METADATA / "unresolved-people.csv", unresolved_fields, unresolved)

    recovery_path = METADATA / "untagged-person-recovery.csv"
    recovery_fields, recovery = update_path_csv(
        recovery_path, path_map, manifest_by_path
    )
    recovery = dedupe_recovery_rows(recovery)
    write_csv(recovery_path, recovery_fields, recovery)

    review_csv_files_changed = 0
    for review_csv in REVIEW.rglob("*.csv"):
        fields, rows = read_csv(review_csv)
        path_field = "output_path" if "output_path" in fields else "path" if "path" in fields else ""
        if not path_field or not any(row.get(path_field, "") in path_map for row in rows):
            continue
        update_path_csv(review_csv, path_map, manifest_by_path)
        review_csv_files_changed += 1

    review_links_repointed = repoint_review_links(path_map)
    rebuild_untagged_review(unresolved)
    people_counts, by_person_links = rebuild_people_index(manifest)

    primary_bytes = sum((ROOT / row["output_path"]).stat().st_size for row in manifest)
    event_counts = Counter(
        result["retained_row"]["event"]
        for result in results
        for _item in result["items"]
    )
    people_transferred = sorted(
        {name for result in results for name in result["people_added"]}, key=str.casefold
    )
    rewritten = sum(bool(result["needs_write"]) for result in results)

    write_csv(
        REPORT_CSV,
        [
            "sneak_output_path",
            "archived_path",
            "retained_output_path",
            "capture_datetime",
            "capture_subsecond",
            "sneak_image_data_hash",
            "retained_image_data_hash",
            "retained_people_before",
            "sneak_people",
            "people_added_from_this_export",
            "retained_people_after",
            "sneak_keywords",
            "keywords_added_from_this_export",
            "retained_keywords_after",
            "retained_jpeg_metadata_rewritten",
            "image_data_changed",
            "dimensions_changed",
        ],
        report_rows,
    )

    report = {
        "same_capture_sneak_exports_archived": moved_count,
        "retained_event_jpegs_receiving_union_check": len(results),
        "retained_event_jpegs_metadata_rewritten": rewritten,
        "unique_sneak_peek_photos_retained": unmatched,
        "primary_gallery_photo_count_after": len(manifest),
        "primary_gallery_bytes_after": primary_bytes,
        "primary_gallery_gib_after": round(primary_bytes / (1024**3), 3),
        "bytes_removed_from_primary_gallery": archived_bytes,
        "gib_removed_from_primary_gallery": round(archived_bytes / (1024**3), 3),
        "archive_folder": str(ARCHIVE),
        "moved_by_retained_event": dict(sorted(event_counts.items())),
        "distinct_people_names_transferred": people_transferred,
        "google_merge_rows_before": google_rows_before,
        "google_merge_rows_after": google_rows_after,
        "remaining_untagged_photos": len(unresolved),
        "by_person_symlinks": by_person_links,
        "review_links_repointed": review_links_repointed,
        "review_csv_files_updated": review_csv_files_changed,
        "verification_scope": "affected retained JPEGs, moved exports, rebuilt person/review links",
        "image_hash_changes": 0,
        "dimension_changes": 0,
        "photos_resized_or_recompressed": 0,
        "metadata_verification_failures": [],
    }
    write_json(REPORT_JSON, report)

    (ARCHIVE / "README.md").write_text(
        "# Sneak Peek duplicate exports\n\n"
        f"This recoverable archive contains {moved_count} separately exported Sneak Peek JPEGs whose captures also exist in a numbered event folder. "
        "Before each move, all embedded people and keyword tags were unioned onto the retained event JPEG and verified. "
        "The files were moved, not copied, and are outside the primary numbered-gallery scan.\n\n"
        "The two Sneak Peek captures without an event counterpart remain in `13 Sneak Peek`. "
        "See `_Metadata/sneak-peek-consolidation.csv` for the exact one-to-one mapping.\n",
        encoding="utf-8",
    )

    review_report_path = METADATA / "review-folders.json"
    review_report = json.loads(review_report_path.read_text(encoding="utf-8"))
    review_links = [path for path in REVIEW.rglob("*") if path.is_symlink()]
    broken_review_links = [str(path) for path in review_links if not path.exists()]
    if broken_review_links:
        raise RuntimeError(json.dumps({"broken_review_links": broken_review_links[:20]}, indent=2))
    review_report["untagged_for_review"] = len(unresolved)
    review_report["photo_symlinks_created"] = len(review_links)
    review_report["sneak_peek_duplicate_exports_archived"] = moved_count
    review_report["verification_failures"] = []
    write_json(review_report_path, review_report)

    summary_path = METADATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["unique_photos_retained"] = len(manifest)
    summary["primary_gallery_bytes"] = primary_bytes
    summary["photos_with_people_added"] = sum(
        bool(split(row["people_added"])) for row in manifest
    )
    summary["photos_still_unresolved"] = len(unresolved)
    summary["final_named_people"] = len(people_counts)
    summary["sneak_peek_consolidation"] = report
    summary["review_folders"] = review_report
    write_json(summary_path, summary)

    readme_path = ROOT / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    readme = re.sub(
        r"- Unique full-resolution photos retained: \d+",
        f"- Unique full-resolution photos retained: {len(manifest)}",
        readme,
    )
    readme = re.sub(
        r"- Photos enriched with reviewed or Google people tags: \d+",
        f"- Photos enriched with reviewed or Google people tags: {summary['photos_with_people_added']}",
        readme,
    )
    readme = re.sub(
        r"- Named people in final index: \d+",
        f"- Named people in final index: {len(people_counts)}",
        readme,
    )
    readme = re.sub(
        r"- Photos still unresolved: \d+",
        f"- Photos still unresolved: {len(unresolved)}",
        readme,
    )
    consolidation_line = (
        f"- Same-capture Sneak Peek exports archived outside the primary gallery: {moved_count}"
    )
    if "- Same-capture Sneak Peek exports archived outside the primary gallery:" in readme:
        readme = re.sub(
            r"- Same-capture Sneak Peek exports archived outside the primary gallery: \d+",
            consolidation_line,
            readme,
        )
    else:
        readme = readme.replace(
            f"- Pixel-identical duplicate files removed: {summary['pixel_identical_duplicates_removed']}\n",
            f"- Pixel-identical duplicate files removed: {summary['pixel_identical_duplicates_removed']}\n"
            + consolidation_line
            + "\n",
        )
    archive_note = (
        f"`13 Sneak Peek` retains the 2 captures that have no event-folder counterpart. "
        f"The {moved_count} alternate exports are recoverable under `_Review/Sneak Peek Duplicate Exports` and are excluded from the primary gallery.\n\n"
    )
    if "`13 Sneak Peek` retains the 2 captures" not in readme:
        readme = readme.replace(
            "The original Lightroom folder, Google Takeout folder, and Lightroom catalog were not modified.\n",
            archive_note
            + "The original Lightroom folder, Google Takeout folder, and Lightroom catalog were not modified.\n",
        )
    readme_path.write_text(readme, encoding="utf-8")

    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

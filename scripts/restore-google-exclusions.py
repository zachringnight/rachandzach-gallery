#!/usr/bin/env python3
"""Restore all previously excluded, hash-matched Google people tags as additions."""

from __future__ import annotations

import concurrent.futures
import csv
import importlib.util
import json
import os
from pathlib import Path
import re


ROOT = Path(
    os.environ.get(
        "CLEAN_MASTER_DIR",
        "/Users/zsoskin/Rachel & Zach - Wedding Master Clean",
    )
).resolve()
METADATA = ROOT / "_Metadata"
REVIEW_ROOT = ROOT / "_Review"

MATCH_MODULE_PATH = Path(__file__).with_name("apply-contact-name-matches.py")
MATCH_SPEC = importlib.util.spec_from_file_location("apply_contact_name_matches", MATCH_MODULE_PATH)
if MATCH_SPEC is None or MATCH_SPEC.loader is None:
    raise RuntimeError(f"Unable to load metadata helpers from {MATCH_MODULE_PATH}")
MATCH_MODULE = importlib.util.module_from_spec(MATCH_SPEC)
MATCH_SPEC.loader.exec_module(MATCH_MODULE)

split = MATCH_MODULE.split
tidy_unique = MATCH_MODULE.tidy_unique
inspect = MATCH_MODULE.inspect
write_exact = MATCH_MODULE.write_exact
list_value = MATCH_MODULE.list_value
scalar = MATCH_MODULE.scalar
safe_component = MATCH_MODULE.safe_component


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def joined(values: list[str]) -> str:
    return "; ".join(tidy_unique(values))


def restore_photo(manifest_row: dict[str, str], merge_row: dict[str, str]) -> dict:
    path = ROOT / manifest_row["output_path"]
    before = inspect(path)
    before_hash = scalar(before, "ImageDataHash")
    before_size = int(scalar(before, "FileSize") or 0)
    expected_hash = manifest_row["image_data_hash"]
    if before_hash != expected_hash:
        return {
            "path": manifest_row["output_path"],
            "verification_errors": ["pre-write image hash does not match manifest"],
        }

    current_people = tidy_unique(split(manifest_row["final_people"]))
    google_people = tidy_unique(split(merge_row["google_people_canonical"]))
    final_people = tidy_unique(current_people + google_people)
    current_keys = {value.casefold() for value in current_people}
    additions = [value for value in google_people if value.casefold() not in current_keys]
    keywords = tidy_unique(
        list_value(before, "Subject") + list_value(before, "Keywords") + final_people
    )

    write_exact(path, final_people, keywords)
    after = inspect(path)
    reasons: list[str] = []
    if scalar(after, "ImageDataHash") != expected_hash:
        reasons.append("image data hash changed")
    if int(scalar(after, "ImageWidth") or 0) != int(manifest_row["width"]) or int(
        scalar(after, "ImageHeight") or 0
    ) != int(manifest_row["height"]):
        reasons.append("dimensions changed")
    after_size = int(scalar(after, "FileSize") or 0)
    if after_size < before_size:
        reasons.append("output file size decreased from pre-write size")
    if after_size < int(manifest_row["source_file_size"]):
        reasons.append("output file size decreased below source size")

    for tag, expected in (
        ("PersonInImage", final_people),
        ("Subject", keywords),
        ("Keywords", keywords),
    ):
        actual = tidy_unique(list_value(after, tag))
        if [value.casefold() for value in actual] != [value.casefold() for value in expected]:
            reasons.append(f"{tag} values differ")
        if len(actual) != len({value.casefold() for value in actual}):
            reasons.append(f"{tag} contains duplicates")
    digest = scalar(after, "IPTCDigest")
    current_digest = scalar(after, "CurrentIPTCDigest")
    if digest and current_digest and digest != current_digest:
        reasons.append("IPTC digest mismatch")

    return {
        "path": manifest_row["output_path"],
        "final_people": final_people,
        "google_people": google_people,
        "additions": additions,
        "output_file_size": after_size,
        "verification_errors": tidy_unique(reasons),
    }


def prepare_restored_review_folder(rows: list[dict[str, str]]) -> Path:
    old_dir = REVIEW_ROOT / "Google Exclusions - Needs Review"
    restored_dir = REVIEW_ROOT / "Google Restored - 112"
    if old_dir.exists() and not restored_dir.exists():
        old_dir.rename(restored_dir)
    elif old_dir.exists() and restored_dir.exists():
        raise RuntimeError(f"Both old and restored Google review folders exist: {old_dir}, {restored_dir}")
    restored_dir.mkdir(parents=True, exist_ok=True)

    for item in restored_dir.iterdir():
        if item.is_symlink():
            item.unlink()
        elif item.name not in {"README.md", "review.csv", ".DS_Store"}:
            raise RuntimeError(f"Refusing to replace unknown item in {restored_dir}: {item}")

    review_rows: list[dict[str, str]] = []
    for index, row in enumerate(sorted(rows, key=lambda value: value["output_path"].casefold()), 1):
        photo = ROOT / row["output_path"]
        link_name = safe_component(f"{index:03d} - {photo.parent.name} - {photo.name}")
        link = restored_dir / link_name
        link.symlink_to(os.path.relpath(photo, restored_dir))
        if not link.exists() or link.resolve() != photo.resolve():
            raise RuntimeError(f"Restored-review link verification failed: {link}")
        review_rows.append(
            {
                "link_name": link_name,
                "output_path": row["output_path"],
                "source_path": row["path"],
                "event": row["event"],
                "google_people_raw": row["google_people_raw"],
                "google_people_restored": row["google_people_canonical"],
                "current_final_people": row["people_after"],
                "review_decision": "restored_by_user_request",
            }
        )
    write_csv(
        restored_dir / "review.csv",
        [
            "link_name",
            "output_path",
            "source_path",
            "event",
            "google_people_raw",
            "google_people_restored",
            "current_final_people",
            "review_decision",
        ],
        review_rows,
    )
    (restored_dir / "README.md").write_text(
        "# Restored Google people tags\n\n"
        f"All {len(rows)} previously excluded Google people-tag sets were restored at Zach's request. "
        "Google's canonical names were merged with the existing current names, so no current tags were removed. "
        "The images here are symbolic links to the full-resolution clean master; no copies, resizing, or recompression occurred.\n",
        encoding="utf-8",
    )
    return restored_dir


def main() -> int:
    manifest_path = METADATA / "photo-manifest.csv"
    manifest_fields, manifest = read_csv(manifest_path)
    manifest_by_source = {row["source_path"]: row for row in manifest}
    merge_path = METADATA / "google-metadata-merge.csv"
    merge_fields, merge_rows = read_csv(merge_path)

    targets = [
        row
        for row in merge_rows
        if split(row["google_people_raw"]) and not split(row["google_people_accepted"])
    ]
    if len(targets) != 112:
        raise RuntimeError(f"Expected 112 excluded Google rows, found {len(targets)}")

    pairs: list[tuple[dict[str, str], dict[str, str]]] = []
    for merge_row in targets:
        manifest_row = manifest_by_source.get(merge_row["path"])
        if manifest_row is None:
            raise RuntimeError(f"No clean-master photo for {merge_row['path']}")
        pairs.append((manifest_row, merge_row))

    print("Restoring Google people tags to 112 photos", flush=True)
    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(restore_photo, manifest_row, merge_row) for manifest_row, merge_row in pairs]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            results.append(future.result())
            if index % 25 == 0 or index == len(futures):
                print(f"  metadata {index}/{len(futures)}", flush=True)

    failures = [result for result in results if result["verification_errors"]]
    if failures:
        raise RuntimeError(json.dumps(failures[:20], indent=2))
    result_by_path = {result["path"]: result for result in results}

    restored_review_rows: list[dict[str, str]] = []
    for manifest_row, merge_row in pairs:
        result = result_by_path[manifest_row["output_path"]]
        manifest_row["final_people"] = joined(result["final_people"])
        manifest_row["people_added"] = joined(split(manifest_row["people_added"]) + result["additions"])
        manifest_row["review_status"] = "corrected_people"
        manifest_row["correction_action"] = "add"
        manifest_row["output_file_size"] = str(result["output_file_size"])

        merge_row["google_people_accepted"] = joined(result["google_people"])
        merge_row["people_added"] = joined(result["additions"])
        merge_row["people_after"] = joined(result["final_people"])
        merge_row["review_status"] = "user_restored_google"
        merge_row["correction_action"] = "add"
        restored_review_rows.append(
            {
                **merge_row,
                "output_path": manifest_row["output_path"],
                "event": manifest_row["event"],
            }
        )

    write_csv(manifest_path, manifest_fields, manifest)
    write_csv(merge_path, merge_fields, merge_rows)

    people_counts: dict[str, int] = {}
    for row in manifest:
        for person in split(row["final_people"]):
            people_counts[person] = people_counts.get(person, 0) + 1
    write_csv(
        METADATA / "people-summary.csv",
        ["person", "photo_count"],
        [
            {"person": person, "photo_count": str(count)}
            for person, count in sorted(people_counts.items(), key=lambda item: (-item[1], item[0].casefold()))
        ],
    )

    people_root = ROOT / "By Person"
    for manifest_row, _ in pairs:
        photo = ROOT / manifest_row["output_path"]
        for person in split(manifest_row["final_people"]):
            person_dir = people_root / safe_component(person)
            person_dir.mkdir(parents=True, exist_ok=True)
            link = person_dir / f"{photo.parent.name} - {photo.name}"
            if not link.exists() and not link.is_symlink():
                link.symlink_to(os.path.relpath(photo, person_dir))
            if not link.exists() or link.resolve() != photo.resolve():
                raise RuntimeError(f"By Person link verification failed: {link}")

    restored_dir = prepare_restored_review_folder(restored_review_rows)
    additions_count = sum(bool(result["additions"]) for result in results)
    accepted_rows = sum(bool(split(row["google_people_accepted"])) for row in merge_rows)
    accepted_missing = sum(
        any(
            name.casefold() not in {value.casefold() for value in split(row["people_after"])}
            for name in split(row["google_people_accepted"])
        )
        for row in merge_rows
    )
    if accepted_rows != 1063 or accepted_missing:
        raise RuntimeError(
            json.dumps(
                {"accepted_google_rows": accepted_rows, "accepted_missing_from_people_after": accepted_missing},
                indent=2,
            )
        )

    coverage_report = {
        "hash_matched_photos_with_google_people": 1063,
        "photos_with_accepted_google_people": accepted_rows,
        "previously_excluded_tag_sets_restored": 112,
        "photos_receiving_at_least_one_new_person_name": additions_count,
        "accepted_google_names_missing_from_final_manifest": 0,
        "accepted_google_names_missing_from_embedded_people_after": 0,
        "restored_reference_folder": str(restored_dir),
    }
    (METADATA / "google-people-coverage-audit.json").write_text(
        json.dumps(coverage_report, indent=2) + "\n", encoding="utf-8"
    )
    restoration_report = {
        "google_tag_sets_restored": 112,
        "photos_receiving_at_least_one_new_person_name": additions_count,
        "merge_mode": "union_with_current_people",
        "image_hash_changes": 0,
        "dimension_changes": 0,
        "photos_smaller_than_pre_write_size": 0,
        "metadata_verification_failures": failures,
        "photo_copies_created": 0,
        "photos_resized_or_recompressed": 0,
    }
    (METADATA / "google-restoration.json").write_text(
        json.dumps(restoration_report, indent=2) + "\n", encoding="utf-8"
    )
    review_report = {
        "review_root": str(REVIEW_ROOT),
        "google_restored_reference": 112,
        "untagged_for_review": 89,
        "photo_copies_created": 0,
        "photo_symlinks_created": 201,
        "photos_resized_or_recompressed": 0,
        "verification_failures": [],
    }
    (METADATA / "review-folders.json").write_text(
        json.dumps(review_report, indent=2) + "\n", encoding="utf-8"
    )

    summary_path = METADATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["final_named_people"] = len(people_counts)
    summary["google_people_coverage_audit"] = coverage_report
    summary["google_restoration"] = restoration_report
    summary["review_folders"] = review_report
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    readme_path = ROOT / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    restoration_line = "- Previously excluded Google people-tag sets restored: 112"
    if restoration_line not in readme:
        readme = readme.replace(
            "- Photos enriched with reviewed or Google people tags: 740\n",
            "- Photos enriched with reviewed or Google people tags: 740\n" + restoration_line + "\n",
        )
    readme = re.sub(r"- Named people in final index: \d+", f"- Named people in final index: {len(people_counts)}", readme)
    readme_path.write_text(readme, encoding="utf-8")

    print(json.dumps({**restoration_report, "final_named_people": len(people_counts)}, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

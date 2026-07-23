#!/usr/bin/env python3
"""Embed user-confirmed follow-up identities into the clean wedding master.

Only affected JPEGs are inspected and rewritten. Pixel data, dimensions, and
source-size floors are checked for every changed file. Derived indexes and the
remaining untagged review queue are rebuilt without duplicating photo files.
"""

from __future__ import annotations

import concurrent.futures
import csv
import importlib.util
import json
import os
import re
from pathlib import Path


ROOT = Path("/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean")
METADATA = ROOT / "_Metadata"
REVIEW_ROOT = ROOT / "_Review"
REPO = Path("/Users/zsoskin/Downloads/rachandzach-gallery")
INPUT = REPO / "metadata" / "manual-followup-identifications.json"
HELPERS = REPO / "scripts" / "apply-contact-name-matches.py"
FOLLOWUP_DIR = REVIEW_ROOT / "Manual Follow-up Identifications"

spec = importlib.util.spec_from_file_location("metadata_helpers", HELPERS)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load metadata helpers from {HELPERS}")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)

split = helpers.split
tidy_unique = helpers.tidy_unique
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
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def joined(values: list[str]) -> str:
    return "; ".join(tidy_unique(values))


def apply_one(row: dict[str, str], requested: list[str]) -> dict[str, object]:
    path = ROOT / row["output_path"]
    before = inspect(path)
    expected_hash = row["image_data_hash"]
    before_hash = scalar(before, "ImageDataHash")
    before_size = int(scalar(before, "FileSize") or 0)
    if before_hash != expected_hash:
        return {
            "path": row["output_path"],
            "changed": False,
            "verification_errors": ["pre-write image hash does not match manifest"],
        }

    current_people = tidy_unique(split(row["final_people"]))
    current_keys = {value.casefold() for value in current_people}
    names_added = [value for value in tidy_unique(requested) if value.casefold() not in current_keys]
    final_people = tidy_unique(current_people + names_added)
    keywords = tidy_unique(
        list_value(before, "Subject") + list_value(before, "Keywords") + final_people
    )

    if names_added:
        write_exact(path, final_people, keywords)
    after = inspect(path)
    errors: list[str] = []
    if scalar(after, "ImageDataHash") != expected_hash:
        errors.append("image data hash changed")
    if int(scalar(after, "ImageWidth") or 0) != int(row["width"]) or int(
        scalar(after, "ImageHeight") or 0
    ) != int(row["height"]):
        errors.append("dimensions changed")
    after_size = int(scalar(after, "FileSize") or 0)
    if names_added and after_size < before_size:
        errors.append("output file size decreased from pre-write size")
    if after_size < int(row["source_file_size"]):
        errors.append("output file size decreased below source size")
    for tag, expected in (
        ("PersonInImage", final_people),
        ("Subject", keywords),
        ("Keywords", keywords),
    ):
        actual = tidy_unique(list_value(after, tag))
        if [value.casefold() for value in actual] != [value.casefold() for value in expected]:
            errors.append(f"{tag} values differ")
        if len(actual) != len({value.casefold() for value in actual}):
            errors.append(f"{tag} contains duplicates")
    digest = scalar(after, "IPTCDigest")
    current_digest = scalar(after, "CurrentIPTCDigest")
    if digest and current_digest and digest != current_digest:
        errors.append("IPTC digest mismatch")
    return {
        "path": row["output_path"],
        "changed": bool(names_added),
        "names_added": names_added,
        "final_people": final_people,
        "before_size": before_size,
        "output_file_size": after_size,
        "verification_errors": tidy_unique(errors),
    }


def clear_root_symlinks(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for item in path.iterdir():
        if item.is_symlink():
            item.unlink()


def make_link(folder: Path, index: int, photo: Path) -> str:
    name = safe_component(f"{index:03d} - {photo.parent.name} - {photo.name}")
    link = folder / name
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(os.path.relpath(photo, folder))
    if not link.exists() or link.resolve() != photo.resolve():
        raise RuntimeError(f"Review link verification failed: {link}")
    return name


def main() -> int:
    assignments = json.loads(INPUT.read_text(encoding="utf-8"))
    if not isinstance(assignments, list) or not assignments:
        raise RuntimeError("Manual identification input is empty or invalid")
    requested_by_path: dict[str, list[str]] = {}
    assignment_by_path: dict[str, dict[str, object]] = {}
    for item in assignments:
        path = str(item["path"])
        if path in requested_by_path:
            raise RuntimeError(f"Duplicate assignment path: {path}")
        requested_by_path[path] = tidy_unique([str(value) for value in item["people"]])
        assignment_by_path[path] = item

    manifest_path = METADATA / "photo-manifest.csv"
    manifest_fields, manifest = read_csv(manifest_path)
    manifest_by_path = {row["output_path"]: row for row in manifest}
    missing = sorted(set(requested_by_path) - set(manifest_by_path))
    if missing:
        raise RuntimeError(f"Assignments missing from manifest: {missing}")

    print(f"Applying {len(assignments)} user-confirmed photo identifications", flush=True)
    results: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(apply_one, manifest_by_path[path], names)
            for path, names in requested_by_path.items()
        ]
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            results.append(future.result())
            if index % 10 == 0 or index == len(futures):
                print(f"  affected-file checks {index}/{len(futures)}", flush=True)

    failures = [row for row in results if row["verification_errors"]]
    if failures:
        raise RuntimeError(json.dumps(failures, indent=2))
    result_by_path = {str(row["path"]): row for row in results}

    report_rows: list[dict[str, str]] = []
    for path in sorted(requested_by_path, key=str.casefold):
        row = manifest_by_path[path]
        result = result_by_path[path]
        row["final_people"] = joined(list(result["final_people"]))
        row["people_added"] = joined(split(row["people_added"]) + requested_by_path[path])
        row["review_status"] = "corrected_people"
        row["correction_action"] = "add"
        row["output_file_size"] = str(result["output_file_size"])
        source = assignment_by_path[path]
        report_rows.append(
            {
                "path": path,
                "source_path": row["source_path"],
                "event": row["event"],
                "people_user_confirmed": joined(requested_by_path[path]),
                "people_newly_added_this_run": joined(list(result["names_added"])),
                "evidence": str(source.get("evidence", "user visual identification")),
                "notes": str(source.get("notes", "")),
                "jpeg_rewritten_this_run": "yes" if result["changed"] else "no",
            }
        )
    write_csv(manifest_path, manifest_fields, manifest)
    write_csv(
        METADATA / "manual-person-identifications.csv",
        [
            "path",
            "source_path",
            "event",
            "people_user_confirmed",
            "people_newly_added_this_run",
            "evidence",
            "notes",
            "jpeg_rewritten_this_run",
        ],
        report_rows,
    )

    people_counts: dict[str, int] = {}
    for row in manifest:
        for person in split(row["final_people"]):
            people_counts[person] = people_counts.get(person, 0) + 1
    write_csv(
        METADATA / "people-summary.csv",
        ["person", "photo_count"],
        [
            {"person": person, "photo_count": str(count)}
            for person, count in sorted(
                people_counts.items(), key=lambda item: (-item[1], item[0].casefold())
            )
        ],
    )

    people_root = ROOT / "By Person"
    for path in requested_by_path:
        photo = ROOT / path
        for person in split(manifest_by_path[path]["final_people"]):
            folder = people_root / safe_component(person)
            folder.mkdir(parents=True, exist_ok=True)
            link = folder / f"{photo.parent.name} - {photo.name}"
            if not link.exists() and not link.is_symlink():
                link.symlink_to(os.path.relpath(photo, folder))
            if not link.exists() or link.resolve() != photo.resolve():
                raise RuntimeError(f"By Person link verification failed: {link}")

    unresolved_path = METADATA / "unresolved-people.csv"
    unresolved_fields, unresolved_rows = read_csv(unresolved_path)
    unresolved_before = len(unresolved_rows)
    removed_from_unresolved = {row["path"] for row in unresolved_rows} & set(requested_by_path)
    remaining = [row for row in unresolved_rows if row["path"] not in requested_by_path]
    write_csv(unresolved_path, unresolved_fields, remaining)

    untagged_dir = REVIEW_ROOT / "Untagged - Needs Review"
    clear_root_symlinks(untagged_dir)
    untagged_review: list[dict[str, str]] = []
    for index, row in enumerate(sorted(remaining, key=lambda value: value["path"].casefold()), start=1):
        photo = ROOT / row["path"]
        untagged_review.append(
            {
                "link_name": make_link(untagged_dir, index, photo),
                "path": row["path"],
                "source_path": row["source_path"],
                "event": row["event"],
                "review_status": row["review_status"],
                "notes": row["notes"],
                "people_names": "",
            }
        )
    write_csv(
        untagged_dir / "review.csv",
        ["link_name", "path", "source_path", "event", "review_status", "notes", "people_names"],
        untagged_review,
    )
    (untagged_dir / "README.md").write_text(
        "# Untagged photos needing review\n\n"
        f"This folder contains {len(remaining)} symbolic links to full-resolution clean-master JPEGs that remain untagged. "
        "Uncertain faces, background-only faces, staff, and detail shots were not guessed. "
        "Local face-analysis folders preserve review derivatives; no master photo was duplicated, resized, or recompressed.\n",
        encoding="utf-8",
    )

    clear_root_symlinks(FOLLOWUP_DIR)
    followup_review: list[dict[str, str]] = []
    by_report_path = {row["path"]: row for row in report_rows}
    for index, path in enumerate(sorted(requested_by_path, key=str.casefold), start=1):
        photo = ROOT / path
        followup_review.append(
            {"link_name": make_link(FOLLOWUP_DIR, index, photo), **by_report_path[path]}
        )
    write_csv(
        FOLLOWUP_DIR / "review.csv",
        [
            "link_name",
            "path",
            "source_path",
            "event",
            "people_user_confirmed",
            "people_newly_added_this_run",
            "evidence",
            "notes",
            "jpeg_rewritten_this_run",
        ],
        followup_review,
    )
    (FOLLOWUP_DIR / "README.md").write_text(
        "# Manual follow-up identifications\n\n"
        f"These {len(assignments)} symbolic links show photos identified directly by Zach or later approved from the manual candidate sheets. "
        "Names were added as a union; existing names were retained. JPEG pixel data was not resized or recompressed.\n",
        encoding="utf-8",
    )

    symlink_count = sum(1 for path in REVIEW_ROOT.rglob("*") if path.is_symlink())
    face_derivatives = sum(
        1 for path in REVIEW_ROOT.rglob("*.jpg") if path.is_file() and not path.is_symlink()
    )
    review_path = METADATA / "review-folders.json"
    review_report = json.loads(review_path.read_text(encoding="utf-8"))
    review_report["manual_followup_identifications"] = len(assignments)
    review_report["untagged_for_review"] = len(remaining)
    review_report["photo_symlinks_created"] = symlink_count
    review_report["face_review_derivatives_created"] = face_derivatives
    review_report["verification_failures"] = []
    review_path.write_text(json.dumps(review_report, indent=2) + "\n", encoding="utf-8")

    changed = sum(bool(row["changed"]) for row in results)
    report = {
        "identifications_in_followup_index": len(assignments),
        "photos_rewritten_this_run": changed,
        "photos_removed_from_unresolved_queue_this_run": len(removed_from_unresolved),
        "unresolved_before_this_run": unresolved_before,
        "unresolved_after_this_run": len(remaining),
        "people_names_in_followup": sorted(
            {name for names in requested_by_path.values() for name in names}, key=str.casefold
        ),
        "verification_scope": "affected files only",
        "image_hash_changes": 0,
        "dimension_changes": 0,
        "photos_smaller_than_pre_write_size": 0,
        "metadata_verification_failures": [],
        "photos_resized_or_recompressed": 0,
        "external_photo_uploads": 0,
        "review_folder": str(FOLLOWUP_DIR),
        "remaining_untagged_review_folder": str(untagged_dir),
    }
    (METADATA / "manual-person-identifications.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )

    summary_path = METADATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["photos_with_people_added"] = sum(bool(split(row["people_added"])) for row in manifest)
    summary["photos_still_unresolved"] = len(remaining)
    summary["final_named_people"] = len(people_counts)
    summary["manual_person_followup"] = report
    summary["review_folders"] = review_report
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    readme_path = ROOT / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
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
        f"- Photos still unresolved: {len(remaining)}",
        readme,
    )
    followup_line = f"- Manual follow-up photo identifications indexed: {len(assignments)}"
    if "- Manual follow-up photo identifications indexed:" in readme:
        readme = re.sub(
            r"- Manual follow-up photo identifications indexed: \d+",
            followup_line,
            readme,
        )
    else:
        readme = readme.replace(
            "- Previously untagged photos newly tagged after local visual review: 42\n",
            "- Previously untagged photos newly tagged after local visual review: 42\n" + followup_line + "\n",
        )
    readme_path.write_text(readme, encoding="utf-8")

    print(json.dumps({**report, "final_named_people": len(people_counts)}, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

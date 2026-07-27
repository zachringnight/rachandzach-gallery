#!/usr/bin/env python3
"""Embed visually reviewed person matches into previously untagged master JPEGs."""

from __future__ import annotations

import concurrent.futures
import csv
import importlib.util
import json
import os
from collections import defaultdict
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
REPO = Path(__file__).resolve().parents[1]
FACE_ANALYSIS = REVIEW_ROOT / "Untagged - Needs Review" / "_Face Match Analysis"
FACE_CANDIDATES = FACE_ANALYSIS / "face-match-candidates.csv"

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


PRIMARY_ACCEPTED_RANKS = set(range(1, 26)) | set(range(27, 37)) | {38, 40, 41, 42}
SECOND_TIER_ACCEPTED_RANKS = {
    1,
    2,
    3,
    4,
    5,
    6,
    8,
    10,
    11,
    12,
    13,
    14,
    16,
    17,
    18,
    19,
    20,
    21,
    23,
    25,
    26,
    27,
}

# These came from the earlier high-confidence side-by-side identity review. They
# are merged with, rather than substituted for, the face-match selections.
MANUAL_MATCHES = {
    "01 Day 1/rachelzachday1-173.jpg": ["Parker Soskin"],
    "05 Ceremony/rachelzach-213.jpg": ["Chris Gutierrez", "Maura Keith Gutierrez"],
    "07 Cocktail Hour/rachelzach-560.jpg": ["Erin Ankin"],
    "07 Cocktail Hour/rachelzach-569.jpg": ["Tav Scott"],
    "07 Cocktail Hour/rachelzach-592.jpg": ["Tav Scott"],
    "09 Reception/rachelzach-887.jpg": ["Sally Stringham"],
    "09 Reception/rachelzach-929.jpg": ["Robbie Soskin"],
    "12 After Party/rachelzach-1106.jpg": ["Todd Lurie"],
}

MANUAL_NOTES = {
    "01 Day 1/rachelzachday1-173.jpg": "Earlier high-confidence visual match to Parker Soskin.",
    "05 Ceremony/rachelzach-213.jpg": "Earlier high-confidence visual matches to Chris and Maura.",
    "07 Cocktail Hour/rachelzach-560.jpg": "Earlier high-confidence visual match to Erin Ankin.",
    "07 Cocktail Hour/rachelzach-569.jpg": "Earlier high-confidence visual match to Tav Scott.",
    "07 Cocktail Hour/rachelzach-592.jpg": "Earlier high-confidence visual match to Tav Scott.",
    "09 Reception/rachelzach-887.jpg": "Earlier high-confidence visual match to Sally Stringham.",
    "09 Reception/rachelzach-929.jpg": "Earlier high-confidence visual match to Robbie Soskin.",
    "12 After Party/rachelzach-1106.jpg": "Earlier high-confidence visual match to Todd Lurie.",
}


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


def selected_face_matches() -> list[dict[str, str]]:
    _, rows = read_csv(FACE_CANDIDATES)
    primary = [
        row
        for row in rows
        if float(row["top1_max_cosine"]) >= 0.44 and float(row["margin"]) >= 0.09
    ]
    primary.sort(
        key=lambda row: (float(row["top1_max_cosine"]), float(row["margin"])),
        reverse=True,
    )
    second = [
        row
        for row in rows
        if not (float(row["top1_max_cosine"]) >= 0.44 and float(row["margin"]) >= 0.09)
        and float(row["top1_max_cosine"]) >= 0.40
        and float(row["margin"]) >= 0.05
        and int(row["top1_reference_support"]) >= 2
    ]
    second.sort(
        key=lambda row: (float(row["top1_max_cosine"]), float(row["margin"])),
        reverse=True,
    )
    if len(primary) != 44 or len(second) != 27:
        raise RuntimeError(
            f"Face-candidate set changed: expected 44 primary/27 second, got {len(primary)}/{len(second)}"
        )
    selected = [
        {**row, "review_tier": "primary"}
        for rank, row in enumerate(primary, 1)
        if rank in PRIMARY_ACCEPTED_RANKS
    ]
    selected.extend(
        {**row, "review_tier": "second_tier"}
        for rank, row in enumerate(second, 1)
        if rank in SECOND_TIER_ACCEPTED_RANKS
    )
    if len(selected) != 61:
        raise RuntimeError(f"Expected 61 visually accepted face assignments, found {len(selected)}")
    return selected


def apply_photo(row: dict[str, str], additions: list[str]) -> dict:
    path = ROOT / row["output_path"]
    before = inspect(path)
    expected_hash = row["image_data_hash"]
    before_hash = scalar(before, "ImageDataHash")
    before_size = int(scalar(before, "FileSize") or 0)
    if before_hash != expected_hash:
        return {
            "path": row["output_path"],
            "verification_errors": ["pre-write image hash does not match manifest"],
        }

    current_people = tidy_unique(split(row["final_people"]))
    final_people = tidy_unique(current_people + additions)
    existing_keys = {name.casefold() for name in current_people}
    names_added = [name for name in additions if name.casefold() not in existing_keys]
    keywords = tidy_unique(
        list_value(before, "Subject") + list_value(before, "Keywords") + final_people
    )
    write_exact(path, final_people, keywords)
    after = inspect(path)

    reasons: list[str] = []
    if scalar(after, "ImageDataHash") != expected_hash:
        reasons.append("image data hash changed")
    if int(scalar(after, "ImageWidth") or 0) != int(row["width"]) or int(
        scalar(after, "ImageHeight") or 0
    ) != int(row["height"]):
        reasons.append("dimensions changed")
    after_size = int(scalar(after, "FileSize") or 0)
    if after_size < before_size:
        reasons.append("output file size decreased from pre-write size")
    if after_size < int(row["source_file_size"]):
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
        "path": row["output_path"],
        "final_people": final_people,
        "names_added": names_added,
        "output_file_size": after_size,
        "verification_errors": tidy_unique(reasons),
    }


def clear_root_symlinks(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for item in path.iterdir():
        if item.is_symlink():
            item.unlink()


def make_link(folder: Path, index: int, photo: Path) -> str:
    link_name = safe_component(f"{index:03d} - {photo.parent.name} - {photo.name}")
    link = folder / link_name
    link.symlink_to(os.path.relpath(photo, folder))
    if not link.exists() or link.resolve() != photo.resolve():
        raise RuntimeError(f"Review link verification failed: {link}")
    return link_name


def main() -> int:
    manifest_path = METADATA / "photo-manifest.csv"
    manifest_fields, manifest = read_csv(manifest_path)
    manifest_by_output = {row["output_path"]: row for row in manifest}
    unresolved_path = METADATA / "unresolved-people.csv"
    unresolved_fields, unresolved_rows = read_csv(unresolved_path)
    if len(unresolved_rows) != 89:
        raise RuntimeError(f"Expected original unresolved queue of 89, found {len(unresolved_rows)}")

    face_rows = selected_face_matches()
    additions_by_path: dict[str, list[str]] = defaultdict(list)
    face_details_by_path: dict[str, list[str]] = defaultdict(list)
    evidence_by_path: dict[str, set[str]] = defaultdict(set)
    for row in face_rows:
        additions_by_path[row["path"]].append(row["top1_person"])
        evidence_by_path[row["path"]].add("local_face_match_visual_review")
        face_details_by_path[row["path"]].append(
            f"{row['top1_person']}|face={row['face_number']}|score={row['top1_max_cosine']}|"
            f"margin={row['margin']}|support={row['top1_reference_support']}|tier={row['review_tier']}"
        )
    for path, names in MANUAL_MATCHES.items():
        additions_by_path[path].extend(names)
        evidence_by_path[path].add("earlier_manual_visual_review")

    additions_by_path = {
        path: tidy_unique(names) for path, names in additions_by_path.items()
    }
    if len(additions_by_path) != 42:
        raise RuntimeError(f"Expected 42 newly taggable photos, found {len(additions_by_path)}")
    unresolved_outputs = {row["path"] for row in unresolved_rows}
    missing_from_queue = sorted(set(additions_by_path) - unresolved_outputs)
    if missing_from_queue:
        raise RuntimeError(f"Selected photos are missing from the unresolved queue: {missing_from_queue}")
    missing_from_manifest = sorted(set(additions_by_path) - set(manifest_by_output))
    if missing_from_manifest:
        raise RuntimeError(f"Selected photos are missing from the manifest: {missing_from_manifest}")

    print("Embedding reviewed people tags into 42 previously untagged photos", flush=True)
    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(apply_photo, manifest_by_output[path], additions)
            for path, additions in additions_by_path.items()
        ]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            results.append(future.result())
            if index % 10 == 0 or index == len(futures):
                print(f"  metadata {index}/{len(futures)}", flush=True)

    failures = [result for result in results if result["verification_errors"]]
    if failures:
        raise RuntimeError(json.dumps(failures[:20], indent=2))
    result_by_path = {result["path"]: result for result in results}

    recovery_rows: list[dict[str, str]] = []
    for path, additions in sorted(additions_by_path.items(), key=lambda item: item[0].casefold()):
        manifest_row = manifest_by_output[path]
        result = result_by_path[path]
        manifest_row["final_people"] = joined(result["final_people"])
        manifest_row["people_added"] = joined(split(manifest_row["people_added"]) + result["names_added"])
        manifest_row["review_status"] = "corrected_people"
        manifest_row["correction_action"] = "add"
        manifest_row["output_file_size"] = str(result["output_file_size"])
        recovery_rows.append(
            {
                "path": path,
                "source_path": manifest_row["source_path"],
                "event": manifest_row["event"],
                "names_added": joined(result["names_added"]),
                "evidence_sources": "; ".join(sorted(evidence_by_path[path])),
                "face_match_details": "; ".join(face_details_by_path[path]),
                "manual_review_notes": MANUAL_NOTES.get(path, ""),
            }
        )
    write_csv(manifest_path, manifest_fields, manifest)
    write_csv(
        METADATA / "untagged-person-recovery.csv",
        [
            "path",
            "source_path",
            "event",
            "names_added",
            "evidence_sources",
            "face_match_details",
            "manual_review_notes",
        ],
        recovery_rows,
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
    for path in additions_by_path:
        photo = ROOT / path
        for person in split(manifest_by_output[path]["final_people"]):
            person_dir = people_root / safe_component(person)
            person_dir.mkdir(parents=True, exist_ok=True)
            link = person_dir / f"{photo.parent.name} - {photo.name}"
            if not link.exists() and not link.is_symlink():
                link.symlink_to(os.path.relpath(photo, person_dir))
            if not link.exists() or link.resolve() != photo.resolve():
                raise RuntimeError(f"By Person link verification failed: {link}")

    remaining_rows = [row for row in unresolved_rows if row["path"] not in additions_by_path]
    if len(remaining_rows) != 47:
        raise RuntimeError(f"Expected 47 unresolved photos after recovery, found {len(remaining_rows)}")
    write_csv(unresolved_path, unresolved_fields, remaining_rows)

    untagged_dir = REVIEW_ROOT / "Untagged - Needs Review"
    clear_root_symlinks(untagged_dir)
    untagged_review_rows: list[dict[str, str]] = []
    for index, row in enumerate(sorted(remaining_rows, key=lambda value: value["path"].casefold()), 1):
        photo = ROOT / row["path"]
        link_name = make_link(untagged_dir, index, photo)
        untagged_review_rows.append(
            {
                "link_name": link_name,
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
        untagged_review_rows,
    )
    (untagged_dir / "README.md").write_text(
        "# Untagged photos needing review\n\n"
        "This folder now contains 47 symbolic links to full-resolution clean-master JPEGs that remain untagged after local face matching and visual review. "
        "Uncertain faces, background-only faces, staff, and detail shots were not guessed. The `_Face Match Analysis` subfolder preserves the local comparison audit for all original 89 candidates. "
        "No master photo was duplicated, resized, or recompressed.\n",
        encoding="utf-8",
    )

    tagged_dir = REVIEW_ROOT / "Newly Tagged from Untagged - 42"
    if tagged_dir.exists():
        for item in tagged_dir.iterdir():
            if item.is_symlink() or item.name in {"README.md", "review.csv", ".DS_Store"}:
                if item.is_dir() and not item.is_symlink():
                    raise RuntimeError(f"Refusing to remove unexpected directory: {item}")
                item.unlink(missing_ok=True)
            else:
                raise RuntimeError(f"Refusing to replace unknown item in {tagged_dir}: {item}")
    tagged_dir.mkdir(parents=True, exist_ok=True)
    tagged_review_rows: list[dict[str, str]] = []
    recovery_by_path = {row["path"]: row for row in recovery_rows}
    for index, path in enumerate(sorted(additions_by_path, key=str.casefold), 1):
        photo = ROOT / path
        link_name = make_link(tagged_dir, index, photo)
        row = recovery_by_path[path]
        tagged_review_rows.append({"link_name": link_name, **row})
    write_csv(
        tagged_dir / "review.csv",
        [
            "link_name",
            "path",
            "source_path",
            "event",
            "names_added",
            "evidence_sources",
            "face_match_details",
            "manual_review_notes",
        ],
        tagged_review_rows,
    )
    (tagged_dir / "README.md").write_text(
        "# Newly tagged from the untagged queue\n\n"
        "These 42 symbolic links show the photos that gained person tags through local face comparison plus the earlier high-confidence visual review. "
        "Names were added as a union; no existing person tags were removed. The JPEG pixel data was not resized or recompressed.\n",
        encoding="utf-8",
    )

    symlink_count = sum(
        1
        for folder in (
            REVIEW_ROOT / "Google Restored - 112",
            untagged_dir,
            tagged_dir,
        )
        for item in folder.iterdir()
        if item.is_symlink()
    )
    review_report = {
        "review_root": str(REVIEW_ROOT),
        "google_restored_reference": 112,
        "newly_tagged_from_untagged": 42,
        "untagged_for_review": 47,
        "photo_copies_created": 0,
        "photo_symlinks_created": symlink_count,
        "face_review_derivatives_created": sum(
            1 for path in FACE_ANALYSIS.rglob("*.jpg") if path.is_file()
        ),
        "master_photos_resized_or_recompressed": 0,
        "verification_failures": [],
    }
    (METADATA / "review-folders.json").write_text(
        json.dumps(review_report, indent=2) + "\n", encoding="utf-8"
    )

    recovery_report = {
        "original_untagged_review_queue": 89,
        "photos_tagged": 42,
        "accepted_face_assignments": len(face_rows),
        "earlier_manual_photo_matches_included": len(MANUAL_MATCHES),
        "unique_person_assignments_added": sum(
            len(result["names_added"]) for result in results
        ),
        "remaining_untagged_review_queue": 47,
        "matching_method": "local YuNet detection and SFace comparison, followed by side-by-side visual review",
        "master_jpegs_metadata_updated": 42,
        "image_hash_changes": 0,
        "dimension_changes": 0,
        "photos_smaller_than_pre_write_size": 0,
        "metadata_verification_failures": failures,
        "photos_resized_or_recompressed": 0,
        "external_photo_uploads": 0,
        "verification_scope": "affected files only; full-library verification deferred until the final pass per user request",
        "newly_tagged_review_folder": str(tagged_dir),
        "remaining_untagged_review_folder": str(untagged_dir),
    }
    (METADATA / "untagged-person-recovery.json").write_text(
        json.dumps(recovery_report, indent=2) + "\n", encoding="utf-8"
    )

    summary_path = METADATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["photos_with_people_added"] = sum(
        bool(split(row["people_added"])) for row in manifest
    )
    summary["photos_still_unresolved"] = len(remaining_rows)
    summary["final_named_people"] = len(people_counts)
    summary["untagged_person_recovery"] = recovery_report
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
        r"- Photos still unresolved: \d+",
        f"- Photos still unresolved: {len(remaining_rows)}",
        readme,
    )
    recovery_line = "- Previously untagged photos newly tagged after local visual review: 42"
    if recovery_line not in readme:
        readme = readme.replace(
            "- Previously excluded Google people-tag sets restored: 112\n",
            "- Previously excluded Google people-tag sets restored: 112\n" + recovery_line + "\n",
        )
    readme = readme.replace("- Image derivatives created: 0", "- Master-photo derivatives created: 0")
    readme_path.write_text(readme, encoding="utf-8")

    print(
        json.dumps(
            {
                **recovery_report,
                "final_named_people": len(people_counts),
                "review_symlinks": symlink_count,
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

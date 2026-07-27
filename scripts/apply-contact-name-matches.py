#!/usr/bin/env python3
"""Apply confirmed wedding-person names to the clean master without changing pixels."""

from __future__ import annotations

import concurrent.futures
import csv
import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(
    os.environ.get(
        "CLEAN_MASTER_DIR",
        "/Users/zsoskin/Rachel & Zach - Wedding Master Clean",
    )
).resolve()
METADATA = ROOT / "_Metadata"


MATCHES = [
    {"old_name": "Patti", "new_name": "Patti Soskin", "confidence": "authoritative", "source": "user", "notes": "Surname confirmed by Zach."},
    {"old_name": "Robbie", "new_name": "Robbie Soskin", "confidence": "authoritative", "source": "user", "notes": "Surname confirmed by Zach."},
    {"old_name": "Jorie", "new_name": "Jorie Soskin", "confidence": "authoritative", "source": "user", "notes": "Surname confirmed by Zach."},
    {"old_name": "Parker", "new_name": "Parker Soskin", "confidence": "authoritative", "source": "user", "notes": "Surname confirmed by Zach."},
    {"old_name": "Riley", "new_name": "Riley Soskin", "confidence": "authoritative", "source": "user", "notes": "Surname confirmed by Zach."},
    {"old_name": "Rylie", "new_name": "Riley Soskin", "confidence": "high", "source": "user+Google Photos", "notes": "Misspelling appears beside Google label Riley Soskin in all four photos."},
    {"old_name": "J Til", "new_name": "Jeff Attila", "confidence": "authoritative", "source": "user+contacts+wedding records", "notes": "Zach confirmed Jeff; contact and gift tracker provide the surname and spelling."},
    {"old_name": "Phil C", "new_name": "Phil Campbell", "confidence": "authoritative", "source": "user", "notes": "Full name confirmed by Zach."},
    {"old_name": "Keagen", "new_name": "Keagen Edwards", "confidence": "authoritative", "source": "user+contacts+wedding records", "notes": "Full name and spelling confirmed."},
    {"old_name": "Tim J", "new_name": "Tim Jackowski", "confidence": "authoritative", "source": "user+wedding records", "notes": "Full name confirmed by Zach and wedding records."},
    {"old_name": "Kayla", "new_name": "Kayla Kohler", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Trelawny", "new_name": "Trelawny Vermont-Davis", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Tara", "new_name": "Tara Brown", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Sally", "new_name": "Sally Stringham", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Bryant", "new_name": "Bryant Kohler", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Steve M", "new_name": "Steve Michaelsen", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique wedding-record match."},
    {"old_name": "Cogan", "new_name": "Daniel Cogan", "confidence": "high", "source": "contacts+wedding records", "notes": "Surname label and unique wedding-record match."},
    {"old_name": "Siri", "new_name": "Siri Ramos", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Nate O", "new_name": "Nate Oveson", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique wedding-record match."},
    {"old_name": "Frankie B", "new_name": "Frankie Bennett", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique wedding-record match."},
    {"old_name": "Dubov", "new_name": "Alex Dubov", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google identifies Alex in 17 of 23 labeled photos."},
    {"old_name": "ASHLEY", "new_name": "Ashley Dubov", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google identifies Ashley Dubov in 15 of 19 labeled photos."},
    {"old_name": "Meg", "new_name": "Meg McCullough", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Meg repeatedly appears with Siri Ramos, her paired wedding-record entry."},
    {"old_name": "Pasha", "new_name": "Pasha Hashemi", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Gisel", "new_name": "Gisel Attila", "confidence": "high", "source": "contacts+wedding records", "notes": "Saved contact and gift tracker agree on spelling."},
    {"old_name": "Nate waldron", "new_name": "Nate Waldron", "confidence": "high", "source": "contacts+wedding records", "notes": "Capitalization normalization; unique wedding-record match."},
    {"old_name": "Debi", "new_name": "Debi Becker", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "SCOTT L", "new_name": "Scott Lattimer", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique wedding-record match; corrected surname spelling."},
    {"old_name": "Jacquie", "new_name": "Jacquie Michaelsen", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Maura", "new_name": "Maura Keith Gutierrez", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Adi", "new_name": "Adi Greene", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Chris N", "new_name": "Chris Nuelle", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique wedding-record match."},
    {"old_name": "Erik", "new_name": "Erik Gunkel", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Photos include Morgan Becker, his paired wedding-record entry."},
    {"old_name": "Libby", "new_name": "Libby Rush", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Rush", "new_name": "Libby Rush", "confidence": "high", "source": "Google Photos+wedding records", "notes": "Google identifies Libby in five of seven photos."},
    {"old_name": "Bob P", "new_name": "Bob Pohlad", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique wedding-record match."},
    {"old_name": "Harris", "new_name": "Harris Ankin", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google raw name and wedding records agree."},
    {"old_name": "Leah M", "new_name": "Leah McCall", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique wedding-record match."},
    {"old_name": "Brendan", "new_name": "Brendan Greene", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Chris", "new_name": "Chris Gutierrez", "confidence": "high", "source": "wedding records+photo co-occurrence", "notes": "Label repeatedly appears with Maura Keith Gutierrez; Chris Nuelle remains separately labeled."},
    {"old_name": "Morgan", "new_name": "Morgan Becker", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Tav", "new_name": "Tav Scott", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Carter", "new_name": "Carter Cheskey", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique first-name wedding-record match."},
    {"old_name": "Greg", "new_name": "Greg Foster", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Four photos include David Benrud, his paired wedding-record entry."},
    {"old_name": "HECKLIN", "new_name": "Steve Hecklin", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Label repeatedly appears with Sandra Hecklin."},
    {"old_name": "Marty", "new_name": "Marty Harstad", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Label appears with Janice Harstad; distinguishes Marty from Marty Erdley."},
    {"old_name": "Rob A", "new_name": "Robert Abisi", "confidence": "high", "source": "contacts", "notes": "Initial and unique saved-contact match."},
    {"old_name": "SANDRA", "new_name": "Sandra Hecklin", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Unique wedding-record match and repeated Steve Hecklin pairing."},
    {"old_name": "BECKY", "new_name": "Becky Pohlad", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Erin", "new_name": "Erin Ankin", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "JUELS", "new_name": "Jules Gesink", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Misspelling; label appears with partner Spencer Soltman."},
    {"old_name": "Jules", "new_name": "Jules Gesink", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Saved contact and partner Spencer Soltman identify the full name."},
    {"old_name": "Lars", "new_name": "Lars Lattimer", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and tracker match."},
    {"old_name": "Allan C", "new_name": "Allan Caplan", "confidence": "high", "source": "contacts+wedding records", "notes": "Initial and unique tracker match."},
    {"old_name": "J Mohr", "new_name": "Jon Mohr", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google variant and wedding records point to Jon Mohr."},
    {"old_name": "Mohr", "new_name": "Jon Mohr", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "All four photos also contain the Google John Mohn variant."},
    {"old_name": "John Mohn", "new_name": "Jon Mohr", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google-name error; no wedding record for John Mohn and photos overlap Mohr labels."},
    {"old_name": "Janice", "new_name": "Janice Harstad", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Leeann", "new_name": "LeeAnn Howarth", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google and tracker provide the full name and capitalization."},
    {"old_name": "Natalie", "new_name": "Natalie Lane", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Scotty P", "new_name": "Scott Prusha", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google raw name and wedding records agree."},
    {"old_name": "LAURA WEISMAN", "new_name": "Laura Weisman", "confidence": "high", "source": "contacts+wedding records", "notes": "Case normalization; exact wedding-record match."},
    {"old_name": "Rod", "new_name": "Rodd Gilbert", "confidence": "high", "source": "contacts+wedding records", "notes": "Saved contact and tracker provide full name and spelling."},
    {"old_name": "Amanda", "new_name": "Amanda Pliska", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Richie", "new_name": "Richie Caputo", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "TODD LEONARD", "new_name": "Todd Leonard", "confidence": "high", "source": "contacts+wedding records", "notes": "Case normalization; exact wedding-record match."},
    {"old_name": "Kaitlin Burns", "new_name": "Kaitlin Burton", "confidence": "high", "source": "Google Photos+contacts+wedding records", "notes": "Google, contact, and tracker agree on Burton."},
    {"old_name": "Kelsey Meyers", "new_name": "Kelsey Myers", "confidence": "high", "source": "contacts+wedding records", "notes": "Saved contact and both wedding workbooks use Myers."},
    {"old_name": "Maddie Channess", "new_name": "Maddie Chaness", "confidence": "high", "source": "contacts+wedding records", "notes": "Saved contact and gift tracker use Chaness."},
    {"old_name": "Nick Pugs", "new_name": "Nick Pugliese", "confidence": "high", "source": "contacts+wedding records", "notes": "Wedding nickname expanded using the gift tracker."},
    {"old_name": "Pat Burton", "new_name": "Patrick Burton", "confidence": "high", "source": "Google Photos+wedding records", "notes": "Google and gift tracker use Patrick Burton."},
    {"old_name": "Jamie", "new_name": "Jamie Levine", "confidence": "high", "source": "contacts+wedding records+photo co-occurrence", "notes": "Unique saved contact and guest-list match; appears with partner Phil Quist."},
    {"old_name": "Nick Adam", "new_name": "Nick Carl Adam", "confidence": "high", "source": "contacts+wedding records", "notes": "Unique saved contact and wedding-record match."},
    {"old_name": "Tim Meyers", "new_name": "Tim Myers", "confidence": "high", "source": "contacts+wedding records", "notes": "Saved contact and both wedding workbooks use Myers."},
    {"old_name": "Jeremy Burton Burton", "new_name": "Jeremy Burton", "confidence": "high", "source": "wedding records", "notes": "Removed duplicated surname."},
    {"old_name": "Taylor Becker", "new_name": "Taylor Bennett", "confidence": "authoritative", "source": "user", "notes": "Identity confirmed by Zach."},
    {"old_name": "Beth", "new_name": "Beth Leonard", "confidence": "authoritative", "source": "user", "notes": "Identity confirmed by Zach."},
    {"old_name": "Tyler", "new_name": "Tyler Speier", "confidence": "authoritative", "source": "user+contacts", "notes": "Zach identified Tyler; saved contact confirms the spelling Speier."},
    {"old_name": "Norris", "new_name": "Norris Shanholtz", "confidence": "authoritative", "source": "user", "notes": "Surname confirmed by Zach."},
    {"old_name": "Matt", "new_name": "Matt Muller", "confidence": "authoritative", "source": "user+wedding records", "notes": "Zach identified Matt as Canadian; the wedding records uniquely distinguish Matt Muller from Matt Wargo."},
]

REVIEW = [
    {"label": "pa", "candidates": "", "reason": "Likely partial-name autosave; insufficient evidence to expand safely."},
]

REMAP = {row["old_name"]: row["new_name"] for row in MATCHES}
OBSOLETE_CASEFOLD = {
    old.casefold()
    for old, new in REMAP.items()
    if old.casefold() != new.casefold()
}
EXIF_PADDING = "0" * 4096


def split(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(";") if part.strip()]


def tidy_unique(values: list[str]) -> list[str]:
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


def canonicalize(values: list[str]) -> list[str]:
    return tidy_unique([REMAP.get(value, value) for value in values])


def joined(value: str | None) -> str:
    return "; ".join(canonicalize(split(value)))


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
        f"-ExifIFD:Padding={EXIF_PADDING}",
        f"-XMP-iptcExt:PersonInImage={'|||'.join(people)}" if people else "-XMP-iptcExt:PersonInImage=",
        f"-XMP-dc:Subject={'|||'.join(keywords)}" if keywords else "-XMP-dc:Subject=",
        f"-IPTC:Keywords={'|||'.join(keywords)}" if keywords else "-IPTC:Keywords=",
        "-IPTCDigest=new",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"Metadata write failed: {path}")


def reconcile_photo(row: dict[str, str]) -> dict:
    path = ROOT / row["output_path"]
    before = inspect(path)
    expected_hash = row["image_data_hash"]
    before_hash = scalar(before, "ImageDataHash")
    before_size = int(scalar(before, "FileSize") or 0)
    if before_hash != expected_hash:
        return {"path": row["output_path"], "verification_errors": ["pre-write image hash does not match manifest"]}

    people = canonicalize(split(row["final_people"]))
    keywords = canonicalize(list_value(before, "Subject") + list_value(before, "Keywords") + people)
    write_exact(path, people, keywords)
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

    expected_people = [value.casefold() for value in people]
    expected_keywords = [value.casefold() for value in keywords]
    for tag, expected in (
        ("PersonInImage", expected_people),
        ("Subject", expected_keywords),
        ("Keywords", expected_keywords),
    ):
        actual_values = tidy_unique(list_value(after, tag))
        actual = [value.casefold() for value in actual_values]
        if actual != expected:
            reasons.append(f"{tag} values differ")
        if len(actual) != len(set(actual)):
            reasons.append(f"{tag} contains duplicates")
        if any(value in OBSOLETE_CASEFOLD for value in actual):
            reasons.append(f"{tag} still contains an old alias")

    digest = scalar(after, "IPTCDigest")
    current = scalar(after, "CurrentIPTCDigest")
    if digest and current and digest != current:
        reasons.append("IPTC digest mismatch")

    return {
        "path": row["output_path"],
        "before_size": before_size,
        "output_file_size": after_size,
        "verification_errors": tidy_unique(reasons),
    }


def safe_component(value: str) -> str:
    return value.replace("/", " - ").replace(":", " - ").strip(" .")


def remove_symlink_directory(path: Path) -> None:
    if not path.exists():
        return
    items = list(path.iterdir())
    if any(not item.is_symlink() for item in items):
        raise RuntimeError(f"Refusing to remove non-symlink item from {path}")
    for item in items:
        item.unlink()
    path.rmdir()


def main() -> int:
    manifest_path = METADATA / "photo-manifest.csv"
    fields, manifest = read_csv(manifest_path)
    original_people = {row["output_path"]: split(row["final_people"]) for row in manifest}
    source_people = {
        row["output_path"]: tidy_unique(
            split(row["lightroom_people"]) + split(row["google_people"])
        )
        for row in manifest
    }
    mapping_counts = {
        old: sum(old in names for names in source_people.values()) for old in REMAP
    }
    historically_affected = {
        path for path, names in source_people.items() if any(name in REMAP for name in names)
    }
    affected = [
        row for row in manifest if any(name in REMAP for name in original_people[row["output_path"]])
    ]

    print(
        f"Applying {len(MATCHES)} confirmed name mappings to {len(affected)} newly affected photos "
        f"({len(historically_affected)} reconciled overall)",
        flush=True,
    )
    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(reconcile_photo, row) for row in affected]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            results.append(future.result())
            if index % 50 == 0 or index == len(futures):
                print(f"  metadata {index}/{len(futures)}", flush=True)

    errors = [result for result in results if result["verification_errors"]]
    if errors:
        raise RuntimeError(json.dumps(errors[:20], indent=2))

    output_sizes = {result["path"]: result["output_file_size"] for result in results}
    for row in manifest:
        for field in ("people_added", "final_people"):
            row[field] = joined(row[field])
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
    match_sources = {row["old_name"]: row["source"] for row in MATCHES}
    for row in alias_rows:
        old_canonical = row["canonical_name"]
        new_canonical = REMAP.get(old_canonical, REMAP.get(row["google_name"], old_canonical))
        if new_canonical != old_canonical:
            row["canonical_name"] = new_canonical
            row["mapping_method"] = f"contact_wedding_records:{match_sources.get(old_canonical, match_sources.get(row['google_name'], 'confirmed'))}"
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
            for person, count in sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold()))
        ],
    )

    match_rows = []
    for row in MATCHES:
        match_rows.append({**row, "photo_count": str(mapping_counts[row["old_name"]])})
    write_csv(
        METADATA / "contact-name-matches.csv",
        ["old_name", "new_name", "confidence", "source", "notes", "photo_count"],
        match_rows,
    )

    review_counts = {
        row["label"]: sum(row["label"] in names for names in original_people.values())
        for row in REVIEW
    }
    write_csv(
        METADATA / "contact-name-review-needed.csv",
        ["label", "candidates", "photo_count", "reason"],
        [
            {
                "label": row["label"],
                "candidates": row["candidates"],
                "photo_count": str(review_counts[row["label"]]),
                "reason": row["reason"],
            }
            for row in REVIEW
        ],
    )

    people_root = ROOT / "By Person"
    for old_name, new_name in REMAP.items():
        old_dir = people_root / safe_component(old_name)
        new_dir = people_root / safe_component(new_name)
        if old_dir.exists() and new_dir.exists():
            try:
                same_directory = old_dir.samefile(new_dir)
            except OSError:
                same_directory = False
            if same_directory:
                remove_symlink_directory(old_dir)
                continue
        remove_symlink_directory(old_dir)

    canonical_names = set(REMAP.values())
    affected_paths = {row["output_path"] for row in affected}
    for row in manifest:
        people = split(row["final_people"])
        if row["output_path"] not in affected_paths and not canonical_names.intersection(people):
            continue
        photo = ROOT / row["output_path"]
        for person in people:
            person_dir = people_root / safe_component(person)
            person_dir.mkdir(parents=True, exist_ok=True)
            link = person_dir / f"{photo.parent.name} - {photo.name}"
            if not link.exists() and not link.is_symlink():
                link.symlink_to(os.path.relpath(photo, person_dir))

    broken_links: list[str] = []
    for person_dir in people_root.iterdir():
        if not person_dir.is_dir():
            continue
        for link in person_dir.iterdir():
            if not link.is_symlink() or not link.exists():
                broken_links.append(str(link.relative_to(ROOT)))
    if broken_links:
        raise RuntimeError(json.dumps({"broken_or_nonlink_items": broken_links[:20]}, indent=2))

    summary_path = METADATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["final_named_people"] = len(counts)
    if "alias_reconciliation" in summary:
        summary["alias_reconciliation"] = {
            old: REMAP.get(new, new) for old, new in summary["alias_reconciliation"].items()
        }
    summary["contact_name_reconciliation"] = {
        "confirmed_mappings": len(MATCHES),
        "source_rows_with_direct_alias_evidence": len(historically_affected),
        "photos_written_last_run": len(affected),
        "labels_remaining_for_review": len(REVIEW),
        "image_hash_changes": 0,
        "dimension_changes": 0,
        "photos_smaller_than_pre_write_size": 0,
        "metadata_verification_failures": 0,
        "broken_by_person_links": 0,
    }
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    readme_path = ROOT / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    readme = re.sub(
        r"- Named people in final index: \d+",
        f"- Named people in final index: {len(counts)}",
        readme,
    )
    reconciliation_lines = (
        f"- Confirmed contact/wedding-record name mappings applied: {len(MATCHES)}\n"
        f"- Source rows with direct alias evidence: {len(historically_affected)}\n"
        f"- Name labels still requiring confirmation: {len(REVIEW)}"
    )
    if "- Confirmed contact/wedding-record name mappings applied:" in readme:
        readme = re.sub(
            r"- Confirmed contact/wedding-record name mappings applied: \d+\n"
            r"- (?:Photos with at least one reconciled name|Source rows with direct alias evidence): \d+\n"
            r"- Name labels still requiring confirmation: \d+",
            reconciliation_lines,
            readme,
        )
    else:
        readme = re.sub(
            r"(- Named people in final index: \d+)",
            r"\1\n" + reconciliation_lines,
            readme,
        )
    readme_path.write_text(readme, encoding="utf-8")

    report = {
        "confirmed_mappings": len(MATCHES),
        "source_rows_with_direct_alias_evidence": len(historically_affected),
        "photos_written_last_run": len(affected),
        "labels_remaining_for_review": [row["label"] for row in REVIEW],
        "verification_failures": errors,
        "image_hash_changes": 0,
        "dimension_changes": 0,
        "photos_smaller_than_pre_write_size": 0,
        "broken_by_person_links": 0,
        "final_named_people": len(counts),
    }
    (METADATA / "contact-name-reconciliation.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

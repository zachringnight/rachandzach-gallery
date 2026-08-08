#!/usr/bin/env python3
"""Rename, or delete, one person across the clean master's embedded metadata.

Why this exists alongside reconcile-clean-master-aliases.py: that script is
driven by _Metadata/photo-manifest.csv and can only reach names the original
import wrote. A name that arrived later, through
write-additions-to-master.py's face-tag pass, is in the JPEGs but not in the
manifest, so the reconciler finds nothing to do and silently leaves the wrong
name in place. That is exactly the shape of "Brend Wasserman": zero manifest
rows, ten files.

This is a REPLACEMENT, not an addition, which makes it the one metadata
operation AGENTS.md gates on Zach. It is therefore deliberately narrow:

  * one name at a time, given explicitly on the command line;
  * only files that actually carry that name are touched;
  * every other name in every field is preserved exactly;
  * ImageDataHash and dimensions are compared before and after, so a run that
    altered a single pixel fails instead of reporting success; and
  * dry run by default. --write is required to touch anything.

--delete drops the name instead of replacing it, for junk entries that are not
anybody: a truncation like "pa" left in one original's PersonInImage. Same
matching, same guards; the only difference is that nothing takes the old
entry's place.

Same exiftool conventions as the scripts either side of it:
XMP-iptcExt:PersonInImage, XMP-dc:Subject, IPTC:Keywords, ||| separator,
-overwrite_original_in_place (no sidecar), -P to keep the file date.

Usage (from the repo root):
  python3 scripts/rename-person-in-master.py "Old Name" "New Name"
  python3 scripts/rename-person-in-master.py "Old Name" "New Name" --write
  python3 scripts/rename-person-in-master.py "pa" --delete --write

After --write, run scripts/sync-manifest-after-write.py so the manifest's
size check stops reporting the intended growth as tampering.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

MASTER = Path("/Users/zsoskin/Rachel & Zach - Wedding Master Clean")
FIELDS = (
    ("XMP-iptcExt:PersonInImage", "PersonInImage"),
    ("XMP-dc:Subject", "Subject"),
    ("IPTC:Keywords", "Keywords"),
)


def unique(values: list[str]) -> list[str]:
    """Case-insensitive dedupe, sorted. Matches the other master scripts."""
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


def scalar(record: dict, suffix: str):
    for key, value in record.items():
        if key == suffix or key.endswith(f":{suffix}"):
            return value
    return None


def inspect(paths: list[Path]) -> dict[str, dict]:
    if not paths:
        return {}
    result = subprocess.run(
        [
            "exiftool", "-json", "-struct", "-G1",
            "-charset", "filename=UTF8",
            "-ImageDataHash", "-ImageWidth", "-ImageHeight", "-FileSize#",
            "-XMP-iptcExt:PersonInImage", "-XMP-dc:Subject", "-IPTC:Keywords",
            *(str(p) for p in paths),
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0 and not result.stdout.strip():
        raise RuntimeError(result.stderr.strip() or "exiftool read failed")
    return {record["SourceFile"]: record for record in json.loads(result.stdout)}


def find_targets(old: str) -> list[Path]:
    """Every real JPEG under the master carrying the old name in any of the
    three fields.

    Matching is exact and case-insensitive, done here rather than in an
    exiftool -if regex: list-valued tags are joined before -if sees them, so a
    regex either needs anchors that then fail on multi-name photos, or drops
    the anchors and matches "Dan" inside "Danny". Reading the tags and
    comparing whole strings has neither failure.

    -i SYMLINKS skips the "By Person" and "_Review" link farms, which point
    back at these same files. Without it a single photograph is written once
    per link that references it. Takes a few minutes over the full master.
    """
    result = subprocess.run(
        [
            "exiftool", "-r", "-json", "-struct", "-G1", "-q", "-q",
            "-i", "SYMLINKS",
            "-charset", "filename=UTF8",
            "-ext", "jpg", "-ext", "jpeg",
            "-XMP-iptcExt:PersonInImage", "-XMP-dc:Subject", "-IPTC:Keywords",
            str(MASTER),
        ],
        capture_output=True, text=True,
    )
    if not result.stdout.strip():
        raise RuntimeError(result.stderr.strip() or "exiftool scan returned nothing")

    wanted = old.casefold()
    seen: set[Path] = set()
    targets: list[Path] = []
    for record in json.loads(result.stdout):
        if not any(
            value.casefold() == wanted
            for _, suffix in FIELDS
            for value in list_value(record, suffix)
        ):
            continue
        # Resolve anyway: a stray hard link or a link exiftool still followed
        # must not put the same inode in the list twice.
        path = Path(record["SourceFile"]).resolve()
        if path in seen:
            continue
        seen.add(path)
        targets.append(path)
    return sorted(targets)


def write_exact(path: Path, values: dict[str, list[str]]) -> None:
    command = [
        "exiftool", "-overwrite_original_in_place", "-P",
        "-api", "NoDups",
        "-charset", "filename=UTF8", "-charset", "IPTC=UTF8",
        "-sep", "|||",
    ]
    for tag, suffix in FIELDS:
        joined = "|||".join(values[suffix])
        command.append(f"-{tag}={joined}" if joined else f"-{tag}=")
    command.extend(["-IPTCDigest=new", str(path)])
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"metadata write failed: {path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("old_name")
    parser.add_argument("new_name", nargs="?")
    parser.add_argument("--delete", action="store_true",
                        help="drop the name instead of replacing it")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    old = args.old_name.strip()
    new = (args.new_name or "").strip()
    if args.delete:
        if new:
            print("--delete takes one name; do not pass a replacement")
            return 2
    elif not new or old.casefold() == new.casefold():
        print("old and new names must differ and be non-empty")
        return 2
    if not old:
        print("the name to change must be non-empty")
        return 2

    print(f'Deleting "{old}" from the clean master' if args.delete
          else f'Renaming "{old}" -> "{new}" in the clean master')
    print("DRY RUN: nothing will be written. Re-run with --write to apply.\n"
          if not args.write else "WRITE MODE\n")

    targets = find_targets(old)
    print(f"{len(targets)} file(s) carry that name")
    if not targets:
        return 0

    before = inspect(targets)
    planned: dict[Path, dict[str, list[str]]] = {}
    for path in targets:
        record = before[str(path)]
        values = {}
        for _, suffix in FIELDS:
            current = list_value(record, suffix)
            if any(v.casefold() == old.casefold() for v in current):
                current = [v for v in current if v.casefold() != old.casefold()]
                if not args.delete:
                    current = current + [new]
            values[suffix] = unique(current)
        planned[path] = values
        rel = str(path).replace(f"{MASTER}/", "")
        print(f"  {rel}: {', '.join(s for _, s in FIELDS)} -> {len(values['PersonInImage'])} people")

    if not args.write:
        print("\nNothing written.")
        return 0

    failures: list[str] = []
    for index, path in enumerate(targets, 1):
        write_exact(path, planned[path])
        if index % 10 == 0 or index == len(targets):
            print(f"  wrote {index}/{len(targets)}")

    after = inspect(targets)
    for path in targets:
        rel = str(path).replace(f"{MASTER}/", "")
        b, a = before[str(path)], after[str(path)]
        if scalar(a, "ImageDataHash") != scalar(b, "ImageDataHash"):
            failures.append(f"{rel}: image data hash changed")
        if (scalar(a, "ImageWidth"), scalar(a, "ImageHeight")) != (
            scalar(b, "ImageWidth"), scalar(b, "ImageHeight")
        ):
            failures.append(f"{rel}: dimensions changed")
        for _, suffix in FIELDS:
            got, want = list_value(a, suffix), planned[path][suffix]
            if got != want:
                failures.append(f"{rel}: {suffix} is {got}, expected {want}")
            # Nothing but the changed entry may have moved.
            lost = [
                v for v in list_value(b, suffix)
                if v.casefold() != old.casefold()
                and not any(g.casefold() == v.casefold() for g in got)
            ]
            if lost:
                failures.append(f"{rel}: {suffix} lost {lost}")

    if failures:
        print("\nVERIFICATION FAILED:")
        for f in failures:
            print("  ", f)
        return 1

    print(f"\n{'deleted from' if args.delete else 'renamed in'} {len(targets)} "
          f"file(s); pixels, dimensions and every other name verified unchanged")
    print("next: python3 scripts/sync-manifest-after-write.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())

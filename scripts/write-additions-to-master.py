#!/usr/bin/env python3
"""Write the 831 reviewed face-tag additions into the master's embedded
metadata (PersonInImage, Subject, Keywords), so the original JPEGs carry the
same names the gallery shows.

Additive only, matching this run's scope: unions new display names onto
whatever a photo already has. Never removes a name, so
metadata/reviewed-face-tag-removals.json is not applied here -- an original
that still says Daniel Cogan on 09 Reception/rachelzach-755.jpg keeps saying
so.

Same exiftool invocation and conventions as normalize-clean-master-metadata.py:
XMP-iptcExt:PersonInImage, XMP-dc:Subject, IPTC:Keywords, ||| list separator,
-overwrite_original_in_place (edits in place, no *_original backup file).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MASTER = Path("/Users/zsoskin/Rachel & Zach - Wedding Master Clean")
ADDITIONS = REPO / "metadata" / "reviewed-face-tag-additions.json"
CATALOG = REPO / "src" / "generated" / "gallery-v2.json"


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


def chunks(values: list, size: int = 160):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def read_current(paths: list[Path]) -> dict[Path, dict]:
    records: dict[Path, dict] = {}
    for batch_index, batch in enumerate(chunks(paths), 1):
        result = subprocess.run(
            [
                "exiftool", "-json", "-struct", "-G1",
                "-charset", "filename=UTF8",
                "-XMP-iptcExt:PersonInImage", "-XMP-dc:Subject", "-IPTC:Keywords",
                *(str(p) for p in batch),
            ],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "exiftool read failed")
        for rec in json.loads(result.stdout):
            records[Path(rec["SourceFile"])] = rec
        print(f"  read {batch_index}/{-(-len(paths)//160)} "
              f"({min(batch_index*160, len(paths))}/{len(paths)})", flush=True)
    return records


def write_one(
    path: Path, people: list[str], keywords: list[str], dry_run: bool = False
) -> tuple[bool, str]:
    """Union `people`/`keywords` onto one master JPEG's embedded metadata.

    Only tag fields are touched: exiftool rewrites the container, never the
    encoded image data, so this does not recompress or otherwise degrade the
    photograph (see the metadata clause in AGENTS.md).

    `-overwrite_original_in_place` skips exiftool's usual `*_original`
    sidecar. That is deliberate here -- the master is 13 GB across 2,625
    files and Zach keeps multiple independent backups of the originals -- but
    it does mean this script is the last line of defence, hence --dry-run.
    """
    if dry_run:
        return True, ""
    command = [
        "exiftool", "-overwrite_original_in_place", "-P",
        "-api", "NoDups",
        "-charset", "filename=UTF8", "-charset", "IPTC=UTF8",
        "-sep", "|||",
        f"-XMP-iptcExt:PersonInImage={'|||'.join(people)}",
        f"-XMP-dc:Subject={'|||'.join(keywords)}",
        f"-IPTC:Keywords={'|||'.join(keywords)}",
        "-IPTCDigest=new",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    output = "\n".join(p.strip() for p in (result.stdout, result.stderr) if p.strip())
    return result.returncode == 0, output


def main() -> int:
    # Default is a preview. Writing to the master should be something you
    # asked for on purpose, not what happens when you run the file to see
    # what it does.
    dry_run = "--write" not in sys.argv
    if dry_run:
        print("DRY RUN -- nothing will be written. Re-run with --write to apply.\n")
    additions = json.loads(ADDITIONS.read_text())["additions"]
    catalog = json.loads(CATALOG.read_text())
    path_by_photo_id = {p["id"]: p["originalRelativePath"] for p in catalog["photos"]}

    by_photo: dict[str, set[str]] = {}
    for a in additions:
        by_photo.setdefault(a["photoId"], set()).add(a["displayName"])

    targets: list[tuple[Path, set[str]]] = []
    missing = []
    for photo_id, names in by_photo.items():
        rel = path_by_photo_id.get(photo_id)
        if rel is None:
            missing.append(photo_id)
            continue
        targets.append((MASTER / rel, names))
    if missing:
        raise SystemExit(f"{len(missing)} additions reference photos not in the catalog")

    print(f"{len(additions)} reviewed additions across {len(targets)} photos")
    current = read_current([p for p, _ in targets])

    changed = skipped = failed = 0
    for path, new_names in targets:
        rec = current.get(path)
        if rec is None:
            print(f"  MISSING FILE: {path}")
            failed += 1
            continue
        existing_people = list_value(rec, "PersonInImage")
        existing_keywords = list_value(rec, "Subject") + list_value(rec, "Keywords")
        people = unique(existing_people + list(new_names))
        keywords = unique(existing_keywords + list(new_names))
        if set(people) == set(existing_people) and set(keywords) == set(existing_keywords):
            skipped += 1
            continue
        ok, output = write_one(path, people, keywords, dry_run=dry_run)
        if ok:
            changed += 1
        else:
            failed += 1
            print(f"  FAILED {path}: {output}")

    verb = "would write" if dry_run else "wrote"
    print(f"\n{verb} {changed}, already current {skipped}, failed {failed} "
          f"(of {len(targets)} photos)")
    if dry_run and changed:
        print("Re-run with --write to apply.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

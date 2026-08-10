#!/usr/bin/env python3
"""Re-verify metadata-written JPEGs, then reconcile their manifest sizes.

Writing metadata legitimately grows a JPEG. The manifest's size_mismatch
check exists to catch tampering, and it cannot tell an intended metadata
write from corruption -- it just compares bytes to what was recorded. This
is the same reconciliation normalize-clean-master-metadata.py performs after
every write it makes: confirm ImageDataHash and dimensions are unchanged
(pixel data untouched), then record the new size so the manifest matches
reality again.

Fails closed: any file whose ImageDataHash or dimensions moved is reported
and the manifest is not written. Dry run is the default; --write creates a
timestamped backup and atomically replaces the manifest.
"""

from __future__ import annotations

import csv
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

MASTER = Path("/Users/zsoskin/Rachel & Zach - Wedding Master Clean")
MANIFEST = MASTER / "_Metadata" / "photo-manifest.csv"
BACKUP_DIR = MANIFEST.parent / "backups"


def chunks(values: list, size: int = 160):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def main() -> int:
    unknown = [arg for arg in sys.argv[1:] if arg != "--write"]
    if unknown:
        raise SystemExit(f"unknown argument(s): {' '.join(unknown)}")
    write = "--write" in sys.argv[1:]
    if not write:
        print("DRY RUN -- the manifest will not be written.\n")

    with MANIFEST.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    by_path = {row["output_path"]: row for row in rows}

    stale_paths = []
    invalid_rows = []
    for row in rows:
        rel = row.get("output_path", "")
        try:
            expected_size = int(row.get("output_file_size", ""))
            live_size = (MASTER / rel).stat().st_size
        except (OSError, TypeError, ValueError) as error:
            invalid_rows.append(f"{rel or '<blank path>'}: {error}")
            continue
        if live_size != expected_size:
            stale_paths.append(rel)
    if invalid_rows:
        raise SystemExit(
            f"{len(invalid_rows)} manifest row(s) could not be checked; "
            f"manifest NOT written, e.g. {invalid_rows[0]}"
        )

    stale_paths.sort()
    print(f"{len(rows)} manifest rows checked; {len(stale_paths)} size mismatch(es)")
    if not stale_paths:
        print("manifest sizes are already current")
        return 0

    live: dict[str, dict] = {}
    for batch in chunks(stale_paths):
        result = subprocess.run(
            ["exiftool", "-json", "-charset", "filename=UTF8",
             "-ImageDataHash", "-FileSize#", "-ImageWidth", "-ImageHeight",
             *(str(MASTER / p) for p in batch)],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "exiftool verify failed")
        for rec in json.loads(result.stdout):
            rel = str(Path(rec["SourceFile"]).relative_to(MASTER))
            live[rel] = rec

    changed = mismatched = 0
    for rel in stale_paths:
        row = by_path[rel]
        rec = live.get(rel)
        if rec is None:
            print(f"  MISSING FROM LIVE READ: {rel}")
            mismatched += 1
            continue
        problems = []
        if rec.get("ImageDataHash") != row["image_data_hash"]:
            problems.append("ImageDataHash changed")
        if int(rec.get("ImageWidth", -1)) != int(row["width"]) or int(
            rec.get("ImageHeight", -1)
        ) != int(row["height"]):
            problems.append("dimensions changed")
        if problems:
            print(f"  MISMATCH {rel}: {', '.join(problems)}")
            mismatched += 1
            continue
        live_size = str(rec["FileSize"])
        if row["output_file_size"] != live_size:
            row["output_file_size"] = live_size
            changed += 1

    if mismatched:
        raise SystemExit(
            f"{mismatched} files failed re-verification; manifest NOT written. "
            "Pixel identity or dimensions moved, which a metadata-only write "
            "should never cause -- investigate before re-running."
        )

    print(
        f"\nverified {len(stale_paths)} files "
        f"(ImageDataHash + dimensions unchanged); "
        f"{'will update' if write else 'would update'} {changed} manifest row(s)"
    )
    if not write:
        print("Re-run with --write to back up and atomically update the manifest.")
        return 0

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUP_DIR / f"photo-manifest.before-size-sync-{stamp}.csv"
    shutil.copy2(MANIFEST, backup)

    temporary = MANIFEST.with_name(f".{MANIFEST.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, MANIFEST)
        directory_fd = os.open(MANIFEST.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)

    print(f"backup: {backup}")
    print(f"updated output_file_size in {MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

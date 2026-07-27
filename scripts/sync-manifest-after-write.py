#!/usr/bin/env python3
"""Re-verify the files write-additions-to-master.py changed, then update
_Metadata/photo-manifest.csv's output_file_size for those rows.

Writing metadata legitimately grows a JPEG. The manifest's size_mismatch
check exists to catch tampering, and it cannot tell an intended metadata
write from corruption -- it just compares bytes to what was recorded. This
is the same reconciliation normalize-clean-master-metadata.py performs after
every write it makes: confirm ImageDataHash and dimensions are unchanged
(pixel data untouched), then record the new size so the manifest matches
reality again.

Fails closed: any file whose ImageDataHash or dimensions moved is reported
and left out of the manifest update rather than silently accepted.
"""

from __future__ import annotations

import csv
import json
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MASTER = Path("/Users/zsoskin/Rachel & Zach - Wedding Master Clean")
MANIFEST = MASTER / "_Metadata" / "photo-manifest.csv"
ADDITIONS = REPO / "metadata" / "reviewed-face-tag-additions.json"
CATALOG = REPO / "src" / "generated" / "gallery-v2.json"


def chunks(values: list, size: int = 160):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def main() -> int:
    additions = json.loads(ADDITIONS.read_text())["additions"]
    catalog = json.loads(CATALOG.read_text())
    path_by_id = {p["id"]: p["originalRelativePath"] for p in catalog["photos"]}
    touched_paths = sorted({path_by_id[a["photoId"]] for a in additions})
    print(f"{len(touched_paths)} photos touched by write-additions-to-master.py")

    with MANIFEST.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    by_path = {row["output_path"]: row for row in rows}

    missing = [p for p in touched_paths if p not in by_path]
    if missing:
        raise SystemExit(f"{len(missing)} touched paths are not manifest rows, e.g. {missing[0]}")

    live: dict[str, dict] = {}
    for batch in chunks(touched_paths):
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

    updated = mismatched = 0
    for rel in touched_paths:
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
        row["output_file_size"] = str(rec["FileSize"])
        updated += 1

    if mismatched:
        raise SystemExit(
            f"{mismatched} files failed re-verification; manifest NOT written. "
            "Pixel identity or dimensions moved, which write-additions-to-master.py "
            "should never cause -- investigate before re-running."
        )

    with MANIFEST.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nverified {updated} files (ImageDataHash + dimensions unchanged), "
          f"updated output_file_size in {MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

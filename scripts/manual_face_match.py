"""Import-safe wrapper for the existing hyphenated face-match helper."""

from pathlib import Path


_source_path = Path(__file__).with_name("find-manual-person-matches.py")
exec(compile(_source_path.read_text(encoding="utf-8"), str(_source_path), "exec"), globals())

# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "torch==2.13.0",
#   "transformers==5.14.1",
#   "pillow==12.3.0",
# ]
# ///
"""Moment Search image-embedding batch job (packet 07).

Embeds APPROVED display derivatives (never originals, never HEIC -- preview
formats are always avif/webp/jpeg per src/types/gallery.ts's PreviewFormat)
with the pinned CLIP image encoder and upserts them into
public.rachandzach_photo_embeddings, keyed by photo id + model version.

AVIF note: task 02's derivative pipeline (tests/import/derivative-policy.test.mjs)
emits AVIF as its smallest preview width, which _fetch_approved_photos_with_previews
below will often select. This was a real open question -- older Pillow builds
need a separate plugin for AVIF -- so it was verified directly rather than
assumed: the pinned pillow==12.3.0 wheel bundles native AVIF decode (its
PIL.features.check("avif") reports True, and a real sharp-encoded AVIF file
was decoded and embedded successfully through this exact pinned environment
during this packet's build). No extra dependency needed.

Pinned per docs/plans/2026-07-22-0719-digital-wedding-home/spikes/clip-model.md
and .../spikes/embeddings-env.md (transformers v5 API note: both
get_text_features and get_image_features return a BaseModelOutputWithPooling;
the projected 512-dim embedding is `.pooler_output`, not the return value
itself):

    MODEL_ID       = "openai/clip-vit-base-patch32"
    MODEL_REVISION = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"

Run with uv so the pinned dependency versions above (identical to the
pre-warmed .venv-search built for this packet) are used automatically -- no
`uv init`, no manual venv activation:

    uv run --python 3.12 scripts/build-embeddings.py --fixture tests/fixtures/search --verify

Two independent things --verify and --fixture each gate:

  --verify   Runs the 5-string cross-language parity check (this packet's
             hard gate on ANY ingestion): embeds the fixed PARITY_STRINGS
             with this Python CLIP text encoder and compares them, by cosine
             similarity, against tests/fixtures/search/js-parity-vectors.json
             (the same 5 strings, embedded by the pinned JS/Xenova text
             encoder -- see tests/fixtures/search/generate-js-parity-vectors.mjs
             and src/lib/search/query-embedding.ts). Requires cosine > 0.999
             per string. If this fails, something about the model, revision,
             tokenizer, or normalization has drifted between the two runtimes
             and no embedding should be trusted until it is fixed.

  --fixture  Points at a local fixture directory (tests/fixtures/search) and
             switches the image-embedding step to an OFFLINE DRY RUN: it
             embeds the fixture's synthetic images, checks dimension (512)
             and L2-normalization, and prints a summary. It never touches a
             database, network storage, or any cloud resource, and it never
             reads or logs a person's name -- only fixture photo ids, counts,
             and dimensions.

Without --fixture, the job runs the LIVE path against Supabase: fetches
approved photos with previews, downloads preview bytes, embeds them in
batches with checkpointing (skips photo ids already embedded at the current
model version so an interrupted run resumes cleanly), and upserts rows via
the PostgREST REST API using httpx (already a transformers/huggingface_hub
dependency in the pinned environment; no extra package needed). It fails
closed -- loudly, before any network call -- when SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY are not both set. This path requires explicit
approval per the plan's hard gates (no cloud resources without approval) and
is not exercised by the packet's done-check.

Never logs a query string or a person's name. Only ids, counts, dimensions,
norms, cosines, and timings are ever printed, and only to stderr.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Iterable

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL_ID = "openai/clip-vit-base-patch32"
MODEL_REVISION = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"
EMBEDDING_DIMENSIONS = 512
MIN_PARITY_COSINE = 0.999
NORMALIZATION_TOLERANCE = 1e-3
DEFAULT_BATCH_SIZE = 16

# Must stay byte-identical to PARITY_STRINGS in
# tests/fixtures/search/generate-js-parity-vectors.mjs and to the parity
# check recorded in spikes/clip-model.md.
PARITY_STRINGS = [
    "bride and groom first dance",
    "sunset over the ocean",
    "a golden retriever",
    "people laughing at a dinner table",
    "fireworks at night",
]

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PARITY_FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "search"


def _log(message: str) -> None:
    """The only place this script prints. Never pass a query string or a
    person's name here -- ids, counts, dimensions, and timings only."""
    print(message, file=sys.stderr)


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


def load_model() -> tuple[CLIPModel, CLIPProcessor, str]:
    model = CLIPModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    processor = CLIPProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = model.to(device).eval()
    return model, processor, device


def _pooler_output(output: Any) -> torch.Tensor:
    """transformers v5's get_text_features/get_image_features return a
    BaseModelOutputWithPooling; the projected 512-dim embedding is
    `.pooler_output` (see embeddings-env.md). Fall back to the raw value for
    any older/newer transformers that returns the tensor directly, so this
    script degrades loudly (a dimension check) rather than silently."""
    return output.pooler_output if hasattr(output, "pooler_output") else output


@torch.no_grad()
def embed_images(
    model: CLIPModel,
    processor: CLIPProcessor,
    device: str,
    paths: list[Path],
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> torch.Tensor:
    """Batch-embeds images, L2-normalized. Returns an (N, 512) tensor."""
    if not paths:
        return torch.empty((0, EMBEDDING_DIMENSIONS))
    chunks: list[torch.Tensor] = []
    for start in range(0, len(paths), batch_size):
        batch_paths = paths[start : start + batch_size]
        images = [Image.open(path).convert("RGB") for path in batch_paths]
        inputs = processor(images=images, return_tensors="pt").to(device)
        feats = _pooler_output(model.get_image_features(**inputs))
        feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
        chunks.append(feats.float().cpu())
    return torch.cat(chunks)


@torch.no_grad()
def embed_texts(
    model: CLIPModel,
    processor: CLIPProcessor,
    device: str,
    texts: list[str],
) -> torch.Tensor:
    """Batch-embeds strings, L2-normalized. Returns an (N, 512) tensor. Used
    only by the parity check -- runtime query embedding happens in JS
    (src/lib/search/query-embedding.ts), never here."""
    inputs = processor(text=texts, return_tensors="pt", padding=True).to(device)
    feats = _pooler_output(model.get_text_features(**inputs))
    feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
    return feats.float().cpu()


# ---------------------------------------------------------------------------
# --verify: 5-string cross-language parity check
# ---------------------------------------------------------------------------


def run_parity_check(
    model: CLIPModel,
    processor: CLIPProcessor,
    device: str,
    fixture_dir: Path,
) -> bool:
    js_path = fixture_dir / "js-parity-vectors.json"
    if not js_path.exists():
        _log(
            f"PARITY: missing {js_path}. Generate it with "
            "`node tests/fixtures/search/generate-js-parity-vectors.mjs` first."
        )
        return False

    js_data = json.loads(js_path.read_text())
    js_strings = js_data.get("strings")
    js_vectors = js_data.get("vectors")
    if js_strings != PARITY_STRINGS:
        _log(
            "PARITY: js-parity-vectors.json strings do not match this script's "
            "PARITY_STRINGS. Regenerate the fixture after any change to either list."
        )
        return False
    if not isinstance(js_vectors, list) or len(js_vectors) != len(PARITY_STRINGS):
        _log("PARITY: js-parity-vectors.json is missing vectors for one or more strings.")
        return False

    py_vectors = embed_texts(model, processor, device, PARITY_STRINGS).tolist()

    ok = True
    for index, (py_vector, js_vector, text) in enumerate(
        zip(py_vectors, js_vectors, PARITY_STRINGS)
    ):
        if len(py_vector) != EMBEDDING_DIMENSIONS or len(js_vector) != EMBEDDING_DIMENSIONS:
            _log(
                f"PARITY[{index}] \"{text[:12]}...\": dimension mismatch "
                f"(python={len(py_vector)}, js={len(js_vector)})"
            )
            ok = False
            continue
        cosine = sum(a * b for a, b in zip(py_vector, js_vector))
        passed = cosine > MIN_PARITY_COSINE
        ok = ok and passed
        _log(
            f"PARITY[{index}] cosine={cosine:.6f} "
            f"({'OK' if passed else f'FAIL, need > {MIN_PARITY_COSINE}'})"
        )

    if ok:
        _log(f"PARITY: all {len(PARITY_STRINGS)} strings passed (cosine > {MIN_PARITY_COSINE}).")
    else:
        _log(
            "PARITY CHECK FAILED. Ingestion must not proceed: something about the "
            "model, revision, tokenizer, or normalization has drifted between the "
            "Python and JS runtimes."
        )
    return ok


# ---------------------------------------------------------------------------
# --fixture: offline dry run over local synthetic images
# ---------------------------------------------------------------------------


def run_fixture_dry_run(
    model: CLIPModel,
    processor: CLIPProcessor,
    device: str,
    fixture_dir: Path,
    batch_size: int,
) -> bool:
    manifest_path = fixture_dir / "manifest.json"
    if not manifest_path.exists():
        _log(f"FIXTURE: missing manifest at {manifest_path}")
        return False

    manifest = json.loads(manifest_path.read_text())
    entries = manifest.get("photos", [])
    if not entries:
        _log("FIXTURE: manifest has no photo entries.")
        return False

    photo_ids: list[str] = []
    image_paths: list[Path] = []
    for entry in entries:
        photo_id = entry.get("photoId")
        rel_path = entry.get("path")
        if not photo_id or not rel_path:
            _log(f"FIXTURE: malformed manifest entry: {entry!r}")
            return False
        image_path = (fixture_dir / rel_path).resolve()
        if not image_path.exists():
            _log(f"FIXTURE[{photo_id}]: missing image at {image_path}")
            return False
        photo_ids.append(photo_id)
        image_paths.append(image_path)

    _log(
        f"FIXTURE: embedding {len(image_paths)} synthetic image(s) offline "
        "(no database, no network storage, no person names)."
    )
    vectors = embed_images(model, processor, device, image_paths, batch_size)

    ok = True
    for photo_id, vector in zip(photo_ids, vectors.tolist()):
        dim = len(vector)
        norm = math.sqrt(sum(x * x for x in vector))
        dim_ok = dim == EMBEDDING_DIMENSIONS
        norm_ok = abs(norm - 1.0) <= NORMALIZATION_TOLERANCE
        ok = ok and dim_ok and norm_ok
        status = "OK" if (dim_ok and norm_ok) else "FAIL"
        _log(f"FIXTURE[{photo_id}] dim={dim} norm={norm:.6f} [{status}]")

    if ok:
        _log(f"FIXTURE: {len(photo_ids)} image(s) embedded at {EMBEDDING_DIMENSIONS} dims, L2-normalized.")
    return ok


# ---------------------------------------------------------------------------
# Live path: Supabase ingestion (not exercised by the packet's done-check;
# requires explicit deploy/cloud-resource approval per the plan's hard gates)
# ---------------------------------------------------------------------------


def _load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"model_version": MODEL_REVISION, "done": []}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {"model_version": MODEL_REVISION, "done": []}
    if data.get("model_version") != MODEL_REVISION:
        # A pinned-revision change invalidates the checkpoint: re-embed everything.
        return {"model_version": MODEL_REVISION, "done": []}
    if not isinstance(data.get("done"), list):
        data["done"] = []
    return data


def _save_checkpoint(path: Path, done_ids: Iterable[str]) -> None:
    payload = {"model_version": MODEL_REVISION, "done": sorted(set(done_ids))}
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _fetch_approved_photos_with_previews(client: Any) -> list[dict[str, Any]]:
    """One row per photo: {photo_id, previews: [{bucket, object_path, width}]}.
    Smallest-width preview per photo is used for embedding (fastest download,
    plenty of signal for CLIP's 224x224 input); previews are ordered by width
    server-side via a PostgREST `order` param.

    Paginated via Range headers: PostgREST caps un-ranged responses at 1,000
    rows, which silently truncated the 1,721-photo catalog on the first live
    run (found 2026-07-23: exactly 1,000 embeddings landed). Pages of 500
    until a short page signals the end."""
    page_size = 500
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = client.get(
            "/rest/v1/rachandzach_photos",
            params={
                "select": (
                    "id,status,"
                    "previews:rachandzach_photo_previews(bucket,object_path,width)"
                ),
                "status": "eq.published",
                "order": "id.asc",
            },
            headers={"Range": f"{offset}-{offset + page_size - 1}"},
        )
        response.raise_for_status()
        page = response.json()
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    photos: list[dict[str, Any]] = []
    for row in rows:
        previews = sorted(row.get("previews") or [], key=lambda p: p["width"])
        if not previews:
            continue
        photos.append({"photo_id": row["id"], "preview": previews[0]})
    return photos


def _download_preview(client: Any, supabase_url: str, preview: dict[str, Any]) -> bytes:
    bucket = preview["bucket"]
    object_path = preview["object_path"]
    response = client.get(f"/storage/v1/object/{bucket}/{object_path}")
    response.raise_for_status()
    return response.content


def _upsert_embeddings(
    client: Any,
    rows: list[dict[str, Any]],
) -> None:
    if not rows:
        return
    response = client.post(
        "/rest/v1/rachandzach_photo_embeddings",
        params={"on_conflict": "photo_id"},
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
    )
    response.raise_for_status()


def run_live(
    model: CLIPModel,
    processor: CLIPProcessor,
    device: str,
    batch_size: int,
    checkpoint_path: Path,
) -> bool:
    import os
    import tempfile

    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        _log(
            "LIVE MODE: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set. "
            "This is the real-ingestion path (writes to public.rachandzach_photo_embeddings) "
            "and fails closed rather than silently skipping or using a fallback. Pass "
            "--fixture tests/fixtures/search for the offline dry run instead, or set "
            "both variables (and get deploy/cloud-resource approval per the plan) to run "
            "for real."
        )
        return False

    import httpx

    checkpoint = _load_checkpoint(checkpoint_path)
    done_ids: set[str] = set(checkpoint.get("done", []))

    with httpx.Client(
        base_url=supabase_url,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
        timeout=60.0,
    ) as client:
        photos = _fetch_approved_photos_with_previews(client)
        pending = [p for p in photos if p["photo_id"] not in done_ids]
        _log(
            f"LIVE MODE: {len(photos)} approved photo(s) with a preview, "
            f"{len(pending)} pending at model_version={MODEL_REVISION[:12]}."
        )

        newly_done: list[str] = []
        with tempfile.TemporaryDirectory(prefix="rz-embed-") as tmp_dir:
            tmp_path = Path(tmp_dir)
            for start in range(0, len(pending), batch_size):
                batch = pending[start : start + batch_size]
                local_paths: list[Path] = []
                for item in batch:
                    content = _download_preview(client, supabase_url, item["preview"])
                    local_path = tmp_path / f"{item['photo_id']}.bin"
                    local_path.write_bytes(content)
                    local_paths.append(local_path)

                vectors = embed_images(model, processor, device, local_paths, batch_size)
                rows = [
                    {
                        "photo_id": item["photo_id"],
                        "model": MODEL_ID,
                        "model_version": MODEL_REVISION,
                        "embedding": vector,
                    }
                    for item, vector in zip(batch, vectors.tolist())
                ]
                _upsert_embeddings(client, rows)
                newly_done.extend(item["photo_id"] for item in batch)
                done_ids.update(newly_done)
                _save_checkpoint(checkpoint_path, done_ids)
                _log(f"LIVE MODE: checkpointed {len(done_ids)}/{len(photos)} photo(s).")

    _log(f"LIVE MODE: embedded {len(newly_done)} photo(s) this run.")
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Moment Search image-embedding batch job (packet 07)."
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        default=None,
        help=(
            "Run an offline dry run against this local fixture directory "
            "(e.g. tests/fixtures/search) instead of Supabase. No database, "
            "no network storage, no cloud resource is touched."
        ),
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help=(
            "Run the 5-string cross-language (Python/JS) parity check before "
            "anything else. Required before any real ingestion."
        ),
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=REPO_ROOT / ".embeddings-checkpoint.json",
        help="Live-mode only: resume file tracking already-embedded photo ids.",
    )
    args = parser.parse_args(argv)

    _log(f"model: {MODEL_ID}@{MODEL_REVISION[:12]}")
    t0 = time.time()
    model, processor, device = load_model()
    _log(f"model loaded in {time.time() - t0:.1f}s on device={device}")

    ok = True

    if args.verify:
        parity_fixture_dir = args.fixture or DEFAULT_PARITY_FIXTURE_DIR
        ok = run_parity_check(model, processor, device, parity_fixture_dir) and ok

    if args.fixture:
        ok = run_fixture_dry_run(model, processor, device, args.fixture, args.batch_size) and ok
    else:
        ok = run_live(model, processor, device, args.batch_size, args.checkpoint) and ok

    if ok:
        _log("OK: build-embeddings completed successfully.")
        return 0
    _log("FAILED: see messages above.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

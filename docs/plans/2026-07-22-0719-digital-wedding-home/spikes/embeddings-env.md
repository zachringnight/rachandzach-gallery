# Spike: Moment Search Python environment (pre-warmed for packet 07)

Date: 2026-07-22
Status: READY. Venv built, model cached, smoke test passed. Packet 07 can start hot.

## Decision

Use the pre-built venv at `/Users/zsoskin/Downloads/rachandzach-gallery/.venv-search` (uv-managed CPython 3.12.13) with torch 2.13.0, transformers 5.14.1, pillow 12.3.0. The pinned model revision is already in the default HF cache with its sha256 verified. One API adjustment vs the clip-model.md sample code: transformers v5 returns an output object from `get_text_features` / `get_image_features`, so read the projected 512-dim vector from `.pooler_output` (details below).

## The one command packet 07 should use

```bash
uv run --no-project --python /Users/zsoskin/Downloads/rachandzach-gallery/.venv-search/bin/python python <script.py>
```

Verified working from the repo root:

```
$ uv run --no-project --python /Users/zsoskin/Downloads/rachandzach-gallery/.venv-search/bin/python python -c "import sys, torch, transformers, PIL; print(...)"
py 3.12.13 | torch 2.13.0 | transformers 5.14.1 | pillow 12.3.0 | exe /Users/zsoskin/Downloads/rachandzach-gallery/.venv-search/bin/python
```

Notes on the command:

- `--python <venv>/bin/python` makes uv use this exact environment; the trailing `python` is the command to run inside it (uv's `-c` would otherwise be parsed by uv itself).
- `--no-project` is required. The repo has no pyproject.toml today, but without the flag uv walks up looking for one and could latch onto something unrelated. There is no `uv run --project semantics` setup; this venv is the environment.
- Direct interpreter invocation is equivalent and also fine: `/Users/zsoskin/Downloads/rachandzach-gallery/.venv-search/bin/python <script.py>`.

## Environment

- Venv path: `/Users/zsoskin/Downloads/rachandzach-gallery/.venv-search`
- Interpreter: CPython 3.12.13, uv-managed (`cpython-3.12.13-macos-aarch64-none`), installed via `uv python install 3.12`
- Created with: `uv venv --python 3.12 /Users/zsoskin/Downloads/rachandzach-gallery/.venv-search`
- torch 2.13.0 is the standard PyPI macOS arm64 wheel: CPU + MPS, no CUDA. This is the CPU build for this platform.

## Exact pins (packet 07: copy these into scripts/requirements-search.txt)

Direct dependencies, the only lines requirements-search.txt needs:

```
torch==2.13.0
transformers==5.14.1
pillow==12.3.0
```

Full `uv pip freeze` of the venv for reproducibility (transitive pins included):

```
annotated-doc==0.0.4
anyio==4.14.2
certifi==2026.7.22
click==8.4.2
filelock==3.32.0
fsspec==2026.6.0
h11==0.16.0
hf-xet==1.5.2
httpcore==1.0.9
httpx==0.28.1
huggingface-hub==1.24.0
idna==3.18
jinja2==3.1.6
markdown-it-py==4.2.0
markupsafe==3.0.3
mdurl==0.1.2
mpmath==1.3.0
networkx==3.6.1
numpy==2.5.1
packaging==26.2
pillow==12.3.0
pygments==2.20.0
pyyaml==6.0.3
regex==2026.7.19
rich==15.0.0
safetensors==0.8.0
setuptools==83.0.0
shellingham==1.5.4
sympy==1.14.0
tokenizers==0.22.2
torch==2.13.0
tqdm==4.69.0
transformers==5.14.1
typer==0.27.0
typing-extensions==4.16.0
```

## Model cache

- Location: `/Users/zsoskin/.cache/huggingface/hub/models--openai--clip-vit-base-patch32` (default HF cache, ~1.1 GB)
- Pinned snapshot present: `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268` containing config.json, preprocessor_config.json, tokenizer files (vocab.json, merges.txt, tokenizer.json, tokenizer_config.json, special_tokens_map.json), and pytorch_model.bin
- Checksum verified against the clip-model.md pin:
  `shasum -a 256 pytorch_model.bin` = `a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f` (exact match)
- Second snapshot in cache: `c237dc49a33fc61debc9276459120b7eac67e7ef` containing `model.safetensors`. This is expected: the pinned revision has no safetensors, so transformers v5's from_pretrained fetches the Hub conversion-bot's safetensors export and loads that by default. Verified bit-identical to the pinned .bin: every state_dict tensor is `torch.equal` and the smoke cosine is identical to 6 decimals whether loaded via safetensors (default) or `use_safetensors=False` (forces the pinned .bin). Either load path is safe; no code change needed.

## transformers v5 API note (differs from the sample code in clip-model.md)

clip-model.md's Python sample was written against the v4 API where `get_text_features` / `get_image_features` return a tensor. In transformers 5.14.1 both return a `BaseModelOutputWithPooling`; the projected 512-dim embedding is in `.pooler_output` (the projection IS applied, confirmed by reading `CLIPModel.get_text_features` source: it sets `text_outputs.pooler_output = self.text_projection(pooled_output)`).

Packet 07 must write:

```python
t = model.get_text_features(**inputs).pooler_output   # (B, 512), unnormalized
v = model.get_image_features(**inputs).pooler_output  # (B, 512), unnormalized
```

Everything else in clip-model.md (revision pin, L2 normalization, MPS device selection, batch loop) carries over unchanged. Same weights, same embedding space; the JS parity plan is unaffected.

## Smoke test (real output)

Script: load pinned model + processor, embed the text "sunset kiss" and the image `tests/fixtures/shared/synthetic-1-phone.jpg`, L2-normalize both, print dims and cosine. Run on CPU.

```
text dim:  (1, 512)  norm=1.000000
image dim: (1, 512)  norm=1.000000
cosine(text='sunset kiss', image=synthetic-1-phone.jpg) = 0.215737
OK: both vectors are 512-dim and L2-normalized
```

Both vectors are 512-dim as required. The low cosine is expected: the fixture is a synthetic test pattern, not a sunset photo. The bin-vs-safetensors comparison run reproduced the same value from both load paths:

```
pinned .bin: dims (1, 512) (1, 512), cosine = 0.215737
default (auto-safetensors): dims (1, 512) (1, 512), cosine = 0.215737
state_dicts bit-identical: True
```

## Constants for packet 07

```python
MODEL_ID = "openai/clip-vit-base-patch32"
REV = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"
```

First `from_pretrained(MODEL_ID, revision=REV)` call now hits the warm cache; no network needed unless the cache is cleared. Unauthenticated HF requests emit a rate-limit warning on cache-miss downloads only; harmless for this one-model workload.

## JS text encoder

Verified 2026-07-22 by `scripts/prewarm-clip-text.mjs` (cold + warm runs on this Mac, Node v26.3.0).

- Package: `@huggingface/transformers` 4.2.0 (already in `node_modules`)
- Model: `Xenova/clip-vit-base-patch32`
- Revision (pinned): `d15189d7028b43f1d3e65039190477f6af591c2a`
- dtype: `fp32`
- Output dims: **512**, unnormalized from the model; L2-normalize in app code (required, mirrors the Python side above)
- Cache path (default `env.cacheDir`): `node_modules/@huggingface/transformers/.cache/`
  - Model files land at `node_modules/@huggingface/transformers/.cache/Xenova/clip-vit-base-patch32/d15189d7028b43f1d3e65039190477f6af591c2a/`
  - Downloaded: `onnx/text_model.onnx` 254,058,553 bytes (sha256 `3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc`, matches the pin), plus `config.json`, `tokenizer.json`, `tokenizer_config.json`; ~258 MB cache total
- Load time cold (first run, includes 254 MB HF Hub download): **149,747 ms** (~2.5 min on this connection)
- Load time warm (cache hit): **493 ms**
- Inference: 2 short strings embedded in 11-18 ms warm
- Sanity output: `cosine("sunset kiss", "people dancing") = 0.650623`

### Exact import/config packet 07 should reuse

```js
import { AutoTokenizer, CLIPTextModelWithProjection } from "@huggingface/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
const REV = "d15189d7028b43f1d3e65039190477f6af591c2a";

// Module scope: loaded once per warm instance, reused across invocations.
const tokenizerP = AutoTokenizer.from_pretrained(MODEL_ID, { revision: REV });
const textModelP = CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
  revision: REV,
  dtype: "fp32",
});

export async function embedText(query) {
  const [tokenizer, textModel] = await Promise.all([tokenizerP, textModelP]);
  const inputs = tokenizer([query], { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs); // Tensor [1, 512], unnormalized
  const v = text_embeds.tolist()[0];
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm); // L2 normalize, REQUIRED (must mirror Python)
}
```

Notes for packet 07:

- Local dev on this machine now hits the warm cache (sub-second load). On Vercel, the same code downloads from the HF Hub at cold start unless the model is bundled; see the deployment options above (option a: hub download at cold start; option b: large functions + `env.localModelPath`).
- Do not change dtype without rerunning the parity check against the Python side.
- Rerun the prewarm anytime with `node scripts/prewarm-clip-text.mjs`; it exits nonzero if dims are not 512.
- The text encoder runs in a Vercel Node route (`src/app/api/search/route.ts` via `src/lib/search/query-embedding.ts`), not a Supabase Edge Function, per the platform spike.

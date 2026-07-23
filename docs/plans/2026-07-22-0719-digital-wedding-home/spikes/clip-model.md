# Spike: pinned CLIP model for cross-language (Python + JS) 512-dim embeddings

Date researched: 2026-07-22 (live sources, verified same day)
Status: DECIDED

## Recommendation (act on this)

Pin **openai/clip-vit-base-patch32** as the embedding space, using two repos that carry the same weights:

| Side | Repo | Pinned revision (commit) | Runtime |
|---|---|---|---|
| Python image batch (local Mac) | `openai/clip-vit-base-patch32` | `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268` | transformers + torch, uv-managed **Python 3.12** venv |
| JS text query (serverless) | `Xenova/clip-vit-base-patch32` (ONNX export of the same checkpoint) | `d15189d7028b43f1d3e65039190477f6af591c2a` | `@huggingface/transformers` v4 (latest is 4.2.0), `dtype: 'fp32'` |

- Vector dim: **512** (confirmed: `projection_dim: 512` in the model config; text hidden 512, vision hidden 768, both project to shared 512-dim space).
- **L2-normalize on both sides** before storing/querying. Store in pgvector as `vector(512)` with cosine ops (or inner product, identical ranking once normalized).
- Run the text-query encoder in a **Vercel Node function, not a Supabase Edge Function**. Supabase Edge Functions cap at 256 MB memory and 2s CPU per request, which makes even the 64 MB quantized text encoder marginal and the fp32 one impossible. Vercel Node gives 2 GB memory (Hobby) and a 250 MB uncompressed bundle (5 GB with large functions), which fits fp32 comfortably.
- License: MIT (OpenAI CLIP repo, copyright 2021 OpenAI). Production-safe. Caveat below.
- Build plan MUST include a one-time parity check (script below): embed 5 fixed strings on both sides, require cosine similarity > 0.999 between Python and JS vectors before any real ingestion.

## Why this choice

1. **Same weights, same space.** The Xenova repo's model card states it is `openai/clip-vit-base-patch32` "with ONNX weights to be compatible with Transformers.js" and lists `base_model: openai/clip-vit-base-patch32`. It is a direct Optimum ONNX export of the original checkpoint, plus the exact same tokenizer files (CLIP BPE vocab.json + merges.txt). Neither side applies normalization inside the model; `get_text_features` / `text_embeds` and `get_image_features` return unnormalized projected vectors on both sides, so the normalization step is yours and is symmetric.
2. **Image preprocessing never crosses the language boundary.** Images are only embedded in Python, text only in JS, so the only compatibility requirement is the shared projection space, which follows from shared weights. The main residual risks are (a) quantization drift on the JS side, handled by pinning `dtype: 'fp32'`, and (b) tokenizer mismatch, handled by the parity check.
3. **Quantization drift is real, so avoid it by default.** There are documented numerical differences between quantized transformers.js output and Python output (transformers.js issue #36 and the general quantization docs). q8 text embeddings typically stay >0.99 cosine to fp32 and rank fine for retrieval, but since Vercel removes the size pressure, use fp32 and make the spaces bit-for-bit comparable (within float noise). If you must shrink: `dtype: 'fp16'` (127 MB, negligible drift, but slower on CPU because ORT upconverts) or `dtype: 'q8'` (64 MB, small drift, fastest on CPU). If q8 is used, rerun the parity check and accept a lower bar (> 0.99).
4. **License is workable.** The OpenAI CLIP GitHub repo is MIT (copyright 2021 OpenAI) and the HF model card is taken from that repo. Note: the HF repo itself carries **no license tag** in its metadata. For a private personal wedding gallery this is a non-issue; the model is used commercially everywhere. If an explicitly license-tagged alternative is ever required, `laion/CLIP-ViT-B-32-laion2B-s34B-b79K` is MIT-tagged and also 512-dim, but it has no maintained transformers.js ONNX port, so it would break the JS side. Stay with openai/Xenova.

## Exact pins and checksums (record these in the repo)

openai/clip-vit-base-patch32 @ `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268` (lastModified 2024-02-29; repo has NO safetensors, only pytorch_model.bin / tf / flax):

- `pytorch_model.bin` 605,247,071 bytes, sha256 `a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f`
- `config.json` 4,186 bytes (contains `projection_dim: 512`)

Xenova/clip-vit-base-patch32 @ `d15189d7028b43f1d3e65039190477f6af591c2a` (lastModified 2025-07-08), text-encoder ONNX files (the JS side downloads only the text model when you use `CLIPTextModelWithProjection`):

- `onnx/text_model.onnx` (fp32, the default at `dtype: 'fp32'`) 254,058,553 bytes, sha256 `3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc`
- `onnx/text_model_fp16.onnx` 127,339,794 bytes, sha256 `df587ffbf248bf20d44fa6e16adc5ebc27ead691860e5333dbdaab5fd6bf3f6e`
- `onnx/text_model_quantized.onnx` (q8) 64,504,507 bytes, sha256 `73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a`

Checksum verification: after first download, run `shasum -a 256 <file>` against the values above (they are the HF LFS oids, which are sha256 of the blob). In Python, `huggingface_hub.hf_hub_download(..., revision=REV)` already verifies LFS checksums; pinning the revision hash is the primary integrity control on both sides because a commit hash immutably identifies the exact file set.

## Python side: batch image embeddings (local Mac)

Environment: **pin Python 3.12 via uv.** Rationale: torch 2.13.0 (latest, 2026-07-08) officially supports 3.10-3.14, and PyTorch has had stable 3.14 support since 2.10 (Jan 2026), BUT huggingface/transformers has an open Python 3.14 import bug (issue #44938, transformers v5.3.0, "Backend should be defined in BACKENDS_MAPPING" requiring tensorflow). 3.12 is the zero-friction lane; do not burn build time on 3.14. open_clip is NOT needed; plain transformers `CLIPModel` is the reference implementation.

```bash
uv init --python 3.12
uv add torch transformers pillow  # then freeze exact versions in the lockfile
```

```python
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL_ID = "openai/clip-vit-base-patch32"
REV = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"

model = CLIPModel.from_pretrained(MODEL_ID, revision=REV)
processor = CLIPProcessor.from_pretrained(MODEL_ID, revision=REV)
device = "mps" if torch.backends.mps.is_available() else "cpu"
model = model.to(device).eval()

@torch.no_grad()
def embed_images(paths: list[str], batch_size: int = 32) -> torch.Tensor:
    chunks = []
    for i in range(0, len(paths), batch_size):
        imgs = [Image.open(p).convert("RGB") for p in paths[i : i + batch_size]]
        inputs = processor(images=imgs, return_tensors="pt").to(device)
        feats = model.get_image_features(**inputs)          # (B, 512)
        feats = feats / feats.norm(p=2, dim=-1, keepdim=True)  # L2 normalize, REQUIRED
        chunks.append(feats.float().cpu())
    return torch.cat(chunks)  # (N, 512), ready for pgvector
```

Keep the model in fp32 (default) for determinism; MPS fp32 is fine for ViT-B/32.

## JS side: text-query embeddings (Vercel Node function)

Package: `@huggingface/transformers` (v4 line; 4.2.0 is current; depends on onnxruntime-node 1.24.3 for the Node backend). v4 kept the v3 model API (`AutoTokenizer`, `CLIPTextModelWithProjection`, `from_pretrained` with `dtype`/`revision` options); the headline v4 change was the new WebGPU runtime, irrelevant here since we run CPU in a serverless function.

```js
import { AutoTokenizer, CLIPTextModelWithProjection } from "@huggingface/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
const REV = "d15189d7028b43f1d3e65039190477f6af591c2a";

// Module scope: loaded once per warm instance, reused across invocations.
const tokenizerP = AutoTokenizer.from_pretrained(MODEL_ID, { revision: REV });
const textModelP = CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
  revision: REV,
  dtype: "fp32", // exact space match with Python. "q8" (64 MB) only if size-forced.
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

Deployment notes for the build agent:

- Vercel Node runtime limits (verified 2026-07): memory 2 GB Hobby / up to 4 GB Pro, uncompressed bundle 250 MB (large functions up to 5 GB, on by default for new projects via fluid compute), max duration 300s default. fp32 text model (254 MB) slightly exceeds the standard 250 MB bundle if you try to ship it inside the function, so either (a) let transformers.js download from the HF Hub at cold start (public repo, no token, cached in the instance for warm calls), or (b) enable large functions and bundle `onnx/text_model.onnx` + tokenizer files locally with `env.localModelPath` for zero-network cold starts. Option (a) is simpler; the pinned revision keeps it deterministic.
- Set `maxDuration` generously (e.g. 60s) so a cold start can never 504.
- Do NOT use the Vercel Edge runtime for this; use the Node runtime (onnxruntime-node native binary).

### Why not a Supabase Edge Function

Verified limits: 256 MB memory, 2s CPU time per request, 20 MB function bundle. Supabase's own AI guidance for Edge Functions points to the built-in `Supabase.ai.Session('gte-small')` (text-only, not CLIP, wrong embedding space) and to external inference servers for anything bigger. Loading even the 64 MB q8 CLIP text encoder plus ORT session init inside 256 MB / 2s CPU is a cold-start gamble. Since the app already runs on Vercel, put `/api/search-embed` there. If a Supabase-side implementation is ever forced, use `dtype: 'q8'`, expect multi-second cold starts, and rerun the parity check at the > 0.99 bar.

## Parity check (must run once before real ingestion)

Python:

```python
texts = ["bride and groom first dance", "sunset over the ocean", "a golden retriever",
         "people laughing at a dinner table", "fireworks at night"]
inputs = processor(text=texts, return_tensors="pt", padding=True).to(device)
t = model.get_text_features(**inputs)
t = (t / t.norm(dim=-1, keepdim=True)).cpu().tolist()  # save as JSON
```

JS: embed the same 5 strings with `embedText`, compute cosine against the Python vectors. Pass criteria: all 5 cosines > 0.999 with fp32 (expect > 0.9999), > 0.99 if q8 was chosen. If this fails, stop and diagnose tokenizer/version drift before embedding any photos.

## Size and latency expectations

- Python batch (Mac, MPS, ViT-B/32, batch 32): roughly 50-200 images/sec on Apple Silicon GPU, ~10-30/sec CPU-only. A few thousand wedding photos embeds in minutes either way. One-time model download ~605 MB.
- Vercel warm request: tokenizer + fp32 text encoder inference for a short query on 1 vCPU, roughly 30-150 ms.
- Vercel cold start: instance boot + 254 MB model fetch from HF (fast inside AWS, ~2-6s) + ORT session init (~1-2s). Budget ~5-10s worst case fp32; ~2-4s with q8. Fluid compute warm instances make this rare; an optional warming ping (cron hitting the endpoint) eliminates it.
- pgvector: `vector(512)`, `vector_cosine_ops` index (HNSW). With both sides normalized, cosine and inner product give identical rankings.

## Sources (verified 2026-07-22)

- Model card + files, openai/clip-vit-base-patch32: https://huggingface.co/openai/clip-vit-base-patch32 and https://huggingface.co/api/models/openai/clip-vit-base-patch32 (revision `3d74acf...`, pytorch_model.bin sha256, no safetensors)
- projection_dim 512: https://huggingface.co/openai/clip-vit-base-patch32/raw/main/config.json
- ONNX port + base_model statement: https://huggingface.co/Xenova/clip-vit-base-patch32 and https://huggingface.co/api/models/Xenova/clip-vit-base-patch32/tree/main/onnx (revision `d15189d...`, per-file sizes and sha256)
- MIT license (OpenAI CLIP): https://github.com/openai/CLIP/blob/main/LICENSE
- @huggingface/transformers latest (4.2.0, onnxruntime-node 1.24.3): https://registry.npmjs.org/@huggingface/transformers/latest
- Transformers.js v4 announcement (API continuity, new runtime): https://huggingface.co/blog/transformersjs-v4 and https://github.com/huggingface/transformers.js/releases/tag/4.0.0
- CLIPTextModelWithProjection usage pattern: https://huggingface.co/Xenova/clip-vit-base-patch16 (same pattern for patch32) and https://www.tigerdata.com/blog/how-to-build-an-image-search-application-with-openai-clip-postgresql-in-javascript
- PyTorch Python 3.14 support: https://pytorch.org/blog/pytorch-2-10-release-blog/ and https://pypi.org/project/torch/ (2.13.0, 2026-07-08, classifiers 3.10-3.14)
- transformers Python 3.14 bug: https://github.com/huggingface/transformers/issues/44938
- JS vs Python embedding drift / quantization: https://github.com/huggingface/transformers.js/issues/36
- Supabase Edge Function limits (256 MB, 2s CPU, 20 MB bundle): https://supabase.com/docs/guides/functions/limits
- Supabase AI-in-Edge-Functions guidance (gte-small built-in): https://supabase.com/docs/guides/functions/ai-models
- Vercel function limits (2-4 GB memory, 250 MB bundle, large functions 5 GB, 300s): https://vercel.com/docs/functions/limitations

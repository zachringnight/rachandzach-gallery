#!/usr/bin/env node
// Pre-warm the JS CLIP text encoder cache and sanity-check the embedding path.
// Pins per docs/plans/2026-07-22-0719-digital-wedding-home/spikes/clip-model.md:
//   Xenova/clip-vit-base-patch32 @ d15189d7028b43f1d3e65039190477f6af591c2a, dtype fp32.
// Usage: node scripts/prewarm-clip-text.mjs

import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
  env,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
const REV = "d15189d7028b43f1d3e65039190477f6af591c2a";

function l2normalize(v) {
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both inputs already L2-normalized
}

console.log(`model:     ${MODEL_ID}`);
console.log(`revision:  ${REV}`);
console.log(`dtype:     fp32`);
console.log(`cacheDir:  ${env.cacheDir}`);

const t0 = performance.now();
const [tokenizer, textModel] = await Promise.all([
  AutoTokenizer.from_pretrained(MODEL_ID, { revision: REV }),
  CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
    revision: REV,
    dtype: "fp32",
  }),
]);
const loadMs = performance.now() - t0;
console.log(`load time: ${loadMs.toFixed(0)} ms`);

async function embedText(query) {
  const inputs = tokenizer([query], { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs); // Tensor [1, 512], unnormalized
  return l2normalize(text_embeds.tolist()[0]);
}

const tEmbed = performance.now();
const a = await embedText("sunset kiss");
const b = await embedText("people dancing");
const embedMs = performance.now() - tEmbed;

console.log(`embed time (2 strings): ${embedMs.toFixed(0)} ms`);
console.log(`dim: ${a.length}`);
console.log(`cosine("sunset kiss", "people dancing"): ${cosine(a, b).toFixed(6)}`);

if (a.length !== 512 || b.length !== 512) {
  console.error(`FAIL: expected 512-dim vectors, got ${a.length}/${b.length}`);
  process.exit(1);
}
console.log("OK: 512-dim vectors, L2-normalized");

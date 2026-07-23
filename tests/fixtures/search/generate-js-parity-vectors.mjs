#!/usr/bin/env node
/**
 * Generates js-parity-vectors.json: the JS-side (Xenova CLIP text encoder)
 * embeddings for the 5 fixed strings that gate every embedding ingestion run
 * (docs/plans/2026-07-22-0719-digital-wedding-home/spikes/clip-model.md,
 * "Parity check"). scripts/build-embeddings.py --verify loads this file,
 * embeds the same 5 strings with the Python-side CLIP text encoder, and
 * requires cosine similarity > 0.999 against these vectors before any real
 * ingestion is allowed to proceed.
 *
 * Deterministic and offline once the model is cached (it already is on this
 * machine; see docs/.../spikes/embeddings-env.md). Re-run this only if the
 * pinned model id or revision below ever changes -- it must always match
 * src/lib/search/query-embedding.ts exactly.
 *
 * Usage: node tests/fixtures/search/generate-js-parity-vectors.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
const REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a";

/**
 * Fixed 5-string parity set. Must stay byte-identical to the PARITY_STRINGS
 * list in scripts/build-embeddings.py and to spikes/clip-model.md.
 */
const PARITY_STRINGS = [
  "bride and groom first dance",
  "sunset over the ocean",
  "a golden retriever",
  "people laughing at a dinner table",
  "fireworks at night",
];

function l2normalize(vector) {
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

async function main() {
  const [tokenizer, textModel] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID, { revision: REVISION }),
    CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
      revision: REVISION,
      dtype: "fp32",
    }),
  ]);

  const vectors = [];
  for (const text of PARITY_STRINGS) {
    const inputs = tokenizer([text], { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs); // Tensor [1, 512], unnormalized
    vectors.push(l2normalize(text_embeds.tolist()[0]));
  }

  for (const vector of vectors) {
    if (vector.length !== 512) {
      throw new Error(`expected 512-dim vector, got ${vector.length}`);
    }
  }

  const output = {
    model: MODEL_ID,
    revision: REVISION,
    dtype: "fp32",
    strings: PARITY_STRINGS,
    vectors,
    generatedAt: new Date().toISOString(),
    note:
      "JS-side (Xenova/clip-vit-base-patch32) L2-normalized text embeddings " +
      "for the 5-string parity set. Consumed by scripts/build-embeddings.py " +
      "--verify, which computes the Python-side (openai/clip-vit-base-patch32) " +
      "embeddings for the same strings and requires cosine > 0.999 per pair.",
  };

  const outPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "js-parity-vectors.json",
  );
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`wrote ${outPath}`);
  vectors.forEach((vector, index) => {
    const norm = Math.hypot(...vector);
    console.log(
      `  [${index}] "${PARITY_STRINGS[index]}" dim=${vector.length} norm=${norm.toFixed(6)}`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

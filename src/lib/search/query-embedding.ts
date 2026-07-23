import "server-only";

/**
 * Query-text embedding for Moment Search (packet 07). Runs in a Vercel Node
 * route handler (src/app/api/search/route.ts), NOT a Supabase Edge Function
 * -- see docs/plans/2026-07-22-0719-digital-wedding-home/spikes/clip-model.md
 * ("Why not a Supabase Edge Function"): Edge Functions cap at 256 MB memory
 * and 2s CPU, which makes even the quantized text encoder marginal.
 *
 * Pinned model, exactly mirroring the Python image encoder's embedding space
 * (spikes/clip-model.md, spikes/embeddings-env.md "JS text encoder"):
 *
 *   JS text side:  Xenova/clip-vit-base-patch32 @ d15189d7028b43f1d3e65039190477f6af591c2a, dtype fp32
 *   Python image:  openai/clip-vit-base-patch32 @ 3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268 (scripts/build-embeddings.py)
 *
 * Both sides L2-normalize before the vector is ever stored or compared; the
 * 5-string parity check (tests/fixtures/search/js-parity-vectors.json,
 * scripts/build-embeddings.py --verify) gates ingestion on cosine > 0.999
 * between the two runtimes. Do not change MODEL_ID, REVISION, or dtype here
 * without re-running that check.
 *
 * Never logs the query text -- only success/failure and, where the caller
 * chooses to log at all, latency bucket and result count (packet privacy
 * rule). This module itself performs no logging.
 */
import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";

export const QUERY_EMBEDDING_MODEL_ID = "Xenova/clip-vit-base-patch32";
export const QUERY_EMBEDDING_MODEL_REVISION =
  "d15189d7028b43f1d3e65039190477f6af591c2a";
export const QUERY_EMBEDDING_DIMENSIONS = 512;

/**
 * The embedding service (model load or inference) failed, or produced a
 * shape that cannot be trusted. Callers must treat this as "unavailable" and
 * fall back to keyword search per the packet's privacy/degradation rule --
 * never surface this as a guest-facing error page.
 */
export class QueryEmbeddingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "QueryEmbeddingError";
  }
}

// Module-scope singletons: loaded once per warm serverless instance, reused
// across invocations (per the spike's cold-start guidance). Lazy so
// importing this module never triggers a model download by itself -- only
// the first real embedText() call does.
let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;
let textModelPromise: Promise<CLIPTextModelWithProjection> | null = null;

function getTokenizer(): Promise<PreTrainedTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(QUERY_EMBEDDING_MODEL_ID, {
      revision: QUERY_EMBEDDING_MODEL_REVISION,
    }) as Promise<PreTrainedTokenizer>;
    // A rejected promise must not poison this warm instance forever: reset
    // the cache on failure so the NEXT call retries a fresh load (a cold
    // start can fail transiently -- e.g. a momentary Hub fetch error --
    // without every subsequent search on this instance failing too).
    tokenizerPromise.catch(() => {
      tokenizerPromise = null;
    });
  }
  return tokenizerPromise;
}

function getTextModel(): Promise<CLIPTextModelWithProjection> {
  if (!textModelPromise) {
    textModelPromise = CLIPTextModelWithProjection.from_pretrained(
      QUERY_EMBEDDING_MODEL_ID,
      {
        revision: QUERY_EMBEDDING_MODEL_REVISION,
        // Exact fp32 space match with the Python image encoder. Do not
        // change without rerunning the parity check (see module docstring).
        dtype: "fp32",
      },
    ) as Promise<CLIPTextModelWithProjection>;
    // Same self-healing reset as getTokenizer() above.
    textModelPromise.catch(() => {
      textModelPromise = null;
    });
  }
  return textModelPromise;
}

function l2normalize(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new QueryEmbeddingError("Query embedding collapsed to a zero vector.");
  }
  return vector.map((value) => value / norm);
}

/**
 * Embeds one search query into the shared 512-dim CLIP space, L2-normalized.
 * Throws QueryEmbeddingError (never a raw model/runtime error) on any
 * failure, including a wrong-dimension result. The query string itself is
 * never logged, here or by anything this function calls.
 */
export async function embedText(query: string): Promise<number[]> {
  let raw: number[];
  try {
    const [tokenizer, textModel] = await Promise.all([
      getTokenizer(),
      getTextModel(),
    ]);
    const inputs = tokenizer([query], { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    raw = Array.from(text_embeds.tolist()[0] as number[]);
  } catch (error) {
    throw new QueryEmbeddingError(
      "The query embedding service is unavailable.",
      { cause: error },
    );
  }

  if (raw.length !== QUERY_EMBEDDING_DIMENSIONS) {
    throw new QueryEmbeddingError(
      `Expected a ${QUERY_EMBEDDING_DIMENSIONS}-dim embedding, got ${raw.length}.`,
    );
  }
  return l2normalize(raw);
}

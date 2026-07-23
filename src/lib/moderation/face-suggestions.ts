/**
 * Server side of the face-recognition moderation assist (Round Two,
 * docs/0719_Round_Two_Features_v1.md): propose person tags for a batch's
 * pending uploads by shelling to the local InsightFace pipeline
 * (scripts/face/suggest-tags.py) against metadata/faces/signatures.json.
 *
 * FEATURE-DETECTED, FAIL-SILENT. The pipeline exists only on the Mac that
 * built the signatures (.venv-faces/ plus the gitignored metadata/faces/
 * artifacts). Everywhere else -- production, CI, a fresh checkout -- every
 * entry point returns null and the reviewer renders no suggestion surface at
 * all. No error states, no placeholders, per the round-two decision.
 *
 * PRIVACY: embeddings never leave the local machine. This module hands the
 * Python process temp file paths and receives only slugs, names, and
 * similarity scores back; that is all the browser ever sees.
 *
 * Deliberately NOT importing "server-only" so the vitest node project can
 * exercise it directly (same tradeoff as src/lib/favorites/server.ts); the
 * node:fs/node:child_process imports make it unbundleable client-side
 * anyway, and its one real caller is the admin batch page (a server
 * component).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { STORAGE_BUCKETS } from "@/lib/supabase/schema";
import type {
  FaceTagSuggestion,
  ItemFaceSuggestions,
} from "@/components/admin/FaceTagSuggestions";

const execFileAsync = promisify(execFile);

type Db = SupabaseClient<Database>;

/** Media types the Python side can decode (HEIC stays out, like its preview). */
export const SUGGESTABLE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Bound per-page-load work; a wedding-sized batch fits well within this. */
export const MAX_SUGGESTION_ITEMS = 30;

/** Suggestions per item are already capped Python-side; re-cap defensively. */
const MAX_SUGGESTIONS_PER_ITEM = 12;

const PIPELINE_TIMEOUT_MS = 180_000;
const PIPELINE_MAX_BUFFER = 32 * 1024 * 1024;

export interface FacePipelinePaths {
  python: string;
  script: string;
  signatures: string;
}

export interface ReviewItemForSuggestions {
  itemId: string;
  objectPath: string;
  mediaType: string;
  status: string;
}

export interface SuggestOptions {
  /** Repo root; defaults to process.cwd() (Next runs from the repo root). */
  root?: string;
  /** Test seam: replaces the real Python spawn. Returns the process stdout. */
  runPipeline?: (
    pipeline: FacePipelinePaths,
    imagePaths: string[],
  ) => Promise<string>;
  /**
   * Live people catalog (slug -> display name). When provided, suggestions
   * are filtered to catalog slugs and renamed from it, so a stale signature
   * name can never leak past the catalog.
   */
  knownPeople?: ReadonlyArray<{ slug: string; name: string }>;
}

/**
 * Locate the local pipeline. Null whenever any piece is missing -- that is
 * the everyday case off this machine, not an error.
 */
export function resolveFacePipeline(
  root: string = process.cwd(),
): FacePipelinePaths | null {
  try {
    const python = path.join(root, ".venv-faces", "bin", "python");
    const script = path.join(root, "scripts", "face", "suggest-tags.py");
    const signatures = path.join(root, "metadata", "faces", "signatures.json");
    if (!existsSync(python) || !existsSync(script) || !existsSync(signatures)) {
      return null;
    }
    return { python, script, signatures };
  } catch {
    return null;
  }
}

interface RawSuggestion {
  slug?: unknown;
  name?: unknown;
  similarity?: unknown;
  tier?: unknown;
}

interface RawResult {
  path?: unknown;
  ok?: unknown;
  suggestions?: unknown;
}

/**
 * Parse the pipeline's stdout into imagePath -> suggestions. Defensive on
 * every field, and tolerant of stray non-JSON lines (ONNX/insightface
 * chatter is redirected to stderr Python-side, but a wrapper could still
 * leak a line): the LAST parseable JSON object line wins.
 */
export function parsePipelineOutput(
  stdout: string,
): Map<string, FaceTagSuggestion[]> {
  const byPath = new Map<string, FaceTagSuggestion[]>();
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let payload: { results?: unknown } | null = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith("{")) continue;
    try {
      const candidate: unknown = JSON.parse(lines[i]);
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        Array.isArray((candidate as { results?: unknown }).results)
      ) {
        payload = candidate as { results?: unknown };
        break;
      }
    } catch {
      // keep scanning upward
    }
  }
  if (!payload || !Array.isArray(payload.results)) return byPath;

  for (const raw of payload.results as RawResult[]) {
    if (typeof raw !== "object" || raw === null) continue;
    if (typeof raw.path !== "string" || raw.ok !== true) continue;
    const suggestions: FaceTagSuggestion[] = [];
    const seen = new Set<string>();
    const rawSuggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
    for (const entry of rawSuggestions as RawSuggestion[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const { slug, name, similarity, tier } = entry;
      if (typeof slug !== "string" || slug.length === 0) continue;
      if (typeof similarity !== "number" || !Number.isFinite(similarity)) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      suggestions.push({
        slug,
        name: typeof name === "string" && name.length > 0 ? name : slug,
        similarity: Math.min(1, Math.max(0, similarity)),
        confident: tier === "confident",
      });
    }
    suggestions.sort(
      (a, b) => b.similarity - a.similarity || a.slug.localeCompare(b.slug),
    );
    byPath.set(raw.path, suggestions.slice(0, MAX_SUGGESTIONS_PER_ITEM));
  }
  return byPath;
}

function extensionFor(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/webp") return ".webp";
  return ".jpg";
}

async function defaultRunPipeline(
  pipeline: FacePipelinePaths,
  imagePaths: string[],
): Promise<string> {
  const { stdout } = await execFileAsync(
    pipeline.python,
    [pipeline.script, "--signatures", pipeline.signatures, ...imagePaths],
    { timeout: PIPELINE_TIMEOUT_MS, maxBuffer: PIPELINE_MAX_BUFFER },
  );
  return stdout;
}

/**
 * Propose person tags for a batch's pending uploads. Returns null whenever
 * the pipeline is unavailable or anything fails (the UI then renders no
 * surface at all); returns [] when the pipeline ran but had nothing eligible
 * to look at.
 */
export async function suggestFaceTagsForItems(
  db: Db,
  items: ReviewItemForSuggestions[],
  options: SuggestOptions = {},
): Promise<ItemFaceSuggestions[] | null> {
  const pipeline = resolveFacePipeline(options.root);
  if (!pipeline) return null;

  const eligible = items
    .filter(
      (item) =>
        item.status === "pending" && SUGGESTABLE_MEDIA_TYPES.has(item.mediaType),
    )
    .slice(0, MAX_SUGGESTION_ITEMS);
  if (eligible.length === 0) return [];

  let tempDir: string | null = null;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "rachandzach-face-suggest-"));
    const filePathToItemId = new Map<string, string>();
    for (const [index, item] of eligible.entries()) {
      const { data, error } = await db.storage
        .from(STORAGE_BUCKETS.guestPending)
        .download(item.objectPath);
      if (error || !data) continue; // one bad object never sinks the batch
      const filePath = path.join(
        tempDir,
        `${index}${extensionFor(item.mediaType)}`,
      );
      await writeFile(filePath, Buffer.from(await data.arrayBuffer()));
      filePathToItemId.set(filePath, item.itemId);
    }
    if (filePathToItemId.size === 0) return [];

    const runPipeline = options.runPipeline ?? defaultRunPipeline;
    const stdout = await runPipeline(pipeline, [...filePathToItemId.keys()]);
    const byPath = parsePipelineOutput(stdout);

    const catalog = options.knownPeople
      ? new Map(options.knownPeople.map((person) => [person.slug, person.name]))
      : null;

    const results: ItemFaceSuggestions[] = [];
    for (const [filePath, itemId] of filePathToItemId) {
      const parsed = byPath.get(filePath) ?? [];
      const suggestions = catalog
        ? parsed
            .filter((suggestion) => catalog.has(suggestion.slug))
            .map((suggestion) => ({
              ...suggestion,
              name: catalog.get(suggestion.slug) ?? suggestion.name,
            }))
        : parsed;
      results.push({ itemId, suggestions });
    }
    return results;
  } catch {
    return null;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

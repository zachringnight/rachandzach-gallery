/**
 * Face-suggestion server module (Round Two moderation assist): feature
 * detection, defensive pipeline-output parsing, and the download-shell-map
 * flow with an injected pipeline runner. The real Python pipeline is never
 * spawned here; its stdout contract is replayed as fixtures.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  MAX_SUGGESTION_ITEMS,
  parsePipelineOutput,
  resolveFacePipeline,
  suggestFaceTagsForItems,
  type FacePipelinePaths,
  type ReviewItemForSuggestions,
} from "@/lib/moderation/face-suggestions";

type Db = SupabaseClient<Database>;

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** A root with all three pipeline pieces present (as empty stand-ins). */
let availableRoot: string;
/** A root with nothing in it. */
let emptyRoot: string;

beforeAll(async () => {
  availableRoot = await mkdtemp(path.join(tmpdir(), "face-sugg-root-"));
  emptyRoot = await mkdtemp(path.join(tmpdir(), "face-sugg-empty-"));
  await mkdir(path.join(availableRoot, ".venv-faces", "bin"), { recursive: true });
  await mkdir(path.join(availableRoot, "scripts", "face"), { recursive: true });
  await mkdir(path.join(availableRoot, "metadata", "faces"), { recursive: true });
  await writeFile(path.join(availableRoot, ".venv-faces", "bin", "python"), "");
  await writeFile(path.join(availableRoot, "scripts", "face", "suggest-tags.py"), "");
  await writeFile(path.join(availableRoot, "metadata", "faces", "signatures.json"), "{}");
});

afterAll(async () => {
  await rm(availableRoot, { recursive: true, force: true });
  await rm(emptyRoot, { recursive: true, force: true });
});

function pendingItem(
  itemId: string,
  objectPath: string,
  mediaType = "image/jpeg",
  status = "pending",
): ReviewItemForSuggestions {
  return { itemId, objectPath, mediaType, status };
}

/** Minimal fake of the one storage call shape the module makes. */
function fakeDb(objects: Record<string, Uint8Array | "error">): Db {
  return {
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("rachandzach-guest-pending");
        return {
          download: async (objectPath: string) => {
            const entry = objects[objectPath];
            if (entry === undefined || entry === "error") {
              return { data: null, error: { message: "Object not found" } };
            }
            return { data: new Blob([entry as BlobPart]), error: null };
          },
        };
      },
    },
  } as unknown as Db;
}

/** A db that fails the test if anything on it is ever touched. */
function untouchableDb(): Db {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("db must not be touched when the pipeline is unavailable");
      },
    },
  ) as Db;
}

function pipelineJson(
  results: Array<{
    path: string;
    ok?: boolean;
    suggestions?: unknown[];
    error?: string;
  }>,
): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    model: "insightface/buffalo_l",
    results: results.map((r) => ({ ok: true, suggestions: [], ...r })),
  })}\n`;
}

describe("resolveFacePipeline", () => {
  it("finds all three pieces under an equipped root", () => {
    const pipeline = resolveFacePipeline(availableRoot);
    expect(pipeline).not.toBeNull();
    expect(pipeline!.python.endsWith(path.join(".venv-faces", "bin", "python"))).toBe(true);
    expect(pipeline!.script.endsWith("suggest-tags.py")).toBe(true);
    expect(pipeline!.signatures.endsWith("signatures.json")).toBe(true);
  });

  it("returns null when any piece is missing", () => {
    expect(resolveFacePipeline(emptyRoot)).toBeNull();
  });

  it("finds the real repo's script (the venv and signatures may be absent elsewhere)", () => {
    // Not asserting availability -- only that the path shapes line up with
    // the actual repo layout so the constants never drift from reality.
    expect(existsSync(path.join(REPO_ROOT, "scripts", "face", "suggest-tags.py"))).toBe(true);
  });
});

describe("parsePipelineOutput", () => {
  it("maps per-path suggestions with tier -> confident", () => {
    const out = pipelineJson([
      {
        path: "/tmp/0.jpg",
        suggestions: [
          { slug: "jo-cohn", name: "Jo Cohn", similarity: 0.749, margin: 0.6, tier: "confident" },
          { slug: "sam-day", name: "Sam Day", similarity: 0.51, margin: 0.1, tier: "review" },
        ],
      },
    ]);
    const parsed = parsePipelineOutput(out);
    expect(parsed.get("/tmp/0.jpg")).toEqual([
      { slug: "jo-cohn", name: "Jo Cohn", similarity: 0.749, confident: true },
      { slug: "sam-day", name: "Sam Day", similarity: 0.51, confident: false },
    ]);
  });

  it("tolerates leading non-JSON chatter and uses the last JSON object line", () => {
    const out = `Applied providers: ['CPUExecutionProvider']\nfind model: det_10g.onnx\n${pipelineJson([
      { path: "/tmp/a.jpg", suggestions: [{ slug: "p", name: "P", similarity: 0.7, tier: "review" }] },
    ])}`;
    expect(parsePipelineOutput(out).get("/tmp/a.jpg")).toHaveLength(1);
  });

  it("returns an empty map for garbage or JSON without results", () => {
    expect(parsePipelineOutput("").size).toBe(0);
    expect(parsePipelineOutput("not json at all").size).toBe(0);
    expect(parsePipelineOutput('{"schemaVersion":1}').size).toBe(0);
  });

  it("skips ok:false results and malformed suggestion entries", () => {
    const out = pipelineJson([
      { path: "/tmp/bad.jpg", ok: false, error: "decode failed" },
      {
        path: "/tmp/good.jpg",
        suggestions: [
          { slug: "", name: "Empty", similarity: 0.9, tier: "confident" },
          { slug: "no-sim", name: "NoSim", tier: "confident" },
          { slug: "nan", name: "NaN", similarity: Number.NaN, tier: "confident" },
          42,
          { slug: "ok-person", name: "Ok Person", similarity: 0.66, tier: "confident" },
        ],
      },
    ]);
    const parsed = parsePipelineOutput(out);
    expect(parsed.has("/tmp/bad.jpg")).toBe(false);
    expect(parsed.get("/tmp/good.jpg")).toEqual([
      { slug: "ok-person", name: "Ok Person", similarity: 0.66, confident: true },
    ]);
  });

  it("clamps similarity into 0..1, dedupes slugs, sorts strongest first, and caps rows", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      slug: `person-${i}`,
      name: `Person ${i}`,
      similarity: 0.5 + i * 0.01,
      tier: "review",
    }));
    const out = pipelineJson([
      {
        path: "/tmp/x.jpg",
        suggestions: [
          { slug: "dupe", name: "Dupe", similarity: 1.7, tier: "confident" },
          { slug: "dupe", name: "Dupe Again", similarity: 0.6, tier: "review" },
          ...many,
        ],
      },
    ]);
    const rows = parsePipelineOutput(out).get("/tmp/x.jpg") ?? [];
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ slug: "dupe", name: "Dupe", similarity: 1, confident: true });
    expect(rows.filter((r) => r.slug === "dupe")).toHaveLength(1);
    const sims = rows.map((r) => r.similarity);
    expect([...sims].sort((a, b) => b - a)).toEqual(sims);
  });
});

describe("suggestFaceTagsForItems", () => {
  it("returns null without touching the db when the pipeline is unavailable", async () => {
    const result = await suggestFaceTagsForItems(
      untouchableDb(),
      [pendingItem("i1", "batch/a.jpg")],
      { root: emptyRoot },
    );
    expect(result).toBeNull();
  });

  it("returns [] when nothing is eligible (non-pending, HEIC-only)", async () => {
    const result = await suggestFaceTagsForItems(
      untouchableDb(),
      [
        pendingItem("i1", "a.jpg", "image/jpeg", "approved"),
        pendingItem("i2", "b.heic", "image/heic"),
      ],
      { root: availableRoot },
    );
    expect(result).toEqual([]);
  });

  it("downloads pending images, shells once, and maps suggestions back by item", async () => {
    const bytes = new TextEncoder().encode("jpeg-bytes-1");
    const db = fakeDb({ "batch/a.jpg": bytes, "batch/b.png": new Uint8Array([7]) });
    let seenPipeline: FacePipelinePaths | null = null;
    let seenPaths: string[] = [];

    const result = await suggestFaceTagsForItems(
      db,
      [
        pendingItem("item-a", "batch/a.jpg"),
        pendingItem("item-b", "batch/b.png", "image/png"),
        pendingItem("item-rejected", "batch/c.jpg", "image/jpeg", "rejected"),
      ],
      {
        root: availableRoot,
        runPipeline: async (pipeline, imagePaths) => {
          seenPipeline = pipeline;
          seenPaths = imagePaths;
          // The first temp file must hold the exact downloaded bytes.
          expect(new Uint8Array(await readFile(imagePaths[0]))).toEqual(bytes);
          expect(imagePaths[0].endsWith(".jpg")).toBe(true);
          expect(imagePaths[1].endsWith(".png")).toBe(true);
          return pipelineJson([
            {
              path: imagePaths[0],
              suggestions: [
                { slug: "jo-cohn", name: "Jo Cohn", similarity: 0.74, tier: "confident" },
              ],
            },
            { path: imagePaths[1], suggestions: [] },
          ]);
        },
      },
    );

    expect(seenPipeline).not.toBeNull();
    expect(seenPaths).toHaveLength(2); // the rejected item never went along
    expect(result).toEqual([
      {
        itemId: "item-a",
        suggestions: [
          { slug: "jo-cohn", name: "Jo Cohn", similarity: 0.74, confident: true },
        ],
      },
      { itemId: "item-b", suggestions: [] },
    ]);
    // Temp files are cleaned up afterwards.
    expect(existsSync(path.dirname(seenPaths[0]))).toBe(false);
  });

  it("caps the batch at MAX_SUGGESTION_ITEMS", async () => {
    const objects: Record<string, Uint8Array> = {};
    const items: ReviewItemForSuggestions[] = [];
    for (let i = 0; i < MAX_SUGGESTION_ITEMS + 5; i += 1) {
      const objectPath = `batch/${i}.jpg`;
      objects[objectPath] = new Uint8Array([i]);
      items.push(pendingItem(`item-${i}`, objectPath));
    }
    let count = 0;
    const result = await suggestFaceTagsForItems(fakeDb(objects), items, {
      root: availableRoot,
      runPipeline: async (_pipeline, imagePaths) => {
        count = imagePaths.length;
        return pipelineJson(imagePaths.map((p) => ({ path: p })));
      },
    });
    expect(count).toBe(MAX_SUGGESTION_ITEMS);
    expect(result).toHaveLength(MAX_SUGGESTION_ITEMS);
  });

  it("filters to the live people catalog and prefers its display names", async () => {
    const db = fakeDb({ "batch/a.jpg": new Uint8Array([1]) });
    const result = await suggestFaceTagsForItems(
      db,
      [pendingItem("item-a", "batch/a.jpg")],
      {
        root: availableRoot,
        knownPeople: [{ slug: "jo-cohn", name: "Joanna Cohn" }],
        runPipeline: async (_pipeline, imagePaths) =>
          pipelineJson([
            {
              path: imagePaths[0],
              suggestions: [
                { slug: "jo-cohn", name: "Jo (stale)", similarity: 0.7, tier: "confident" },
                { slug: "gone-person", name: "Gone", similarity: 0.65, tier: "confident" },
              ],
            },
          ]),
      },
    );
    expect(result).toEqual([
      {
        itemId: "item-a",
        suggestions: [
          { slug: "jo-cohn", name: "Joanna Cohn", similarity: 0.7, confident: true },
        ],
      },
    ]);
  });

  it("skips items whose download fails and keeps the rest", async () => {
    const db = fakeDb({ "batch/ok.jpg": new Uint8Array([1]), "batch/broken.jpg": "error" });
    const result = await suggestFaceTagsForItems(
      db,
      [pendingItem("ok", "batch/ok.jpg"), pendingItem("broken", "batch/broken.jpg")],
      {
        root: availableRoot,
        runPipeline: async (_pipeline, imagePaths) => {
          expect(imagePaths).toHaveLength(1);
          return pipelineJson([{ path: imagePaths[0] }]);
        },
      },
    );
    expect(result).toEqual([{ itemId: "ok", suggestions: [] }]);
  });

  it("returns [] when every download fails", async () => {
    const db = fakeDb({ "batch/broken.jpg": "error" });
    const run = vi.fn();
    const result = await suggestFaceTagsForItems(
      db,
      [pendingItem("broken", "batch/broken.jpg")],
      { root: availableRoot, runPipeline: run },
    );
    expect(result).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the pipeline run fails", async () => {
    const db = fakeDb({ "batch/a.jpg": new Uint8Array([1]) });
    const result = await suggestFaceTagsForItems(
      db,
      [pendingItem("item-a", "batch/a.jpg")],
      {
        root: availableRoot,
        runPipeline: async () => {
          throw new Error("python exploded");
        },
      },
    );
    expect(result).toBeNull();
  });

  it("degrades unparseable pipeline output to empty suggestions, not an error", async () => {
    const db = fakeDb({ "batch/a.jpg": new Uint8Array([1]) });
    const result = await suggestFaceTagsForItems(
      db,
      [pendingItem("item-a", "batch/a.jpg")],
      { root: availableRoot, runPipeline: async () => "totally not json" },
    );
    // Deliberate: unparseable output degrades to "no suggestions", the UI
    // renders nothing, and moderation is unaffected.
    expect(result).toEqual([{ itemId: "item-a", suggestions: [] }]);
  });
});

describe("suggest-tags.py contract (static)", () => {
  it("keeps the CLI surface the module depends on", async () => {
    const script = await readFile(
      path.join(REPO_ROOT, "scripts", "face", "suggest-tags.py"),
      "utf8",
    );
    // The module passes --signatures and positional image paths, and relies
    // on JSON-on-stdout with ok/suggestions/tier fields.
    expect(script).toContain('"--signatures"');
    expect(script).toContain('"suggestions"');
    expect(script).toContain('"confident"');
    expect(script).toContain("redirect_stdout");
  });
});

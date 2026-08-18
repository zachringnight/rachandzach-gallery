import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeJsonAtomicSet } from "../../scripts/lib/naming-decisions.mjs";

let dir;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("writeJsonAtomicSet", () => {
  it("restores every file from snapshots if a later rename fails", async () => {
    dir = await mkdtemp(join(tmpdir(), "naming-atomic-"));
    const first = join(dir, "additions.json");
    const second = join(dir, "ledger.json");
    await writeFile(first, '{"ok":true}\n');
    await mkdir(second);
    const snapshots = [await readFile(first), null];

    await expect(
      writeJsonAtomicSet(
        [
          { path: first, value: { ok: false } },
          { path: second, value: { ledger: true } },
        ],
        snapshots,
      ),
    ).rejects.toThrow();

    expect(JSON.parse(await readFile(first, "utf8"))).toEqual({ ok: true });
  });
});

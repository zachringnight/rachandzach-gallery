/**
 * /[personSlug] route tests: slug resolution order (exact catalog hit, then
 * the compact-spelling scan), the admin rename override, canonical-URL
 * redirect, and 404 semantics. createAdminClient is mocked (vi.mock, same
 * pattern as tests/memories/api-memories.test.ts) with a small chain-shaped
 * fake that records every query it is asked to run.
 *
 * The query plan under test: the exact person lookup and the override lookup
 * are fired together (override rows are keyed by catalog slug, which on the
 * exact path is the requested slug itself), while the catalog scan and its
 * dependent override stay sequential. A miss must remain a plain 404 even if
 * the speculative override branch fails, and no branch may leak an unhandled
 * rejection.
 */
import { describe, expect, it, vi } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("SENTINEL_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`SENTINEL_REDIRECT:${url}`);
  },
}));

// The page only ever passes props to this client component; rendering it
// would drag the whole gallery tree into a node-environment test.
vi.mock("@/components/personalization/PersonGalleryClient", () => ({
  PersonGalleryClient: () => null,
}));

import PersonGalleryPage, {
  generateMetadata,
} from "@/app/(guest)/[personSlug]/page";
import { PersonGalleryClient } from "@/components/personalization/PersonGalleryClient";

type PersonRow = { slug: string; display_name: string };
type QueryResult<T> = { data: T; error: { message: string } | null };

const ok = <T,>(data: T): QueryResult<T> => ({ data, error: null });

type FakeDbConfig = {
  exact: (slug: string) => QueryResult<PersonRow | null> | Promise<QueryResult<PersonRow | null>>;
  scan?: () => QueryResult<PersonRow[]>;
  override?: (
    slug: string,
  ) =>
    | QueryResult<{ display_name: string } | null>
    | Promise<QueryResult<{ display_name: string } | null>>;
};

/**
 * Shapes exactly the chains the page uses: people .eq().maybeSingle() (exact
 * lookup), people awaited bare (catalog scan), overrides .eq().maybeSingle().
 * Every dispatched query is appended to `calls`, so tests can assert both
 * which queries ran and the order they were issued in.
 */
function createFakeDb(config: FakeDbConfig) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      return {
        // The column list is irrelevant to the fake; select() takes no args
        // here and the page's actual argument is simply ignored at runtime.
        select() {
          if (table === "rachandzach_person_overrides") {
            return {
              eq(_column: string, slug: string) {
                return {
                  maybeSingle() {
                    calls.push(`override:${slug}`);
                    const handler = config.override ?? (() => ok(null));
                    return Promise.resolve(handler(slug));
                  },
                };
              },
            };
          }
          return {
            eq(_column: string, slug: string) {
              return {
                maybeSingle() {
                  calls.push(`exact:${slug}`);
                  return Promise.resolve(config.exact(slug));
                },
              };
            },
            // Awaiting the select builder itself is the full-catalog scan.
            then(
              onFulfilled: (value: QueryResult<PersonRow[]>) => unknown,
              onRejected: (reason: unknown) => unknown,
            ) {
              calls.push("scan");
              const handler = config.scan ?? (() => ok([]));
              return Promise.resolve(handler()).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
  };
  createAdminClientMock.mockReturnValue(client);
  return { calls };
}

function pageFor(personSlug: string) {
  return PersonGalleryPage({ params: Promise.resolve({ personSlug }) });
}

/** Walks the returned element tree to the PersonGalleryClient props. */
function clientProps(node: unknown): Record<string, unknown> | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = clientProps(child);
      if (found) return found;
    }
    return null;
  }
  const element = node as {
    type?: unknown;
    props?: Record<string, unknown> & { children?: unknown };
  };
  if (element.type === PersonGalleryClient) return element.props ?? null;
  return clientProps(element.props?.children);
}

describe("/[personSlug] page", () => {
  it("resolves an exact slug with the override name and no catalog scan", async () => {
    const db = createFakeDb({
      exact: () => ok({ slug: "rach", display_name: "Rachel" }),
      override: () => ok({ display_name: "Rachel Soskin" }),
    });
    const props = clientProps(await pageFor("rach"));
    expect(props).toMatchObject({
      personSlug: "rach",
      personName: "Rachel Soskin",
    });
    expect(db.calls).toEqual(["exact:rach", "override:rach"]);
  });

  it("issues the person and override lookups concurrently", async () => {
    let resolveExact!: (result: QueryResult<PersonRow | null>) => void;
    const db = createFakeDb({
      exact: () =>
        new Promise<QueryResult<PersonRow | null>>((resolve) => {
          resolveExact = resolve;
        }),
      override: () => ok(null),
    });
    const rendered = pageFor("rach");
    // The override query must already be in flight while the person lookup
    // is still unresolved; sequential dispatch would never get here.
    await vi.waitFor(() => expect(db.calls).toContain("override:rach"));
    resolveExact(ok({ slug: "rach", display_name: "Rachel" }));
    expect(clientProps(await rendered)).toMatchObject({ personName: "Rachel" });
  });

  it("keeps an unknown slug a plain 404 even when the speculative override fails", async () => {
    createFakeDb({
      exact: () => ok(null),
      override: () => Promise.reject(new Error("override boom")),
      scan: () => ok([]),
    });
    // The rejection must be swallowed with the rest of the discarded branch,
    // not surface as the page error or as an unhandled rejection.
    await expect(pageFor("nobody")).rejects.toThrow("SENTINEL_NOT_FOUND");
  });

  it("resolves the compact spelling through the scan, then the dependent override", async () => {
    const db = createFakeDb({
      exact: () => ok(null),
      scan: () => ok([{ slug: "phil-campbell", display_name: "Phil" }]),
      override: (slug) =>
        slug === "phil-campbell" ? ok({ display_name: "Philip" }) : ok(null),
    });
    const props = clientProps(await pageFor("philcampbell"));
    expect(props).toMatchObject({
      personSlug: "phil-campbell",
      personName: "Philip",
    });
    // The second override lookup depends on the scan result and stays behind it.
    expect(db.calls).toEqual([
      "exact:philcampbell",
      "override:philcampbell",
      "scan",
      "override:phil-campbell",
    ]);
  });

  it("redirects a hyphenated catalog link to the compact URL", async () => {
    createFakeDb({
      exact: () => ok({ slug: "phil-campbell", display_name: "Phil" }),
      override: () => ok(null),
    });
    await expect(pageFor("phil-campbell")).rejects.toThrow(
      "SENTINEL_REDIRECT:/philcampbell",
    );
  });

  it("surfaces an override query error for a real person", async () => {
    createFakeDb({
      exact: () => ok({ slug: "rach", display_name: "Rachel" }),
      override: () => ({ data: null, error: { message: "boom" } }),
    });
    await expect(pageFor("rach")).rejects.toThrow(
      "Person route override query failed: boom",
    );
  });

  it("titles metadata with the resolved name, or the neutral fallback", async () => {
    createFakeDb({
      exact: (slug) =>
        slug === "rach" ? ok({ slug: "rach", display_name: "Rachel" }) : ok(null),
      override: () => ok(null),
      scan: () => ok([]),
    });
    const found = await generateMetadata({
      params: Promise.resolve({ personSlug: "rach" }),
    });
    expect(found.title).toBe("Rachel's Photos | Rach & Zach");
    const missing = await generateMetadata({
      params: Promise.resolve({ personSlug: "nobody" }),
    });
    expect(missing.title).toBe("Your Photos | Rach & Zach");
  });
});

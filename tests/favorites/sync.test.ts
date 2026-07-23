/**
 * Favorites sync layer tests (Favorites v2): load-union semantics, background
 * push with retry-once, silent failure, coalescing, and the My Weekend
 * session-to-person merge. Runs in vitest's "node" project against
 * createFavoritesSync's injected dependencies: a real FavoriteStore over null
 * storage (pure in-memory, same code path a storage-disabled browser uses)
 * and a vi.fn fetch. No jsdom, no real network.
 */
import { describe, expect, it, vi } from "vitest";
import { createFavoriteStore } from "@/lib/favorites/store";
import {
  FAVORITES_API_PATH,
  createFavoritesSync,
} from "@/lib/favorites/sync";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** vi.fn pinned to the sync layer's fetch signature, so every mock in this
 *  file has the same type regardless of how many params its impl declares. */
function fetchMockOf(impl: FetchLike) {
  return vi.fn<FetchLike>(impl);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okList(photoIds: string[]): Response {
  return jsonResponse({ ownerKind: "session", photoIds });
}

/** Lets queued microtasks and zero-delay timers run (background pushes). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function putBodies(
  fetchMock: ReturnType<typeof fetchMockOf>,
): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PUT")
    .map(
      ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
    );
}

describe("createFavoritesSync.load", () => {
  it("unions server favorites into the local store without removing local ones", async () => {
    const store = createFavoriteStore(null);
    store.toggle("local-only");
    const fetchMock = fetchMockOf(async () => okList(["server-a", "server-b"]));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    await sync.load();

    expect(store.list()).toEqual(["local-only", "server-a", "server-b"]);
    expect(fetchMock.mock.calls[0][0]).toBe(FAVORITES_API_PATH);
  });

  it("pushes local-only ids up after the union", async () => {
    const store = createFavoriteStore(null);
    store.toggle("local-only");
    const fetchMock = fetchMockOf(async (input, init) =>
      init?.method === "PUT" ? okList([]) : okList(["server-a"]),
    );
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    await sync.load();

    const puts = putBodies(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0].photoIds).toEqual(["local-only", "server-a"]);
  });

  it("skips the reconcile push when the server already has every local id", async () => {
    const store = createFavoriteStore(null);
    store.toggle("shared");
    const fetchMock = fetchMockOf(async () => okList(["shared", "server-a"]));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    await sync.load();

    expect(putBodies(fetchMock)).toHaveLength(0);
    expect(store.list()).toEqual(["shared", "server-a"]);
  });

  it("sends the person slug as a query parameter when one is set", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () => okList([]));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => "rach",
    });

    await sync.load();

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FAVORITES_API_PATH}?person=rach`,
    );
  });

  it("retries once on network failure and still applies the result", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () => okList(["server-a"]));
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    await sync.load();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.list()).toEqual(["server-a"]);
  });

  it("retries once on a non-ok response", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () => okList(["server-a"]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    await sync.load();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.list()).toEqual(["server-a"]);
  });

  it("gives up silently after the retry; the local store keeps working", async () => {
    const store = createFavoriteStore(null);
    store.toggle("local-only");
    const fetchMock = fetchMockOf(async () => {
      throw new Error("offline");
    });
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    await expect(sync.load()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.list()).toEqual(["local-only"]);
    store.toggle("still-works");
    expect(store.list()).toEqual(["local-only", "still-works"]);
  });

  it("ignores a malformed response body without retrying against a healthy server", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () =>
      jsonResponse({ photoIds: "not-an-array" }),
    );
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    await sync.load();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.list()).toEqual([]);
  });
});

describe("createFavoritesSync.start", () => {
  it("pushes the full local list when the guest toggles a favorite", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () => okList([]));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    const stop = sync.start();
    await flush();
    fetchMock.mockClear();

    store.toggle("hearted");
    await flush();

    const puts = putBodies(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toEqual({ photoIds: ["hearted"] });
    stop();
  });

  it("includes the person slug in pushes once one is set", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () => okList([]));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => "zach",
    });

    const stop = sync.start();
    await flush();
    fetchMock.mockClear();

    store.toggle("hearted");
    await flush();

    expect(putBodies(fetchMock)[0]).toEqual({
      photoIds: ["hearted"],
      person: "zach",
    });
    stop();
  });

  it("does not push server-applied ids back at the server", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () => okList(["server-a"]));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    const stop = sync.start();
    await flush();

    // The load unioned server-a into the store; that store change must not
    // have echoed a PUT (local had nothing the server lacked).
    expect(putBodies(fetchMock)).toHaveLength(0);
    expect(store.list()).toEqual(["server-a"]);
    stop();
  });

  it("coalesces rapid toggles into sequential pushes ending on the final list", async () => {
    const store = createFavoriteStore(null);
    let releaseFirstPut: () => void = () => {};
    const firstPutGate = new Promise<void>((resolve) => {
      releaseFirstPut = resolve;
    });
    let putCount = 0;
    const fetchMock = fetchMockOf(async (input, init) => {
      if (init?.method === "PUT") {
        putCount += 1;
        if (putCount === 1) await firstPutGate;
      }
      return okList([]);
    });
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    const stop = sync.start();
    await flush();

    store.toggle("a"); // starts PUT #1, which blocks on the gate
    await flush();
    store.toggle("b"); // queued behind the in-flight PUT
    store.toggle("c"); // still just one queued follow-up push, not two
    releaseFirstPut();
    await flush();
    await flush();

    const puts = putBodies(fetchMock);
    expect(puts).toHaveLength(2);
    expect(puts[0].photoIds).toEqual(["a"]);
    expect(puts[1].photoIds).toEqual(["a", "b", "c"]);
    stop();
  });

  it("stops pushing after the returned unsubscribe runs", async () => {
    const store = createFavoriteStore(null);
    const fetchMock = fetchMockOf(async () => okList([]));
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => null,
    });

    const stop = sync.start();
    await flush();
    stop();
    fetchMock.mockClear();

    store.toggle("after-stop");
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createFavoritesSync.migrateToPerson", () => {
  it("PUTs the local list with migrateFromSession and unions the merged result", async () => {
    const store = createFavoriteStore(null);
    store.toggle("local-a");
    const fetchMock = fetchMockOf(async () =>
      jsonResponse({
        ownerKind: "person",
        photoIds: ["local-a", "from-session", "from-person"],
      }),
    );
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => "rach",
    });

    await sync.migrateToPerson("rach");

    const puts = putBodies(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toEqual({
      photoIds: ["local-a"],
      person: "rach",
      migrateFromSession: true,
    });
    expect(store.list()).toEqual(["local-a", "from-session", "from-person"]);
  });

  it("fails silently when the merge request cannot reach the server", async () => {
    const store = createFavoriteStore(null);
    store.toggle("local-a");
    const fetchMock = fetchMockOf(async () => {
      throw new Error("offline");
    });
    const sync = createFavoritesSync({
      store,
      fetchFn: fetchMock,
      getPersonSlug: () => "rach",
    });

    await expect(sync.migrateToPerson("rach")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one retry
    expect(store.list()).toEqual(["local-a"]);
  });
});

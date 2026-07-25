import { describe, expect, it, vi } from "vitest";

import { fetchWithRetry } from "@/lib/http/fetch-with-retry";

const URL = "https://example.test/api/gallery?q=flowers";

function response(status: number, headers?: HeadersInit) {
  return new Response(null, { status, headers });
}

describe("fetchWithRetry", () => {
  it("retries a transient network failure and returns the successful response", async () => {
    const networkError = new TypeError("fetch failed");
    const success = response(200);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(success);
    const sleep = vi.fn(async () => {});

    const result = await fetchWithRetry(
      URL,
      {},
      { fetchImpl, sleep, baseDelayMs: 25, maxDelayMs: 100 },
    );

    expect(result).toBe(success);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it("retries 5xx and 429 responses with bounded backoff", async () => {
    const success = response(200);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(429, { "retry-after": "10" }))
      .mockResolvedValueOnce(success);
    const sleep = vi.fn(async () => {});

    const result = await fetchWithRetry(
      URL,
      {},
      {
        fetchImpl,
        sleep,
        maxAttempts: 3,
        baseDelayMs: 25,
        maxDelayMs: 250,
      },
    );

    expect(result).toBe(success);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[25], [250]]);
  });

  it.each([400, 401, 403, 404])(
    "returns a %i response without retrying",
    async (status) => {
      const clientError = response(status);
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(clientError);
      const sleep = vi.fn(async () => {});

      const result = await fetchWithRetry(URL, {}, { fetchImpl, sleep });

      expect(result).toBe(clientError);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("stops after the configured maximum number of attempts", async () => {
    const finalError = new TypeError("still offline");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(finalError);
    const sleep = vi.fn(async () => {});

    await expect(
      fetchWithRetry(
        URL,
        {},
        {
          fetchImpl,
          sleep,
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 15,
        },
      ),
    ).rejects.toBe(finalError);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [15]]);
  });

  it("hard-caps caller attempts so retries always remain bounded", async () => {
    const finalError = new TypeError("still offline");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(finalError);
    const sleep = vi.fn(async () => {});

    await expect(
      fetchWithRetry(
        URL,
        {},
        { fetchImpl, sleep, maxAttempts: 10_000, baseDelayMs: 0 },
      ),
    ).rejects.toBe(finalError);

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("propagates AbortError immediately without retrying", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(abortError);
    const sleep = vi.fn(async () => {});

    await expect(
      fetchWithRetry(URL, { signal: new AbortController().signal }, {
        fetchImpl,
        sleep,
      }),
    ).rejects.toBe(abortError);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("interrupts the default backoff when the request is aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(503));

    const result = fetchWithRetry(
      URL,
      { signal: controller.signal },
      { fetchImpl, baseDelayMs: 5_000 },
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects an explicit %s mutation before calling fetch",
    async (method) => {
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(
        fetchWithRetry(URL, { method }, { fetchImpl }),
      ).rejects.toThrow("only supports GET and HEAD");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("rejects a mutation carried by a Request object before calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const request = new Request(URL, { method: "POST", body: "{}" });

    await expect(
      fetchWithRetry(request, {}, { fetchImpl }),
    ).rejects.toThrow("only supports GET and HEAD");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/route";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  hashRateLimitKey: vi.fn(),
  consumeRateLimit: vi.fn(),
  searchMoments: vi.fn(),
  serializeMomentResults: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  hashRateLimitKey: mocks.hashRateLimitKey,
  consumeRateLimit: mocks.consumeRateLimit,
}));

vi.mock("@/lib/search/moment-search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/search/moment-search")>();
  return {
    ...actual,
    searchMoments: mocks.searchMoments,
    serializeMomentResults: mocks.serializeMomentResults,
  };
});

function request(query: string): NextRequest {
  return new NextRequest(
    `https://gallery.test/api/search?q=${encodeURIComponent(query)}&limit=1`,
    { headers: { "x-vercel-id": "pdx1::sfo1::request-123" } },
  );
}

function parseLog(spy: ReturnType<typeof vi.spyOn>, index = 0) {
  return JSON.parse(String(spy.mock.calls[index]?.[0])) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.createAdminClient.mockReset().mockReturnValue({});
  mocks.hashRateLimitKey.mockReset().mockResolvedValue("hashed-ip");
  mocks.consumeRateLimit.mockReset().mockResolvedValue(true);
  mocks.searchMoments.mockReset().mockResolvedValue([]);
  mocks.serializeMomentResults.mockReset().mockResolvedValue([]);
});

describe("GET /api/search structured logging", () => {
  it("records a correlated successful request without logging its query", async () => {
    const query = "private dance-floor phrase";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request(query));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(2);

    const started = parseLog(info, 0);
    const completed = parseLog(info, 1);
    expect(started).toMatchObject({
      level: "info",
      event: "gallery.moment_search",
      route: "/api/search",
      requestId: "pdx1::sfo1::request-123",
      stage: "request",
      outcome: "started",
    });
    expect(completed).toMatchObject({
      stage: "search",
      outcome: "completed",
      status: 200,
      resultCount: 0,
    });
    expect(info.mock.calls.flat().join(" ")).not.toContain(query);
    expect(info.mock.calls.flat().join(" ")).not.toContain(encodeURIComponent(query));
  });

  it("captures a nested production failure while redacting query text and credentials", async () => {
    const query = "private sunset phrase";
    const cause = Object.assign(
      new Error(
        `native model failed for ${query} at https://models.example/file?token=secret-value`,
      ),
      { code: "ERR_DLOPEN_FAILED" },
    );
    mocks.searchMoments.mockRejectedValue(
      new Error("Could not import Bearer private-token", { cause }),
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request(query));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Search is unavailable right now." });
    expect(error).toHaveBeenCalledTimes(1);

    const line = String(error.mock.calls[0]?.[0]);
    const logged = parseLog(error);
    expect(logged).toMatchObject({
      level: "error",
      event: "gallery.moment_search",
      route: "/api/search",
      requestId: "pdx1::sfo1::request-123",
      stage: "search",
      outcome: "failed",
      status: 500,
    });
    expect(line).toContain("ERR_DLOPEN_FAILED");
    expect(line).toContain("[query-redacted]");
    expect(line).toContain("Bearer [redacted]");
    expect(line).not.toContain(query);
    expect(line).not.toContain(encodeURIComponent(query));
    expect(line).not.toContain("secret-value");
    expect(line).not.toContain("private-token");
  });

  it("records rate-limit setup failures at their actual stage", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("Supabase admin client is not configured");
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request("dancing"));

    expect(response.status).toBe(500);
    expect(parseLog(error)).toMatchObject({
      stage: "rate_limit",
      outcome: "failed",
      status: 500,
    });
    expect(mocks.searchMoments).not.toHaveBeenCalled();
  });

  it("records an embedding failure even when the route degrades to a 200 keyword response", async () => {
    const query = "private first-dance phrase";
    mocks.searchMoments.mockImplementation(async (_input, reportFallback) => {
      reportFallback?.({
        stage: "embedding",
        error: new Error(`cache failed while embedding ${query}`),
      });
      return [];
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request(query));

    expect(response.status).toBe(200);
    expect(error).toHaveBeenCalledTimes(1);
    expect(parseLog(error)).toMatchObject({
      stage: "embedding",
      outcome: "keyword_fallback",
    });
    expect(String(error.mock.calls[0]?.[0])).not.toContain(query);
    expect(parseLog(info, 1)).toMatchObject({
      stage: "search",
      outcome: "completed",
      embeddingResultCount: 0,
      keywordResultCount: 0,
    });
  });
});

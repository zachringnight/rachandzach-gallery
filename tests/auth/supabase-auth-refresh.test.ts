import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUserMock, setAllMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  setAllMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: {
    cookies: {
      getAll: () => { name: string; value: string }[];
      setAll: (cookies: { name: string; value: string; options?: object }[]) => void;
    };
  }) => {
    setAllMock.mockImplementation((cookies: { name: string; value: string }[]) => {
      options.cookies.setAll(cookies.map((cookie) => ({ ...cookie, options: {} })));
    });
    return {
      auth: {
        getUser: async () => {
          const result = await getUserMock();
          if (result?.setCookies) setAllMock(result.setCookies);
          return result;
        },
      },
    };
  }),
}));

import { applySupabaseAuthRefresh } from "@/lib/auth/supabase-auth-refresh";

afterEach(() => {
  vi.unstubAllEnvs();
  getUserMock.mockReset();
});

function requestWithAuthCookie() {
  return new NextRequest("https://gallery.test/admin", {
    headers: { cookie: "sb-rnfvmqflktghriqefatc-auth-token=stale" },
  });
}

describe("applySupabaseAuthRefresh", () => {
  it("no-ops without Supabase configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { hasUser, response } = await applySupabaseAuthRefresh(requestWithAuthCookie());
    expect(hasUser).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("writes rotated auth cookies onto the response when getUser refreshes", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    getUserMock.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
      setCookies: [{ name: "sb-rnfvmqflktghriqefatc-auth-token", value: "rotated" }],
    });

    const { hasUser, response } = await applySupabaseAuthRefresh(requestWithAuthCookie());
    expect(hasUser).toBe(true);
    expect(response.headers.get("set-cookie") ?? "").toContain("rotated");
  });

  it("reports no user when getUser fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    getUserMock.mockRejectedValue(new Error("network"));
    const { hasUser } = await applySupabaseAuthRefresh(requestWithAuthCookie());
    expect(hasUser).toBe(false);
  });
});

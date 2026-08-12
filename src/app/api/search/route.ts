/**
 * GET /api/search (packet 07). Moment Search: protected, rate-limited,
 * validated. Runs the JS text encoder (src/lib/search/query-embedding.ts) in
 * this Vercel Node route per the platform spike -- never a Supabase Edge
 * Function. Never logs the query string.
 */
import { NextResponse, type NextRequest } from "next/server";
import { GalleryAccessConfigError } from "@/lib/auth/guest-session";
import { consumeRateLimit, hashRateLimitKey } from "@/lib/auth/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MOMENT_SEARCH_DEFAULT_LIMIT,
  MomentSearchValidationError,
  searchMoments,
  serializeMomentResults,
  type MomentSearchFallbackEvent,
} from "@/lib/search/moment-search";

// Runs the CLIP text encoder: needs the Node runtime (onnxruntime-node), not
// Edge, and a generous duration budget for a cold-start model fetch (see
// spikes/clip-model.md's cold-start budget of ~5-10s worst case fp32).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** IP-based; wedding-guest searches are rare, this is generous for humans and hostile to scripts. */
const SEARCH_RATE_LIMIT = {
  action: "moment_search_ip",
  attemptLimit: 30,
  windowSeconds: 60,
} as const;

const SEARCH_LOG_EVENT = "gallery.moment_search" as const;
const SEARCH_LOG_ROUTE = "/api/search" as const;

interface ErrorWithCode extends Error {
  code?: unknown;
}

interface SearchRequestContext {
  requestId: string | null;
  deploymentId: string | null;
  commitSha: string | null;
  environment: string | null;
}

/**
 * Removes credentials and URL query strings from third-party/runtime errors.
 * `forbiddenValues` includes the guest's exact query (plain and encoded), so
 * even an upstream library that echoes its input cannot put it in Vercel
 * logs. The route never logs request URLs or search params directly.
 */
function redactLogText(value: string, forbiddenValues: string[]): string {
  let redacted = value
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(
      /((?:access[_-]?token|api[_-]?key|authorization|password|secret|signature)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/https?:\/\/[^\s)\]}>"']+/g, (candidate) => {
      try {
        const url = new URL(candidate);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[redacted-url]";
      }
    });

  for (const forbidden of forbiddenValues) {
    if (forbidden) redacted = redacted.replaceAll(forbidden, "[query-redacted]");
  }
  return redacted.slice(0, 2_000);
}

function errorDetails(
  error: unknown,
  forbiddenValues: string[],
  depth = 0,
): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      name: "NonErrorThrown",
      message: redactLogText(String(error), forbiddenValues),
    };
  }

  const coded = error as ErrorWithCode;
  const details: Record<string, unknown> = {
    name: error.name || "Error",
    message: redactLogText(error.message || "No error message", forbiddenValues),
  };
  if (typeof coded.code === "string" || typeof coded.code === "number") {
    details.code = coded.code;
  }
  if (error.stack) {
    details.stack = redactLogText(
      error.stack.split("\n").slice(0, 8).join("\n"),
      forbiddenValues,
    );
  }
  if (depth < 2 && error.cause !== undefined) {
    details.cause = errorDetails(error.cause, forbiddenValues, depth + 1);
  }
  return details;
}

function requestContext(request: NextRequest): SearchRequestContext {
  return {
    requestId: request.headers.get("x-vercel-id"),
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    environment: process.env.VERCEL_ENV ?? null,
  };
}

function writeSearchLog(
  level: "info" | "error",
  context: SearchRequestContext,
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: SEARCH_LOG_EVENT,
    route: SEARCH_LOG_ROUTE,
    ...context,
    ...fields,
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.info(line);
  }
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function logSearchFallback(
  context: SearchRequestContext,
  event: MomentSearchFallbackEvent,
  forbiddenLogValues: string[],
  startedAt: number,
): void {
  const fields: Record<string, unknown> = {
    stage: event.stage,
    outcome: "keyword_fallback",
    durationMs: Date.now() - startedAt,
  };
  if (event.error !== undefined) {
    fields.error = errorDetails(event.error, forbiddenLogValues);
  }
  writeSearchLog(event.error === undefined ? "info" : "error", context, fields);
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const context = requestContext(request);
  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  const forbiddenLogValues = [rawQuery, encodeURIComponent(rawQuery)];

  writeSearchLog("info", context, { stage: "request", outcome: "started" });

  try {
    const admin = createAdminClient();
    const keyHash = await hashRateLimitKey(clientIp(request), SEARCH_RATE_LIMIT.action);
    const allowed = await consumeRateLimit(admin, {
      keyHash,
      action: SEARCH_RATE_LIMIT.action,
      attemptLimit: SEARCH_RATE_LIMIT.attemptLimit,
      windowSeconds: SEARCH_RATE_LIMIT.windowSeconds,
    });
    if (!allowed) {
      writeSearchLog("info", context, {
        stage: "rate_limit",
        outcome: "denied",
        status: 429,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { error: "Too many searches. Please wait a moment and try again." },
        { status: 429 },
      );
    }
  } catch (error) {
    writeSearchLog("error", context, {
      stage: "rate_limit",
      outcome: "failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      error: errorDetails(error, forbiddenLogValues),
    });
    if (error instanceof GalleryAccessConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Search rate limiting is unavailable." },
      { status: 500 },
    );
  }

  const params = request.nextUrl.searchParams;
  const query = rawQuery;
  const event = params.get("event");
  const limitParam = params.get("limit");
  const limit = limitParam ? Number(limitParam) : MOMENT_SEARCH_DEFAULT_LIMIT;

  try {
    const results = await searchMoments({ query, event, limit }, (fallback) =>
      logSearchFallback(context, fallback, forbiddenLogValues, startedAt),
    );
    const client = createAdminClient();
    const body = await serializeMomentResults(results, client);
    const embeddingResultCount = body.filter(
      (result) => result.matchType === "embedding",
    ).length;
    const keywordResultCount = body.length - embeddingResultCount;
    writeSearchLog("info", context, {
      stage: "search",
      outcome: "completed",
      status: 200,
      durationMs: Date.now() - startedAt,
      resultCount: body.length,
      embeddingResultCount,
      keywordResultCount,
    });
    return NextResponse.json({ results: body });
  } catch (error) {
    if (error instanceof MomentSearchValidationError) {
      writeSearchLog("info", context, {
        stage: "validation",
        outcome: "rejected",
        status: error.status,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    writeSearchLog("error", context, {
      stage: "search",
      outcome: "failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      error: errorDetails(error, forbiddenLogValues),
    });
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 500 });
  }
}

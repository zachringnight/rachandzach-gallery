export interface FetchWithRetryOptions {
  /** Total attempts, including the first request. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 150;
const DEFAULT_MAX_DELAY_MS = 1_000;
const HARD_MAX_ATTEMPTS = 5;
const HARD_MAX_DELAY_MS = 5_000;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "AbortError"
  );
}

function retryAfterMs(response: Response, now = Date.now()): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

export function isRetryableResponse(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

function abortError(signal?: AbortSignal | null): DOMException {
  return signal?.reason instanceof DOMException
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function sleepWithAbort(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(abortError(signal));
    };
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

/**
 * Bounded retries for idempotent gallery reads. Only GET/HEAD requests are
 * accepted so a caller cannot accidentally replay a mutation.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const method = (
    init.method ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.method
      : "GET")
  ).toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new TypeError("fetchWithRetry only supports GET and HEAD requests.");
  }

  const requestedAttempts = Math.trunc(
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  );
  const maxAttempts = Math.max(
    1,
    Math.min(
      Number.isFinite(requestedAttempts)
        ? requestedAttempts
        : DEFAULT_MAX_ATTEMPTS,
      HARD_MAX_ATTEMPTS,
    ),
  );
  const requestedBaseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const baseDelayMs = Math.max(
    0,
    Math.min(
      Number.isFinite(requestedBaseDelay)
        ? requestedBaseDelay
        : DEFAULT_BASE_DELAY_MS,
      HARD_MAX_DELAY_MS,
    ),
  );
  const requestedMaxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxDelayMs = Math.max(
    baseDelayMs,
    Math.min(
      Number.isFinite(requestedMaxDelay)
        ? requestedMaxDelay
        : DEFAULT_MAX_DELAY_MS,
      HARD_MAX_DELAY_MS,
    ),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal =
    init.signal ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.signal
      : undefined);
  const sleep =
    options.sleep ??
    ((delayMs: number) => sleepWithAbort(delayMs, signal));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(input, init);
      if (!isRetryableResponse(response) || attempt === maxAttempts) {
        return response;
      }
      const exponential = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1),
      );
      const delay = Math.min(
        maxDelayMs,
        retryAfterMs(response) ?? exponential,
      );
      await response.body?.cancel().catch(() => undefined);
      await sleep(delay);
      if (signal?.aborted) throw abortError(signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await sleep(
        Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)),
      );
      if (signal?.aborted) throw abortError(signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gallery request failed.");
}

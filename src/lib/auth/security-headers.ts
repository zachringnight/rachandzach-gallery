/**
 * Security headers (packet 04). Single source of truth consumed by both
 * proxy.ts (applied to every proxied response, including auth redirects and
 * 401s) and next.config.ts (applied by the server to every route, covering
 * the static assets the proxy matcher skips).
 *
 * This module must stay dependency-free and framework-free: next.config.ts
 * imports it at config-bundle time.
 */

/** Supabase project host pattern for signed storage URLs, auth, and TUS uploads. */
const SUPABASE_HOSTS = "https://*.supabase.co";

export interface SecurityHeaderOptions {
  /**
   * Development mode relaxes CSP for the dev toolchain (eval, websockets for
   * HMR). Defaults to NODE_ENV !== "production" so production builds get the
   * strict policy automatically.
   */
  dev?: boolean;
}

export function contentSecurityPolicy(
  options?: SecurityHeaderOptions,
): string {
  const dev = options?.dev ?? process.env.NODE_ENV !== "production";
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])];
  const connectSrc = ["'self'", SUPABASE_HOSTS, ...(dev ? ["ws:", "wss:"] : [])];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `img-src 'self' data: blob: ${SUPABASE_HOSTS}`,
    `media-src 'self' blob: ${SUPABASE_HOSTS}`,
    "font-src 'self' data:",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
  ];
  return directives.join("; ");
}

export function securityHeaders(
  options?: SecurityHeaderOptions,
): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** The same set shaped for next.config.ts `headers()`. */
export function securityHeaderEntries(
  options?: SecurityHeaderOptions,
): Array<{ key: string; value: string }> {
  return Object.entries(securityHeaders(options)).map(([key, value]) => ({
    key,
    value,
  }));
}

/** Applies the header set to a Response (NextResponse included) in place. */
export function applySecurityHeaders<T extends Response>(
  response: T,
  options?: SecurityHeaderOptions,
): T {
  for (const [key, value] of Object.entries(securityHeaders(options))) {
    response.headers.set(key, value);
  }
  return response;
}

# Task 04: Guest and admin access layer

**Wave:** 2
**Depends on:** 03

## Objective

Replace fallback credentials with a fail-closed guest session and separate admin authentication. Protect gallery, upload, download, search, and moderation endpoints before those features are built.

## Files

- Replace: src/lib/session.ts
- Create: src/lib/auth/guest-session.ts
- Create: src/lib/auth/admin-session.ts
- Create: src/lib/auth/rate-limit.ts
- Create: src/app/api/access/login/route.ts
- Create: src/app/api/access/logout/route.ts
- Create: src/app/auth/callback/route.ts
- Create: src/app/(access)/enter/page.tsx
- Create: src/app/(access)/enter/AccessForm.tsx
- Create: proxy.ts
- Remove after cutover: middleware.ts
- Modify: next.config.ts
- Test: tests/auth/guest-session.test.ts
- Test: tests/auth/route-protection.test.ts
- Remove after cutover: src/app/api/login/route.ts
- Remove after cutover: src/app/api/logout/route.ts

## Interfaces

- Consumes: createServerClient() and createAdminClient() from task 03.
- Consumes: consume_rate_limit(key_hash, action, attempt_limit, window_seconds) -> boolean from task 03.
- Produces: GallerySession
  - sessionId: string
  - issuedAt: number
  - expiresAt: number
  - version: 1
- Produces: createGuestSession() -> Promise<string>
- Produces: verifyGuestSession(token: string | undefined) -> Promise<GallerySession | null>
- Produces: requireGalleryAccess() -> Promise<GallerySession>
- Produces: requireAdmin() -> Promise<{ userId: string; email: "wedding@rachandzach.com" }>
- Produces: hashRateLimitKey(ip: string, action: string) -> Promise<string>
- Produces redirect convention: next=/relative/path only. Reject absolute and protocol-relative URLs.
- Produces: PUBLIC_ROUTES allowlist exported from src/lib/auth/guest-session.ts, consumed by proxy.ts and route tests. Default deny: any route not listed requires a guest session.

## Security decisions

- Required production variables: GALLERY_PASSWORD_HASH and GALLERY_SESSION_SECRET.
- GALLERY_SESSION_SECRET must be at least 32 random bytes.
- Store only an Argon2id password hash. Never store or log the plain password.
- Guest cookie: rz_gallery_session, HttpOnly, Secure in production, SameSite=Lax, Path=/, 30-day expiry.
- A valid guest cookie never grants admin access.
- Admin authentication uses Supabase magic links and an exact lowercase email allowlist containing only wedding@rachandzach.com.
- Login limit: 5 failed attempts per 15 minutes per hashed IP, plus a small global safety limit.
- Access responses must not reveal whether the configured password or admin account exists.

## Steps

- [ ] Write tests for expired, tampered, wrong-version, missing-secret, and valid guest tokens.
- [ ] Write route tests proving public routes remain open, guest routes redirect to /enter, admin routes require the allowed Supabase user, and an unlisted route defaults to protected.
- [ ] Confirm tests fail against the current fallback implementation.
- [ ] Implement signed, versioned guest sessions using Web Crypto compatible primitives.
- [ ] Implement Argon2id verification in the Node login route. Set runtime explicitly if required.
- [ ] Call consume_rate_limit before password verification. Hash network identifiers with a dedicated secret before storage.
- [ ] Implement Supabase magic-link callback with allowlist enforcement and safe next handling.
- [ ] Enforce default-deny in proxy.ts: only /, /weekend, /playlists, /marathon, /enter, /api/access, /auth/callback, /robots.txt, /sitemap.xml, and Next static plus public brand assets skip the guest session check. Everything else, including /photos, /my-weekend, /add-yours, /favorites, /submissions, /api/gallery, /api/search, /api/uploads, and /api/downloads, requires a valid guest session. A new route is protected until it is added to the public list.
- [ ] Protect /admin and /api/admin with requireAdmin.
- [ ] Delete all fallback secrets and default passwords.
- [ ] Add security headers. Include frame-ancestors, nosniff, strict referrer policy, and a tested Content Security Policy.
- [ ] Report status. Do not configure production secrets or send magic links.

## Done-check

Run: npm run test -- tests/auth/guest-session.test.ts tests/auth/route-protection.test.ts && npm run typecheck

Expected: all auth tests pass. next build succeeds without credentials; missing credentials fail closed at RUNTIME (server start or the first auth code path) with a clear configuration error, never a silent fallback. No literal 071925 or 071925-local-dev remains under src, proxy.ts, or middleware.ts.

## Report

Report DONE unless a platform constraint weakens fail-closed behavior. Any such weakening is BLOCKED.

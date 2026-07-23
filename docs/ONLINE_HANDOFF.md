# Rach & Zach gallery: online handoff

Updated July 23, 2026.

## Live surfaces

- Production: <https://rachandzach.com>
- GitHub: <https://github.com/zachringnight/rachandzach-gallery>
- Vercel project: `rachandzach-gallery`
- Default branch: `main`
- Continuation branch: `codex/wedding-premium-overhaul`

The current Vercel production deployment is ready and serves the apex domain.
GoDaddy's authoritative records are also set for `www`:

- `@` A -> `76.76.21.21`
- `www` CNAME -> `cname.vercel-dns.com`

Some public DNS resolvers may temporarily return the prior Wix `www` record
until its one-hour TTL expires. The apex domain is already serving from
Vercel.

## What is online

- Premium cream, wheat, sand, coral, and ink visual system
- Responsive home and weekend story experiences
- Password-gated 1,721-photo gallery
- Event, person, orientation, and source filters
- Weekend/newest sorting and event scrubber
- Natural-language Moment Search
- Favorites, lightbox permalinks, downloads, batch selection, and ZIP export
- Guest-person vanity routes such as `/{personSlug}`
- Guest upload and moderation flows
- My Weekend, slideshow, and TV views
- Public Rachel Runs NYC fundraiser page at `/nyc`

## Production services

- Vercel owns the Next.js production deployment and GitHub integration.
- Supabase provides the private database and storage catalog.
- Production and Preview environment variables are configured in Vercel.
- Secrets remain outside Git and must never be copied into this repository.
- Resend-powered outbound email remains intentionally disabled.

## Continue online

Work from `main` for the deployed baseline or from
`codex/wedding-premium-overhaul` for continued review:

```bash
git clone https://github.com/zachringnight/rachandzach-gallery.git
cd rachandzach-gallery
git switch codex/wedding-premium-overhaul
npm install
npm run dev
```

Create `.env.local` from `.env.example` when local private-gallery access is
needed. The production Vercel environment is already configured.

## Latest verification

- TypeScript: passed
- ESLint: 0 errors; 13 non-blocking warnings
- Unit/component suite: 841 passed before the final Moment Search regression
  test, plus that focused regression test passing independently
- Production build: passed
- Catalog reconciliation: 1,721 / 1,721
- Sampled local and remote originals: 100 / 100 SHA-256 matches
- Live apex domain: HTTP 200 from Vercel

Manual design QA was stopped at Zach's request once the source, deployment,
and continuation branch were online.

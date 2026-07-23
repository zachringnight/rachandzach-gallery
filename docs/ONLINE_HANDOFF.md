# Rach & Zach gallery: online handoff

Updated 2026-07-23.

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

This exact continuation branch is explicitly allowed through both GitHub
Actions and Vercel's preview-build guard. Other `codex/*` branches remain
excluded unless they are intentionally added to those allowlists.

Create `.env.local` from `.env.example` when local private-gallery access is
needed. The production Vercel environment is already configured.

## Latest verification

The launch verification passed across TypeScript, ESLint, unit/component
tests, the production build, catalog reconciliation, sampled-original
integrity, and the live Vercel apex-domain check. Exact warning and test totals
are intentionally not repeated here because they change as the suite grows.
Use these commands for the current checkout:

```bash
npm run typecheck
npm run lint
npm run test
npm run verify:build
npm run verify:catalog
npm run verify:originals
```

Manual design QA was stopped at Zach's request once the source, deployment,
and continuation branch were online.

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

The continuation branch named above is an explicit exception in both GitHub
Actions and Vercel's preview-build guard, so pushes produce CI and a protected
preview. Other `codex/*` branches remain excluded unless they are intentionally
added to those allowlists.

Create `.env.local` from `.env.example` when local private-gallery access is
needed. The production Vercel environment is already configured.

## Latest verification

The launch verification passed across TypeScript, ESLint, unit/component
tests, the production build, catalog reconciliation, sampled-original
integrity, and the live Vercel apex-domain check. Exact warning and test totals
are intentionally not repeated here because they change as the suite grows.

### Source and application checks

These commands work in any checkout and do not require the protected wedding
master:

```bash
npm run typecheck
npm run lint
npm run test
npm run verify:build
gh pr checks 1
curl --fail --silent --show-error --location \
  --output /dev/null --write-out '%{http_code}\n' https://rachandzach.com
```

`gh pr checks 1` is the reproducible online check for both GitHub Actions and
the Vercel preview. The domain command must print `200`.

### Local media integrity checks

The media commands require the protected clean-master photo directory and are
local-only by design. A fresh cloud clone does not contain those originals.
Set the path explicitly before running them:

```bash
export SOURCE_PHOTO_DIR="/absolute/path/to/Rachel & Zach - Wedding Master Clean"
npm run verify:catalog
npm run verify:originals
```

`verify:catalog` accepts an optional loopback Supabase env file, and
`verify:originals` has an optional loopback metadata mode. Both scripts
intentionally refuse production/cloud Supabase credentials, so a skipped
database or remote section is not evidence that the live project was checked.

### Live Supabase catalog and storage check

The actual post-sync cloud verification is the saved read-only workflow at
`docs/plans/2026-07-22-0719-digital-wedding-home/workflows/wedding-home-post-sync-verify.js`.
Run it with a Supabase connector that has read access to project
`rnfvmqflktghriqefatc`, using:

- `catalogPath`: `src/generated/gallery-v2.json`
- `projectId`: `rnfvmqflktghriqefatc`
- `shards`: `6`
- `sampleSize`: `40`

The workflow deterministically divides the catalog into non-overlapping
samples, then performs read-only queries against `rachandzach_photos`,
`rachandzach_photo_previews`, and `storage.objects`. It compares database
hashes, object paths, and byte counts without downloading media or writing to
Supabase. A passing rerun reports zero `mismatches` and zero `missingRemote`
objects. The launch run sampled 241 photos across the six shards and was clean.

Manual design QA was stopped at Zach's request once the source, deployment,
and continuation branch were online.

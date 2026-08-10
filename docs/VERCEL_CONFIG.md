# vercel.json, and why its reasoning lives here

`vercel.json` is validated against https://openapi.vercel.sh/vercel.json, and
that schema sets `"additionalProperties": false` at the top level. **Any key
the schema does not define is a hard deployment failure**, including the
`"//comment"` convention that works in many other JSON config formats.

This is not theoretical. A `"//regions"` key was added alongside the `regions`
setting in commit `f5731e9` to explain the choice. It broke every deployment
from that commit onward with:

```
The `vercel.json` schema validation failed with the following message:
should NOT have additional property `//regions`
```

Four deployments failed that way before anyone noticed, three of them
production, because a failed deployment leaves the previous build serving and
the site does not visibly break. Production sat on the build from `2ed16876`
while three commits' worth of work looked merged but was never live.

So: **do not put comments in `vercel.json`.** Put them here, next to the
setting they explain. If that ever becomes too awkward, the real fix is to
migrate to `vercel.ts` (`@vercel/config`), which is a TypeScript module and
takes ordinary comments.

## Settings

### `regions: ["sfo1"]`

Run functions next to the database. Supabase is in us-west-2; with no region
set, functions default to `iad1` on the US east coast, so every catalog read
and every preview-signing call crossed the continent (~60ms each way). Nearly
every route here is dynamic and blocks on several such round trips, so being
near Postgres beats being near the visitor. `sfo1` is the closest Vercel
region to us-west-2. East-coast guests trade a little HTML TTFB for a much
shorter server-side chain.

### The `/story/:path*` cache rule

The whole-site password gate once narrowed this rule to the two hero files the
sign-in page rendered. The gate was removed on 2026-08-09, so all seven public
story derivatives now receive the same one-year immutable browser/CDN cache
policy. Their filenames are content-hashed or hand-versioned, so `immutable`
is honest and a changed image receives a new URL.

If a story derivative is ever re-exported its filename changes (it carries the
first 8 chars of the image hash), so existing cached files remain correct.

### Git deployment behavior

There is deliberately no `ignoreCommand`. Vercel's Git integration builds
every non-`main` branch as a Preview and builds `main` as Production. This
keeps pull-request checks honest: a green Vercel status represents a runnable
test artifact rather than an ignored/canceled deployment. The repository's
`verify:vercel` check fails if an `ignoreCommand` is reintroduced.

GitHub protects `main` with strict required checks for both `npm run verify`
and `Vercel`. A pull request therefore cannot merge until its full CI gate
passes, its exact head commit has a successful Vercel Preview, and the branch
is current with `main`. Keep those check names synchronized with GitHub Actions
and the Vercel integration if either provider is renamed.

## Before changing this file

```bash
node scripts/validate-vercel-json.mjs
```

That checks `vercel.json` against the live published schema and exits non-zero
on any violation, which is the check that would have caught `//regions` at
commit time instead of four deployments later.

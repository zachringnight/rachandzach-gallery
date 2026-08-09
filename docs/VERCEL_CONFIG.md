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

### The two `/story/hero-sunset-*` cache rules

This was a single `/story/:path*` rule, back when every story derivative was
public. The whole-site password gate (2026-07-30) moved four of the six behind
the guest session, and `public` on a gated path is a real leak, so the rule was
narrowed to the two hero files the sign-in page rendered.

Removing the password gate (2026-08-09) makes all six public again, so the
narrowing is no longer load-bearing -- it is now just a cache policy that
covers two of six files. Widening it back to `/story/:path*` is safe and would
be a small win; left alone here because it is a performance change, not part of
opening the site. Both named files are content-hashed or hand-versioned, so
`immutable` is still honest.

If a story derivative is ever re-exported its filename changes (it carries the
first 8 chars of the image hash) and this rule must change with it. The
allowlist that used to share that coupling is gone.

### `ignoreCommand`

`scripts/vercel-ignore-build.mjs` decides whether a commit needs a build at
all. Note that it runs *after* schema validation, so it cannot rescue a
malformed `vercel.json`.

## Before changing this file

```bash
node scripts/validate-vercel-json.mjs
```

That checks `vercel.json` against the live published schema and exits non-zero
on any violation, which is the check that would have caught `//regions` at
commit time instead of four deployments later.

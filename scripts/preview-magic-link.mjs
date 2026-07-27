// Mints a one-shot Supabase magic-link sign-in URL for a deployment, so an
// admin can reach a gated route (e.g. /admin/faces) on a Vercel preview that
// has no mail delivery wired up. Env comes from .env.local via @next/env and
// is never printed; only the resulting sign-in URL goes to stdout. Usage:
//   node scripts/preview-magic-link.mjs <deployment-url> [next-path] [email]
//   node scripts/preview-magic-link.mjs https://foo.vercel.app /admin/faces
// The URL is single-use and short-lived. It grants admin access to whatever
// deployment you point it at, so treat the output as a credential: do not
// paste it into shared channels or commit it.
import pkg from "@next/env";

const { loadEnvConfig } = pkg;
loadEnvConfig(process.cwd(), false);

const [deployment, nextPath = "/admin/faces", email = "wedding@rachandzach.com"] =
  process.argv.slice(2);

if (!deployment) {
  console.error(
    "usage: node scripts/preview-magic-link.mjs <deployment-url> [next-path] [email]",
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (.env.local).",
  );
  process.exit(1);
}

const response = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ type: "magiclink", email }),
});

const body = await response.json();
// Newer Supabase returns the raw token under properties; older builds only
// expose it inside action_link's query string.
const hash =
  body.properties?.hashed_token ??
  (body.action_link
    ? new URL(body.action_link).searchParams.get("token")
    : null);

if (!hash) {
  console.error(
    `could not obtain token (HTTP ${response.status}):`,
    JSON.stringify(body).slice(0, 200),
  );
  process.exit(1);
}

const base = deployment.replace(/\/+$/, "");
console.log(
  `${base}/auth/callback?token_hash=${encodeURIComponent(hash)}` +
    `&next=${encodeURIComponent(nextPath)}`,
);

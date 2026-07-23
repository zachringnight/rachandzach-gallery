# 0719 + co. Launch Operations Brief v1

Scope: the remaining eyeball-list infrastructure, email sending (Resend) and hosting (Vercel), plus the full go-live sequence with approval gates.
Verified against live resend.com and vercel.com documentation on 2026-07-22. Nothing in this brief performs any action. Every gate below waits for Zach's explicit approval.

## Recommendation

1. **Email: Resend free tier, verify the root domain rachandzach.com, send as `0719 + co. <wedding@rachandzach.com>`.** Three DNS records (MX + SPF TXT on the `send` subdomain, DKIM TXT on `resend._domainkey`), none of which touch the domain's existing mail records. Optional fourth record: DMARC `p=none` if the domain has none today. Cost: $0. Expected volume is roughly 25 emails per week against a 3,000 per month, 100 per day free allowance.
2. **Hosting: Vercel Hobby, $0.** The site is personal and non-commercial, media never transits Vercel, and every measured Hobby allotment has 8x or better headroom. Preview protection: Vercel Authentication with Standard Protection, included free. Custom domain: included, apex A record plus www CNAME. The one upgrade trigger to watch: if ZIP export assembly ever needs more than 300 seconds in a single function, that forces Pro ($20 per month).
3. **Total new monthly cost for email and hosting at launch: $0.** The only expected paid line item in the whole launch is the dedicated Supabase project (Pro tier, roughly $25 per month, needed for storage volume; confirming that is already a separate eyeball-list item and is not re-verified in this brief).

## 1. Resend: sender domain for rachandzach.com

### Decision: verify the root domain, not a sending subdomain

Resend's own best practice is to send from a subdomain (for example `updates.rachandzach.com`) to isolate sending reputation. That guidance targets volume senders. We deviate deliberately:

- Volume is a handful of moderation notifications per week. There is no reputation to isolate.
- The From address guests and Zach see should be the human one, `wedding@rachandzach.com`. Verifying a subdomain would force the From to live on that subdomain (each subdomain is added and verified independently, and you can only send from the domain you verified).
- Verifying the root in Resend does not touch the root's own mail records. Resend's SPF and return-path records live on the `send.` subdomain and its DKIM record lives on `resend._domainkey.`, so an existing Google Workspace (or any) MX and SPF setup on the bare domain keeps working untouched.
- DMARC alignment works cleanly: DKIM signs with d=rachandzach.com, which aligns with the From domain directly.

### Exact DNS records Resend will ask for

Values come from the Resend dashboard after adding the domain (region affects the MX value, default region is us-east-1). The shape, per Resend's docs:

| # | Type | Host (name) | Value | Required |
|---|------|-------------|-------|----------|
| 1 | MX | `send.rachandzach.com` | `feedback-smtp.us-east-1.amazonses.com`, priority 10 | Yes (bounce and complaint feedback, return path) |
| 2 | TXT (SPF) | `send.rachandzach.com` | `"v=spf1 include:amazonses.com ~all"` | Yes |
| 3 | TXT (DKIM) | `resend._domainkey.rachandzach.com` | `p=<public key from dashboard>` | Yes |
| 4 | TXT (DMARC) | `_dmarc.rachandzach.com` | `v=DMARC1; p=none; rua=mailto:wedding@rachandzach.com;` | Optional, not needed for verification |

Operational notes:

- At most DNS hosts you enter only the subdomain part in the name field (`send`, `resend._domainkey`, `_dmarc`), not the full hostname.
- If DNS is on Cloudflare, the DKIM record must be DNS-only (proxy off).
- Verification typically completes within about 15 minutes of correct records; Resend marks the domain failed if records are not detected within 72 hours (just re-verify after fixing).
- Resend signs with 1024-bit DKIM keys (RFC-compliant, accepted by major providers). No action needed, just do not be surprised by the key length.
- DMARC guidance: start at `p=none` (monitor only), consider `quarantine` later. If rachandzach.com already publishes a DMARC record, leave it alone.

### Volume vs free tier

| Metric | Expected | Resend free tier | Headroom |
|--------|----------|------------------|----------|
| Emails per month | ~110 (new-batch admin alerts plus decision emails, under 25 per week) | 3,000 | ~27x |
| Emails per day (worst burst) | Wedding-weekend upload surge; notifications are per batch, not per photo, so realistically under 30 | 100 | 3x+ |
| Custom domains | 1 (rachandzach.com) | 1 | Exact fit |

The paid Pro tier ($20 per month, 50,000 emails, no daily cap, 10 domains) exists as an upgrade path but nothing in this product ever approaches free-tier limits. Free tier data retention is listed at 30 days on the current pricing page, which comfortably covers the notification_log reconciliation window.

### From-address recommendation

- From: `0719 + co. <wedding@rachandzach.com>` for both admin notifications and guest decision emails.
- Reply-To: same address. It must be a real, receiving mailbox anyway because admin magic links land there.
- Do not create a `noreply@` address. At this scale a replyable human address is warmer and matches the site voice.

## 2. Vercel: Hobby vs Pro

### Decision: Hobby

The architecture makes this easy: originals and display derivatives are served from private Supabase Storage through short-lived signed URLs, so photo bytes never transit Vercel. Vercel carries only the application shell, API routes that mint signed URLs, and auth gating. Numbers:

| Resource | Hobby included (per month) | Expected load | Verdict |
|----------|---------------------------|---------------|---------|
| Fast Data Transfer | 100 GB | Shell only. ~300 guests x 20 visits x ~2 MB is ~12 GB | 8x headroom |
| Function invocations | 1,000,000 | Page renders plus access, signed URL, upload, and moderation APIs; well under 100k | 10x+ |
| Active CPU / Provisioned Memory | 4 CPU-hrs / 360 GB-hrs | Light API work, no image processing at runtime | Ample |
| Edge requests | 1,000,000 | Same traffic profile as invocations | Ample |
| Image transformations | 5,000 | Zero. We serve pre-built derivatives; set `images.unoptimized: true` in next.config so Next never routes through Vercel Image Optimization | Not used |
| Function max duration | 300s (Pro default is also 300s, configurable to 800s) | Only risk is ZIP export assembly (task 09) | See below |
| Deployments per day | 100 | Handful | Ample |
| Custom domains per project | 50 | 2 (apex plus www) | Ample |

Eligibility: Hobby is restricted to non-commercial personal use under Vercel's fair use guidelines. A private wedding site for family and friends is squarely inside that.

The single Pro trigger: ZIP exports. If assembling a large favorites export into the download-exports bucket runs inside one request-scoped function and exceeds 300 seconds, Hobby kills it. Mitigation is architectural, not billable: chunk the assembly, or build exports incrementally and notify when the signed URL is ready. Only if that proves impossible does Pro ($20 per month per seat, duration configurable to 800s) enter the picture.

### Preview deployment protection

- Hobby includes **Vercel Authentication with Standard Protection**: every preview URL and generated deployment URL requires logging in to Vercel with an account that has project access (that is Zach, the sole member). Production domains stay publicly reachable.
- That is the correct posture here. Production being "public" only exposes the login screen and the intentionally public pages; the app's own guest-session gate (proxy.ts, fails closed) protects all gallery content.
- Password Protection and protecting production URLs at the platform layer require Pro plus the Advanced Deployment Protection add-on at $150 per month. Not needed, not recommended.
- Note for the QA agent: with Standard Protection on, fetches against `VERCEL_URL` from client code break; use relative paths (already Vercel's documented guidance).

### Custom domain connection

- Free on all plans. Add `rachandzach.com` in Project Settings, Domains; Vercel will prompt to also add `www` and redirect it.
- Apex `rachandzach.com`: A record pointing at the IP shown in the project's Domain Settings. Vercel now assigns from an optimized pool (commonly 216.198.79.1); the legacy 76.76.21.21 keeps working but Vercel recommends the newly shown value. Use whatever the dashboard displays for this project.
- `www.rachandzach.com`: CNAME to the per-project value the dashboard shows (format like `<hash>.vercel-dns-017.com`; legacy `cname.vercel-dns.com` also still works).
- SSL certificates are issued automatically once DNS resolves. Nameserver delegation to Vercel is only required for wildcard domains, which we do not need, so the domain's DNS can stay at its current host.

## 3. Go-live sequence

Preconditions before any gate (all local, no approval needed): all six waves complete, `npm run verify` green, `npm run verify:originals` reproduces source hashes locally, launch definition in the plan manifest met.

Ordering note: Gate 2 creates the Vercel project with placeholder or preview-only env values. The real Supabase keys arrive at Gate 3 and the Resend key at Gate 4. Production env vars must be complete, and a preview deployment approved by Zach, before Gate 5 points the domain at it. Credentials are entered by Zach directly in each dashboard; they never pass through chat, prompts, or committed files.

**Gate 1: git init plus private remote. APPROVAL REQUIRED.**
- What happens: `git init` in the repo (it is intentionally not a git repo today), a reviewed .gitignore (env files, local artifacts, nothing from the read-only master), one initial commit, push to a new private GitHub repository under Zach's account.
- Cost: $0 (GitHub private repo, single collaborator).
- Rollback: delete the remote repository; the local tree is unchanged by rollback. Nothing else depends on this yet.

**Gate 2: Vercel project plus env vars. APPROVAL REQUIRED.**
- What happens: create the Vercel project (Hobby team) from the GitHub repo, framework Next.js, enable Vercel Authentication with Standard Protection, add env var names per `.env.example` (values completed after Gates 3 and 4), confirm `images.unoptimized` is in effect, keep the ignored-build-step rule from task 12 so only main and staging build. Preview deploys begin; no domain is attached.
- Cost: $0 on Hobby.
- Rollback: delete the Vercel project. The GitHub repo and everything local are unaffected.

**Gate 3: Supabase production project, migrations, media sync. APPROVAL REQUIRED.**
- What happens: create the dedicated Supabase project (region confirmed with Zach), apply `supabase/migrations`, create the five private buckets (wedding-originals, wedding-previews, guest-pending, guest-approved, download-exports), run the catalog sync then the storage sync from the read-only master (1,721 primary JPEGs as of the July 22 reference; re-verify the snapshot count first), then run integrity verification against storage (`info()` size plus fileSha256 metadata, no downloads needed). Enter the Supabase URL and keys into Vercel env.
- Cost: expected Supabase Pro, roughly $25 per month (free tier's 1 GB storage cannot hold the originals). Confirm exact plan, storage, and egress pricing at creation time; that confirmation is its own eyeball-list item.
- Rollback: pause or delete the Supabase project. The source master is read-only and untouched, so a full re-sync is always possible. Cancelling Pro stops the subscription.

**Gate 4: Resend domain. APPROVAL REQUIRED.**
- What happens: create the Resend account/team if needed, add rachandzach.com, add the three DNS records from section 1 at the current DNS host (plus optional DMARC), wait for verification (usually minutes), send one test email to wedding@rachandzach.com only, enter RESEND_API_KEY into Vercel env. Per the plan constraints, no email to anyone but Zach's own addresses before launch approval, and all outbound email templates are on the eyeball list for separate approval.
- Cost: $0 on the free tier.
- Rollback: delete the domain in Resend and remove the three added DNS records. Because they live on `send.` and `resend._domainkey.`, removal cannot affect the domain's existing mail flow.

**Gate 5: DNS cutover. APPROVAL REQUIRED.**
- What happens: Zach reviews the final preview deployment (protected, Vercel login). On approval: 24 to 48 hours ahead, lower TTL on the current apex and www records to 300 seconds and record their existing values in this doc's companion checklist. At the agreed window, add the domain in Vercel, set the apex A record to the dashboard-shown IP and the www CNAME to the per-project value. Vercel verifies, issues SSL, and production is live. Confirm the guest gate fails closed, an original download matches its source hash, and admin magic-link email arrives.
- Cost: $0.
- Rollback: restore the recorded previous A and www records. With the lowered TTL, propagation back is minutes. Detaching the domain from the Vercel project completes the reversal; previews and all data remain intact.

## Open questions for Zach

1. Who hosts DNS for rachandzach.com today (registrar, Cloudflare, other), and do I get read access to confirm current records before Gate 4?
2. Is anything live at rachandzach.com right now that must stay up until cutover?
3. Does the wedding@rachandzach.com mailbox exist and receive mail today (magic links depend on it)?
4. Resend region: default us-east-1 fine?
5. Confirm the site stays strictly personal and non-commercial (no vendor promos), which is what keeps Vercel Hobby legitimate: yes or no?
6. GitHub destination for the private remote: your personal account, or an org?
7. Supabase region preference (us-west-1 for Pacific guests?) and is ~$25 per month approved in principle?
8. At launch, do decision emails go to guests who uploaded, or admin-only until you have watched a few cycles?
9. Add the DMARC `p=none` record now, or leave the domain's mail policy untouched?
10. Preferred cutover window (suggest a weekday morning PT so the day is available for rollback)?

## Sources

- Resend, managing domains (DNS requirements, subdomain guidance, DKIM key size, 72-hour window, `send` return path): https://resend.com/docs/dashboard/domains/introduction
- Resend, Cloudflare record walkthrough (exact record shapes: MX/TXT on `send`, TXT on `resend._domainkey`, proxy off for DKIM): https://resend.com/docs/knowledge-base/cloudflare
- Resend, domain not verifying (verification timing, trailing-dot MX gotcha): https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying
- Resend, DMARC guidance (`p=none` first, rua reporting): https://resend.com/docs/dashboard/domains/dmarc
- Resend, pricing (free: 3,000 per month, 100 per day, 1 domain; Pro $20): https://resend.com/pricing
- Vercel, Hobby plan (included usage, 300s duration, deployment protection column, non-commercial restriction): https://vercel.com/docs/plans/hobby
- Vercel, deployment protection (Standard Protection free on Hobby, Password Protection as $150 per month Pro add-on, VERCEL_URL migration note): https://vercel.com/docs/deployment-protection
- Vercel, adding a custom domain (apex A record, per-project CNAME, nameservers only for wildcard, 50 domains on Hobby): https://vercel.com/docs/domains/working-with-domains/add-a-domain
- Vercel, A record knowledge base (216.198.79.1 and legacy 76.76.21.21 both valid, dashboard value recommended): https://vercel.com/kb/guide/a-record-and-caa-with-vercel
- Vercel, pricing reference (function, image, and analytics allotments): https://vercel.com/docs/pricing
- Vercel, CDN pricing and usage (Fast Data Transfer definition): https://vercel.com/docs/manage-cdn-usage
- Vercel, fair use guidelines (Hobby non-commercial): https://vercel.com/docs/limits/fair-use-guidelines

# 0719 + co. Supabase Decision Brief v1

Prepared 2026-07-22 for the end-review eyeball item: "Confirm the dedicated Supabase project, costs, region, bucket retention, and backup policy." All prices verified 2026-07-22 against supabase.com/pricing and current Supabase docs. Nothing in this brief creates any cloud resource; it is the approval document only.

## Recommendation

Create one NEW dedicated Supabase project on the **Pro plan ($25/mo)** in **us-west-1 (North California)**, spend cap **off**, PITR **skipped**, daily backups (included) plus a **local mirror job for guest-upload buckets** as the real archive policy, and the 30-day rejected-uploads queue implemented **in-app** (Supabase has no native bucket lifecycle rules). Expected cost: $25 in a quiet month, roughly $25-45 in launch month, about $315-375 for year one. The open question for Zach is org placement and billing card (Section 5).

## 1. Plan tier: Pro, and Free is disqualified three times over

The build needs roughly 15-17 GB of storage at import (11.6 GiB originals which is about 12.5 GB decimal, plus 2-4 GiB display derivatives) and headroom of about 10 GB for guest uploads across guest-pending, guest-approved, and the rejected queue. Call it a 27 GB ceiling.

| Limit (verified 2026-07-22) | Free | Pro ($25/mo) | This build needs |
|---|---|---|---|
| Storage included | 1 GB | 100 GB, then $0.021/GB | ~15-27 GB |
| Egress included | 5 GB | 250 GB uncached + 250 GB cached, then $0.09/GB uncached, $0.03/GB cached | 2 GB quiet, up to ~430 GB launch worst case |
| Max file upload | 50 MB | 500 GB (global cap, configurable lower per bucket) | 50 MB guest cap fits either; keep the bucket-level cap at 50 MB |
| Database | 500 MB | 8 GB included | tens of MB (1,721-row catalog plus joins) |
| Project pausing | Paused after 1 week of inactivity | Never paused | Quiet months are certain; pausing is fatal |
| Backups | None | Daily, 7-day retention | Required |
| Compute | Shared | $10/mo credit covers one Micro instance | Micro is plenty; media bytes bypass compute via Storage CDN |

Free plan disqualifiers, any one of which is fatal: 1 GB storage against a 15+ GB need, auto-pause after a week of inactivity on what is supposed to be a permanent memory archive, and no backups.

What happens at overage:
- Free: no charges ever, but service is restricted or the project is effectively cut off when limits are exceeded. Not acceptable.
- Pro with spend cap ON (the default): "further usage of that item is disallowed until the next billing cycle." Concretely, guest downloads and gallery previews would start failing mid-launch if egress crosses 250 GB. That failure mode is worse than the money.
- Pro with spend cap OFF: pay per GB past quota. Worst-case launch overage is about $16-70 (Section 2).

Decision: **Pro, spend cap off from day one.** The maximum realistic downside is tens of dollars; the downside of cap-on is guests hitting broken downloads during the two weeks that matter most.

## 2. Monthly cost model

Working numbers: 1,721 originals totaling 11.6 GiB, average original 7.2 MB, full-archive download 12.5 GB, average fetched preview ~0.25 MB (960w AVIF/WebP), full-gallery browse ~0.43 GB.

The multiplier that matters: Supabase's CDN keys its cache on the full signed URL including the token. A fresh signed URL for the same object is always a cache miss, at the CDN and in the guest's browser. The current architecture signs preview URLs for 60 minutes, so every new browsing hour re-fetches every preview as uncached egress. That makes preview egress scale with guest browsing hours (~0.1 GB per guest per hour) instead of with unique photos viewed, roughly an 8-10x multiplier.

Mitigation (recommended, cheap): sign preview URLs for 24 hours or longer and memoize them server-side keyed by object path, re-signing only near expiry. The object's cache-control (public, max-age=31536000, immutable) governs edge caching per token, so a stable URL means repeat views hit the browser cache (zero egress) and cross-guest views hit the CDN (cached egress, separate 250 GB quota, $0.03/GB overage). Original downloads stay at short 10-minute TTLs; they are one-shot per guest anyway. Security cost of the longer preview TTL is minor: previews are display derivatives behind the shared password, and a leaked URL dies within a day.

| Scenario | Assumptions | Uncached egress | Over 250 GB quota | Overage | Month total |
|---|---|---|---|---|---|
| Quiet month | ~15 sessions, light browsing, ~40 original downloads | ~2 GB | 0 | $0 | **$25** |
| Launch month, mitigated (24h preview TTL) | 100 guests browse the full gallery once (~43 GB), repeats cached; 10 full-archive downloads (125 GB) + 40 personal sets of ~100 originals (29 GB) | ~200 GB | 0 | $0 | **$25** |
| Launch month, worst case (hourly cache-busting kept) | 100 guests x 8 browsing hours x ~0.1 GB/hr (80 GB); 25 full-archive (312 GB) + 50 personal sets (36 GB) | ~430 GB | ~180 GB | ~$16 | **~$41** |
| Extreme ceiling | 1 TB total egress in one month | 1,000 GB | 750 GB | ~$68 | **~$93** |

Rates used (2026-07-22): Pro base $25/mo, storage $0.021/GB over 100 GB (not reached), uncached egress $0.09/GB over 250 GB, cached egress $0.03/GB over 250 GB. Ingress (guest uploads) is not billed.

Steady state: **$25/mo, $300/yr**, plus a one-time launch-month overage of $0-70 depending on whether the preview TTL mitigation lands. Year-one estimate: **$315-375** including PITR skipped and no compute add-ons.

## 3. Region: us-west-1 (North California)

- Guest center of mass is the US West Coast: the wedding was Santa Barbara and the couple is US-based, Pacific time. us-west-1 is the closest Supabase region to that population.
- The traffic that actually feels region latency is exactly the traffic this build generates: first-fetch preview misses (every signed URL's first request is a CDN miss by design) and original downloads. Cached repeats are served from the guest's nearest CDN edge regardless of region, so East Coast guests are fine.
- Pin the Vercel function region to sfo1 to match, since every page view triggers a server round trip to Postgres to issue signed URLs.
- Region is fixed at project creation. Moving later means standing up a new project and migrating, so this choice should be made now. Alternatives considered: us-west-2 (Oregon) is nearly as good; us-east-1 has no advantage for this audience.

## 4. Backup and retention posture

The single most important fact, quoted from Supabase's backup docs (verified 2026-07-22): "Database backups do not include objects you store via the Storage API." A Supabase backup restores the catalog rows, never the photos. Plan accordingly:

- **Daily database backups, 7-day retention: included in Pro, enable nothing, it is automatic.** Covers the catalog, favorites, identity corrections, moderation history, and notification log. Worst case loses one day of guest activity metadata. Acceptable at this scale.
- **PITR: skip.** $100/mo for 7-day point-in-time recovery would quadruple the bill to protect a database that is largely re-materializable from the local manifest via the import scripts. PITR also does nothing for photos, which are the only irreplaceable asset.
- **Originals archive of record stays local.** The read-only Wedding Master Clean folder (plus whatever offline copy Zach already maintains) is the durable archive for the 1,721 originals. The cloud copy is re-creatable any time via the packet 13 sync scripts, which verify file_sha256 byte-for-byte.
- **Guest uploads are the one cloud-only irreplaceable asset.** Once guests submit photos, those bytes exist only in Supabase Storage and no Supabase backup covers them. Required posture: a periodic local mirror job (weekly is fine, more often around launch) that pulls guest-pending and guest-approved down into the local archive, plus a monthly pg_dump of the database to the same place. This is a small read-only script and belongs in the packet 12 ops runbook.
- **30-day rejected-uploads queue: implement in-app, not in Supabase.** Supabase Storage has no native bucket lifecycle or TTL rules as of 2026-07-22 (still an open feature request). The queue is: moderation sets rejected_at, a scheduled job (pg_cron in the same project) deletes storage objects whose rejected_at is older than 30 days, scoped strictly to the rejected prefix in guest-pending. Nothing ever auto-deletes from wedding-originals, wedding-previews, or guest-approved.

## 5. Isolation, naming, and the one open question

- **New dedicated project, no exceptions.** This project is never the Panini project or any other existing Supabase project. The packet 13 sync scripts already enforce an explicit --project-ref allowlist; that allowlist gets exactly this new project's ref and nothing else.
- **Recommended project name: `rachandzach-wedding-prod`.** Unambiguous in any project list next to client work, and leaves room for a `-dev` sibling if ever needed (not proposed now).
- **Recommended org placement: a personal org, not any client or Ring Night org.** This is a personal permanent archive with a personal card attached; it should never be entangled with client billing, client team members, or a client org's spend cap settings. Admin login inside the app is wedding@rachandzach.com via magic link, but the Supabase org owner should be Zach's own account.
- **Open question for Zach (the only blank in the approval block):** which Supabase organization should own it: an existing personal org if one exists, or a new org (suggested name: `0719 + co.`)? And which card goes on it?

## Numbers at a glance (all verified 2026-07-22)

| Item | Price |
|---|---|
| Pro plan base | $25/month (includes $10 compute credit, covers Micro) |
| Storage overage | $0.021/GB past 100 GB (not expected to trigger) |
| Uncached egress overage | $0.09/GB past 250 GB |
| Cached egress overage | $0.03/GB past 250 GB |
| Daily backups, 7-day retention | Included in Pro |
| PITR add-on | ~$100/month per 7 days retention (skipping) |
| Expected steady state | $25/month |
| Expected launch month | $25-45 (mitigated vs worst case), $93 extreme ceiling |
| Expected year one | $315-375 |

## Sources

- Supabase pricing (plans, quotas, overage rates, spend cap default, file size caps): https://supabase.com/pricing (accessed 2026-07-22)
- Storage file upload limits per plan: https://supabase.com/docs/guides/storage/uploads/file-limits (accessed 2026-07-22)
- Egress billing, cached vs uncached, unified quota: https://supabase.com/docs/guides/platform/manage-your-usage/egress (accessed 2026-07-22)
- Smart CDN cache keyed on signed-URL token, cacheControl vs token expiry: https://supabase.com/docs/guides/storage/cdn/smart-cdn (accessed 2026-07-22)
- Backups, PITR pricing, storage objects excluded from backups: https://supabase.com/docs/guides/platform/backups (accessed 2026-07-22)
- Spend cap behavior when quota is exceeded: https://supabase.com/docs/guides/platform/spend-cap (accessed 2026-07-22)
- Available regions: https://supabase.com/docs/guides/platform/regions (accessed 2026-07-22)
- Storage lifecycle policies not available, community workaround pattern: https://github.com/orgs/supabase/discussions/20171 (accessed 2026-07-22)

---

## Approval block

Reply "approved" to accept all of the below as written, or edit any line.

- **Plan:** Pro, $25/month, spend cap OFF
- **Project name:** rachandzach-wedding-prod
- **Region:** us-west-1 (North California), Vercel functions pinned to sfo1
- **Org placement:** ______ (existing personal org / new org `0719 + co.`) with card ______
- **Backups:** included daily backups only; PITR declined; weekly local mirror of guest-pending and guest-approved plus monthly pg_dump added to the ops runbook
- **Retention:** 30-day rejected-uploads queue implemented in-app via rejected_at plus pg_cron, scoped to the rejected prefix only; no auto-deletion anywhere else
- **Preview signed-URL TTL:** extend from 60 minutes to 24 hours with server-side URL memoization (cuts worst-case launch egress roughly 8-10x on previews)
- **Isolation:** new dedicated project only; its ref is the sole entry in the sync-script allowlist; never Panini or any existing project

Approving this block authorizes creating the Supabase project as specified. Nothing is created until Zach approves.

# Naming the unresolved face clusters

## Problem

Rebuilding signatures resolves 118 of 131 tagged people. What it cannot name
it leaves as **148 unresolved clusters**: recurring faces the model grouped
confidently but could not attach to anyone. The largest is 21 faces across 16
photographs. Fifty have four or more faces.

These are the people still missing from the gallery, and nothing surfaces
them for naming. The zero-tag review reaches only the narrow case of a photo
with faces and no tags at all, which is 13 clusters.

## Approach

Extend the existing local tagger rather than build anything new. It already
does the job for the narrow case: it renders each cluster's crops, opens the
full photograph with the face boxed, searches all 189 catalog identities,
compares a selected identity against its committed saved face, and exports
decisions for the validated importer. It is pointed at the wrong input, not
missing features.

Local only, matching the rest of this pipeline. Embeddings, cluster
membership and crops stay on this machine; nothing here reaches Supabase or
the deployed site. Naming a cluster produces the same reviewed tag with
recorded provenance that every other wave produced.

## What has to change

**1. Persist full cluster membership.** `build-face-signatures.py` writes
only three sample faces per unresolved cluster (`sorted(...)[:3]`). Naming a
21-face cluster would therefore tag 3 photos and silently drop 18. The
clustering already knows every member; it just is not written down. Add a
`members` array carrying every face, and keep `sampleFaces` so existing
readers are unaffected.

**2. Convert to the report shape the tagger reads.** A converter emits the
unresolved clusters in the same schema as `zero-tag-review.json` — the
`clusters` plus `photos` pair with per-face keys. This keeps the tagger's
loader untouched, which is the lower-risk half of the change.

**3. Widen the cluster id rule.** Zero-tag clusters are `z001`; signature
clusters are `c0116`. Three places hardcode `/^z\d{3}$/`: the tagger, the
importer, and the overlay validator. All three accept both forms.

## Ordering and cutoff

Clusters rank by face count, so the 21-face stranger leads and single
sightings fall to the bottom. No hard cutoff: ranking already puts the thin
clusters where they belong, and an arbitrary threshold would hide a
one-photo face that happens to be someone's grandmother.

## What does not change

The importer keeps its full validation — report fingerprint, cluster and
person existence, photo-path drift, same-person conflict. Decisions are still
recorded as their own review wave without inventing a model similarity score,
because a human made the call. The dry-run-then-`--write` flow is unchanged,
and the live sync stays a separate, explicit step.

## Testing

The importer's existing tests cover the decision format. New coverage for the
widened cluster id rule, and for the converter: that every member survives the
round trip, that a cluster's photo count matches its distinct photos, and that
a cluster referencing a missing detection fails closed rather than rendering a
blank crop.

## Risks

The tagger deliberately shows no similarity scores, so the reviewer judges
the face rather than the number. That stays. The larger risk is scale: 148
clusters is a long queue, and a tired reviewer approves things. Ranking by
face count means the highest-value decisions come while attention is fresh.

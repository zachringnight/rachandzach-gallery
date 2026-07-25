/**
 * Feature-flagged experience module contracts (packet 11).
 *
 * Pure, environment-free types, constants, and helpers shared by the
 * playlists/marathon pages, the Shuffle/Recently Added/Approved Memory Note
 * components, and the submission-receipt page. Nothing here imports
 * "server-only", next/headers, or a Supabase client at module scope, so this
 * file is safe to import from a Client Component (src/components/modules/
 * ShuffleWeekend.tsx and RecentlyApproved.tsx both do). This mirrors the
 * split already used by src/lib/uploads/contracts.ts, src/lib/downloads/
 * contracts.ts, and src/lib/search/contracts.ts: see search/contracts.ts's
 * doc comment for the real `next build` failure this pattern fixes. In
 * particular, loadSubmissionReceiptView takes getUploadStatus as an injected
 * dependency rather than importing it from "@/lib/uploads/create-batch",
 * because that module lazily reaches "@/lib/supabase/admin" (server-only);
 * even a dynamic import deferred inside a function body taints the whole
 * client module graph once any file it exports is imported by a Client
 * Component.
 *
 * Launch vs. future boundary (packet 11's own contract, not repeated by
 * every export below): Shuffle, Recently Added, and the submission receipt
 * are live at launch. Playlists and Marathon Support render real content the
 * day their flags flip on and Zach supplies PlaylistConfig/MarathonConfig
 * values (docs/0719_Content_Needed_v1.md tracks both as open items); until
 * then the content lists below stay empty and their routes return not found.
 * Anniversary Capsule and Approved Memory Notes are further out: their types
 * and rendering rules are ready, but no page currently mounts them.
 */
import {
  getGalleryPage,
  type GalleryDataSource,
  type GalleryPhotoView,
} from "@/lib/gallery/query";
import {
  UPLOAD_STATES,
  type PublicUploadStatus,
  type UploadState,
} from "@/lib/uploads/contracts";
import type { UploadBatchStatus } from "@/lib/moderation/state-machine";

// ---------------------------------------------------------------------------
// Playlists (enable when content arrives)
// ---------------------------------------------------------------------------

/** One Spotify-linked chapter, optionally paired to a weekend event. */
export interface PlaylistConfig {
  title: string;
  description: string;
  spotifyUrl: string;
  coverPhotoId: string | null;
  eventSlug: string | null;
}

/**
 * Populated once Zach supplies titles, descriptions, and Spotify URLs
 * (docs/0719_Content_Needed_v1.md, "Playlist details"). Empty is expected
 * pre-launch and must not block this packet's done-check: the playlists flag
 * stays off regardless of this list's contents, and /playlists returns not
 * found while it is off (src/app/(public)/playlists/page.tsx).
 */
export const PLAYLIST_CHAPTERS: readonly PlaylistConfig[] = [];

// ---------------------------------------------------------------------------
// Marathon Support (enable when content arrives)
// ---------------------------------------------------------------------------

/**
 * Rachel's story, charity, donation action, and an optional STATIC progress
 * figure. There is deliberately no "amount raised so far" field: the packet
 * forbids scraping donation totals, and goalAmount/displayProgress can only
 * ever render the explicit goal Zach supplies, never a live or implied
 * percent-complete number.
 */
export interface MarathonConfig {
  runnerName: string;
  raceName: string;
  story: string;
  donationUrl: string;
  charityName: string;
  goalAmount: number | null;
  displayProgress: boolean;
}

/**
 * Populated once Zach supplies the marathon story and donation URL
 * (docs/0719_Content_Needed_v1.md, "Marathon story and donation URL"). Null
 * is expected pre-launch; /marathon returns not found while the marathon
 * flag is off regardless of this value.
 */
export const MARATHON_CONFIG: MarathonConfig | null = null;

// ---------------------------------------------------------------------------
// Anniversary Capsule (future opt-in)
// ---------------------------------------------------------------------------

/** A timed editorial module for a future anniversary. */
export interface AnniversaryCapsuleConfig {
  /** ISO date/time the capsule may start showing. Null means never. */
  enabledAt: string | null;
  title: string;
  body: string;
  photoIds: string[];
}

/**
 * No content exists yet; this is a future opt-in feature (packet 11's launch
 * boundary), not part of the initial content backlog.
 */
export const ANNIVERSARY_CAPSULE: AnniversaryCapsuleConfig | null = null;

/**
 * Two independent gates, both required: the anniversaryCapsule flag AND an
 * explicit enabledAt in the past. Neither gate alone is enough, so flipping
 * the flag on early can never publish the capsule automatically ahead of its
 * date, and setting a past date in the config can never publish it while the
 * flag stays off.
 */
export function isAnniversaryCapsuleVisible(
  capsule: AnniversaryCapsuleConfig | null,
  flagEnabled: boolean,
  now: Date = new Date(),
): boolean {
  if (!flagEnabled || !capsule || !capsule.enabledAt) return false;
  const enabledAtMs = Date.parse(capsule.enabledAt);
  if (!Number.isFinite(enabledAtMs)) return false;
  return enabledAtMs <= now.getTime();
}

// ---------------------------------------------------------------------------
// Approved Memory Notes (future opt-in)
// ---------------------------------------------------------------------------

/** A short uploader caption, ready to render once memoryNotes is on. */
export interface ApprovedMemoryNoteConfig {
  photoId: string;
  noteText: string;
  /** Set only when the guest opted in by supplying a display name at upload. */
  contributorDisplayName: string | null;
}

/**
 * Inputs available (in principle) for one guest-upload batch's note. Notes
 * live on rachandzach_upload_batches.note (one per batch, not per photo);
 * this input asks the caller to already have resolved which single approved
 * photo from that batch the note should caption.
 *
 * The live moderation flow now persists noteApproved on the upload item and
 * copies approved note text/byline onto the published photo. This pure helper
 * remains useful to older module callers; the gallery DTO reads the catalog
 * caption directly and does not expose batch contact data.
 */
export interface MemoryNoteCandidateInput {
  batchStatus: UploadBatchStatus;
  note: string | null;
  displayName: string | null;
  /** The published photo this batch's approved item became, if any. */
  photoId: string | null;
  noteApproved: boolean;
}

/**
 * Pure eligibility rule: "short uploader context shown only when both the
 * photo and note are approved" (packet 11). A batch note is only ever
 * surfaced once its batch has a terminal-approved decision (approved or
 * partially_approved), the admin explicitly approved the note, and a
 * published photo exists to caption. Returns null otherwise -- including for
 * an empty/whitespace-only note, so an approved-but-blank note never renders
 * an empty caption.
 */
export function resolveApprovedMemoryNote(
  input: MemoryNoteCandidateInput,
): ApprovedMemoryNoteConfig | null {
  const batchTerminalApproved =
    input.batchStatus === "approved" || input.batchStatus === "partially_approved";
  if (!batchTerminalApproved) return null;
  if (!input.noteApproved) return null;
  if (!input.photoId) return null;
  const noteText = input.note?.trim();
  if (!noteText) return null;
  return {
    photoId: input.photoId,
    noteText,
    contributorDisplayName: input.displayName?.trim() || null,
  };
}

/** Whether the resolved note (or lack of one) should render, given the flag. */
export function isApprovedMemoryNoteVisible(
  note: ApprovedMemoryNoteConfig | null,
  flagEnabled: boolean,
): boolean {
  return flagEnabled && note !== null;
}

// ---------------------------------------------------------------------------
// Shuffle the Weekend (launch)
// ---------------------------------------------------------------------------

/** The minimal shape the diversity algorithm needs from a candidate photo. */
export interface ShuffleCandidate {
  id: string;
  eventSlug: string;
}

export interface ShufflePick {
  photoId: string;
  /** Feed this back in as `history` on the next call. */
  nextHistory: string[];
}

/**
 * Picks the next shuffle photo: event diversity, no repeats until the
 * recent-history queue is exhausted.
 *
 * "No repeats until exhausted": a candidate already in `history` is never
 * picked again until every OTHER candidate has also appeared, at which point
 * the history resets and a fresh cycle begins. "Event diversity": among the
 * candidates eligible for this pick, the function prefers whichever event(s)
 * appear least often in the current cycle's history so far, so a run of
 * consecutive picks spreads across events rather than clustering in one.
 *
 * `random` is injectable (defaults to Math.random) so the algorithm is
 * exercised deterministically in tests.
 */
export function pickShufflePhoto(
  candidates: readonly ShuffleCandidate[],
  history: readonly string[],
  random: () => number = Math.random,
): ShufflePick | null {
  if (candidates.length === 0) return null;

  const historySet = new Set(history);
  let available = candidates.filter((c) => !historySet.has(c.id));
  let effectiveHistory = history;
  if (available.length === 0) {
    // Every candidate has appeared since the last reset: start a new cycle.
    available = [...candidates];
    effectiveHistory = [];
  }

  const eventCounts = new Map<string, number>();
  const byId = new Map(candidates.map((c) => [c.id, c] as const));
  for (const id of effectiveHistory) {
    const shown = byId.get(id);
    if (!shown) continue;
    eventCounts.set(shown.eventSlug, (eventCounts.get(shown.eventSlug) ?? 0) + 1);
  }

  let minCount = Number.POSITIVE_INFINITY;
  for (const candidate of available) {
    const count = eventCounts.get(candidate.eventSlug) ?? 0;
    if (count < minCount) minCount = count;
  }
  const mostDiverse = available.filter(
    (candidate) => (eventCounts.get(candidate.eventSlug) ?? 0) === minCount,
  );

  const index = Math.min(
    mostDiverse.length - 1,
    Math.max(0, Math.floor(random() * mostDiverse.length)),
  );
  const pick = mostDiverse[index];

  return { photoId: pick.id, nextHistory: [...effectiveHistory, pick.id] };
}

/**
 * Builds one full diverse pass over every candidate (a permutation, no
 * duplicates) starting from `startId` when given. Used to hand a "continue
 * as a serendipitous slideshow" ordering to the Slideshow component: the
 * guest keeps seeing the same event-diverse, no-immediate-repeat sequence
 * pickShufflePhoto would have produced one click at a time.
 */
export function buildShuffleSequence(
  candidates: readonly ShuffleCandidate[],
  startId: string | null = null,
  random: () => number = Math.random,
): string[] {
  if (candidates.length === 0) return [];

  const sequence: string[] = [];
  let history: string[] = [];
  if (startId && candidates.some((c) => c.id === startId)) {
    sequence.push(startId);
    history = [startId];
  }

  // Bounded by candidates.length: each call either extends the current cycle
  // with a brand-new id or starts a fresh cycle, so this always terminates.
  while (sequence.length < candidates.length) {
    const pick = pickShufflePhoto(candidates, history, random);
    if (!pick) break;
    history = pick.nextHistory;
    sequence.push(pick.photoId);
  }

  return sequence;
}

// ---------------------------------------------------------------------------
// Recently Added (launch)
// ---------------------------------------------------------------------------

/** The home rail never shows more than this many guest uploads. */
export const RECENTLY_APPROVED_RAIL_LIMIT = 12;

/**
 * Produced interface: getRecentlyApproved(limit) -> Promise<GalleryPhotoView[]>.
 *
 * Approved guest photos only (source: "guest"; getGalleryPage already
 * restricts every result to VISIBLE_PHOTO_STATUS, so pending/rejected guest
 * uploads can never appear here either). Ordered newest-first by the only
 * timestamp task 06's query layer exposes, captured_at -- see this packet's
 * report for why that is a proxy for "recently added," not a literal
 * approval-time ordering, and what task 06 would need to expose to close
 * that gap. Returns the server-side view (internal preview object paths,
 * never a signed URL): callers sign and strip previews the same way
 * src/lib/gallery/serialize.ts does for every other gallery read, before
 * this ever reaches a Client Component.
 */
export async function getRecentlyApproved(
  limit: number,
  dataSource: GalleryDataSource,
): Promise<GalleryPhotoView[]> {
  const page = await getGalleryPage(
    { source: "guest", sort: "newest", limit },
    dataSource,
  );
  return page.photos;
}

// ---------------------------------------------------------------------------
// Submission Receipt (launch)
// ---------------------------------------------------------------------------

export interface SubmissionStateCopy {
  headline: string;
  body: string;
}

/** One line of guest-facing copy per guest-visible upload state. */
export const SUBMISSION_STATE_COPY: Record<UploadState, SubmissionStateCopy> = {
  draft: {
    headline: "Getting started",
    body: "We do not have any photos for this upload yet.",
  },
  uploading: {
    headline: "Still uploading",
    body: "Your photos are on their way. Keep this tab open until the upload finishes.",
  },
  submitted: {
    headline: "Under review",
    body: "Rachel and Zach have not reviewed these yet. Check back soon.",
  },
  approved: {
    headline: "All in",
    body: "Every photo from this upload is now in the gallery. Thank you.",
  },
  partially_approved: {
    headline: "Some are in",
    body: "A few of your photos made it into the gallery. The rest did not fit this time.",
  },
  rejected: {
    headline: "Not this time",
    body: "These photos did not make it into the gallery this time. Thank you for sharing them.",
  },
  expired: {
    headline: "This link expired",
    body: "This upload was never finished, so its link has expired. Head back to Add Yours to try again.",
  },
};

/** Every guest-facing state must carry copy; this pins that at the type level too. */
export const SUBMISSION_STATE_COPY_KEYS: readonly UploadState[] = UPLOAD_STATES;

export type SubmissionReceiptView =
  | { kind: "opaque" }
  | { kind: "status"; status: PublicUploadStatus; copy: SubmissionStateCopy };

/**
 * Maps a resolved status to its view. `status === null` (a wrong receipt
 * token, a missing token, or a batch id that does not exist) always maps to
 * the same opaque view: this function receives no signal that could tell
 * those cases apart, so it cannot leak one -- "a batch id without its
 * receipt token reveals nothing" holds by construction, not by convention.
 */
export function resolveSubmissionReceiptView(
  status: PublicUploadStatus | null,
): SubmissionReceiptView {
  if (!status) return { kind: "opaque" };
  return { kind: "status", status, copy: SUBMISSION_STATE_COPY[status.state] };
}

export interface LoadSubmissionReceiptDeps {
  getUploadStatus: (
    batchId: string,
    receiptToken: string,
  ) => Promise<PublicUploadStatus | null>;
}

/**
 * Page-level entry point, deliberately taking getUploadStatus as an injected
 * dependency (see this file's top doc comment) rather than importing it from
 * "@/lib/uploads/create-batch" directly. A missing receipt token short-
 * circuits before any lookup, exactly like the existing status API route
 * requires the same param -- but here it collapses to the SAME opaque view a
 * wrong token or unknown batch would produce, never a different one.
 */
export async function loadSubmissionReceiptView(
  batchId: string,
  receiptToken: string | null | undefined,
  deps: LoadSubmissionReceiptDeps,
): Promise<SubmissionReceiptView> {
  if (!receiptToken) return { kind: "opaque" };
  const status = await deps.getUploadStatus(batchId, receiptToken);
  return resolveSubmissionReceiptView(status);
}

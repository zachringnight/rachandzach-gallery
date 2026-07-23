/**
 * Feature-flag tests (packet 11).
 *
 * Proves that every module gated behind an off flag (playlists, marathon,
 * anniversaryCapsule, memoryNotes -- all hard false outside development per
 * src/content/features.ts, and hard false in every environment for these
 * four specifically) is completely absent: no navigation entry, no sitemap
 * entry, no empty placeholder card, and a real HTTP-404-shaped not-found for
 * the two routed modules (playlists, marathon).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlaylistChapter } from "@/components/modules/PlaylistChapter";
import { MarathonSupport } from "@/components/modules/MarathonSupport";
import { AnniversaryCapsule } from "@/components/modules/AnniversaryCapsule";
import { ApprovedMemoryNote } from "@/components/modules/ApprovedMemoryNote";
import { RecentlyApproved } from "@/components/modules/RecentlyApproved";
import { SiteHeader } from "@/components/site/SiteHeader";
import sitemap from "@/app/sitemap";
import PlaylistsPage from "@/app/(public)/playlists/page";
import MarathonPage from "@/app/(public)/marathon/page";
import {
  isAnniversaryCapsuleVisible,
  isApprovedMemoryNoteVisible,
  resolveApprovedMemoryNote,
  type AnniversaryCapsuleConfig,
  type ApprovedMemoryNoteConfig,
  type MarathonConfig,
  type PlaylistConfig,
} from "@/lib/modules/contracts";

afterEach(cleanup);

/** The digest next/navigation's notFound() throws; confirmed against the
 * installed Next version (node_modules/next/dist/client/components/not-found.js). */
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

function expectNotFound(run: () => unknown) {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the page to call notFound()").toBeInstanceOf(Error);
  expect((caught as { digest?: unknown }).digest).toBe(NOT_FOUND_DIGEST);
}

const fakePlaylist: PlaylistConfig = {
  title: "The Ceremony Walk-In",
  description: "What played as everyone found their seats.",
  spotifyUrl: "https://open.spotify.com/playlist/fake",
  coverPhotoId: null,
  eventSlug: "wedding",
};

const fakeMarathon: MarathonConfig = {
  runnerName: "Rachel",
  raceName: "Chicago Marathon",
  story: "Rachel is running her first marathon this fall.",
  donationUrl: "https://example-donate.test/rachel",
  charityName: "A charity",
  goalAmount: 2000,
  displayProgress: true,
};

const visibleCapsule: AnniversaryCapsuleConfig = {
  enabledAt: "2020-01-01T00:00:00.000Z", // in the past relative to any test run
  title: "One year later",
  body: "A note we wrote for our first anniversary.",
  photoIds: [],
};

const futureCapsule: AnniversaryCapsuleConfig = {
  ...visibleCapsule,
  enabledAt: "2999-01-01T00:00:00.000Z",
};

const resolvedNote: ApprovedMemoryNoteConfig = {
  photoId: "photo-1",
  noteText: "We could not stop laughing during this one.",
  contributorDisplayName: "Sam",
};

describe("disabled modules render nothing (no placeholder card)", () => {
  it("PlaylistChapter renders nothing while playlists is off", () => {
    const { container } = render(<PlaylistChapter playlist={fakePlaylist} />);
    expect(container.innerHTML).toBe("");
  });

  it("MarathonSupport renders nothing while marathon is off", () => {
    const { container } = render(<MarathonSupport marathon={fakeMarathon} />);
    expect(container.innerHTML).toBe("");
  });

  it("AnniversaryCapsule renders nothing while anniversaryCapsule is off, even with a past enabledAt", () => {
    const { container } = render(<AnniversaryCapsule capsule={visibleCapsule} />);
    expect(container.innerHTML).toBe("");
  });

  it("AnniversaryCapsule renders nothing for a null capsule", () => {
    const { container } = render(<AnniversaryCapsule capsule={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("ApprovedMemoryNote renders nothing while memoryNotes is off, even with a resolved note", () => {
    const { container } = render(<ApprovedMemoryNote note={resolvedNote} />);
    expect(container.innerHTML).toBe("");
  });

  it("ApprovedMemoryNote renders nothing for a null note", () => {
    const { container } = render(<ApprovedMemoryNote note={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("RecentlyApproved renders nothing when there are no approved guest photos yet", () => {
    const { container } = render(<RecentlyApproved photos={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("flagged routes return not found while their flags are off", () => {
  it("/playlists", () => {
    expectNotFound(() => PlaylistsPage());
  });

  it("/marathon", () => {
    expectNotFound(() => MarathonPage());
  });
});

describe("disabled modules have no navigation entry", () => {
  it("SiteHeader never renders Playlists or The Marathon", () => {
    const { container } = render(<SiteHeader />);
    const labels = Array.from(container.querySelectorAll("nav a")).map((a) => a.textContent);
    expect(labels).not.toContain("Playlists");
    expect(labels).not.toContain("The Marathon");
  });
});

describe("disabled modules have no sitemap entry", () => {
  it("sitemap lists only the two always-on public pages", () => {
    const entries = sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);
    for (const disabled of ["/playlists", "/marathon", "/anniversary", "/submissions"]) {
      expect(paths, `sitemap must not list ${disabled}`).not.toContain(disabled);
    }
  });
});

describe("isAnniversaryCapsuleVisible: both gates are required", () => {
  it("is invisible with the flag off, regardless of date", () => {
    expect(isAnniversaryCapsuleVisible(visibleCapsule, false)).toBe(false);
  });

  it("is invisible with the flag on but a future enabledAt", () => {
    expect(isAnniversaryCapsuleVisible(futureCapsule, true)).toBe(false);
  });

  it("is invisible with the flag on but no enabledAt at all", () => {
    expect(isAnniversaryCapsuleVisible({ ...visibleCapsule, enabledAt: null }, true)).toBe(false);
  });

  it("is invisible for a null capsule even with the flag on", () => {
    expect(isAnniversaryCapsuleVisible(null, true)).toBe(false);
  });

  it("is visible only once BOTH the flag is on and enabledAt has passed", () => {
    expect(isAnniversaryCapsuleVisible(visibleCapsule, true)).toBe(true);
  });

  it("treats an unparsable enabledAt as invisible rather than throwing", () => {
    expect(isAnniversaryCapsuleVisible({ ...visibleCapsule, enabledAt: "not-a-date" }, true)).toBe(false);
  });
});

describe("resolveApprovedMemoryNote: photo and note must both be approved", () => {
  const base = {
    batchStatus: "approved" as const,
    note: "Loved every second of this.",
    displayName: "Sam",
    photoId: "photo-1",
    noteApproved: true,
  };

  it("resolves when the batch is fully approved, the note is approved, and a photo exists", () => {
    expect(resolveApprovedMemoryNote(base)).toEqual({
      photoId: "photo-1",
      noteText: "Loved every second of this.",
      contributorDisplayName: "Sam",
    });
  });

  it("also resolves for a partially_approved batch", () => {
    expect(resolveApprovedMemoryNote({ ...base, batchStatus: "partially_approved" })).not.toBeNull();
  });

  it("omits the contributor name when the guest did not opt in", () => {
    expect(resolveApprovedMemoryNote({ ...base, displayName: null })?.contributorDisplayName).toBeNull();
  });

  for (const batchStatus of ["draft", "submitted", "under_review", "rejected"] as const) {
    it(`returns null for a non-terminal-approved batch status ("${batchStatus}")`, () => {
      expect(resolveApprovedMemoryNote({ ...base, batchStatus })).toBeNull();
    });
  }

  it("returns null when the admin did not approve the note itself", () => {
    expect(resolveApprovedMemoryNote({ ...base, noteApproved: false })).toBeNull();
  });

  it("returns null when no photo resulted from this batch", () => {
    expect(resolveApprovedMemoryNote({ ...base, photoId: null })).toBeNull();
  });

  it("returns null for a missing note", () => {
    expect(resolveApprovedMemoryNote({ ...base, note: null })).toBeNull();
  });

  it("returns null for a whitespace-only note", () => {
    expect(resolveApprovedMemoryNote({ ...base, note: "   " })).toBeNull();
  });
});

describe("isApprovedMemoryNoteVisible", () => {
  it("is false whenever the flag is off, even with a resolved note", () => {
    expect(isApprovedMemoryNoteVisible(resolvedNote, false)).toBe(false);
  });

  it("is false for a null note even with the flag on", () => {
    expect(isApprovedMemoryNoteVisible(null, true)).toBe(false);
  });

  it("is true only once both are satisfied", () => {
    expect(isApprovedMemoryNoteVisible(resolvedNote, true)).toBe(true);
  });
});

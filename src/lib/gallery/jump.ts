/**
 * Light Bar far-jump controller (design upgrade P3).
 *
 * A far scrub pages toward its target before scrolling (the loaded list is
 * always a contiguous prefix of the archive order). Guests re-scrub while a
 * jump is still paging, and two overlapping paging loops used to share one
 * pending target and one busy flag: the EARLIER loop could finish first,
 * clear the newer target, scroll to its own stale index, and declare the
 * rail idle while the newer loop was still running -- so the guest's most
 * recent scrub was silently ignored.
 *
 * Every invocation therefore takes a generation token. Only the latest
 * generation may clear or land the pending target, touch the busy flag, or
 * scroll; a superseded loop notices at its next await and stops without
 * writing anything. Pure orchestration with injected effects so the race
 * itself is unit-testable.
 */

export interface JumpPageResult {
  status: "appended" | "busy" | "end" | "stale";
}

export interface JumpIo {
  /** Photos currently loaded (contiguous prefix of the archive order). */
  loadedCount(): number;
  /** True while another page can still be fetched. */
  hasMore(): boolean;
  /** Result-set generation; changes when filters replace the archive. */
  requestSeq(): number;
  fetchNextPage(): Promise<JumpPageResult>;
  /** Back off while another request holds the wire. */
  waitForWire(): Promise<void>;
  /** Scroll immediately (target rows already committed). */
  scrollTo(photoIndex: number): void;
  /** Scroll once the rows containing the target have committed. */
  scrollAfterCommit(photoIndex: number): void;
  /** Drives the Light Bar's busy shimmer. */
  setBusy(busy: boolean): void;
}

export interface JumpController {
  /**
   * Call when the loaded photo count grows: lands the pending target as
   * soon as its rows exist (scrolling earlier would target stale layout).
   */
  notifyLoaded(): void;
  /** Jump to a photo index, paging toward it when not yet loaded. */
  jumpTo(photoIndex: number): Promise<void>;
  /** Exposed for tests: the target still waiting to land, if any. */
  pendingTarget(): number | null;
}

export function createJumpController(io: JumpIo): JumpController {
  let generation = 0;
  let pending: number | null = null;

  return {
    pendingTarget: () => pending,

    notifyLoaded(): void {
      // `pending` always belongs to the LATEST jump (only the latest
      // generation writes it), so landing it here needs no token check.
      if (pending !== null && io.loadedCount() > pending) {
        const target = pending;
        pending = null;
        io.scrollAfterCommit(target);
      }
    },

    async jumpTo(photoIndex: number): Promise<void> {
      const jump = ++generation;

      if (photoIndex < io.loadedCount()) {
        // Already loaded: this newest jump owns the shared state, so it
        // cancels any older pending target and idles the rail.
        pending = null;
        io.setBusy(false);
        io.scrollTo(photoIndex);
        return;
      }

      const seq = io.requestSeq();
      pending = photoIndex;
      io.setBusy(true);
      try {
        while (
          jump === generation &&
          seq === io.requestSeq() &&
          io.loadedCount() <= photoIndex &&
          io.hasMore()
        ) {
          const outcome = await io.fetchNextPage();
          if (outcome.status === "busy") {
            // Another request (e.g. tail-loading) holds the wire; let it
            // land, then keep paging toward the target.
            await io.waitForWire();
            continue;
          }
          if (outcome.status !== "appended") break;
        }
      } finally {
        // Only the live jump may declare the rail idle.
        if (jump === generation) io.setBusy(false);
      }

      // Superseded: a newer jump owns pending/busy/scroll now. Stop clean.
      if (jump !== generation) return;

      if (seq !== io.requestSeq()) {
        pending = null;
        return;
      }

      // Ran out of archive before the target (or notifyLoaded already
      // landed it): settle on the last loaded photograph.
      if (pending !== null && io.loadedCount() > 0) {
        const target = Math.min(photoIndex, io.loadedCount() - 1);
        pending = null;
        io.scrollAfterCommit(target);
      }
    },
  };
}

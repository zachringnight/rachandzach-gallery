"use client";

import { useEffect, useState } from "react";
import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_DISPLAY_NAME_MAX_LENGTH,
  type GuestMemory,
} from "@/lib/memories/shared";

export interface PhotoMemoriesProps {
  photoId: string;
}

type WallState =
  | { kind: "loading" }
  | { kind: "ready"; memories: GuestMemory[] }
  | { kind: "error" };

/**
 * The memories wall for one photo (Round Two): approved guest notes as
 * quiet captions, plus a small composer. Rendered inside Lightbox itself
 * (below the footer slot), so every lightbox surface carries it and every
 * treatment here is for the dark bg-ink/95 surface; cream/70 (not the
 * site-wide text-muted token, which is tuned for the light cream surface)
 * is the dialog's established muted-on-dark treatment (see Lightbox.tsx).
 *
 * New notes are pending until Zach approves them; the composer says so
 * before and after sending, and nothing a guest writes here ever renders
 * for other guests until that approval.
 */
export function PhotoMemories({ photoId }: PhotoMemoriesProps) {
  const [wall, setWall] = useState<WallState>({ kind: "loading" });
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Paging to another photo resets the wall and the composer. Derived
  // during render (the sanctioned previous-key adjustment), never from
  // inside an effect: see FavoritesGallery's 2026-07-22 hook-rule
  // restructure for the precedent.
  const [lastPhotoId, setLastPhotoId] = useState(photoId);
  if (lastPhotoId !== photoId) {
    setLastPhotoId(photoId);
    setWall({ kind: "loading" });
    setComposing(false);
    setBody("");
    setName("");
    setSent(false);
    setSendError(null);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/memories?photoId=${encodeURIComponent(photoId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`status ${response.status}`);
        const payload = (await response.json()) as { memories?: GuestMemory[] };
        if (!cancelled) {
          setWall({ kind: "ready", memories: payload.memories ?? [] });
        }
      } catch {
        if (!cancelled) setWall({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setSendError("Write a short memory to share.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          photoId,
          body: trimmed,
          displayName: name.trim().length > 0 ? name.trim() : null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setSendError(
          payload?.error ?? "Could not send your memory. Try again in a bit.",
        );
        return;
      }
      setSent(true);
      setComposing(false);
      setBody("");
      setName("");
    } catch {
      setSendError("Could not send your memory. Try again in a bit.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-label="Memories" className="pt-3">
      <h3 className="mb-2 text-xs uppercase tracking-wider text-cream/60">
        Memories
      </h3>

      {wall.kind === "loading" ? (
        <p className="text-sm text-cream/70">Loading memories...</p>
      ) : null}
      {wall.kind === "error" ? (
        <p className="text-sm text-cream/70">
          Memories are unavailable right now.
        </p>
      ) : null}
      {wall.kind === "ready" && wall.memories.length === 0 ? (
        <p className="text-sm text-cream/70">
          No memories on this photo yet. Leave the first one.
        </p>
      ) : null}
      {wall.kind === "ready" && wall.memories.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
          {wall.memories.map((memory) => (
            <li key={memory.id}>
              <blockquote className="text-sm text-cream/90">
                {memory.body}
              </blockquote>
              {memory.displayName ? (
                <p className="mt-0.5 text-xs text-cream/70">
                  From {memory.displayName}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div aria-live="polite">
        {sent ? (
          <p className="mt-2 text-sm text-cream/90">
            Thank you. Rach and Zach read every memory, and yours will appear
            here once it is approved.
          </p>
        ) : null}
      </div>

      {!composing && !sent ? (
        <button
          type="button"
          onClick={() => {
            setComposing(true);
            setSendError(null);
          }}
          className="mt-2 h-9 rounded-md border border-cream/30 bg-cream/10 px-3 text-sm text-cream hover:bg-cream/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
        >
          Leave a memory
        </button>
      ) : null}

      {composing ? (
        <form onSubmit={submit} className="mt-2 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-cream/70">
            Your memory
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={MEMORY_BODY_MAX_LENGTH}
              rows={3}
              required
              className="rounded-md border border-cream/30 bg-cream/10 p-2 text-sm text-cream placeholder:text-cream/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
              placeholder="What do you remember about this one?"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-cream/70">
            Your name (optional)
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MEMORY_DISPLAY_NAME_MAX_LENGTH}
              className="rounded-md border border-cream/30 bg-cream/10 p-2 text-sm text-cream placeholder:text-cream/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
            />
          </label>
          <p className="text-xs text-cream/70">
            {body.length}/{MEMORY_BODY_MAX_LENGTH}. Rach and Zach approve
            memories before they appear.
          </p>
          {sendError ? (
            <p role="alert" className="text-sm text-cream/90">
              {sendError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={sending}
              className="h-9 rounded-md border border-cream/30 bg-cream/10 px-3 text-sm text-cream hover:bg-cream/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:opacity-60"
            >
              {sending ? "Sending..." : "Share it"}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setSendError(null);
              }}
              className="h-9 rounded-md px-3 text-sm text-cream/70 hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

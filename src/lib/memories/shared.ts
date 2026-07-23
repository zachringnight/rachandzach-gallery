/**
 * Memories wall vocabulary shared by both sides of the wire (Round Two).
 * CLIENT-SAFE: no server imports, no env, no database shapes. The composer
 * (src/components/memories/PhotoMemories.tsx) enforces the same length
 * bounds the server and the Postgres check constraints do, so "body length
 * enforced both ends" is one pair of constants, not two guesses.
 *
 * Server-side counterparts live in src/lib/memories/server.ts, which
 * re-exports everything here.
 */

/** Matches rachandzach_photo_memories.body's check constraint (1..500). */
export const MEMORY_BODY_MAX_LENGTH = 500;

/** Matches rachandzach_photo_memories.display_name's check (<= 80). */
export const MEMORY_DISPLAY_NAME_MAX_LENGTH = 80;

export const MEMORY_STATUSES = ["pending", "approved", "rejected"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_OWNER_KINDS = ["session", "person"] as const;
export type MemoryOwnerKind = (typeof MEMORY_OWNER_KINDS)[number];

/** What a guest sees: approved notes carry a byline and a body, nothing
 *  else. Owner keys (session ids, person slugs) never reach this shape. */
export interface GuestMemory {
  id: string;
  displayName: string | null;
  body: string;
  createdAt: string;
}

/** What the admin review queue sees. Still no owner key: moderation decides
 *  on content, and the key adds nothing Zach can act on. */
export interface AdminMemory {
  id: string;
  photoId: string;
  displayName: string | null;
  body: string;
  status: MemoryStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return (
    typeof value === "string" &&
    (MEMORY_STATUSES as readonly string[]).includes(value)
  );
}

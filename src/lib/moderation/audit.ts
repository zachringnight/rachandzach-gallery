/**
 * Moderation audit trail (packet 10).
 *
 * Every state-changing moderation action -- item approve/reject/restore,
 * batch approve/reject, and metadata edits -- writes exactly one row to
 * rachandzach_moderation_actions with a before/after JSON snapshot. Retried
 * or idempotent no-op calls (see state-machine.ts) must NOT call this: the
 * packet's contract is "retrying approval creates ... one audit trail."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { MODERATION_ACTIONS } from "@/lib/supabase/schema";

type Db = SupabaseClient<Database>;

export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

export interface RecordModerationActionInput {
  batchId: string | null;
  itemId: string | null;
  actorUserId: string;
  action: ModerationActionKind;
  /** JSON-serializable snapshot of the affected state before the change. */
  before: unknown;
  /** JSON-serializable snapshot of the affected state after the change. */
  after: unknown;
}

/** A database write failed. Routes map this to HTTP 500; never leak internals. */
export class ModerationPersistenceError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = "ModerationPersistenceError";
  }
}

function asJson(value: unknown): Json {
  if (value === null || value === undefined) return {};
  // JSON round-trip guarantees the value is plain, serializable JSON (no
  // undefined props, no class instances, no circular refs) before it reaches
  // the jsonb column.
  return JSON.parse(JSON.stringify(value)) as Json;
}

/**
 * Appends one row to the moderation audit trail. Never updates or deletes an
 * existing row: the table is append-only by convention (nothing in this
 * packet issues an UPDATE or DELETE against it).
 */
export async function recordModerationAction(
  client: Db,
  input: RecordModerationActionInput,
): Promise<void> {
  const { error } = await client.from("rachandzach_moderation_actions").insert({
    batch_id: input.batchId,
    item_id: input.itemId,
    actor_user_id: input.actorUserId,
    action: input.action,
    before: asJson(input.before),
    after: asJson(input.after),
  });
  if (error) {
    throw new ModerationPersistenceError(
      "Could not record the moderation audit entry.",
    );
  }
}

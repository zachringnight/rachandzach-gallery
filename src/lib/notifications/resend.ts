/**
 * Notifications (packet 10).
 *
 * Two producer functions:
 *   - notifyNewBatch(batchId): one admin email to wedding@rachandzach.com
 *     when a complete batch enters "submitted".
 *   - notifyUploadDecision(batchId): one guest decision receipt after a
 *     batch reaches a terminal review state, ONLY when the guest supplied an
 *     email. Never exposes internal rejection notes -- the guest sees a
 *     generic outcome, not an admin's private moderation comment.
 *
 * Idempotency: rachandzach_notification_log.idempotency_key is UNIQUE. Both
 * functions derive a stable key from (kind, batchId) and try to INSERT a
 * "queued" row first. The insert that wins the unique constraint is the only
 * caller allowed to send; every other caller (a route retry, two admin tabs,
 * a genuinely concurrent request) observes the pre-existing row and returns
 * its recorded outcome without sending again. This holds even under a real
 * race: Postgres's unique index is the arbiter, not application logic.
 *
 * Resend is disabled by default and stays disabled until BOTH
 * RESEND_API_KEY is set AND RESEND_SEND_APPROVED="true" is set -- the
 * explicit approval gate the packet requires alongside a verified sender
 * domain. Neither exists in this environment, so the default transport never
 * imports the Resend SDK and never makes a network call; it marks the log
 * row "skipped". Tests inject a recording transport instead, so idempotency
 * is provable without ever touching the network, per the packet's "never
 * send a real email in tests" rule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { NOTIFICATION_KINDS, type UploadBatchRow } from "@/lib/supabase/schema";

type Db = SupabaseClient<Database>;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Sender identity (Zach's decision, 2026-07-22). Sender domain
 * rachandzach.com; Resend verification is pending DNS. This is the ONLY
 * place the from-address is defined -- every send path must use it.
 */
export const NOTIFICATION_SENDER_NAME = "0719 + co.";
export const NOTIFICATION_SENDER_EMAIL = "wedding@rachandzach.com";
export const NOTIFICATION_SENDER = `"${NOTIFICATION_SENDER_NAME}" <${NOTIFICATION_SENDER_EMAIL}>`;

/** The one inbox that receives "a new batch needs review" emails. */
export const ADMIN_NOTIFICATION_RECIPIENT = "wedding@rachandzach.com";

export interface NotificationSendResult {
  sent: boolean;
  providerId: string | null;
}

export interface NotificationMessage {
  kind: NotificationKind;
  to: string;
  subject: string;
  html: string;
}

export interface NotificationTransport {
  /** Returns the provider's message id on a real send, or null on a skip. */
  send(message: NotificationMessage): Promise<{ providerId: string } | null>;
}

/**
 * Fail-closed production gate. A bare API key is never enough on its own:
 * both the key AND the explicit approval flag must be present, so flipping
 * one environment variable can never accidentally start emailing guests.
 */
export function isSendingEnabled(): boolean {
  return (
    Boolean(process.env.RESEND_API_KEY) &&
    process.env.RESEND_SEND_APPROVED === "true"
  );
}

/**
 * Default transport used outside tests. Dynamic-imports the Resend SDK only
 * once sending is actually enabled, so this module carries no Resend
 * dependency at import time for every environment where it stays disabled
 * (which is every environment today).
 */
export const defaultTransport: NotificationTransport = {
  async send(message) {
    if (!isSendingEnabled()) return null;
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: NOTIFICATION_SENDER,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
    if (error || !data) return null;
    return { providerId: data.id };
  },
};

async function resolveClient(client?: Db): Promise<Db> {
  if (client) return client;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function fetchBatch(client: Db, batchId: string): Promise<UploadBatchRow | null> {
  const { data, error } = await client
    .from("rachandzach_upload_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (error) return null;
  return (data as UploadBatchRow | null) ?? null;
}

interface ExistingLogRow {
  status: string;
  provider_id: string | null;
}

async function fetchLogByKey(
  client: Db,
  idempotencyKey: string,
): Promise<ExistingLogRow | null> {
  const { data } = await client
    .from("rachandzach_notification_log")
    .select("status, provider_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return (data as ExistingLogRow | null) ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A caller that lost the idempotency-key insert race did not necessarily
 * lose to a caller that has already finished sending -- the winner may still
 * be mid-flight (rendering the email, awaiting the provider's HTTP call).
 * Rather than report a possibly-stale "not sent" the instant the row is
 * merely "queued", poll briefly for the winner to settle it. Bounded so a
 * genuinely stuck winner (a crashed process mid-send) cannot hang the loser
 * forever; the row itself is the source of truth either way.
 */
async function waitForClaimedOutcome(
  client: Db,
  idempotencyKey: string,
): Promise<ExistingLogRow> {
  const POLL_ATTEMPTS = 20;
  const POLL_DELAY_MS = 15;
  let last: ExistingLogRow | null = null;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    last = await fetchLogByKey(client, idempotencyKey);
    if (last && last.status !== "queued") return last;
    await delay(POLL_DELAY_MS);
  }
  return last ?? { status: "queued", provider_id: null };
}

/**
 * The idempotency core shared by both notification kinds: claim the
 * idempotency key via INSERT, and only the claimer sends.
 */
async function sendIdempotent(
  client: Db,
  batchId: string,
  message: NotificationMessage,
  transport: NotificationTransport,
): Promise<NotificationSendResult> {
  const idempotencyKey = `${message.kind}:${batchId}`;

  const { data: inserted, error: insertError } = await client
    .from("rachandzach_notification_log")
    .insert({
      batch_id: batchId,
      kind: message.kind,
      idempotency_key: idempotencyKey,
      status: "queued",
    })
    .select("*")
    .maybeSingle();

  if (insertError || !inserted) {
    if (insertError && !isUniqueViolation(insertError)) {
      // A real database error, not a "someone already claimed this" race.
      // Fail closed: do not send when we cannot even record the attempt.
      return { sent: false, providerId: null };
    }
    // Lost the claim: this idempotency key already exists. Whoever won
    // decides the outcome; wait for it to settle rather than reporting a
    // possibly-transient "not sent" while the winner is still in flight, and
    // never send a second time ourselves.
    const existing = await waitForClaimedOutcome(client, idempotencyKey);
    return { sent: existing.status === "sent", providerId: existing.provider_id };
  }

  // We claimed the key: we are the only caller allowed to send.
  const result = await transport.send(message);
  const status = result ? "sent" : "skipped";

  await client
    .from("rachandzach_notification_log")
    .update({
      status,
      provider_id: result?.providerId ?? null,
    })
    .eq("id", (inserted as { id: string }).id);

  return { sent: status === "sent", providerId: result?.providerId ?? null };
}

// --- Templates (plain-text fallback content; the React Email components in
// src/emails/ produce the real HTML at call time to avoid a hard React
// dependency inside this otherwise-pure module) ---------------------------

function newBatchSubject(itemCount: number): string {
  return `New wedding photo batch: ${itemCount} photo${itemCount === 1 ? "" : "s"} to review`;
}

function decisionSubject(status: string): string {
  if (status === "rejected") return "Your wedding photo submission";
  return "Your wedding photos have been added";
}

// --- Produced interfaces ---------------------------------------------------

export interface NotifyOptions {
  client?: Db;
  transport?: NotificationTransport;
}

/**
 * Sends exactly one NewUploadBatch email to wedding@rachandzach.com when a
 * complete batch enters "submitted". Idempotent per batch: a retry (or a
 * second admin route call) never sends a second email.
 */
export async function notifyNewBatch(
  batchId: string,
  options: NotifyOptions = {},
): Promise<NotificationSendResult> {
  const client = await resolveClient(options.client);
  const transport = options.transport ?? defaultTransport;

  const batch = await fetchBatch(client, batchId);
  if (!batch) return { sent: false, providerId: null };

  const { data: items } = await client
    .from("rachandzach_upload_items")
    .select("status")
    .eq("batch_id", batchId);
  const itemCount = (items ?? []).length;

  const { renderNewUploadBatchEmail } = await import("@/emails/NewUploadBatch");
  const html = await renderNewUploadBatchEmail({
    displayName: batch.display_name,
    itemCount,
    submittedAt: batch.submitted_at,
  });

  return sendIdempotent(
    client,
    batchId,
    {
      kind: "admin_new_batch",
      to: ADMIN_NOTIFICATION_RECIPIENT,
      subject: newBatchSubject(itemCount),
      html,
    },
    transport,
  );
}

/**
 * Sends exactly one decision receipt to the submitting guest once their
 * batch has reached a terminal review state (approved / partially_approved /
 * rejected), and ONLY when the guest supplied an email at submission time.
 * Never includes an admin's internal rejection note.
 */
export async function notifyUploadDecision(
  batchId: string,
  options: NotifyOptions = {},
): Promise<NotificationSendResult> {
  const client = await resolveClient(options.client);
  const transport = options.transport ?? defaultTransport;

  const batch = await fetchBatch(client, batchId);
  if (!batch || !batch.email) {
    return { sent: false, providerId: null };
  }
  if (!["approved", "partially_approved", "rejected"].includes(batch.status)) {
    return { sent: false, providerId: null };
  }

  const { data: items } = await client
    .from("rachandzach_upload_items")
    .select("status")
    .eq("batch_id", batchId);
  const approvedCount = (items ?? []).filter((i) => i.status === "approved").length;
  const totalCount = (items ?? []).length;

  const kind: NotificationKind =
    batch.status === "rejected" ? "guest_rejected" : "guest_approved";

  const { renderUploadDecisionEmail } = await import("@/emails/UploadDecision");
  const html = await renderUploadDecisionEmail({
    displayName: batch.display_name,
    status: batch.status,
    approvedCount,
    totalCount,
  });

  return sendIdempotent(
    client,
    batchId,
    {
      kind,
      to: batch.email,
      subject: decisionSubject(batch.status),
      html,
    },
    transport,
  );
}

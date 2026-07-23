/**
 * Shared client-side types for the guest upload UI (packet 08).
 */

export type QueueItemStatus =
  | "queued"
  | "signing"
  | "uploading"
  | "paused"
  | "error"
  | "done";

export interface QueueItem {
  /** Local id (crypto.randomUUID), distinct from the server item id. */
  id: string;
  file: File;
  displayName: string;
  bytes: number;
  /** Media type resolved from the file's magic bytes on the client. */
  mediaType: string;
  /** 0..1 upload progress. */
  progress: number;
  status: QueueItemStatus;
  /** Set when status is "error". */
  error?: string;
  /** True when the file duplicates another selection (same name + size). */
  duplicate?: boolean;
}

export interface UploadReceiptData {
  batchId: string;
  receiptToken: string;
  statusPath: string;
}

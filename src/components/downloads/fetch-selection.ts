import {
  MAX_SELECTION_ITEMS,
  type OriginalDownload,
  type SelectionDownload,
} from "@/lib/downloads/contracts";

export class SelectionPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionPreparationError";
  }
}

export interface FetchSelectionOptions {
  signal?: AbortSignal;
  /** Called just before each bounded signing POST with the 1-based index of
   *  the batch about to be prepared and the total batch count, so a caller
   *  can show "Preparing 2 of 4" while a large selection is being signed
   *  sequentially. Fires exactly once per batch, including a single-batch
   *  selection (as 1 of 1). */
  onBatchStart?: (batchIndex: number, batchCount: number) => void;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/**
 * Resolves any-size UI selection through the server's intentionally bounded
 * 50-id signing endpoint. Requests remain within the security contract, then
 * are combined client-side for the existing ZIP or native-share flows.
 */
export async function fetchSelectionDownloads(
  photoIds: string[],
  fallbackMessage: string,
  options: FetchSelectionOptions = {},
): Promise<SelectionDownload> {
  const ids = Array.from(new Set(photoIds.filter(Boolean)));
  if (ids.length === 0) {
    return {
      items: [],
      maximumItems: MAX_SELECTION_ITEMS,
      estimatedBytes: 0,
    };
  }

  const items: OriginalDownload[] = [];
  let estimatedBytes = 0;

  const batches = chunks(ids, MAX_SELECTION_ITEMS);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    options.onBatchStart?.(batchIndex + 1, batches.length);
    const response = await fetch("/api/downloads/selection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds: batch }),
      signal: options.signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new SelectionPreparationError(body?.error ?? fallbackMessage);
    }
    const selection = (await response.json()) as SelectionDownload;
    items.push(...selection.items);
    estimatedBytes += selection.estimatedBytes;
  }

  const unique = new Map<string, OriginalDownload>();
  for (const item of items) {
    if (!unique.has(item.photoId)) unique.set(item.photoId, item);
  }

  return {
    items: Array.from(unique.values()),
    maximumItems: MAX_SELECTION_ITEMS,
    estimatedBytes,
  };
}

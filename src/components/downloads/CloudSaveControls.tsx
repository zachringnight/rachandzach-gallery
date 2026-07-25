"use client";

import { CloudUpload, HardDriveUpload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DROPBOX_SAVER_MAX_FILES,
  type DropboxWindow,
  hasMinimumSignedUrlLifetime,
  loadDropboxSaverScript,
  loadGoogleIdentityScript,
  requestGoogleDriveToken,
  toDropboxSaverFiles,
  uploadOriginalToGoogleDrive,
} from "@/lib/downloads/cloud-save";
import type { OriginalDownload } from "@/lib/downloads/contracts";
import {
  fetchSelectionDownloads,
  SelectionPreparationError,
} from "@/components/downloads/fetch-selection";

export interface CloudSaveControlsProps {
  photoIds: string[];
  googleClientId?: string;
  dropboxAppKey?: string;
}

type Provider = "google" | "dropbox";

type CloudState =
  | { phase: "idle" }
  | { phase: "loading-provider"; provider: Provider; selectionKey: string }
  | { phase: "google-ready"; selectionKey: string }
  | { phase: "authorizing"; selectionKey: string }
  | { phase: "preparing"; provider: Provider; selectionKey: string }
  | {
      phase: "uploading";
      completed: number;
      total: number;
      selectionKey: string;
    }
  | {
      phase: "dropbox-ready";
      items: OriginalDownload[];
      selectionKey: string;
    }
  | { phase: "saving-dropbox"; selectionKey: string }
  | { phase: "done"; message: string; selectionKey: string }
  | {
      phase: "error";
      message: string;
      selectionKey: string;
      provider?: Provider;
      googleRemainingPhotoIds?: string[];
      googleCompleted?: number;
      googleTotal?: number;
    };

interface Operation {
  id: number;
  selectionKey: string;
  controller: AbortController;
}

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-transparent px-3 py-1.5 text-sm text-ink transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50";

function errorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof SelectionPreparationError ||
    error instanceof RangeError
  ) {
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function CloudSaveControls({
  photoIds,
  googleClientId,
  dropboxAppKey,
}: CloudSaveControlsProps) {
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const [dropboxLoaded, setDropboxLoaded] = useState(false);
  const [state, setState] = useState<CloudState>({ phase: "idle" });
  const operationRef = useRef<Operation | null>(null);
  const operationIdRef = useRef(0);
  const selectionKey = useMemo(() => photoIds.join("\u0000"), [photoIds]);
  const selectedIds = useMemo(
    () => Array.from(new Set(photoIds.filter(Boolean))),
    [photoIds],
  );
  const dropboxSelectionTooLarge =
    Boolean(dropboxAppKey) && selectedIds.length > DROPBOX_SAVER_MAX_FILES;
  const currentState = useMemo<CloudState>(
    () =>
      state.phase === "idle" || state.selectionKey === selectionKey
        ? state
        : { phase: "idle" },
    [selectionKey, state],
  );

  const beginOperation = useCallback((): Operation => {
    operationRef.current?.controller.abort();
    const operation = {
      id: operationIdRef.current + 1,
      selectionKey,
      controller: new AbortController(),
    };
    operationIdRef.current = operation.id;
    operationRef.current = operation;
    return operation;
  }, [selectionKey]);

  const isCurrent = useCallback(
    (operation: Operation): boolean =>
      operationRef.current?.id === operation.id &&
      operation.selectionKey === selectionKey &&
      !operation.controller.signal.aborted,
    [selectionKey],
  );

  useEffect(() => {
    operationIdRef.current += 1;
    operationRef.current?.controller.abort();
    operationRef.current = null;
    return () => {
      operationIdRef.current += 1;
      operationRef.current?.controller.abort();
      operationRef.current = null;
    };
  }, [selectionKey]);

  const prepareGoogle = useCallback(async () => {
    if (!googleClientId || selectedIds.length === 0) return;
    const operation = beginOperation();
    setState({
      phase: "loading-provider",
      provider: "google",
      selectionKey,
    });
    try {
      await loadGoogleIdentityScript();
      if (!isCurrent(operation)) return;
      setGoogleLoaded(true);
      setState({ phase: "google-ready", selectionKey });
    } catch (error) {
      if (!isCurrent(operation) || isAbort(error, operation.controller.signal)) {
        return;
      }
      setState({
        phase: "error",
        provider: "google",
        message: errorMessage(error, "Google Drive could not load."),
        selectionKey,
        googleRemainingPhotoIds: selectedIds,
        googleCompleted: 0,
        googleTotal: selectedIds.length,
      });
    }
  }, [
    beginOperation,
    googleClientId,
    isCurrent,
    selectedIds,
    selectionKey,
  ]);

  const saveToGoogle = useCallback(async () => {
    if (!googleClientId || selectedIds.length === 0) return;
    const retry =
      currentState.phase === "error" &&
      currentState.provider === "google" &&
      currentState.googleRemainingPhotoIds
        ? currentState
        : null;
    let remainingPhotoIds = retry?.googleRemainingPhotoIds ?? selectedIds;
    let completed = retry?.googleCompleted ?? 0;
    let total = retry?.googleTotal ?? selectedIds.length;
    const operation = beginOperation();
    setState({ phase: "authorizing", selectionKey });

    try {
      const token = await requestGoogleDriveToken(googleClientId);
      if (!isCurrent(operation)) return;
      setState({ phase: "preparing", provider: "google", selectionKey });
      const selection = await fetchSelectionDownloads(
        remainingPhotoIds,
        "Could not get your photos ready for Google Drive.",
        { signal: operation.controller.signal },
      );
      if (!isCurrent(operation)) return;
      if (selection.items.length === 0) {
        throw new Error("Nothing here is available to save yet.");
      }

      remainingPhotoIds = selection.items.map((item) => item.photoId);
      total = completed + selection.items.length;
      for (let index = 0; index < selection.items.length; index += 1) {
        setState({
          phase: "uploading",
          completed,
          total,
          selectionKey,
        });
        await uploadOriginalToGoogleDrive(
          selection.items[index],
          token,
          fetch,
          { signal: operation.controller.signal },
        );
        if (!isCurrent(operation)) return;
        completed += 1;
        remainingPhotoIds = selection.items
          .slice(index + 1)
          .map((item) => item.photoId);
      }
      setState({
        phase: "done",
        message: `${completed} ${
          completed === 1 ? "photo" : "photos"
        } saved to Google Drive.`,
        selectionKey,
      });
    } catch (error) {
      if (!isCurrent(operation) || isAbort(error, operation.controller.signal)) {
        return;
      }
      setState({
        phase: "error",
        provider: "google",
        message: errorMessage(
          error,
          "Could not save those photos to Google Drive.",
        ),
        selectionKey,
        googleRemainingPhotoIds: remainingPhotoIds,
        googleCompleted: completed,
        googleTotal: total,
      });
    }
  }, [
    beginOperation,
    currentState,
    googleClientId,
    isCurrent,
    selectedIds,
    selectionKey,
  ]);

  const prepareDropbox = useCallback(async () => {
    if (
      !dropboxAppKey ||
      selectedIds.length === 0 ||
      selectedIds.length > DROPBOX_SAVER_MAX_FILES
    ) {
      return;
    }
    const operation = beginOperation();
    setState({ phase: "preparing", provider: "dropbox", selectionKey });
    try {
      const [, selection] = await Promise.all([
        loadDropboxSaverScript(dropboxAppKey),
        fetchSelectionDownloads(
          selectedIds,
          "Could not get your photos ready for Dropbox.",
          { signal: operation.controller.signal },
        ),
      ]);
      if (!isCurrent(operation)) return;
      const dropbox = (window as DropboxWindow).Dropbox;
      if (!dropbox?.isBrowserSupported()) {
        throw new Error("Dropbox Saver is not supported in this browser.");
      }
      if (selection.items.length === 0) {
        throw new Error("Nothing here is available to save yet.");
      }
      toDropboxSaverFiles(selection.items);
      setDropboxLoaded(true);
      setState({
        phase: "dropbox-ready",
        items: selection.items,
        selectionKey,
      });
    } catch (error) {
      if (!isCurrent(operation) || isAbort(error, operation.controller.signal)) {
        return;
      }
      setState({
        phase: "error",
        provider: "dropbox",
        message: errorMessage(error, "Could not prepare those Dropbox files."),
        selectionKey,
      });
    }
  }, [
    beginOperation,
    dropboxAppKey,
    isCurrent,
    selectedIds,
    selectionKey,
  ]);

  const openDropbox = useCallback(() => {
    if (currentState.phase !== "dropbox-ready") return;
    if (!hasMinimumSignedUrlLifetime(currentState.items)) {
      void prepareDropbox();
      return;
    }

    const operation = beginOperation();
    const items = currentState.items;
    try {
      const dropbox = (window as DropboxWindow).Dropbox;
      if (!dropbox?.isBrowserSupported()) {
        throw new Error("Dropbox Saver is not supported in this browser.");
      }
      const files = toDropboxSaverFiles(items);
      setState({ phase: "saving-dropbox", selectionKey });
      dropbox.save({
        files,
        success: () => {
          if (!isCurrent(operation)) return;
          setState({
            phase: "done",
            message: `${files.length} ${
              files.length === 1 ? "photo" : "photos"
            } saved to Dropbox.`,
            selectionKey,
          });
        },
        cancel: () => {
          if (!isCurrent(operation)) return;
          setState({
            phase: "dropbox-ready",
            items,
            selectionKey,
          });
        },
        error: () => {
          if (!isCurrent(operation)) return;
          setState({
            phase: "error",
            provider: "dropbox",
            message: "Dropbox could not save those photos.",
            selectionKey,
          });
        },
      });
    } catch (error) {
      if (!isCurrent(operation)) return;
      setState({
        phase: "error",
        provider: "dropbox",
        message: errorMessage(error, "Dropbox could not save those photos."),
        selectionKey,
      });
    }
  }, [
    beginOperation,
    currentState,
    isCurrent,
    prepareDropbox,
    selectionKey,
  ]);

  if (!googleClientId && !dropboxAppKey) return null;

  const busy =
    currentState.phase === "loading-provider" ||
    currentState.phase === "authorizing" ||
    currentState.phase === "preparing" ||
    currentState.phase === "uploading" ||
    currentState.phase === "saving-dropbox";
  let status: string | null = null;
  if (currentState.phase === "loading-provider") {
    status = `Opening ${
      currentState.provider === "google" ? "Google Drive" : "Dropbox"
    }...`;
  } else if (currentState.phase === "google-ready") {
    status = "Google Drive is ready.";
  } else if (currentState.phase === "authorizing") {
    status = "Waiting for Google Drive...";
  } else if (currentState.phase === "preparing") {
    status = `Getting photos ready for ${
      currentState.provider === "google" ? "Google Drive" : "Dropbox"
    }...`;
  } else if (currentState.phase === "uploading") {
    status = `Saving ${Math.min(
      currentState.completed + 1,
      currentState.total,
    )} of ${currentState.total} to Google Drive...`;
  } else if (currentState.phase === "dropbox-ready") {
    status = "Photos are ready. Continue to choose a Dropbox folder.";
  } else if (currentState.phase === "saving-dropbox") {
    status = "Dropbox is open...";
  } else if (currentState.phase === "done") {
    status = currentState.message;
  } else if (dropboxSelectionTooLarge) {
    status = `Dropbox can save up to ${DROPBOX_SAVER_MAX_FILES} photos at once. Select ${DROPBOX_SAVER_MAX_FILES} or fewer to continue.`;
  }

  const googleAction = googleLoaded ? saveToGoogle : prepareGoogle;
  const dropboxAction =
    dropboxLoaded && currentState.phase === "dropbox-ready"
      ? openDropbox
      : prepareDropbox;

  return (
    <div className="atlas-cloud-save-controls">
      <div className="atlas-cloud-save-actions">
        {googleClientId ? (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy || selectedIds.length === 0}
            onClick={() => void googleAction()}
          >
            <HardDriveUpload aria-hidden="true" size={15} strokeWidth={1.6} />
            {currentState.phase === "google-ready"
              ? "Continue to Google Drive"
              : currentState.phase === "error" &&
                  currentState.provider === "google"
                ? "Try Google Drive again"
                : "Google Drive"}
          </button>
        ) : null}
        {dropboxAppKey ? (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={
              busy || selectedIds.length === 0 || dropboxSelectionTooLarge
            }
            onClick={() => void dropboxAction()}
          >
            <CloudUpload aria-hidden="true" size={15} strokeWidth={1.6} />
            {currentState.phase === "dropbox-ready"
              ? "Continue to Dropbox"
              : currentState.phase === "error" &&
                  currentState.provider === "dropbox"
                ? "Try Dropbox again"
                : "Dropbox"}
          </button>
        ) : null}
      </div>

      {currentState.phase === "error" ? (
        <p role="alert" className="atlas-cloud-save-status text-sm text-coral">
          {currentState.message}
        </p>
      ) : status ? (
        <p
          role="status"
          aria-live="polite"
          className="atlas-cloud-save-status text-sm text-muted"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}

import type { OriginalDownload } from "./contracts";

export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";
export const DROPBOX_SAVER_MAX_FILES = 100;
export const DROPBOX_MIN_SIGNED_URL_LIFETIME_MS = 15 * 60 * 1000;
export const GOOGLE_DRIVE_UPLOAD_MAX_ATTEMPTS = 3;

const GOOGLE_IDENTITY_SCRIPT =
  "https://accounts.google.com/gsi/client";
const DROPBOX_SAVER_SCRIPT =
  "https://www.dropbox.com/static/api/2/dropins.js";
const DRIVE_UPLOAD_ENDPOINT =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name";

let googleIdentityLoad: Promise<void> | null = null;
let dropboxSaverLoad: { appKey: string; promise: Promise<void> } | null = null;

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(config?: { prompt?: string }): void;
}

interface GoogleOAuthApi {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }): GoogleTokenClient;
}

export interface GoogleIdentityWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: GoogleOAuthApi;
    };
  };
}

export interface DropboxSaverFile {
  url: string;
  filename: string;
}

export interface DropboxSaverApi {
  isBrowserSupported(): boolean;
  save(options: {
    files: DropboxSaverFile[];
    success: () => void;
    cancel: () => void;
    error: (message: string) => void;
  }): void;
}

export interface DropboxWindow extends Window {
  Dropbox?: DropboxSaverApi;
}

function browserDocument(): Document {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("Cloud saving is only available in a browser.");
  }
  return document;
}

function waitForScript(
  script: HTMLScriptElement,
  verify: () => boolean,
  missingMessage: string,
  removeOnError: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      script.dataset.rzLoaded = "true";
      if (verify()) {
        resolve();
      } else {
        if (removeOnError) script.remove();
        reject(new Error(missingMessage));
      }
    };
    const handleError = () => {
      cleanup();
      if (removeOnError) script.remove();
      reject(new Error(missingMessage));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (script.dataset.rzLoaded === "true") {
      queueMicrotask(handleLoad);
    }
  });
}

/**
 * Loads Google's official browser OAuth library only after a guest elects to
 * use Drive. The module-level promise lets every gallery control share one
 * script request.
 */
export function loadGoogleIdentityScript(): Promise<void> {
  const target = browserDocument();
  if ((window as GoogleIdentityWindow).google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (googleIdentityLoad) return googleIdentityLoad;

  const existing = target.querySelector<HTMLScriptElement>(
    `script[src="${GOOGLE_IDENTITY_SCRIPT}"]`,
  );
  const script = existing ?? target.createElement("script");
  if (!existing) {
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.dataset.rzGoogleIdentity = "true";
  }

  googleIdentityLoad = waitForScript(
    script,
    () => Boolean((window as GoogleIdentityWindow).google?.accounts?.oauth2),
    "Google Drive could not load.",
    !existing,
  ).catch((error) => {
    googleIdentityLoad = null;
    throw error;
  });
  if (!existing) target.head.append(script);
  return googleIdentityLoad;
}

/**
 * Loads Dropbox Saver on demand. Dropbox binds its public app key while the
 * script initializes, so a page cannot safely mix keys.
 */
export function loadDropboxSaverScript(appKey: string): Promise<void> {
  const target = browserDocument();
  if ((window as DropboxWindow).Dropbox) return Promise.resolve();
  if (dropboxSaverLoad) {
    if (dropboxSaverLoad.appKey !== appKey) {
      return Promise.reject(
        new Error("Dropbox is already configured with a different app key."),
      );
    }
    return dropboxSaverLoad.promise;
  }

  const existing = target.querySelector<HTMLScriptElement>("#dropboxjs");
  const existingKey = existing?.dataset.appKey;
  if (existing && existingKey !== appKey) {
    return Promise.reject(
      new Error("Dropbox is already configured with a different app key."),
    );
  }

  const script = existing ?? target.createElement("script");
  if (!existing) {
    script.id = "dropboxjs";
    script.src = DROPBOX_SAVER_SCRIPT;
    script.async = true;
    script.dataset.appKey = appKey;
    script.dataset.rzDropboxSaver = "true";
  }

  const promise = waitForScript(
    script,
    () => Boolean((window as DropboxWindow).Dropbox),
    "Dropbox could not load.",
    !existing,
  ).catch((error) => {
    dropboxSaverLoad = null;
    throw error;
  });
  dropboxSaverLoad = { appKey, promise };
  if (!existing) target.head.append(script);
  return promise;
}

export function requestGoogleDriveToken(
  clientId: string,
  target: GoogleIdentityWindow = window,
): Promise<string> {
  const oauth = target.google?.accounts?.oauth2;
  if (!oauth) {
    return Promise.reject(
      new Error("Google Drive is still loading. Try again in a moment."),
    );
  }

  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.access_token) {
          resolve(response.access_token);
          return;
        }
        reject(
          new Error(
            response.error_description ??
              response.error ??
              "Google Drive access was not granted.",
          ),
        );
      },
      error_callback: (error) => {
        reject(
          new Error(
            error.type === "popup_closed"
              ? "Google Drive sign-in was closed."
              : "Could not open Google Drive sign-in.",
          ),
        );
      },
    });
    client.requestAccessToken();
  });
}

function responseMessage(response: Response, fallback: string): Promise<string> {
  return response
    .json()
    .then((body: unknown) => {
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error?: { message?: unknown } }).error?.message ===
          "string"
      ) {
        return (body as { error: { message: string } }).error.message;
      }
      return fallback;
    })
    .catch(() => fallback);
}

export interface GoogleDriveUploadOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function waitWithSignal(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function retryableDriveStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function uploadedByteOffset(response: Response): number {
  const range = response.headers.get("range");
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/i.exec(range.trim());
  if (!match) return 0;
  const lastByte = Number(match[1]);
  return Number.isSafeInteger(lastByte) ? lastByte + 1 : 0;
}

type DriveSessionStatus =
  | { complete: true }
  | { complete: false; offset: number; retryable: boolean };

async function inspectDriveSession(
  uploadUrl: string,
  totalBytes: number,
  accessToken: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<DriveSessionStatus> {
  const response = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-range": `bytes */${totalBytes}`,
    },
    signal,
  });
  if (response.ok) return { complete: true };
  if (response.status === 308) {
    return {
      complete: false,
      offset: uploadedByteOffset(response),
      retryable: true,
    };
  }
  if (retryableDriveStatus(response.status)) {
    return { complete: false, offset: 0, retryable: true };
  }
  throw new Error(
    await responseMessage(response, "Google Drive upload session expired."),
  );
}

/**
 * Streams one selected original through the browser into a Drive resumable
 * upload session. The OAuth token is caller-owned and never persisted here.
 */
export async function uploadOriginalToGoogleDrive(
  item: OriginalDownload,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  options: GoogleDriveUploadOptions = {},
): Promise<void> {
  const { signal } = options;
  const maxAttempts = Math.max(
    1,
    Math.min(
      options.maxAttempts ?? GOOGLE_DRIVE_UPLOAD_MAX_ATTEMPTS,
      GOOGLE_DRIVE_UPLOAD_MAX_ATTEMPTS,
    ),
  );
  const wait = options.wait ?? waitWithSignal;

  const source = await fetchImpl(item.signedUrl, { signal });
  if (!source.ok) {
    throw new Error(`Could not download ${item.filename}.`);
  }
  const blob = await source.blob();
  const mediaType = blob.type || "application/octet-stream";

  const session = await fetchImpl(
    DRIVE_UPLOAD_ENDPOINT,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(blob.size),
        "x-upload-content-type": mediaType,
      },
      body: JSON.stringify({ name: item.filename }),
      signal,
    },
  );
  if (!session.ok) {
    throw new Error(
      await responseMessage(
        session,
        `Google Drive could not prepare ${item.filename}.`,
      ),
    );
  }

  const uploadUrl = session.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Google Drive did not return an upload location.");
  }

  let offset = 0;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const uploaded = await fetchImpl(uploadUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": mediaType,
          "content-range": `bytes ${offset}-${blob.size - 1}/${blob.size}`,
        },
        body: offset === 0 ? blob : blob.slice(offset),
        signal,
      });
      if (uploaded.ok) return;
      if (uploaded.status === 308) {
        offset = uploadedByteOffset(uploaded);
        if (offset >= blob.size) {
          const status = await inspectDriveSession(
            uploadUrl,
            blob.size,
            accessToken,
            fetchImpl,
            signal,
          );
          if (status.complete) return;
          offset = status.offset;
        }
      } else if (retryableDriveStatus(uploaded.status)) {
        const status = await inspectDriveSession(
          uploadUrl,
          blob.size,
          accessToken,
          fetchImpl,
          signal,
        );
        if (status.complete) return;
        offset = status.offset || offset;
      } else {
        throw new Error(
          await responseMessage(
            uploaded,
            `Google Drive could not save ${item.filename}.`,
          ),
        );
      }
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      lastError = error;
      try {
        const status = await inspectDriveSession(
          uploadUrl,
          blob.size,
          accessToken,
          fetchImpl,
          signal,
        );
        if (status.complete) return;
        offset = status.offset || offset;
      } catch (statusError) {
        if (isAbort(statusError, signal)) throw statusError;
        lastError = statusError;
      }
    }

    if (attempt < maxAttempts) {
      await wait(attempt === 1 ? 250 : 750, signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Google Drive could not save ${item.filename}.`);
}

export function hasMinimumSignedUrlLifetime(
  items: readonly OriginalDownload[],
  minimumMilliseconds = DROPBOX_MIN_SIGNED_URL_LIFETIME_MS,
  now = Date.now(),
): boolean {
  return items.every((item) => {
    const expiresAt = Date.parse(item.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt - now >= minimumMilliseconds;
  });
}

export function toDropboxSaverFiles(
  items: readonly OriginalDownload[],
): DropboxSaverFile[] {
  if (items.length > DROPBOX_SAVER_MAX_FILES) {
    throw new RangeError(
      `Dropbox accepts up to ${DROPBOX_SAVER_MAX_FILES} photos at once.`,
    );
  }
  return items.map((item) => ({
    url: item.signedUrl,
    filename: item.filename,
  }));
}

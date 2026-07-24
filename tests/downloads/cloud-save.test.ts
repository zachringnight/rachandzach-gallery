import { describe, expect, it, vi } from "vitest";

import {
  DROPBOX_MIN_SIGNED_URL_LIFETIME_MS,
  DROPBOX_SAVER_MAX_FILES,
  GOOGLE_DRIVE_FILE_SCOPE,
  hasMinimumSignedUrlLifetime,
  requestGoogleDriveToken,
  toDropboxSaverFiles,
  uploadOriginalToGoogleDrive,
  type GoogleIdentityWindow,
} from "@/lib/downloads/cloud-save";
import type { OriginalDownload } from "@/lib/downloads/contracts";

const ITEM: OriginalDownload = {
  photoId: "photo-1",
  filename: "RZ 001.jpg",
  bytes: 5,
  sha256: "a".repeat(64),
  signedUrl: "https://storage.example.test/signed/photo-1",
  expiresAt: "2026-07-24T12:00:00.000Z",
};

describe("Google Drive authorization", () => {
  it("requests only drive.file and returns the short-lived access token", async () => {
    let config:
      | {
          client_id: string;
          scope: string;
          callback: (response: { access_token?: string }) => void;
        }
      | undefined;
    const requestAccessToken = vi.fn();
    const target = {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn((nextConfig) => {
              config = nextConfig;
              return { requestAccessToken };
            }),
          },
        },
      },
    } as unknown as GoogleIdentityWindow;

    const tokenPromise = requestGoogleDriveToken("public-client-id", target);
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
    expect(config?.client_id).toBe("public-client-id");
    expect(config?.scope).toBe(GOOGLE_DRIVE_FILE_SCOPE);

    config?.callback({ access_token: "short-lived-token" });
    await expect(tokenPromise).resolves.toBe("short-lived-token");
  });

  it("fails closed while the official identity library is unavailable", async () => {
    await expect(
      requestGoogleDriveToken(
        "public-client-id",
        {} as unknown as GoogleIdentityWindow,
      ),
    ).rejects.toThrow(/still loading/i);
  });
});

describe("Google Drive uploads", () => {
  it("downloads the signed original, creates a resumable session, then uploads the blob", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(["photo"], { type: "image/jpeg" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { location: "https://upload.example.test/session-1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "drive-file-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await uploadOriginalToGoogleDrive(
      ITEM,
      "short-lived-token",
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(ITEM.signedUrl);
    const [sessionUrl, sessionInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(sessionUrl).toContain("uploadType=resumable");
    expect(sessionInit.headers).toMatchObject({
      authorization: "Bearer short-lived-token",
      "x-upload-content-type": "image/jpeg",
    });
    expect(JSON.parse(String(sessionInit.body))).toEqual({
      name: ITEM.filename,
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://upload.example.test/session-1",
    );
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe("PUT");
  });

  it("never contacts Drive when the signed original cannot be read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      uploadOriginalToGoogleDrive(
        ITEM,
        "token",
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/could not download/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes at the server-reported byte after an interrupted upload", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(["photo"], { type: "image/jpeg" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { location: "https://upload.example.test/session-1" },
        }),
      )
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: { range: "bytes=0-2" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await uploadOriginalToGoogleDrive(
      ITEM,
      "short-lived-token",
      fetchMock as unknown as typeof fetch,
      { wait },
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const probeInit = fetchMock.mock.calls[3][1] as RequestInit;
    expect(probeInit.headers).toMatchObject({
      "content-range": "bytes */5",
    });
    const resumedInit = fetchMock.mock.calls[4][1] as RequestInit;
    expect(resumedInit.headers).toMatchObject({
      "content-range": "bytes 3-4/5",
    });
    expect((resumedInit.body as Blob).size).toBe(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("accepts a completed session after the final response is lost", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(["photo"], { type: "image/jpeg" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { location: "https://upload.example.test/session-1" },
        }),
      )
      .mockRejectedValueOnce(new TypeError("response was lost"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await uploadOriginalToGoogleDrive(
      ITEM,
      "short-lived-token",
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("bounds resumable recovery attempts", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(["photo"], { type: "image/jpeg" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { location: "https://upload.example.test/session-1" },
        }),
      )
      .mockRejectedValueOnce(new TypeError("upload network error"))
      .mockRejectedValueOnce(new TypeError("probe network error"))
      .mockRejectedValueOnce(new TypeError("upload network error"))
      .mockRejectedValueOnce(new TypeError("probe network error"));

    await expect(
      uploadOriginalToGoogleDrive(
        ITEM,
        "short-lived-token",
        fetchMock as unknown as typeof fetch,
        { maxAttempts: 2, wait },
      ),
    ).rejects.toThrow(/probe network error/i);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});

describe("Dropbox Saver payloads", () => {
  it("passes only signed URLs and filenames to Dropbox", () => {
    expect(toDropboxSaverFiles([ITEM])).toEqual([
      { url: ITEM.signedUrl, filename: ITEM.filename },
    ]);
  });

  it("enforces Dropbox's documented 100-file bound", () => {
    const items = Array.from(
      { length: DROPBOX_SAVER_MAX_FILES + 1 },
      (_, i) => ({
        ...ITEM,
        photoId: `photo-${i}`,
        filename: `photo-${i}.jpg`,
      }),
    );
    expect(() => toDropboxSaverFiles(items)).toThrow(/up to 100 photos/i);
  });

  it("requires enough signed-URL lifetime for a Saver handoff", () => {
    const now = Date.parse("2026-07-24T12:00:00.000Z");
    expect(
      hasMinimumSignedUrlLifetime(
        [
          {
            ...ITEM,
            expiresAt: new Date(
              now + DROPBOX_MIN_SIGNED_URL_LIFETIME_MS,
            ).toISOString(),
          },
        ],
        DROPBOX_MIN_SIGNED_URL_LIFETIME_MS,
        now,
      ),
    ).toBe(true);
    expect(
      hasMinimumSignedUrlLifetime(
        [
          {
            ...ITEM,
            expiresAt: new Date(
              now + DROPBOX_MIN_SIGNED_URL_LIFETIME_MS - 1,
            ).toISOString(),
          },
        ],
        DROPBOX_MIN_SIGNED_URL_LIFETIME_MS,
        now,
      ),
    ).toBe(false);
  });
});

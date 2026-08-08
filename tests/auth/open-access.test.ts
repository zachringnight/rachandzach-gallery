import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOpenAccess } from "@/lib/auth/open-access";

/**
 * This module is one boolean, and that boolean is the whole reason the
 * archive is not public. While open, everything is: all 1,721 photographs,
 * every guest name and face crop, the signed originals, and an /admin that
 * writes to the live database.
 *
 * Until now nothing tested it, so deleting the VERCEL_ENV clause -- the guard
 * against the flag being copied into Production by a routine "copy env"
 * action -- was a fully green build and a fully open site. These tests exist
 * so that specific edit fails loudly.
 */
describe("isOpenAccess", () => {
  const original = {
    OPEN_ACCESS: process.env.OPEN_ACCESS,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  function setEnv(open: string | undefined, vercel: string | undefined) {
    if (open === undefined) delete process.env.OPEN_ACCESS;
    else process.env.OPEN_ACCESS = open;
    if (vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercel;
  }

  beforeEach(() => {
    setEnv(undefined, undefined);
  });

  afterEach(() => {
    setEnv(original.OPEN_ACCESS, original.VERCEL_ENV);
  });

  it("is off by default", () => {
    expect(isOpenAccess()).toBe(false);
  });

  it("is OFF in production even when the flag is set", () => {
    // The one that matters. An env var can be copied between Vercel scopes,
    // so intent alone must never be able to open production.
    setEnv("1", "production");
    expect(isOpenAccess()).toBe(false);
  });

  it("is on in preview when the flag is set", () => {
    setEnv("1", "preview");
    expect(isOpenAccess()).toBe(true);
  });

  it("is on in development when the flag is set", () => {
    setEnv("1", "development");
    expect(isOpenAccess()).toBe(true);
  });

  it("is on locally, where VERCEL_ENV is undefined", () => {
    setEnv("1", undefined);
    expect(isOpenAccess()).toBe(true);
  });

  it("is off in preview without the flag", () => {
    setEnv(undefined, "preview");
    expect(isOpenAccess()).toBe(false);
  });

  it("requires exactly \"1\", not any truthy string", () => {
    for (const value of ["true", "yes", "0", "", "TRUE", " 1"]) {
      setEnv(value, "preview");
      expect(isOpenAccess(), `OPEN_ACCESS=${JSON.stringify(value)}`).toBe(false);
    }
  });
});

"use client";

/**
 * Guest password form (packet 04). A plain HTML POST to /api/access/login so
 * it works without JavaScript; the only client behavior is disabling the
 * button during submit. The password is never handled in client state.
 */
import { useState } from "react";

interface AccessFormProps {
  nextPath: string;
  errorMessage: string | null;
}

export function AccessForm({ nextPath, errorMessage }: AccessFormProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      method="post"
      action="/api/access/login"
      onSubmit={() => setSubmitting(true)}
      className="mt-6 flex flex-col gap-4"
    >
      <input type="hidden" name="next" value={nextPath} />
      <label
        htmlFor="gallery-password"
        className="text-sm font-medium"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Password
        <input
          id="gallery-password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full border px-4 py-3 text-base outline-none"
          style={{
            borderColor: "var(--color-sand)",
            borderRadius: "var(--radius-card)",
            backgroundColor: "var(--color-cream)",
            color: "var(--color-ink)",
          }}
        />
      </label>
      {errorMessage ? (
        <p
          role="alert"
          className="text-sm"
          // Ink, not coral: coral on cream is 2.54:1 and fails WCAG AA for
          // text (flagged by the packet 12 accessibility scan). Coral stays
          // decorative-only; error text reads in ink with the coral border
          // carrying the error affordance.
          style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-3 text-sm font-semibold uppercase tracking-wide disabled:opacity-60"
        style={{
          backgroundColor: "var(--color-ink)",
          color: "var(--color-cream)",
          borderRadius: "var(--radius-card)",
          fontFamily: "var(--font-body)",
        }}
      >
        {submitting ? "Checking..." : "Come on in"}
      </button>
    </form>
  );
}

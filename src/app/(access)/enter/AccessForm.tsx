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
      className="atlas-access-form"
    >
      <input type="hidden" name="next" value={nextPath} />
      <label
        htmlFor="gallery-password"
        className="atlas-access-label"
      >
        Password
        <input
          id="gallery-password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="atlas-access-input"
        />
      </label>
      {errorMessage ? (
        <p
          role="alert"
          className="atlas-access-error"
          // Ink, not coral: coral on cream is 2.54:1 and fails WCAG AA for
          // text (flagged by the packet 12 accessibility scan). Coral stays
          // decorative-only; error text reads in ink with the coral border
          // carrying the error affordance.
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="atlas-access-submit"
      >
        {submitting ? "Checking..." : "Come on in"}
      </button>
    </form>
  );
}

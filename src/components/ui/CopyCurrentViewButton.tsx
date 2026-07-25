"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface CopyCurrentViewButtonProps {
  className?: string;
  label?: string;
}

async function copyText(value: string): Promise<void> {
  let clipboardError: unknown;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (typeof document.execCommand !== "function") {
    throw clipboardError instanceof Error
      ? clipboardError
      : new Error("Clipboard copy failed.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy failed.");
}

/**
 * Copies the browser's canonical current URL, including any gallery/admin
 * filters already reflected through history.replaceState().
 */
export function CopyCurrentViewButton({
  className,
  label = "Copy current view",
}: CopyCurrentViewButtonProps) {
  const [state, setState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const resetTimer = useRef<number | null>(null);
  const operationSeq = useRef(0);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    const operation = operationSeq.current + 1;
    operationSeq.current = operation;
    setState("copying");
    try {
      await copyText(window.location.href);
      if (operation !== operationSeq.current) return;
      setState("copied");
    } catch {
      if (operation !== operationSeq.current) return;
      setState("error");
    }
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(() => setState("idle"), 2_000);
  }, []);

  const visibleLabel =
    state === "copied" ? "Copied" : state === "error" ? "Try again" : label;

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={className}
      aria-busy={state === "copying"}
      disabled={state === "copying"}
      aria-label={label}
      title={label}
    >
      {state === "copied" ? (
        <Check aria-hidden="true" size={15} strokeWidth={1.7} />
      ) : (
        <Copy aria-hidden="true" size={15} strokeWidth={1.6} />
      )}
      <span>{visibleLabel}</span>
    </button>
  );
}

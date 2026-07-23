import { featureFlags } from "@/content/features";
import {
  isApprovedMemoryNoteVisible,
  type ApprovedMemoryNoteConfig,
} from "@/lib/modules/contracts";

export interface ApprovedMemoryNoteProps {
  /**
   * Pass the result of resolveApprovedMemoryNote (or null when there is no
   * eligible note for this photo). This component never decides eligibility
   * itself; it only renders what it is handed, once memoryNotes is on.
   */
  note: ApprovedMemoryNoteConfig | null;
}

/**
 * Short uploader context, rendered as a caption. Renders nothing at all
 * unless BOTH the memoryNotes flag is on and a resolved, already-approved
 * note was supplied (defense in depth beyond whatever gate the caller
 * applied). The contributor's name only ever appears when they opted in by
 * giving one at upload time (ApprovedMemoryNoteConfig.contributorDisplayName
 * is null otherwise); an un-named note renders anonymously rather than
 * guessing at a name.
 */
export function ApprovedMemoryNote({ note }: ApprovedMemoryNoteProps) {
  if (!isApprovedMemoryNoteVisible(note, featureFlags.memoryNotes)) return null;
  const { noteText, contributorDisplayName } = note as ApprovedMemoryNoteConfig;

  return (
    <figcaption className="mt-2 font-body text-sm italic text-muted">
      &ldquo;{noteText}&rdquo;
      {contributorDisplayName ? (
        <span className="not-italic"> &middot; {contributorDisplayName}</span>
      ) : null}
    </figcaption>
  );
}

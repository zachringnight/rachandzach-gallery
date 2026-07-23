"use client";

export interface SearchExamplesProps {
  onPick: (query: string) => void;
}

/**
 * Approachable prompts based on visual categories only -- scenes and
 * objects, never a person's name (Moment Search performs no face
 * recognition or identity inference; see the packet's Privacy and model
 * rules).
 */
const EXAMPLES = [
  "sunset kiss",
  "champagne toast",
  "people dancing",
  "first dance",
  "confetti",
  "laughing at the table",
  "flower details",
  "golden hour portraits",
] as const;

export function SearchExamples({ onPick }: SearchExamplesProps) {
  return (
    <div className="atlas-search-examples" aria-label="Example searches">
      {EXAMPLES.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() => onPick(example)}
          className="atlas-picker-chip"
        >
          {example}
        </button>
      ))}
    </div>
  );
}

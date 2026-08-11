"use client";

import { MOMENT_SEARCH_EXAMPLES } from "@/lib/search/contracts";

export interface SearchExamplesProps {
  onPick: (query: string) => void;
}

/** The prompt list itself lives in the client-safe contracts leaf so server
 *  components (BrowseLanding) can read it too. See its doc comment. */
const EXAMPLES = MOMENT_SEARCH_EXAMPLES;

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

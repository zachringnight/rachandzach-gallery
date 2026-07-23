"use client";

import { useEffect, useState } from "react";

/**
 * Comp B (Gallery House): the sticky chapter index rail.
 *
 * Tracks scroll position with a single IntersectionObserver over the room
 * sections and marks the room nearest the reading line as current. Below lg
 * the rail becomes a slim sticky strip of plate numerals; the room titles
 * stay in each link's accessible name. All visual states live in the page's
 * scoped compb-* styles; the only transition is a color/opacity change on
 * the current marker, so the rail is quiet under any motion preference.
 */

export interface ChapterIndexItem {
  /** Section id of the room this entry points at. */
  id: string;
  /** Roman plate numeral, decorative (the title carries the meaning). */
  numeral: string;
  title: string;
}

export function ChapterIndex({ chapters }: { chapters: ChapterIndexItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections = chapters
      .map((chapter) => document.getElementById(chapter.id))
      .filter((node): node is HTMLElement => node !== null);
    if (sections.length === 0) return;

    // A narrow band around the reading line (roughly 30% to 45% down the
    // viewport): whichever room crosses it becomes current. Topmost wins
    // when two rooms straddle the band during fast scrolls.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [chapters]);

  return (
    <nav aria-label="Chapters" className="compb-rail">
      <ol>
        {chapters.map((chapter) => (
          <li key={chapter.id}>
            <a
              href={`#${chapter.id}`}
              aria-current={activeId === chapter.id ? "true" : undefined}
              className="compb-rail-link"
            >
              <span className="compb-rail-numeral" aria-hidden="true">
                {chapter.numeral}
              </span>
              <span className="compb-rail-title">{chapter.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

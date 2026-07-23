"use client";

import { ArrowUpRight, Shuffle } from "lucide-react";
import { useCallback, useState } from "react";

import type { StoryPhotoContent } from "@/content/story-photos";
import { focalObjectPosition } from "@/content/story-photos";

export interface AtlasMoment {
  id: string;
  number: string;
  kicker: string;
  title: string;
  body: string;
  photo: StoryPhotoContent;
}

export function AtlasExplorer({ moments }: { moments: AtlasMoment[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMoment = moments[activeIndex];

  const selectRelative = useCallback(
    (delta: number) => {
      setActiveIndex((current) => (current + delta + moments.length) % moments.length);
    },
    [moments.length],
  );

  if (!activeMoment) return null;

  return (
    <section
      id="atlas"
      aria-labelledby="atlas-title"
      className="atlas-explorer"
      data-atlas-explorer
    >
      <div className="atlas-section-heading">
        <div>
          <p className="atlas-kicker">A personal atlas</p>
          <h2 id="atlas-title">Five moments. One very full weekend.</h2>
        </div>
        <p className="atlas-section-intro">
          Move through the weekend by moment, then open the full gallery to find the
          frames that feel like yours.
        </p>
      </div>

      <div className="atlas-explorer-grid">
        <div
          className="atlas-moment-tabs"
          role="tablist"
          aria-label="Explore the weekend by moment"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              selectRelative(1);
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              selectRelative(-1);
            }
            if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            }
            if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(moments.length - 1);
            }
          }}
        >
          {moments.map((moment, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={moment.id}
                id={`atlas-tab-${moment.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`atlas-panel-${moment.id}`}
                tabIndex={active ? 0 : -1}
                className="atlas-moment-tab"
                data-active={active ? "true" : "false"}
                onClick={() => setActiveIndex(index)}
              >
                <span className="atlas-moment-number">{moment.number}</span>
                <span className="atlas-moment-label">
                  <strong>{moment.title}</strong>
                  <small>{moment.kicker}</small>
                </span>
                <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.5} />
              </button>
            );
          })}

          <button
            type="button"
            className="atlas-surprise"
            onClick={() => selectRelative(2)}
          >
            <Shuffle aria-hidden="true" size={15} strokeWidth={1.5} />
            Surprise me
          </button>
        </div>

        <div
          id={`atlas-panel-${activeMoment.id}`}
          role="tabpanel"
          aria-labelledby={`atlas-tab-${activeMoment.id}`}
          className="atlas-moment-panel"
        >
          <figure key={activeMoment.id} className="atlas-moment-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeMoment.photo.src}
              alt={activeMoment.photo.alt}
              width={activeMoment.photo.width}
              height={activeMoment.photo.height}
              decoding="async"
              loading="lazy"
              style={{ objectPosition: focalObjectPosition(activeMoment.photo) }}
            />
            <figcaption>
              <span>{activeMoment.number} / 05</span>
              <span>{activeMoment.kicker}</span>
            </figcaption>
          </figure>

          <div className="atlas-moment-copy" aria-live="polite">
            <p className="atlas-kicker">{activeMoment.kicker}</p>
            <h3>{activeMoment.title}</h3>
            <p>{activeMoment.body}</p>
            <a href={`#${activeMoment.id}`} className="atlas-text-link">
              Read this chapter
              <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

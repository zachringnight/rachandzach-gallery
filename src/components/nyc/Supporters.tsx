import { Reveal } from "@/components/motion/Reveal";
import {
  hasSupporters,
  nycFundraiser,
  nycSupporters,
  visibleSupporters,
} from "@/content/nyc";

/**
 * The wall of people who have already given, and what they wrote.
 *
 * Renders NOTHING unless Rachel has approved the list (nycSupporters.approved)
 * and there is at least one usable entry. There is no empty state and no
 * placeholder: an unapproved or empty wall is simply absent from the page.
 *
 * The data is a hand-seeded list in src/content/nyc.ts, read once from NYRR
 * and reviewed by a person. Nothing here fetches anything at runtime, and no
 * donation amounts exist in the data model at all. See that file's header for
 * the approval and privacy rules. The section uses data-nosnippet while the
 * fundraiser page remains indexable.
 */
export function Supporters() {
  if (!hasSupporters()) return null;
  const people = visibleSupporters();
  if (people.length === 0) return null;

  return (
    <section
      className="atlas-nyc-supporters"
      aria-labelledby="nyc-supporters-title"
      /*
       * Asks search engines not to lift these names and messages into result
       * snippets, while the page itself stays indexable so the fundraiser can
       * be found.
       *
       * This is a courtesy, not a control. Crawlers still fetch and read this
       * text; only participating engines honour the hint, and only for
       * snippet display. If these names genuinely must not be public, the
       * lever is `approved: false` in src/content/nyc.ts, which removes the
       * section entirely.
       */
      data-nosnippet>
      <Reveal className="atlas-nyc-section-label">
        <p className="atlas-kicker">The people behind her</p>
        <span aria-hidden="true">04</span>
      </Reveal>

      <div className="atlas-nyc-supporters-body">
        <Reveal>
          <h2 id="nyc-supporters-title">
            She has not run a step of it alone.
          </h2>
        </Reveal>

        {/* Reveal renders a plain div (it has no "ul" tag option), so the
            wall class sits on the real <ul> inside it. */}
        <Reveal delayMs={70}>
          <ul className="atlas-nyc-supporter-wall">
            {people.map((person) => (
              <li key={`${person.name}-${person.message ?? ""}`}>
                {person.message ? (
                  <p className="atlas-nyc-supporter-message">{person.message}</p>
                ) : null}
                <p className="atlas-nyc-supporter-name">{person.name}</p>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal>
          <p className="atlas-nyc-supporters-note">
            {nycSupporters.note ??
              `Messages left on ${nycFundraiser.charityName} fundraising page, shared with thanks. Donation amounts are not shown.`}{" "}
            Supporter wall as of {nycSupporters.seededOn}.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

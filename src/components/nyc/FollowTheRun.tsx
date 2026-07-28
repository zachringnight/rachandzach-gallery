import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Reveal } from "@/components/motion/Reveal";
import { InstagramPostCard } from "@/components/nyc/InstagramPostCard";
import { hasInstagramPost, instagramPost, nycFundraiser } from "@/content/nyc";
import { SITE_ORIGIN } from "@/lib/redirects";

interface Channel {
  id: string;
  name: string;
  detail: string;
  href: string;
}

/**
 * "Follow along": where to watch the run happen, and how to pass it on.
 *
 * Channels are conditional on real content existing, so this never shows a
 * link that goes nowhere. Her NYRR fundraiser page is always present, which is
 * why the section is never empty.
 *
 * The share link is a plain mailto:. Email was the one sharing affordance on
 * the NYRR page worth keeping, and a mailto needs no JavaScript, no clipboard
 * permission, and no third-party share SDK (which the CSP would block anyway).
 */
export function FollowTheRun() {
  const channels: Channel[] = [];

  if (hasInstagramPost() && instagramPost.postUrl) {
    channels.push({
      id: "instagram",
      name: "Instagram",
      detail: "The post where she said out loud that she was doing this.",
      href: instagramPost.postUrl,
    });
  }

  channels.push({
    id: "nyrr",
    name: "Her NYRR fundraiser page",
    detail: "The live donation total and the full list of who has given.",
    href: nycFundraiser.fundraiserUrl,
  });

  channels.push({
    id: "race",
    name: nycFundraiser.raceName,
    detail: "What the race itself is, from New York Road Runners.",
    href: nycFundraiser.raceInfoUrl,
  });

  const showPost = hasInstagramPost();

  const shareSubject = encodeURIComponent("Rach is running the NYC Marathon");
  // Built from SITE_ORIGIN rather than a literal: this URL is pasted into
  // someone else's inbox, so a stale hardcoded origin would keep sending
  // people to the old domain long after a move, with nothing failing here.
  const shareBody = encodeURIComponent(
    `Rach is running the ${nycFundraiser.raceName} for ${nycFundraiser.charityFullName}. Her story and the donation link are here: ${SITE_ORIGIN}/nyc`,
  );

  return (
    <section
      className="atlas-nyc-follow"
      aria-labelledby="nyc-follow-title"
      data-post={showPost ? "true" : "false"}
    >
      <Reveal className="atlas-nyc-section-label">
        <p className="atlas-kicker">Follow along</p>
        <span aria-hidden="true">03</span>
      </Reveal>

      <div className="atlas-nyc-follow-body">
        <Reveal>
          <h2 id="nyc-follow-title">
            There is a whole build-up before there is a finish line.
          </h2>
        </Reveal>

        <div className="atlas-nyc-follow-layout">
          {/* Reveal renders a plain div (it has no "ul" tag option), so the
              list class sits on the real <ul> inside it. */}
          <Reveal delayMs={70}>
            <ul className="atlas-nyc-channels">
              {channels.map((channel, index) => (
                <li key={channel.id}>
                  <Link
                    href={channel.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span aria-hidden="true" className="atlas-nyc-channel-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="atlas-nyc-channel-name">
                      {channel.name}
                      <ArrowUpRight aria-hidden="true" size={16} />
                    </span>
                    <span className="atlas-nyc-channel-detail">
                      {channel.detail}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>

          {showPost ? (
            <Reveal delayMs={140}>
              <InstagramPostCard />
            </Reveal>
          ) : null}
        </div>

        <Reveal className="atlas-nyc-share">
          <p>Know someone who would back her?</p>
          <a href={`mailto:?subject=${shareSubject}&body=${shareBody}`}>
            Send this page by email
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        </Reveal>
      </div>
    </section>
  );
}

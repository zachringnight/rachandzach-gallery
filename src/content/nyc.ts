/**
 * Rachel's 2026 TCS New York City Marathon fundraiser.
 *
 * The story below is preserved from Rachel's NYRR fundraising page. Progress
 * is an explicitly dated snapshot rather than a scraped live total; the NYRR
 * page remains the canonical source for donations and current progress.
 */
export const nycFundraiser = {
  runnerName: "Rachel Casciano",
  raceName: "2026 TCS New York City Marathon",
  charityName: "Team for Kids",
  fundraiserUrl: "https://fundraisers.nyrr.org/rachel-casciano",
  donationUrl:
    "https://donations.nyrr.org/donations/new?fundraiser=fa3fbedc687074f450f7",
  impactReportUrl: "https://ceros.nyrr.org/p/p/1",
  photo: {
    src: "/nyc/rachel-running.jpg",
    width: 4251,
    height: 5314,
    alt: "Rachel smiling with her arms outstretched while running through a city race",
  },
  progress: {
    raised: 3981,
    goal: 10000,
    verifiedOn: "July 23, 2026",
  },
  story: [
    "Hi friends and family! I’m running the 2026 TCS New York City Marathon with Team for Kids, a team of adult runners who raise funds to support New York Road Runners' free youth and community programs. Team for Kids has raised over $120M and served 2.5M students in NYC and across the nation with the goal of encouraging lifelong physical activity.",
    "It’s no secret that running has played a pivotal role in my life - opening doors of opportunity and getting me through some of my hardest moments. I really don't know where I would be without it. All kids should have the same chance to experience the cathartic and life-changing power of running, and that's why I'm finding it so special to give back to the sport that gave me so much.",
    "Your donation* will help empower youth and communities to develop and encourage healthy habits via running, making it possible for more kids to further their lives through this transformational sport. Thank you for taking part in getting more kids running towards brighter futures, I appreciate it so much.",
  ],
  signoff: "With love, Rach",
  footnote:
    "*Donations are 100% tax deductible and support a 501(c)(3) non-profit organization.",
} as const;

export function fundraiserProgressPercent(
  raised: number = nycFundraiser.progress.raised,
  goal: number = nycFundraiser.progress.goal,
): number {
  if (!Number.isFinite(raised) || !Number.isFinite(goal) || goal <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((raised / goal) * 100)));
}

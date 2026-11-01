export const RACE_DATE = "2026-11-01";
export const RACE_DISTANCE = 26.2188;
export const BIB = "10378";
export const STORAGE_KEY = "rach-cheer-2026-v1";
export const DEFAULT_SETTINGS = { start: "09:10", finish: "3:25", stop: 0 };
export const NYRR_APP = "https://prod.nyrr.org/tcsnycmarathon/mobile-app";
export const COURSE_MAP = "https://cms.prod.nyrr.org/api/document-files/file/TCSNYCM26_Map_Course_090226_RD3.pdf";

export const STOPS = [
  {
    name: "Brooklyn", intersection: "Fourth Avenue & 36th Street", borough: "Brooklyn",
    mile: 5.4, buffer: 22, corner: "Southwest corner · west sidewalk",
    position: "Stand just before 36th Street as she runs north. Orange runners use the west roadway. You’re on Rach’s left.",
    walking: "Station to corner: under 0.1 mile · 1–3 minutes",
    steps: [
      "Start at Canal Street station, Manhattan. Follow signs for the Brooklyn-bound N toward Coney Island–Stillwell Avenue.",
      "Take the N to 36th Street in Brooklyn. The Q does not go to this stop.",
      "Exit on the west side of Fourth Avenue. Walk to the southwest corner of Fourth Avenue and 36th Street.",
    ],
    next: "As soon as Rach passes, return to 36th Street station. Your next stop is First Avenue in Manhattan.",
  },
  {
    name: "First Avenue", intersection: "First Avenue & East 96th Street", borough: "Manhattan",
    mile: 18, buffer: 16, corner: "Southwest corner · west sidewalk",
    position: "Stay on the west sidewalk, just before 96th Street as she runs north. Do not cross First Avenue. You’re on Rach’s left.",
    walking: "Q exit to corner: about 0.2 mile · 4–6 minutes",
    steps: [
      "Walk back to 36th Street station: under 0.1 mile. Take the first Manhattan-bound N or D to Atlantic Av–Barclays Center.",
      "Stay inside the station. Follow signs to the Manhattan-bound Q toward 96th Street. Allow 5–10 minutes for the transfer, plus the train wait.",
      "Take the Q to its last stop, 96th Street. Use the East 96th Street / Second Avenue exit.",
      "Walk east along 96th Street to First Avenue, about 0.2 mile. Stop on the west sidewalk at the southwest corner.",
    ],
    next: "Leave immediately after she passes. Walk west on 96th Street to Fifth Avenue. If transit delays cost you this sighting, go directly to Fifth Avenue instead.",
  },
  {
    name: "Fifth Avenue", intersection: "Fifth Avenue & East 96th Street", borough: "Manhattan",
    mile: 23.3, buffer: 12, corner: "Northeast corner · building side",
    position: "Stay on the building side, across from Central Park. She’ll be running south toward you. Do not cross Fifth Avenue. You’re on Rach’s left.",
    walking: "First to Fifth: about 0.6–0.7 mile · 20–25 minutes",
    steps: [
      "From First Avenue, walk west along East 96th Street, away from the river.",
      "Continue past Second, Third, Lexington, Park and Madison avenues. Allow 20–25 minutes for the roughly 0.6–0.7-mile walk with crowds.",
      "Stop at Fifth Avenue’s northeast corner, on the building side. Do not cross Fifth Avenue into Central Park.",
    ],
    next: "Rach has about 2.9 miles left. Use the group’s agreed post-race meeting point; this page does not set a reunion location.",
  },
] as const;

export function finishMinutes(value: string): number | null {
  const match = /^(\d):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 120 && minutes <= 480 ? minutes : null;
}

export function validStart(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function sightingTime(start: string, duration: number, mile: number): number {
  // Race day is after the DST transition. Never use the viewer's timezone.
  const timestamp = Date.parse(`${RACE_DATE}T${start}:00-05:00`) + duration * mile / RACE_DISTANCE * 60_000;
  return Math.round(timestamp / 60_000) * 60_000;
}

export function nyTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
  }).format(timestamp);
}

export function paceLabel(duration: number): string {
  const seconds = Math.round(duration * 60 / RACE_DISTANCE);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function mapLinks(stop: typeof STOPS[number]) {
  const query = encodeURIComponent(`${stop.intersection}, ${stop.borough}, New York, NY`);
  // Destination pins, not routing instructions: a navigation app may suggest
  // crossing the course. The viewing-side instructions stay on our page.
  return {
    apple: `https://maps.apple.com/?q=${query}`,
    google: `https://www.google.com/maps/search/?api=1&query=${query}`,
  };
}

export function itineraryText(start: string, duration: number): string {
  return [
    `RACH’S NYC MARATHON · November 1, 2026 · Bib ${BIB}`,
    `Orange Wave 1 · Start-line crossing ${start} New York time · Goal ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`,
    "All times and distances are approximate. Follow actual NYRR splits. We’re on Rach’s LEFT at every stop.",
    ...STOPS.map((stop, i) => {
      const estimate = sightingTime(start, duration, stop.mile);
      return `\n${i + 1}. ${stop.intersection} · Mile ~${stop.mile}\n${stop.corner}\nBe ready ${nyTime(estimate - stop.buffer * 60_000)} · Estimated passing ${nyTime(estimate)}\n${stop.position}\n${stop.walking}\n${stop.steps.join("\n")}\n${stop.next}`;
    }),
    `\nEstimated finish: ${nyTime(sightingTime(start, duration, RACE_DISTANCE))}. Check N/D/Q service before each subway leg.`,
    "https://rachandzach.com/cheer",
  ].join("\n");
}

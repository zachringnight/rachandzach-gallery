"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUpRight, Check, Copy, Footprints, MapPin, RefreshCw, TrainFront } from "lucide-react";
import { BIB, COURSE_MAP, DEFAULT_SETTINGS, NYRR_APP, STOPS, STORAGE_KEY, finishMinutes, itineraryText, mapLinks, nyTime, paceLabel, sightingTime, validStart, RACE_DISTANCE } from "@/lib/cheer/plan";
import { ROUTES, STALE_AFTER_MS, type TransitSnapshot } from "@/lib/cheer/transit";
import styles from "./cheer.module.css";

const defaults = JSON.stringify(DEFAULT_SETTINGS);
let memorySettings = defaults;
let memoryOnly = false;
function readSettings() {
  if (memoryOnly) return memorySettings;
  try { return localStorage.getItem(STORAGE_KEY) ?? memorySettings; } catch { return memorySettings; }
}
function writeSettings(next: typeof DEFAULT_SETTINGS): boolean {
  memorySettings = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, memorySettings);
    memoryOnly = false;
  } catch { memoryOnly = true; }
  window.dispatchEvent(new Event("cheer-settings"));
  return !memoryOnly;
}
function subscribeSettings(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("cheer-settings", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("cheer-settings", callback);
  };
}
function decodeSettings(value: string): typeof DEFAULT_SETTINGS {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed.start === "string" && validStart(parsed.start) && typeof parsed.finish === "string" && finishMinutes(parsed.finish) !== null && Number.isInteger(parsed.stop) && parsed.stop >= 0 && parsed.stop < STOPS.length) return parsed;
  } catch { /* Invalid saved values restore the race-day defaults. */ }
  return DEFAULT_SETTINGS;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={15} aria-hidden="true" /></a>;
}

export function CheerCompanion() {
  const saved = useSyncExternalStore(subscribeSettings, readSettings, () => defaults);
  const settings = useMemo(() => decodeSettings(saved), [saved]);
  const duration = finishMinutes(settings.finish) ?? 205;
  const current = STOPS[settings.stop];
  const estimate = sightingTime(settings.start, duration, current.mile);
  const [formError, setFormError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [manualCopy, setManualCopy] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [transit, setTransit] = useState<TransitSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef<AbortController | null>(null);

  function save(next: typeof DEFAULT_SETTINGS) {
    setStorageWarning(!writeSettings(next));
  }

  const refreshTransit = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/cheer/transit", { cache: "no-store", signal: controller.signal });
      const data: TransitSnapshot = await response.json();
      if (!data.checkedAt || !Array.isArray(data.alerts) || !["fresh", "stale", "unavailable"].includes(data.status)) throw new Error("Invalid response");
      if (request.current === controller) setTransit(data);
    } catch {
      if (request.current === controller) setTransit({ status: "unavailable", feedAt: null, checkedAt: new Date().toISOString(), alerts: [], message: "Couldn’t refresh MTA alerts. Check the MTA app before traveling." });
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setNow(Date.now());
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Schedule the initial network check so Strict Mode can cancel its
    // first mount before starting a duplicate request.
    const initial = window.setTimeout(() => void refreshTransit(), 0);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshTransit();
    }, 5 * 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refreshTransit(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      request.current?.abort();
      request.current = null;
    };
  }, [refreshTransit]);

  const stale = transit?.status === "stale" || (transit?.feedAt ? now - Date.parse(transit.feedAt) > STALE_AFTER_MS : false);
  const verified = transit?.status === "fresh" && !stale;
  const links = mapLinks(current);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`${label} copied`);
      setManualCopy("");
    } catch {
      setCopyStatus("Copy isn’t available here. Select and copy the text below.");
      setManualCopy(text);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.date}>Sunday, November 1, 2026 · New York time</p>
          <h1>Let’s hear it for <em>Rach.</em></h1>
          <p className={styles.intro}>Three stops. One incredible run.</p>
        </div>
        <div className={styles.bib}>
          <span>Orange Wave 1</span><strong>{BIB}</strong>
          <button onClick={() => void copy(BIB, "Bib")}><Copy size={14} aria-hidden="true" /> Copy bib</button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <ExternalLink href={NYRR_APP}>Track in the NYRR app</ExternalLink>
        <button onClick={() => void copy(itineraryText(settings.start, duration), "Itinerary")}><Copy size={16} aria-hidden="true" /> Copy group plan</button>
        <a href="#itinerary">Full itinerary <ArrowDown size={15} aria-hidden="true" /></a>
        <a href="#subway">Subway status <ArrowDown size={15} aria-hidden="true" /></a>
      </div>
      <p className={styles.copyStatus} role="status">{copyStatus}</p>
      {manualCopy && <textarea className={styles.manualCopy} aria-label="Text to copy" readOnly value={manualCopy} onFocus={(e) => e.currentTarget.select()} />}

      <div className={styles.layout}>
        <div>
          <nav className={styles.stopNav} aria-label="Choose your viewing stop">
            {STOPS.map((stop, index) => <button key={stop.name} aria-pressed={settings.stop === index} onClick={() => save({ ...settings, stop: index })}><span>0{index + 1}</span>{" "}{stop.name}</button>)}
          </nav>
          <section className={styles.current} aria-labelledby="current-stop-heading">
            <div className={styles.currentTop}><span>Selected viewing stop</span><span>Mile ~{current.mile}</span></div>
            <h2 id="current-stop-heading">{current.intersection}</h2>
            <p className={styles.corner}><MapPin size={20} aria-hidden="true" />{current.corner}</p>
            <div className={styles.times}>
              <div><span>Be ready by</span><strong>{nyTime(estimate - current.buffer * 60_000)}</strong></div>
              <div><span>Estimated passing</span><strong>{nyTime(estimate)}</strong></div>
            </div>
            <p className={styles.position}>{current.position}</p>
            <p className={styles.walking}><Footprints size={19} aria-hidden="true" />{current.walking}</p>
            <ol className={styles.directions}>{current.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <div className={styles.maps}><ExternalLink href={links.apple}>Apple Maps</ExternalLink><ExternalLink href={links.google}>Google Maps</ExternalLink></div>
            <p className={styles.note}>Maps mark the intersection. Follow the sidewalk instructions above; don’t cross the race course.</p>
            <div className={styles.next}><strong>After you see her</strong><p>{current.next}</p></div>
          </section>

          <section className={styles.timing} aria-labelledby="timing-heading">
            <h2 id="timing-heading">Keep the timing flexible.</h2>
            <p>These are even-pace estimates, not live runner locations. Use actual NYRR splits and get there early.</p>
            <form key={`${settings.start}-${settings.finish}`} onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const start = String(data.get("start") ?? "");
              const finish = String(data.get("finish") ?? "").trim();
              if (!validStart(start) || finishMinutes(finish) === null) { setFormError("Enter a valid start time and a finish goal from 2:00 to 8:00 (hours:minutes)."); return; }
              save({ ...settings, start, finish });
              setFormError("");
            }}>
              <label>Start-line crossing<input name="start" type="time" defaultValue={settings.start} required aria-describedby="timing-help" /></label>
              <label>Finish goal (h:mm)<input name="finish" type="text" inputMode="text" defaultValue={settings.finish} required pattern="[2-8]:[0-5][0-9]" aria-describedby="timing-help" /></label>
              <button type="submit">Update times <Check size={16} aria-hidden="true" /></button>
            </form>
            {formError && <p className={styles.error} role="alert">{formError}</p>}
            <p id="timing-help" className={styles.note}>New York time on November 1. Use her actual start-line crossing if later than 9:10. Changes apply only on this device.</p>
            <div className={styles.finish}><span>{paceLabel(duration)} / mile</span><span>Estimated finish <strong>{nyTime(sightingTime(settings.start, duration, RACE_DISTANCE))}</strong></span></div>
            {storageWarning && <p className={styles.error}>Your browser couldn’t save these settings. They work now but may reset when you reopen the page.</p>}
          </section>
        </div>

        <aside id="subway" className={styles.transit} aria-labelledby="transit-heading">
          <div className={styles.transitHeading}><h2 id="transit-heading"><TrainFront size={22} aria-hidden="true" />Subway check</h2><button onClick={() => { setLoading(true); void refreshTransit(); }} disabled={loading} aria-label="Refresh subway alerts"><RefreshCw size={18} aria-hidden="true" />{loading ? "Checking" : "Refresh"}</button></div>
          <p className={styles.note}>N to Brooklyn → N or D to Atlantic–Barclays → Q to 96th.</p>
          <div className={styles.routeStatus}>
            {ROUTES.map((route) => {
              const alerts = transit?.alerts.filter((alert) => alert.routes.includes(route)) ?? [];
              return <div key={route}><strong>{route}</strong><span>{!transit ? "Checking…" : !verified ? "Unverified" : alerts.some((a) => !a.upcoming) ? "Alerts" : alerts.length ? "Upcoming" : "No reported alerts"}</span></div>;
            })}
          </div>
          {transit?.status === "unavailable" && <p className={styles.warning} role="status">{transit.message}</p>}
          {stale && <p className={styles.warning} role="status">MTA’s feed is over 10 minutes old. These alerts may be outdated. Check the MTA app before traveling.</p>}
          {verified && transit?.alerts.length === 0 && <p className={styles.clear}>No N/D/Q alerts reported for now or the next three hours. Train waits can still vary.</p>}
          {transit?.alerts.map((alert) => <details key={alert.id} className={styles.alert}>
            <summary><span className={styles.alertType}>{alert.routes.join(" / ")} · {alert.upcoming ? "Upcoming" : alert.type}</span>{alert.title.replace(/\[([A-Z0-9]+)\]/g, "$1")}</summary>
            {alert.description && <p>{alert.description.replace(/\[([A-Z0-9]+)\]/g, "$1")}</p>}
            {alert.period && <p className={styles.note}>{alert.period}</p>}
          </details>)}
          <div className={styles.feedNote}>
            {transit && <p>Last checked {nyTime(Date.parse(transit.checkedAt))}{transit.feedAt && <> · Feed updated {nyTime(Date.parse(transit.feedAt))}</>} · New York time</p>}
            <p>Refreshes every 5 minutes while open. Alerts are line-wide; read the direction and affected stations. “Delays” does not specify a number of minutes.</p>
            <ExternalLink href="https://www.mta.info/alerts">Official MTA alerts</ExternalLink>
          </div>
          <div className={styles.backup}><strong>If the trains slow you down</strong><p>If you can’t reach First Avenue before Rach, go directly to Fifth Avenue & 96th. That later sighting is your backup.</p></div>
        </aside>
      </div>

      <section id="itinerary" className={styles.itinerary} aria-labelledby="itinerary-heading">
        <h2 id="itinerary-heading">The whole route, at a glance.</h2>
        <p>All three times update with your start and finish goal. Stay on her left at every stop.</p>
        {STOPS.map((stop, index) => {
          const passing = sightingTime(settings.start, duration, stop.mile);
          return <details key={stop.name} className={styles.itineraryRow}>
            <summary><span className={styles.stopNumber}>0{index + 1}</span><span><strong>{stop.intersection}</strong><small>{stop.corner} · Mile ~{stop.mile}</small></span><span className={styles.rowTime}>{nyTime(passing)}<small>Estimated</small></span></summary>
            <div className={styles.expanded}><p><strong>Be ready by {nyTime(passing - stop.buffer * 60_000)}.</strong> {stop.position}</p><p>{stop.walking}</p><ol>{stop.steps.map((step) => <li key={step}>{step}</li>)}</ol><p>{stop.next}</p><button onClick={() => { save({ ...settings, stop: index }); document.getElementById("current-stop-heading")?.scrollIntoView({ block: "start" }); }}>Make this my viewing stop</button></div>
          </details>;
        })}
      </section>
      <footer className={styles.footer}><p>Comfortable shoes. Charged phone. Loud cheers.</p><span>Approximate course and walking distances.</span><ExternalLink href={COURSE_MAP}>Official course map</ExternalLink><span>Unlisted group link · No live location sharing</span></footer>
    </main>
  );
}

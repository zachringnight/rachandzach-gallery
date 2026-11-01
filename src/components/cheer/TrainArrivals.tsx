"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import { ARRIVAL_BOARDS, arrivalCountdown, arrivalStatus, type ArrivalsSnapshot } from "@/lib/cheer/arrivals";
import { nyTime } from "@/lib/cheer/plan";
import styles from "./cheer.module.css";

export function TrainArrivals() {
  const [snapshot, setSnapshot] = useState<ArrivalsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/cheer/arrivals", { cache: "no-store", signal: controller.signal });
      const data: ArrivalsSnapshot = await response.json();
      if (!data.checkedAt || !Array.isArray(data.services) || data.services.length !== 4) throw new Error("Invalid response");
      if (request.current === controller) { setSnapshot(data); setFailed(false); }
    } catch {
      if (request.current === controller) { setSnapshot(null); setFailed(true); }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); setNow(Date.now()); }
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial); window.clearInterval(poll); window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      request.current?.abort(); request.current = null;
    };
  }, [refresh]);

  return <section id="trains" className={styles.transit} aria-labelledby="arrivals-heading">
    <div className={styles.transitHeading}>
      <h2 id="arrivals-heading"><Clock3 size={22} aria-hidden="true" />Next trains</h2>
      <button disabled={loading} aria-label="Refresh train arrivals" onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={18} aria-hidden="true" />{loading ? "Checking" : "Refresh"}</button>
    </div>
    <p className={styles.note}>Live MTA predictions for your three subway legs. Times below are for trains arriving now, not a schedule for later.</p>
    {failed && <p className={styles.warning}>Train times are unavailable. Check station countdown clocks or the MTA app.</p>}
    {!snapshot && !failed && <p className={styles.note}>Checking arrival predictions…</p>}
    {snapshot && ARRIVAL_BOARDS.map((board) => {
      const services = snapshot.services.filter((service) => service.boardId === board.id);
      const trains = services.filter((service) => arrivalStatus(service, now) === "fresh")
        .flatMap((service) => service.arrivals.map((train) => ({ ...train, route: service.route })))
        .filter((train) => arrivalCountdown(train.at, now) !== null)
        .sort((a, b) => a.at.localeCompare(b.at)).slice(0, 3);
      return <section className={styles.arrivalBoard} key={board.id} aria-label={`${board.station} train times`}>
        <h3>{board.station}</h3><p className={styles.arrivalDirection}>{board.direction}</p>
        {services.map((service) => {
          const status = arrivalStatus(service, now);
          return <p key={service.route} className={status === "fresh" ? styles.arrivalSource : styles.warning}>
            {service.route}: {status === "unavailable" ? "predictions unavailable" : status === "stale" ? "feed is old; countdowns hidden" : `feed updated ${nyTime(Date.parse(service.feedAt!))}`}
          </p>;
        })}
        <ul className={styles.arrivalList}>{trains.map((train) => <li key={`${train.route}:${train.id}`}>
          <div className={styles.arrivalLine}><strong className={styles.trainLetter}>{train.route}</strong><strong>{arrivalCountdown(train.at, now)}</strong><span>{nyTime(Date.parse(train.at))}</span></div>
          {train.platform && <p>{train.platform}</p>}
          {train.destinationAt && <p>{board.destination} ~{nyTime(Date.parse(train.destinationAt))}</p>}
        </li>)}</ul>
        {trains.length === 0 && services.some((service) => arrivalStatus(service, now) === "fresh") && <p className={styles.note}>No current predictions for trains serving {board.destination}. This does not mean service has stopped.</p>}
      </section>;
    })}
    <div className={styles.feedNote}>
      {snapshot && <p>Last checked {nyTime(Date.parse(snapshot.checkedAt))} · New York time</p>}
      <p>Refreshes every 30 seconds while open. Predictions can change. Feeds older than 2 minutes are hidden. Check platform signs before boarding.</p>
      <a href="https://www.mta.info/" target="_blank" rel="noopener noreferrer">Official MTA information ↗</a>
    </div>
  </section>;
}

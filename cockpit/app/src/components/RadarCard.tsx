import { loadRadar } from "../api/radar";
import { useAsync } from "../hooks/useAsync";
import { euro } from "../lib/format";
import { RADAR_APP_URL, lastSeenText, radarOverview, type RadarOverview } from "../lib/radar";
import { ErrorNote, Kpi } from "./ui";

function auditsHint(overview: RadarOverview): string | undefined {
  return overview.halted > 0 ? `${String(overview.halted)} angehalten, wartet auf dich` : undefined;
}

function Card({ overview, now }: { overview: RadarOverview; now: Date }) {
  const { collector, latest } = overview;
  return (
    <section class="panel stack app-card" aria-labelledby="radar-head">
      <div class="spread">
        <h2 id="radar-head">RadarAuditor</h2>
        <span class="cluster">
          <a class="button" href="/radarauditor">Audits</a>
          <a class="button button--gold" href={RADAR_APP_URL} target="_blank" rel="noopener">Öffnen</a>
        </span>
      </div>
      <div class="kpis">
        <Kpi label="Sammler" value={collector.online ? "Online" : "Offline"} hint={lastSeenText(collector, now)} />
        <Kpi label="Laufende Audits" value={String(overview.running)} hint={auditsHint(overview)} />
        <Kpi label="Kosten im Monat" value={euro(overview.monthCost)} />
        <Kpi label="Letztes Urteil" value={latest === null ? "–" : latest.verdict.label} hint={latest === null ? undefined : `${latest.customer}${latest.points === null ? "" : ` · ${latest.points}`}`} />
      </div>
      {collector.blockedReason !== null && <p class="note note--bad small">{collector.blockedReason}</p>}
    </section>
  );
}

export function RadarCard({ reloadKey }: { reloadKey: number | undefined }) {
  const radar = useAsync(() => loadRadar(), [reloadKey]);
  const now = new Date();
  return (
    <>
      <ErrorNote message={radar.error} />
      {radar.data !== undefined && <Card overview={radarOverview(radar.data, now)} now={now} />}
    </>
  );
}

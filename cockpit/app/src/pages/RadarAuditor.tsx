import { useEffect, useState } from "preact/hooks";
import { loadRadar, startAudit } from "../api/radar";
import type { RadarCustomer, RadarSnapshot } from "../api/types";
import { Badge, Empty, ErrorNote, Loading, PageHead } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import { dateTime, euro } from "../lib/format";
import {
  PHASE_TONE, RADAR_APP_URL, collectorState, customerGroups, lastSeenText, monthSources, monthStart, unitPrice,
  type AuditRow, type CollectorState, type CustomerGroup, type SourceMonth, type Statement,
} from "../lib/radar";

const REFRESH_MS = 30_000;

function CollectorPanel({ state, now }: { state: CollectorState; now: Date }) {
  return (
    <section class="panel stack" aria-labelledby="collector-head">
      <div class="spread">
        <h2 id="collector-head">Sammler</h2>
        <Badge tone={state.online ? "good" : "bad"}>{state.online ? "Online" : "Offline"}</Badge>
      </div>
      <p class="small muted">{lastSeenText(state, now)}</p>
      {!state.online && <p class="note note--bad small">Der Sammler meldet sich nicht. Neue Audits warten, bis er wieder da ist.</p>}
      {state.blockedReason !== null && <p class="note note--bad small">{state.blockedReason}</p>}
    </section>
  );
}

function ConfirmBox({ name, onYes, onNo }: { name: string; onYes: () => void; onNo: () => void }) {
  return (
    <div class="note note--gold stack stack--tight" role="alert">
      <p>Sichtbarkeitsaudit für {name} wirklich starten? Er kostet Abfragen bei bezahlten Diensten.</p>
      <div class="cluster">
        <button class="button button--gold" type="button" onClick={onYes}>Ja, starten</button>
        <button class="button" type="button" onClick={onNo}>Abbrechen</button>
      </div>
    </div>
  );
}

function CustomerPicker({ customers, value, disabled, onChoose, onStart }: {
  customers: RadarCustomer[]; value: string; disabled: boolean; onChoose: (id: string) => void; onStart: () => void;
}) {
  return (
    <div class="cluster">
      <select class="select grow" aria-label="Kunde" value={value} onChange={(event) => { onChoose(event.currentTarget.value); }}>
        <option value="">Kunde wählen</option>
        {customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select>
      <button class="button button--gold" type="button" disabled={value === "" || disabled} onClick={onStart}>Audit starten</button>
    </div>
  );
}

function StartPanel({ customers, state, onStarted }: { customers: RadarCustomer[]; state: CollectorState; onStarted: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const action = useAction();
  const name = customers.find((entry) => entry.id === customerId)?.name ?? "";
  const start = () => {
    setConfirming(false);
    void action.run(async () => {
      await startAudit(customerId);
      setQueued(name);
      onStarted();
    });
  };
  const choose = (id: string) => { setCustomerId(id); setConfirming(false); setQueued(null); };
  return (
    <section class="panel stack" aria-labelledby="start-head">
      <h2 id="start-head">Audit starten</h2>
      <CustomerPicker customers={customers} value={customerId} disabled={state.blockedReason !== null || action.busy} onChoose={choose} onStart={() => { setConfirming(true); }} />
      {state.blockedReason !== null && <p class="small muted">Starten gesperrt: {state.blockedReason}</p>}
      {confirming && <ConfirmBox name={name} onYes={start} onNo={() => { setConfirming(false); }} />}
      {queued !== null && <p class="note note--good small" role="status">Audit für {queued} ist eingereiht. {state.online ? "Der Sammler holt ihn ab." : "Er startet, sobald der Sammler wieder da ist."}</p>}
      <ErrorNote message={action.error} />
    </section>
  );
}

function MonthPanel({ sources }: { sources: SourceMonth[] }) {
  return (
    <section class="panel stack" aria-labelledby="month-head">
      <h2 id="month-head">Kosten im Monat je Dienst</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Dienst</th><th class="num">Abfragen</th><th class="num">Kosten</th><th class="num">Limit</th></tr></thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.source}>
                <td>
                  {source.label}
                  {source.share !== null && <div class="bar" aria-hidden="true"><span style={{ width: `${String(Math.min(100, Math.round(source.share * 100)))}%` }} /></div>}
                </td>
                <td class="num">{source.requests}</td>
                <td class="num">{euro(source.cost)}</td>
                <td class="num">{source.limit === null ? "kein Limit" : euro(source.limit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatementTable({ title, data }: { title: string; data: Statement }) {
  return (
    <div class="stack stack--tight">
      <h3>{title}</h3>
      {data.lines.length === 0 ? <Empty>Keine bezahlten Abfragen.</Empty> : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Dienst</th><th class="num">Abfragen</th><th class="num">je Abfrage</th><th class="num">Summe</th></tr></thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={`${line.source}-${line.service}`}>
                  <td>{line.source}: {line.service}</td>
                  <td class="num">{line.calls}</td>
                  <td class="num">{line.unit === null ? "–" : unitPrice(line.unit)}</td>
                  <td class="num">{euro(line.total)}</td>
                </tr>
              ))}
              <tr><td colSpan={3}><strong>Gesamt</strong></td><td class="num"><strong>{euro(data.total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
      {data.subscriptionCalls > 0 && <p class="small muted">Dazu {data.subscriptionCalls} Abfragen über das Claude-Abo, ohne Einzelkosten.</p>}
    </div>
  );
}

function CostDetails({ row }: { row: AuditRow }) {
  return (
    <details class="more">
      <summary>Kosten und Kostenvoranschlag</summary>
      {row.estimate !== null && (
        <p class="small"><Badge tone={row.estimate.tone}>{row.estimate.label}</Badge> {row.audit.estimate_note ?? ""}</p>
      )}
      <StatementTable title="Kostenvoranschlag" data={row.planned} />
      <StatementTable title="Kostenaufstellung" data={row.actual} />
    </details>
  );
}

function AuditItem({ row }: { row: AuditRow }) {
  return (
    <li class="stack stack--tight">
      <div class="spread">
        <span class="cluster">
          <Badge tone={PHASE_TONE[row.phase]}>{row.status}</Badge>
          {row.verdict !== null && <Badge tone={row.verdict.tone}>{row.verdict.label}</Badge>}
          {row.monthly && <Badge>Monatsprüfung</Badge>}
          {row.points !== null && <strong class="num">{row.points}</strong>}
        </span>
        <span class="small muted num">{dateTime(row.audit.requested_at)}</span>
      </div>
      {row.verdict?.reason !== undefined && row.verdict.reason !== null && <p class="small">{row.verdict.reason}</p>}
      {row.audit.error !== null && <p class="note note--bad small">{row.audit.error}</p>}
      {row.failedRoutes > 0 && <p class="small muted">{row.failedRoutes} {row.failedRoutes === 1 ? "Messung" : "Messungen"} fehlgeschlagen.</p>}
      {row.repairs.map((line, index) => (
        <p key={index} class={line.tone === "" ? "note small" : `note note--${line.tone} small`}>{line.text}</p>
      ))}
      <div class="cluster">
        <a class="button" href={row.link} target="_blank" rel="noopener">Auswertung öffnen</a>
      </div>
      <CostDetails row={row} />
    </li>
  );
}

function CustomerPanel({ group }: { group: CustomerGroup }) {
  return (
    <section class="panel stack" aria-label={group.name}>
      <div class="stack stack--tight">
        <h2>{group.name}</h2>
        <p class="small muted">{group.keywords}</p>
      </div>
      <ul class="cards">{group.audits.map((row) => <AuditItem key={row.audit.id} row={row} />)}</ul>
    </section>
  );
}

function RadarBody({ data, onStarted }: { data: RadarSnapshot; onStarted: () => void }) {
  const now = new Date();
  const state = collectorState(data.heartbeat, now);
  return (
    <>
      <CollectorPanel state={state} now={now} />
      <StartPanel customers={data.customers} state={state} onStarted={onStarted} />
      <MonthPanel sources={monthSources(data.usage, data.sources, monthStart(now))} />
      {customerGroups(data).map((group) => <CustomerPanel key={group.customerId} group={group} />)}
      {data.audits.length === 0 && <Empty>Noch keine Audits.</Empty>}
    </>
  );
}

export function RadarAuditor() {
  const radar = useAsync(() => loadRadar(), []);
  useEffect(() => {
    const timer = setInterval(radar.reload, REFRESH_MS);
    return () => { clearInterval(timer); };
  }, [radar.reload]);
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Produkt" title="RadarAuditor">
        <a class="button button--gold" href={RADAR_APP_URL} target="_blank" rel="noopener">Öffnen</a>
      </PageHead>
      <ErrorNote message={radar.error} />
      {radar.data === undefined ? <Loading /> : <RadarBody data={radar.data} onStarted={radar.reload} />}
    </div>
  );
}

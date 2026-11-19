import { useState } from "preact/hooks";
import { haken, type Bestand } from "./bestand";
import { laufzeit } from "./anzeige";
import { SEIT_UPDATE } from "./Kontextleiste";
import { agentKarten, fortschrittAnzeige, type FortschrittAnzeige, type Kaertchen } from "./ordnung";
import { useJetzt } from "./useJetzt";
import type { Agent, SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

const SEKUNDE_MS = 1000;
const ART_TEXT: Readonly<Record<Kaertchen["art"], string>> = { skill: "Skill", plugin: "Plugin", konnektor: "Konnektor", status: "Sitzung" };

export function Fortschrittsbalken({ anzeige, klasse }: { anzeige: FortschrittAnzeige; klasse: string }) {
  if (anzeige.kind === "keiner") return null;
  if (anzeige.kind === "laufend") {
    return <span class={`${klasse} kz-balken kz-balken--laufend`} role="progressbar" aria-label="Fortschritt ohne Aufgabenliste"><span class="kz-balken__fuellung" /></span>;
  }
  const prozent = Math.round(anzeige.anteil * 100);
  return (
    <span class={`${klasse} kz-balken`} role="progressbar" aria-label={`Fortschritt ${anzeige.text} Aufgaben`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={prozent}
      title={`${anzeige.text} Aufgaben erledigt`}>
      <span class="kz-balken__fuellung" style={{ width: `${String(prozent)}%` }} />
    </span>
  );
}

interface SkillKlappeProps {
  readonly id: string;
  readonly karten: readonly Kaertchen[];
  readonly gesperrt: boolean;
  readonly onWeg: (karte: Kaertchen) => void;
}

function SkillKlappe({ id, karten, gesperrt, onWeg }: SkillKlappeProps) {
  if (karten.length === 0) return <p class="kz-leer kz-al__klappe" id={id}>Keine Skills geladen.</p>;
  return (
    <ul class="kz-al__klappe" id={id}>
      {karten.map((karte) => (
        <li key={`${karte.art}-${karte.kennung}`} class={`kz-pille kz-pille--${karte.art}`} title={`${ART_TEXT[karte.art]}: ${karte.kennung}`}>
          <span class="kz-pille__punkt" aria-hidden="true" />
          <span class="kz-pille__text">{karte.text}</span>
          {karte.entfernbar && (
            <button type="button" class="kz-pille__weg" disabled={gesperrt} aria-label={`${karte.text} für diese Sitzung abwählen`}
              title={karte.art === "skill" ? "Nicht mehr anwenden (Hinweis an Claude)" : "Für diese Sitzung abwählen"} onClick={() => { onWeg(karte); }}>×</button>
          )}
        </li>
      ))}
    </ul>
  );
}

interface ZeileProps {
  readonly agent: Agent;
  readonly art: string;
  readonly dauer: string;
  readonly karten: readonly Kaertchen[];
  readonly offen: boolean;
  readonly gesperrt: boolean;
  readonly onUmschalten: () => void;
  readonly onWeg: (karte: Kaertchen) => void;
}

function Zeile({ agent, art, dauer, karten, offen, gesperrt, onUmschalten, onWeg }: ZeileProps) {
  const fortschritt = fortschrittAnzeige(agent);
  const klappe = `kz-al-${agent.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return (
    <li class={`kz-al__eintrag kz-al__eintrag--${agent.stand}`}>
      <button type="button" class="kz-al__zeile" aria-expanded={offen} aria-controls={klappe} onClick={onUmschalten}
        title={`${agent.name} · ${art} · ${String(agent.aufrufe)} ${agent.aufrufe === 1 ? "Aufruf" : "Aufrufe"} · ${dauer}`}>
        <span class={`kz-dot kz-dot--${agent.stand === "wartet" ? "wartet" : agent.stand === "fertig" ? "beendet" : "arbeitet"}`} aria-hidden="true" />
        <span class="kz-al__name">{agent.name}</span>
        <span class="kz-al__info">{agent.stand === "fertig" ? "fertig" : agent.werkzeug ?? art}</span>
        <Fortschrittsbalken anzeige={fortschritt} klasse="kz-al__balken" />
        {fortschritt.kind === "zahl" && <span class="kz-al__zahl">{fortschritt.text}</span>}
        <span class="kz-al__skillzahl" title={`${String(karten.length)} Skills, Plugins und Konnektoren`}>◇ {karten.length}</span>
        <span class="kz-al__pfeil" aria-hidden="true">{offen ? "▴" : "▾"}</span>
      </button>
      {offen && <SkillKlappe id={klappe} karten={karten} gesperrt={gesperrt} onWeg={onWeg} />}
    </li>
  );
}

export interface AgentenlisteProps {
  readonly sitzung: SitzungsZustand | null;
  readonly bestand: Bestand | null;
  readonly starts: ReadonlyMap<string, number>;
  readonly steuernd: boolean;
  readonly keineDaten: boolean;
  readonly senden: Senden;
}

function useAufklapper() {
  const [offen, setOffen] = useState<ReadonlySet<string>>(new Set());
  const umschalten = (id: string) => {
    setOffen((alt) => {
      const neu = new Set(alt);
      if (!neu.delete(id)) neu.add(id);
      return neu;
    });
  };
  return { offen, umschalten };
}

export function Agentenliste({ sitzung, bestand, starts, steuernd, keineDaten, senden }: AgentenlisteProps) {
  const jetzt = useJetzt(SEKUNDE_MS);
  const { offen, umschalten } = useAufklapper();
  const [fehler, setFehler] = useState(false);
  const agenten = sitzung?.agenten ?? [];
  const gesperrt = !steuernd || sitzung === null || sitzung.prozess === "beendet" || sitzung.pausiert;
  const weg = (karte: Kaertchen) => { if (sitzung !== null && karte.art !== "status") setFehler(!senden(haken(sitzung.id, karte.art, karte.kennung, false))); };
  return (
    <section class="kz-panel kz-agentenliste" aria-labelledby="kz-agentenliste-titel">
      <h2 class="kz-ph" id="kz-agentenliste-titel">Agenten · {agenten.filter((agent) => agent.stand !== "fertig").length} aktiv</h2>
      <div class="kz-pb">
        {keineDaten && <p class="kz-seit-update" role="status">Agenten: {SEIT_UPDATE}</p>}
        {sitzung === null && <p class="kz-leer">Keine Sitzung gewählt.</p>}
        {sitzung !== null && agenten.length === 0 && !keineDaten && <p class="kz-leer">Gerade arbeitet kein Agent.</p>}
        {sitzung !== null && agenten.length > 0 && (
          <ul class="kz-al">
            {agenten.map((agent) => (
              <Zeile key={agent.id} agent={agent} art={agent.eltern === null ? (sitzung.modell ?? agent.typ) : agent.typ}
                dauer={laufzeit(jetzt - (starts.get(`${sitzung.id}|${agent.id}`) ?? jetzt))} karten={agentKarten(agent, sitzung, bestand)}
                offen={offen.has(agent.id)} gesperrt={gesperrt} onUmschalten={() => { umschalten(agent.id); }} onWeg={weg} />
            ))}
          </ul>
        )}
        {fehler && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
      </div>
    </section>
  );
}

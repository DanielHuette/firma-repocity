import { useState } from "preact/hooks";
import { uhrzeitText } from "./anzeige";
import { ersteZeile, kuerzen, type AgentAufruf, type Eintrag, type Knoten, type WerkzeugAufruf } from "./chat";
import { FrageImChat, PlanKarte, type KartenRahmen } from "./ChatKarten";
import { MarkdownAnsicht } from "./MarkdownAnsicht";

export interface EintragRahmen extends KartenRahmen {
  readonly laufend: string | null;
}

const ZUSAMMENFASSUNG = 56;
const LAENGSTE_EINGABE = 2000;
const LAENGSTES_ERGEBNIS = 4000;
const AGENT_STAND: Readonly<Record<string, string>> = { laeuft: "läuft", fertig: "fertig", ok: "fertig", fehler: "Fehler" };

function zeit(eintrag: Eintrag): string {
  return uhrzeitText(new Date(eintrag.zeit));
}

function standText(werkzeug: WerkzeugAufruf): string {
  if (werkzeug.status === "laeuft") return "läuft …";
  const zeile = ersteZeile(werkzeug.ergebnis ?? "", ZUSAMMENFASSUNG);
  if (werkzeug.status === "fehler") return `✗ ${zeile === "" ? "Fehler" : zeile}`;
  return `✓ ${zeile === "" ? "fertig" : zeile}`;
}

function eingabeText(eingabe: unknown): string {
  if (eingabe === undefined) return "";
  return typeof eingabe === "string" ? eingabe : JSON.stringify(eingabe, null, 2);
}

function Gekuerzt({ text, hoechstens }: { text: string; hoechstens: number }) {
  const teil = kuerzen(text, hoechstens);
  return (
    <>
      <pre class="kz-werkzeug__text">{teil.text}</pre>
      {teil.gekuerzt && <p class="kz-klein">Gekürzt: {hoechstens.toLocaleString("de-DE")} von {text.length.toLocaleString("de-DE")} Zeichen.</p>}
    </>
  );
}

function WerkzeugZeile({ eintrag, werkzeug }: { eintrag: Eintrag; werkzeug: WerkzeugAufruf }) {
  const eingabe = eingabeText(werkzeug.eingabe);
  return (
    <details class={`kz-werkzeug kz-werkzeug--${werkzeug.status}`}>
      <summary title={zeit(eintrag)}>
        <span class="kz-werkzeug__pfeil" aria-hidden="true">▸</span>
        <b>{werkzeug.name}</b>
        <span class="kz-werkzeug__kurz">{werkzeug.kurz}</span>
        <span class="kz-werkzeug__stand">{standText(werkzeug)}</span>
      </summary>
      <div class="kz-werkzeug__inhalt">
        {eingabe !== "" && <><p class="kz-werkzeug__titel">Eingabe</p><Gekuerzt text={eingabe} hoechstens={LAENGSTE_EINGABE} /></>}
        {werkzeug.ergebnis !== null && <><p class="kz-werkzeug__titel">Ergebnis</p><Gekuerzt text={werkzeug.ergebnis} hoechstens={LAENGSTES_ERGEBNIS} /></>}
        {werkzeug.ergebnis === null && <p class="kz-klein">Noch kein Ergebnis.</p>}
      </div>
    </details>
  );
}

function AgentKarte({ knoten, agent, rahmen }: { knoten: Knoten; agent: AgentAufruf; rahmen: EintragRahmen }) {
  const laeuft = agent.status === "laeuft";
  const [offen, setOffen] = useState(laeuft);
  const text = knoten.eintrag.text ?? "";
  return (
    <details class="kz-agentkarte" open={offen} onToggle={(ereignis) => { setOffen(ereignis.currentTarget.open); }}>
      <summary title={zeit(knoten.eintrag)}>
        <span class="kz-werkzeug__pfeil" aria-hidden="true">▸</span>
        <span class={laeuft ? "kz-dot kz-dot--arbeitet" : "kz-dot"} aria-hidden="true" />
        <b>{agent.typ}</b>
        <span class="kz-agentkarte__stand">· {AGENT_STAND[agent.status] ?? agent.status} · {knoten.kinder.length} {knoten.kinder.length === 1 ? "Eintrag" : "Einträge"}</span>
      </summary>
      <p class="kz-agentkarte__beschreibung">{agent.beschreibung}</p>
      {knoten.kinder.length > 0 && <div class="kz-agentkarte__kinder">{knoten.kinder.map((kind) => <EintragAnsicht key={kind.eintrag.id} knoten={kind} rahmen={rahmen} />)}</div>}
      {text !== "" && <div class="kz-agentkarte__ergebnis"><MarkdownAnsicht text={text} /></div>}
    </details>
  );
}

function ClaudeText({ eintrag, laufend }: { eintrag: Eintrag; laufend: boolean }) {
  const text = eintrag.text ?? "";
  if (text === "") return laufend ? <p class="kz-claude kz-claude--tippt" aria-label="Claude schreibt"><span /><span /><span /></p> : null;
  return <div class="kz-claude" title={zeit(eintrag)}><MarkdownAnsicht text={text} laufend={laufend} /></div>;
}

export function EintragAnsicht({ knoten, rahmen }: { knoten: Knoten; rahmen: EintragRahmen }) {
  const { eintrag } = knoten;
  const { werkzeug, agent, frage, plan } = eintrag;
  switch (eintrag.art) {
    case "du":
      return <div class="kz-du" title={zeit(eintrag)}>{eintrag.text}</div>;
    case "claude":
      return <ClaudeText eintrag={eintrag} laufend={eintrag.id === rahmen.laufend} />;
    case "system":
      return <p class="kz-system" title={zeit(eintrag)}>{eintrag.text}</p>;
    case "werkzeug":
      return werkzeug === null ? null : <WerkzeugZeile eintrag={eintrag} werkzeug={werkzeug} />;
    case "agent":
      return agent === null ? null : <AgentKarte knoten={knoten} agent={agent} rahmen={rahmen} />;
    case "frage":
      return frage === null ? null : <FrageImChat eintrag={eintrag.id} frage={frage} rahmen={rahmen} />;
    case "plan":
      return plan === null ? null : <PlanKarte eintrag={eintrag.id} plan={plan} rahmen={rahmen} />;
  }
}

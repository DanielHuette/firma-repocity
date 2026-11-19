import { useEffect, useState } from "preact/hooks";
import { MarkdownAnsicht } from "./MarkdownAnsicht";
import { fragenAntwort, frageAntwort, planAntwort, type Antworten, type FrageInhalt, type PlanEntscheidung, type PlanInhalt, type Teilfrage, type Wahl } from "./chat";
import { BESTAETIGUNG_MS, antwortLage, type AntwortLage, type Gesendet } from "./rueckmeldung";
import type { Meldung } from "./useBruecke";
import type { ClientNachricht } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

export interface KartenRahmen {
  readonly sitzung: string;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly meldungen: readonly Meldung[];
}

const NUR_STEUERND = "Antworten kann nur das steuernde Gerät.";
const KEINE_WAHL: Wahl = { gewaehlt: [], eigene: "" };

function useAbsenden(rahmen: KartenRahmen) {
  const [gesendet, setGesendet] = useState<Gesendet | null>(null);
  const [fehlgeschlagen, setFehlgeschlagen] = useState(false);
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    if (gesendet === null) return;
    const zeitgeber = setTimeout(() => { setJetzt(Date.now()); }, BESTAETIGUNG_MS);
    return () => { clearTimeout(zeitgeber); };
  }, [gesendet]);
  const absenden = (nachricht: ClientNachricht) => {
    const ok = rahmen.senden(nachricht);
    const um = Date.now();
    setFehlgeschlagen(!ok);
    setJetzt(um);
    if (ok) setGesendet({ um, letzteMeldung: rahmen.meldungen.reduce((hoechste, meldung) => Math.max(hoechste, meldung.nummer), 0) });
  };
  return { lage: antwortLage(gesendet, rahmen.meldungen, jetzt), fehlgeschlagen, absenden };
}

function AbsendeStand({ lage, fehlgeschlagen }: { lage: AntwortLage; fehlgeschlagen: boolean }) {
  if (fehlgeschlagen) return <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>;
  switch (lage.kind) {
    case "frei":
      return null;
    case "gesendet":
      return <p class="kz-klein" role="status">Gesendet, warte auf Claude Code …</p>;
    case "abgelehnt":
      return <p class="kz-fehler" role="alert">Die Brücke hat die Antwort abgelehnt: {lage.text} Du kannst erneut antworten.</p>;
    case "unbestaetigt":
      return <p class="kz-fehler" role="alert">Nach 5 Sekunden ist die Antwort nicht bestätigt. Sie ist wohl nicht angekommen; antworte erneut.</p>;
  }
}

function umschalten(frage: Teilfrage, alt: Wahl, label: string): Wahl {
  const an = alt.gewaehlt.includes(label);
  if (frage.mehrfach) return { ...alt, gewaehlt: an ? alt.gewaehlt.filter((wert) => wert !== label) : [...alt.gewaehlt, label] };
  return { ...alt, gewaehlt: an ? [] : [label] };
}

interface TeilProps {
  readonly frage: Teilfrage;
  readonly wahl: Wahl;
  readonly gesperrt: boolean;
  readonly aendern: (wahl: Wahl) => void;
}

function TeilfrageFeld({ frage, wahl, gesperrt, aendern }: TeilProps) {
  return (
    <fieldset class="kz-frage__teil" disabled={gesperrt}>
      <legend>{frage.kopf !== "" && <span class="kz-tag">{frage.kopf}</span>}<span class="kz-frage__text">{frage.frage}</span></legend>
      {frage.mehrfach && <p class="kz-klein">Mehrere Antworten möglich.</p>}
      <div class="kz-frage__optionen">
        {frage.optionen.map((option) => {
          const an = wahl.gewaehlt.includes(option.label);
          return (
            <button key={option.label} type="button" class={an ? "kz-opt kz-opt--an" : "kz-opt"} aria-pressed={an} onClick={() => { aendern(umschalten(frage, wahl, option.label)); }}>
              <span>{option.label}</span>{option.beschreibung !== "" && <small>{option.beschreibung}</small>}
            </button>
          );
        })}
      </div>
      <label class="kz-feld kz-frage__eigene">Eigene Antwort
        <input value={wahl.eigene} placeholder={frage.mehrfach ? "zusätzlich zu den gewählten" : "statt der Knöpfe"} onInput={(ereignis) => { aendern({ ...wahl, eigene: ereignis.currentTarget.value }); }} />
      </label>
    </fieldset>
  );
}

function OffeneFrage({ eintrag, frage, rahmen }: { eintrag: string; frage: FrageInhalt; rahmen: KartenRahmen }) {
  const [wahl, setWahl] = useState<Readonly<Record<string, Wahl>>>({});
  const { lage, fehlgeschlagen, absenden } = useAbsenden(rahmen);
  const antworten = fragenAntwort(frage.fragen, wahl);
  const gesperrt = !rahmen.steuernd || lage.kind === "gesendet";
  return (
    <article class="kz-frage" aria-label="Frage von Claude">
      {frage.fragen.map((teil) => (
        <TeilfrageFeld key={teil.frage} frage={teil} wahl={wahl[teil.frage] ?? KEINE_WAHL} gesperrt={gesperrt} aendern={(neu) => { setWahl({ ...wahl, [teil.frage]: neu }); }} />
      ))}
      <div class="kz-row">
        <button type="button" class="kz-btn kz-btn--go" disabled={gesperrt || antworten === null} onClick={() => { if (antworten !== null) absenden(frageAntwort(rahmen.sitzung, eintrag, antworten)); }}>Antwort senden</button>
        {!rahmen.steuernd && <span class="kz-klein">{NUR_STEUERND}</span>}
      </div>
      <AbsendeStand lage={lage} fehlgeschlagen={fehlgeschlagen} />
    </article>
  );
}

function antwortText(antwort: string | readonly string[] | undefined): string {
  if (antwort === undefined) return "keine Antwort";
  return typeof antwort === "string" ? antwort : antwort.join(", ");
}

function BeantworteteFrage({ frage, antworten }: { frage: FrageInhalt; antworten: Antworten }) {
  return (
    <article class="kz-frage kz-frage--fertig" aria-label="Beantwortete Frage von Claude">
      {frage.fragen.map((teil) => (
        <div key={teil.frage} class="kz-frage__fertig">
          <span class="kz-frage__text">{teil.frage}</span>
          <span class="kz-frage__antwort">→ {antwortText(antworten[teil.frage])}</span>
        </div>
      ))}
    </article>
  );
}

export function FrageImChat({ eintrag, frage, rahmen }: { eintrag: string; frage: FrageInhalt; rahmen: KartenRahmen }) {
  return frage.beantwortet === null ? <OffeneFrage eintrag={eintrag} frage={frage} rahmen={rahmen} /> : <BeantworteteFrage frage={frage} antworten={frage.beantwortet} />;
}

const ENTSCHIEDEN_TEXT: Record<PlanEntscheidung, string> = { ja: "Plan freigegeben.", nein: "Plan abgelehnt." };

export function PlanKarte({ eintrag, plan, rahmen }: { eintrag: string; plan: PlanInhalt; rahmen: KartenRahmen }) {
  const { lage, fehlgeschlagen, absenden } = useAbsenden(rahmen);
  const gesperrt = !rahmen.steuernd || lage.kind === "gesendet";
  const entscheiden = (entscheidung: PlanEntscheidung) => { absenden(planAntwort(rahmen.sitzung, eintrag, entscheidung)); };
  return (
    <article class={plan.entschieden === null ? "kz-plan" : "kz-plan kz-plan--fertig"} aria-label="Plan von Claude">
      <div class="kz-who"><span class={plan.entschieden === null ? "kz-dot kz-dot--wartet" : "kz-dot"} aria-hidden="true" />Plan zur Freigabe</div>
      <MarkdownAnsicht text={plan.text} />
      {plan.entschieden !== null ? <p class="kz-frage__antwort">{ENTSCHIEDEN_TEXT[plan.entschieden]}</p> : (
        <div class="kz-row">
          <button type="button" class="kz-btn kz-btn--go" disabled={gesperrt} onClick={() => { entscheiden("ja"); }}>Plan freigeben</button>
          <button type="button" class="kz-btn" disabled={gesperrt} onClick={() => { entscheiden("nein"); }}>Ablehnen</button>
          {!rahmen.steuernd && <span class="kz-klein">{NUR_STEUERND}</span>}
        </div>
      )}
      {plan.entschieden === null && <AbsendeStand lage={lage} fehlgeschlagen={fehlgeschlagen} />}
    </article>
  );
}

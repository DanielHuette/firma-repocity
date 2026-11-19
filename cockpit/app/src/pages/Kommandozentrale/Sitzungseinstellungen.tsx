import { useState } from "preact/hooks";
import { sitzungEinstellung, vorgabenSetzen, type Bestand, type Erlaubnis, type Optionen, type Vorgaben } from "./bestand";
import { AUFWAND_STUFEN } from "./menuepunkte";
import { KOSTENFALLE, kostenfalle, vorgabenMitHaken } from "./ordnung";
import type { ClientNachricht, OrdnerEintrag, SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

const KEINE_WAHL = "";
export const ERLAUBNIS_TEXT: Readonly<Record<Erlaubnis, string>> = {
  default: "Bei allem Neuen fragen (default)",
  acceptEdits: "Dateiänderungen ohne Frage (acceptEdits)",
  plan: "Nur planen, nichts ändern (plan)",
  auto: "Selbständig mit Sicherheitsprüfung (auto)",
};

interface WahlProps {
  readonly beschriftung: string;
  readonly wert: string;
  readonly optionen: readonly { readonly wert: string; readonly text: string }[];
  readonly gesperrt: boolean;
  readonly onWahl: (wert: string) => void;
}

function Auswahl({ beschriftung, wert, optionen, gesperrt, onWahl }: WahlProps) {
  return (
    <label class="kz-feld">{beschriftung}
      <select class="kz-feld__wahl" value={wert} disabled={gesperrt} onChange={(ereignis) => { onWahl(ereignis.currentTarget.value); }}>
        {optionen.map((option) => <option key={option.wert} value={option.wert}>{option.text}</option>)}
      </select>
    </label>
  );
}

function erlaubnisOptionen(optionen: Optionen): { wert: string; text: string }[] {
  return optionen.erlaubnis.map((modus) => ({ wert: modus, text: ERLAUBNIS_TEXT[modus] }));
}

function stilOptionen(optionen: Optionen, mitVorgabe: boolean): { wert: string; text: string }[] {
  return [...(mitVorgabe ? [{ wert: KEINE_WAHL, text: "wie in den Einstellungen von Claude Code" }] : []), ...optionen.ausgabestile.map((stil) => ({ wert: stil, text: stil }))];
}

export interface DieseSitzungProps {
  readonly optionen: Optionen;
  readonly sitzung: SitzungsZustand | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
}

export function DieseSitzung({ optionen, sitzung, steuernd, senden }: DieseSitzungProps) {
  const [hinweis, setHinweis] = useState("");
  const gesperrt = !steuernd || sitzung === null;
  const pruefung = sitzung?.pruefung === true;
  const schicken = (nachricht: ClientNachricht | null) => {
    if (nachricht !== null) setHinweis(senden(nachricht) ? "Gesendet. Wirkt sofort; nur der Schnellmodus verbindet beim nächsten Schritt neu." : NICHT_GESENDET);
  };
  const id = sitzung?.id ?? null;
  return (
    <section class="kz-einstellung" aria-labelledby="kz-diese-sitzung">
      <h3 class="kz-unterkopf" id="kz-diese-sitzung">Diese Sitzung{sitzung === null ? "" : ` · ${sitzung.titel}`}</h3>
      {sitzung === null && <p class="kz-klein">Erst eine Sitzung wählen.</p>}
      <Auswahl beschriftung="Erlaubnismodus" wert={sitzung?.erlaubnis ?? "default"} optionen={erlaubnisOptionen(optionen)} gesperrt={gesperrt || pruefung}
        onWahl={(wert) => { const modus = optionen.erlaubnis.find((eintrag) => eintrag === wert); schicken(id === null || modus === undefined ? null : sitzungEinstellung(id, "erlaubnis", modus)); }} />
      {pruefung && <p class="kz-hk__neustart" role="status">Prüfsitzung: jede Handlung fragt dich.</p>}
      {sitzung !== null && !sitzung.erlaubnisBestaetigt && <p class="kz-hk__neustart" role="status">Erlaubnismodus noch nicht übernommen.</p>}
      {sitzung !== null && kostenfalle(sitzung.modellWahl, sitzung.erlaubnis) && <p class="kz-klein kz-warnung" role="alert">{KOSTENFALLE}</p>}
      <Auswahl beschriftung="Ausgabestil" wert={sitzung?.ausgabestil ?? KEINE_WAHL} optionen={stilOptionen(optionen, sitzung?.ausgabestil === null)} gesperrt={gesperrt}
        onWahl={(wert) => { schicken(id === null || wert === KEINE_WAHL ? null : sitzungEinstellung(id, "ausgabestil", wert)); }} />
      <label class="kz-schalter">
        <input type="checkbox" role="switch" checked={sitzung?.schnell ?? false} disabled={gesperrt} onChange={(ereignis) => { schicken(id === null ? null : sitzungEinstellung(id, "schnell", ereignis.currentTarget.checked)); }} />
        <span>Schnellmodus</span>
      </label>
      <p class="kz-klein kz-warnung">Kostet Extra-Nutzung, nur Opus und Fable. Umschalten verbindet die Sitzung beim nächsten Schritt neu.</p>
      {sitzung?.neustartAusstehend === true && <p class="kz-hk__neustart" role="status">Wird beim nächsten Schritt neu verbunden.</p>}
      {hinweis !== "" && <p class="kz-klein" role="status">{hinweis}</p>}
    </section>
  );
}

function Liste({ titel, eintraege, gesperrt, onWeg }: { titel: string; eintraege: readonly string[]; gesperrt: boolean; onWeg: (kennung: string) => void }) {
  return (
    <div class="kz-vorgabe-liste">
      <span class="kz-klein">{titel}</span>
      {eintraege.length === 0 ? <span class="kz-leer">keine</span> : (
        <ul class="kz-pillen">{eintraege.map((kennung) => (
          <li key={kennung} class="kz-pille">
            <span class="kz-pille__text">{kennung}</span>
            <button type="button" class="kz-pille__weg" disabled={gesperrt} aria-label={`${kennung} aus den Vorgaben nehmen`} onClick={() => { onWeg(kennung); }}>×</button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

function Grundwerte({ optionen, werte, ordner, gesperrt, setzen }: {
  optionen: Optionen; werte: Vorgaben; ordner: readonly OrdnerEintrag[] | null; gesperrt: boolean; setzen: (aenderung: Partial<Vorgaben>) => void;
}) {
  const ordnerOptionen = [{ wert: KEINE_WAHL, text: "Vault (Vorgabe der Brücke)" }, ...(ordner ?? []).map((eintrag) => ({ wert: eintrag.pfad, text: eintrag.name }))];
  if (werte.ordner !== null && !ordnerOptionen.some((option) => option.wert === werte.ordner)) ordnerOptionen.push({ wert: werte.ordner, text: werte.ordner });
  const modelle = optionen.modelle.claude.some((modell) => modell.wert === werte.modell) ? optionen.modelle.claude : [{ wert: werte.modell, text: werte.modell }, ...optionen.modelle.claude];
  return (
    <>
      <div class="kz-raster-zwei">
        <Auswahl beschriftung="Modell" wert={werte.modell} optionen={modelle} gesperrt={gesperrt} onWahl={(modell) => { setzen({ modell }); }} />
        <Auswahl beschriftung="Aufwand" wert={werte.aufwand} optionen={AUFWAND_STUFEN} gesperrt={gesperrt} onWahl={(aufwand) => { setzen({ aufwand }); }} />
        <Auswahl beschriftung="Erlaubnismodus" wert={werte.erlaubnis} optionen={erlaubnisOptionen(optionen)} gesperrt={gesperrt}
          onWahl={(wert) => { const modus = optionen.erlaubnis.find((eintrag) => eintrag === wert); if (modus !== undefined) setzen({ erlaubnis: modus }); }} />
        <Auswahl beschriftung="Ausgabestil" wert={werte.ausgabestil ?? KEINE_WAHL} optionen={stilOptionen(optionen, true)} gesperrt={gesperrt}
          onWahl={(stil) => { setzen({ ausgabestil: stil === KEINE_WAHL ? null : stil }); }} />
      </div>
      {kostenfalle(werte.modell, werte.erlaubnis) && <p class="kz-klein kz-warnung" role="alert">{KOSTENFALLE}</p>}
      <Auswahl beschriftung="Ordner" wert={werte.ordner ?? KEINE_WAHL} optionen={ordnerOptionen} gesperrt={gesperrt} onWahl={(pfad) => { setzen({ ordner: pfad === KEINE_WAHL ? null : pfad }); }} />
    </>
  );
}

export interface VorgabenProps {
  readonly optionen: Optionen;
  readonly bestand: Bestand | null;
  readonly ordner: readonly OrdnerEintrag[] | null;
  readonly sitzung: SitzungsZustand | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
}

export function VorgabenFormular({ optionen, bestand, ordner, sitzung, steuernd, senden }: VorgabenProps) {
  const [werte, setWerte] = useState<Vorgaben>(optionen.vorgaben);
  const [hinweis, setHinweis] = useState("");
  const gesperrt = !steuernd;
  const setzen = (aenderung: Partial<Vorgaben>) => { setWerte({ ...werte, ...aenderung }); setHinweis(""); };
  const ohne = (feld: "skills" | "plugins" | "konnektoren") => (kennung: string) => { setzen({ [feld]: werte[feld].filter((eintrag) => eintrag !== kennung) }); };
  const speichern = (ereignis: Event) => {
    ereignis.preventDefault();
    setHinweis(senden(vorgabenSetzen(werte)) ? "Gespeichert. Gilt für die nächste neue Sitzung." : NICHT_GESENDET);
  };
  return (
    <form class="kz-einstellung" aria-labelledby="kz-vorgaben" onSubmit={speichern}>
      <h3 class="kz-unterkopf" id="kz-vorgaben">Vorgaben für neue Sitzungen</h3>
      <p class="kz-klein">Neue Sitzungen und Klicks auf ein Projekt starten nie über OpenRouter und nie im Schnellmodus. Nach einem Neustart der Brücke ist der Schnellmodus immer aus; OpenRouter-Sitzungen bleiben pausiert, bis du sie fortsetzt.</p>
      <Grundwerte optionen={optionen} werte={werte} ordner={ordner} gesperrt={gesperrt} setzen={setzen} />
      <Liste titel="Skills" eintraege={werte.skills} gesperrt={gesperrt} onWeg={ohne("skills")} />
      <Liste titel="Plugins" eintraege={werte.plugins} gesperrt={gesperrt} onWeg={ohne("plugins")} />
      <Liste titel="Konnektoren" eintraege={werte.konnektoren} gesperrt={gesperrt} onWeg={ohne("konnektoren")} />
      <span class="kz-row">
        <button type="button" class="kz-btn" disabled={gesperrt || sitzung === null} title={sitzung === null ? "Erst eine Sitzung wählen" : `Haken aus „${sitzung.titel}“ übernehmen`}
          onClick={() => { if (sitzung !== null) setzen(vorgabenMitHaken(werte, sitzung, bestand)); }}>Haken der gewählten Sitzung übernehmen</button>
        <button type="submit" class="kz-btn kz-btn--go" disabled={gesperrt}>Vorgaben speichern</button>
      </span>
      {hinweis !== "" && <p class="kz-klein" role="status">{hinweis}</p>}
    </form>
  );
}

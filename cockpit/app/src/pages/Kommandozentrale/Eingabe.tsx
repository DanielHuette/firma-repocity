import type { Ref, TargetedEvent } from "preact";
import { useState } from "preact/hooks";
import type { ModellWahl } from "./bestand";
import { LAENGSTE_NACHRICHT, abbrechen, nachrichtLesen, type Eintrag } from "./chat";
import { AUFWAND_STUFEN, aufwandSetzen, modellSetzen } from "./menuepunkte";
import type { ClientNachricht, SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";
import { Vorschlagskarte } from "./Vorschlagskarte";

export interface EingabeProps {
  readonly sitzung: SitzungsZustand | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly entwurf: string;
  readonly setEntwurf: (text: string) => void;
  readonly feld: Ref<HTMLTextAreaElement>;
  readonly modelle: readonly ModellWahl[];
  readonly eintraege: readonly Eintrag[];
}

const ZU_LANG = `Zu lang: höchstens ${LAENGSTE_NACHRICHT.toLocaleString("de-DE")} Zeichen je Nachricht.`;
const CHIP_STUFEN = AUFWAND_STUFEN.filter((stufe) => stufe.wert !== "auto");

function platzhalter(sitzung: SitzungsZustand | null, steuernd: boolean): string {
  if (sitzung === null) return "Erst eine Sitzung starten, mit dem Plus oben.";
  if (sitzung.prozess === "beendet") return "Claude Code ist in dieser Sitzung beendet.";
  if (sitzung.pausiert) return "Pausiert: erst oben „Fortsetzen“ wählen.";
  return steuernd ? "Schreib, was Claude tun soll …" : "Schreiben kann nur das steuernde Gerät.";
}

interface WahlProps {
  readonly beschriftung: string;
  readonly jetzt: string;
  readonly optionen: readonly { readonly wert: string; readonly text: string }[];
  readonly gesperrt: boolean;
  readonly onWahl: (wert: string) => void;
}

function Wahlchip({ beschriftung, jetzt, optionen, gesperrt, onWahl }: WahlProps) {
  const waehlen = (ereignis: TargetedEvent<HTMLSelectElement>) => {
    const feld = ereignis.currentTarget;
    const wert = feld.value;
    feld.value = "";
    if (wert !== "") onWahl(wert);
  };
  return (
    <label class="kz-wahl" title={beschriftung}>
      <span class="kz-nur-leser">{beschriftung}</span>
      <select class="kz-wahl__feld" value="" disabled={gesperrt} onChange={waehlen}>
        <option value="" disabled>{jetzt}</option>
        {optionen.map((option) => <option key={option.wert} value={option.wert}>{option.text}</option>)}
      </select>
    </label>
  );
}

function useAbschicken({ sitzung, senden, entwurf, setEntwurf }: EingabeProps) {
  const [fehler, setFehler] = useState("");
  const schicken = (nachricht: ClientNachricht) => {
    const ok = senden(nachricht);
    setFehler(ok ? "" : NICHT_GESENDET);
    return ok;
  };
  const absenden = () => {
    if (sitzung === null) return;
    const gelesen = nachrichtLesen(sitzung.id, entwurf);
    if (gelesen.kind === "zu_lang") setFehler(ZU_LANG);
    else if (gelesen.kind === "ok" && schicken(gelesen.nachricht)) setEntwurf("");
  };
  return { fehler, schicken, absenden };
}

interface LeisteProps {
  readonly sitzung: SitzungsZustand | null;
  readonly gesperrt: boolean;
  readonly modelle: readonly ModellWahl[];
  readonly schicken: (nachricht: ClientNachricht) => boolean;
  readonly absenden: () => void;
  readonly leer: boolean;
}

function Leiste({ sitzung, gesperrt, modelle, schicken, absenden, leer }: LeisteProps) {
  const arbeitet = sitzung?.stand === "arbeitet";
  const modellGesperrt = gesperrt || modelle.length === 0 || sitzung?.anbieter === "openrouter";
  return (
    <div class="kz-box__leiste">
      <Wahlchip beschriftung={sitzung?.anbieter === "openrouter" ? "Modell dieser OpenRouter-Sitzung" : "Modell wechseln"} jetzt={`◆ ${sitzung?.modell ?? "Modell"}`} optionen={modelle} gesperrt={modellGesperrt}
        onWahl={(modell) => { if (sitzung !== null) schicken(modellSetzen(sitzung.id, modell)); }} />
      <Wahlchip beschriftung="Aufwand wechseln" jetzt={`◐ ${sitzung?.aufwand ?? "Aufwand"}`} optionen={CHIP_STUFEN} gesperrt={gesperrt}
        onWahl={(stufe) => { if (sitzung !== null) schicken(aufwandSetzen(sitzung.id, stufe)); }} />
      <span class="kz-sp" />
      {arbeitet && <button type="button" class="kz-btn kz-btn--stop" disabled={gesperrt} onClick={() => { schicken(abbrechen(sitzung.id)); }}>■ Stopp</button>}
      <button type="button" class="kz-senden" aria-label="Nachricht senden" title="Senden (Enter)" disabled={gesperrt || leer} onClick={absenden}>↑</button>
    </div>
  );
}

export function Eingabe(props: EingabeProps) {
  const { sitzung, steuernd, entwurf, setEntwurf, feld, modelle, eintraege } = props;
  const { fehler, schicken, absenden } = useAbschicken(props);
  const gesperrt = !steuernd || sitzung === null || sitzung.prozess === "beendet" || sitzung.pausiert;
  const taste = (ereignis: KeyboardEvent) => {
    if (ereignis.key !== "Enter" || ereignis.shiftKey || ereignis.isComposing) return;
    ereignis.preventDefault();
    absenden();
  };
  return (
    <div class="kz-composer">
      <Vorschlagskarte sitzung={sitzung} entwurf={entwurf} eintraege={eintraege} gesperrt={gesperrt} schicken={schicken} />
      <div class={gesperrt ? "kz-box kz-box--gesperrt" : "kz-box"}>
        <textarea ref={feld} class="kz-box__feld" rows={2} value={entwurf} disabled={gesperrt} placeholder={platzhalter(sitzung, steuernd)} aria-label="Nachricht an Claude"
          aria-describedby="kz-eingabe-hilfe" onInput={(ereignis) => { setEntwurf(ereignis.currentTarget.value); }} onKeyDown={taste} />
        <Leiste sitzung={sitzung} gesperrt={gesperrt} modelle={modelle} schicken={schicken} absenden={absenden} leer={entwurf.trim() === ""} />
      </div>
      <p class="kz-composer__hilfe" id="kz-eingabe-hilfe">Enter sendet · Umschalt+Enter für eine neue Zeile</p>
      {fehler !== "" && <p class="kz-fehler kz-composer__fehler" role="alert">{fehler}</p>}
    </div>
  );
}

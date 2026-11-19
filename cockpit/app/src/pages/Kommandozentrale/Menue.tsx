import { useState } from "preact/hooks";
import { HakenFenster } from "./HakenFenster";
import { Hinzufuegen } from "./Hinzufuegen";
import { AufwandFenster, EinstellungenFenster, Fenster, OrdnerAuswahl, SucheFenster } from "./MenueFenster";
import { ModellFenster } from "./ModellFenster";
import type { MenueDaten } from "./useBruecke";
import { ordnerAnfragen, verdichten, type ClientNachricht, type SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

export type MenueFensterArt = "neu" | "skills" | "konnektoren" | "suche" | "einstellungen" | "aufwand" | "modell";

const NUR_STEUERND = "Nur das steuernde Gerät";
const BESTAND_HOLEN: ClientNachricht = { typ: "bestand_holen" };
const OPTIONEN_HOLEN: ClientNachricht = { typ: "optionen_holen" };
const ANFRAGEN: Readonly<Record<MenueFensterArt, readonly ClientNachricht[]>> = {
  neu: [ordnerAnfragen()],
  skills: [BESTAND_HOLEN, OPTIONEN_HOLEN],
  konnektoren: [BESTAND_HOLEN, OPTIONEN_HOLEN],
  suche: [],
  einstellungen: [{ typ: "einstellungen" }, OPTIONEN_HOLEN, ordnerAnfragen()],
  aufwand: [],
  modell: [OPTIONEN_HOLEN],
};
const TITEL: Readonly<Record<MenueFensterArt, string>> = {
  neu: "Neue Sitzung", skills: "Skills & Plugins", konnektoren: "Konnektoren", suche: "Suchen", einstellungen: "Einstellungen", aufwand: "Aufwand", modell: "Modell",
};

export function fensterAnfragen(art: MenueFensterArt): readonly ClientNachricht[] {
  return ANFRAGEN[art];
}

export interface MenueProps {
  readonly aktiv: string | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly oeffnen: (art: MenueFensterArt) => void;
  readonly onFertig: () => void;
}

interface Eintrag {
  readonly zeichen: string;
  readonly text: string;
  readonly primaer?: boolean;
  readonly gesperrt: string | null;
  readonly tun: () => void;
}

function Punkt({ eintrag }: { eintrag: Eintrag }) {
  return (
    <button type="button" class={eintrag.primaer === true ? "kz-mi kz-mi--primaer" : "kz-mi"} disabled={eintrag.gesperrt !== null} title={eintrag.gesperrt ?? eintrag.text} onClick={eintrag.tun}>
      <span class="kz-mi__ic" aria-hidden="true">{eintrag.zeichen}</span>
      {eintrag.text}
    </button>
  );
}

function eintraege({ aktiv, steuernd, oeffnen }: MenueProps, direkt: (nachricht: ClientNachricht) => void): Eintrag[] {
  const sitzungsSperre = !steuernd ? NUR_STEUERND : aktiv === null ? "Erst eine Sitzung wählen" : null;
  return [
    { zeichen: "＋", text: "Neue Sitzung", primaer: true, gesperrt: steuernd ? null : NUR_STEUERND, tun: () => { oeffnen("neu"); } },
    { zeichen: "⌕", text: "Suchen", gesperrt: null, tun: () => { oeffnen("suche"); } },
    { zeichen: "◇", text: "Skills & Plugins", gesperrt: null, tun: () => { oeffnen("skills"); } },
    { zeichen: "⇄", text: "Konnektoren", gesperrt: null, tun: () => { oeffnen("konnektoren"); } },
    { zeichen: "◈", text: "Modell", gesperrt: null, tun: () => { oeffnen("modell"); } },
    { zeichen: "◐", text: "Aufwand", gesperrt: sitzungsSperre, tun: () => { oeffnen("aufwand"); } },
    { zeichen: "≡", text: "Verdichten", gesperrt: sitzungsSperre, tun: () => { if (aktiv !== null) direkt(verdichten(aktiv)); } },
    { zeichen: "⚙", text: "Einstellungen", gesperrt: null, tun: () => { oeffnen("einstellungen"); } },
  ];
}

export function Menue(props: MenueProps) {
  const [fehler, setFehler] = useState(false);
  const direkt = (nachricht: ClientNachricht) => { const ok = props.senden(nachricht); setFehler(!ok); if (ok) props.onFertig(); };
  return (
    <section class="kz-panel" aria-labelledby="kz-menue-titel">
      <h2 class="kz-ph" id="kz-menue-titel">Menü</h2>
      <div class="kz-menu">{eintraege(props, direkt).map((eintrag) => <Punkt key={eintrag.text} eintrag={eintrag} />)}</div>
      <p class="kz-pnote">Modell, Aufwand und Verdichten gehen als Befehl in den Chat der gewählten Sitzung; dein angefangener Text im Eingabefeld bleibt.</p>
      {fehler && <p class="kz-pnote kz-fehler" role="alert">{NICHT_GESENDET}</p>}
    </section>
  );
}

export interface MenueDialogProps {
  readonly art: MenueFensterArt;
  readonly daten: MenueDaten;
  readonly sitzung: SitzungsZustand | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly geraetName: string;
  readonly umbenennen: (name: string) => boolean;
  readonly speicherOk: boolean;
  readonly onZu: () => void;
  readonly onFertig: () => void;
}

function Inhalt(props: MenueDialogProps) {
  const { art, daten, sitzung, steuernd, senden, onFertig } = props;
  switch (art) {
    case "neu":
      return <OrdnerAuswahl ordner={daten.ordner} steuernd={steuernd} senden={senden} onFertig={onFertig} />;
    case "skills":
    case "konnektoren":
      return <HakenFenster art={art} bestand={daten.bestand} sitzung={sitzung} steuernd={steuernd} senden={senden} />;
    case "suche":
      return <SucheFenster treffer={daten.treffer} senden={senden} />;
    case "aufwand":
      return <AufwandFenster aktiv={sitzung?.id ?? null} jetzt={sitzung?.aufwand ?? null} steuernd={steuernd} senden={senden} onFertig={onFertig} />;
    case "modell":
      return <ModellFenster optionen={daten.optionen} sitzung={sitzung} steuernd={steuernd} senden={senden} onFertig={onFertig} />;
    case "einstellungen":
      return <EinstellungenFenster daten={daten} sitzung={sitzung} steuernd={steuernd} senden={senden} geraetName={props.geraetName} umbenennen={props.umbenennen} speicherOk={props.speicherOk} />;
  }
}

function PlusKnopf({ offen, onWechsel }: { offen: boolean; onWechsel: () => void }) {
  return (
    <button type="button" class={offen ? "kz-plusknopf kz-plusknopf--an" : "kz-plusknopf"} aria-expanded={offen} aria-controls="kz-plus-bereich"
      aria-label={offen ? "Hinzufügen schließen" : "Neues hinzufügen"} title={offen ? "Hinzufügen schließen" : "Aus der Bibliothek, per Link oder neu bauen lassen"} onClick={onWechsel}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
    </button>
  );
}

export function MenueDialog(props: MenueDialogProps) {
  const [plus, setPlus] = useState(false);
  const mitPlus = props.art === "skills" || props.art === "konnektoren";
  return (
    <Fenster titel={TITEL[props.art]} onZu={props.onZu} zusatz={mitPlus ? <PlusKnopf offen={plus} onWechsel={() => { setPlus(!plus); }} /> : undefined}>
      {mitPlus && plus && (
        <div id="kz-plus-bereich">
          <Hinzufuegen fensterArt={props.art === "konnektoren" ? "konnektoren" : "skills"} bestand={props.daten.bestand} antwort={props.daten.hinzugefuegt}
            sitzung={props.sitzung?.id ?? null} linkGesperrt={props.daten.optionen === null ? "Die Optionen der Brücke laden noch." : props.daten.optionen.linkGesperrt} steuernd={props.steuernd} senden={props.senden} />
        </div>
      )}
      <Inhalt {...props} />
    </Fenster>
  );
}

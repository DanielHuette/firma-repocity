import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Dialog } from "./Dialog";
import { AUFWAND_STUFEN, SCHWELLE_HOECHSTENS, SCHWELLE_MINDESTENS, aufwandSetzen, ordnerFiltern, schwelleLesen, suchAnfrage } from "./menuepunkte";
import { DieseSitzung, VorgabenFormular } from "./Sitzungseinstellungen";
import type { MenueDaten } from "./useBruecke";
import { neueSitzung, type OrdnerEintrag, type SitzungsZustand, type Treffer } from "./verbindung";
import { NICHT_GESENDET, type Senden } from "./gemeinsam";

const ZAHL = new Intl.NumberFormat("de-DE");
const NUR_STEUERND = "Das kann nur das steuernde Gerät.";

export interface FensterProps {
  readonly titel: string;
  readonly onZu: () => void;
  readonly zusatz?: ComponentChildren;
  readonly children: ComponentChildren;
}

export function Fenster({ titel, onZu, zusatz, children }: FensterProps) {
  return (
    <Dialog titelId="kz-fenster-titel" klasse="kz-dialog--breit" onAbbrechen={onZu} danebenSchliesst>
      <div class="kz-dialog__kopf"><h2 id="kz-fenster-titel">{titel}</h2>{zusatz}<button type="button" class="kz-btn kz-dialog__zu" onClick={onZu}>Schließen</button></div>
      {children}
    </Dialog>
  );
}

function OrdnerZeile({ name, pfad, gesperrt, onWahl }: { name: string; pfad: string; gesperrt: boolean; onWahl: () => void }) {
  return (
    <li>
      <button type="button" class="kz-liste__knopf" disabled={gesperrt} onClick={onWahl}>
        <span class="kz-liste__name">{name}</span>
        <span class="kz-klein kz-liste__pfad">{pfad}</span>
      </button>
    </li>
  );
}

export interface OrdnerProps {
  readonly ordner: readonly OrdnerEintrag[] | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly onFertig: () => void;
}

export function OrdnerAuswahl({ ordner, steuernd, senden, onFertig }: OrdnerProps) {
  const [suche, setSuche] = useState("");
  const [fehler, setFehler] = useState(false);
  const starten = (pfad: string) => {
    const ok = senden(neueSitzung(pfad));
    setFehler(!ok);
    if (ok) onFertig();
  };
  const gefunden = ordner === null ? [] : ordnerFiltern(ordner, suche);
  return (
    <div class="kz-fensterinhalt">
      <label class="kz-feld">Ordner suchen<input value={suche} onInput={(ereignis) => { setSuche(ereignis.currentTarget.value); }} placeholder="Name oder Pfad" autoFocus /></label>
      {!steuernd && <p class="kz-klein">{NUR_STEUERND}</p>}
      <ul class="kz-liste">
        <OrdnerZeile name="Vault (Vorgabe)" pfad="erlaubter Hauptordner der Brücke" gesperrt={!steuernd} onWahl={() => { starten(""); }} />
        {gefunden.map((eintrag) => <OrdnerZeile key={eintrag.pfad} name={eintrag.name} pfad={eintrag.pfad} gesperrt={!steuernd} onWahl={() => { starten(eintrag.pfad); }} />)}
      </ul>
      {ordner === null && <p class="kz-leer" role="status">Lädt die erlaubten Ordner von der Brücke …</p>}
      {fehler && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
    </div>
  );
}

export interface WahlFensterProps {
  readonly aktiv: string | null;
  readonly jetzt: string | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly onFertig: () => void;
}

const AUFWAND_HINWEIS = "Die Wahl gilt für diese Sitzung und wird für spätere Sitzungen gespeichert; „auto“ nimmt die gespeicherte Wahl zurück.";

export function AufwandFenster({ aktiv, jetzt, steuernd, senden, onFertig }: WahlFensterProps) {
  const [fehler, setFehler] = useState(false);
  const gesperrt = !steuernd || aktiv === null;
  const setzen = (wert: string) => {
    if (aktiv === null) return;
    const ok = senden(aufwandSetzen(aktiv, wert));
    setFehler(!ok);
    if (ok) onFertig();
  };
  return (
    <div class="kz-fensterinhalt">
      <p class="kz-klein">Jetzt: {jetzt ?? "unbekannt"}. {AUFWAND_HINWEIS}</p>
      {gesperrt && <p class="kz-klein">{aktiv === null ? "Erst eine Sitzung wählen." : NUR_STEUERND}</p>}
      <ul class="kz-liste">{AUFWAND_STUFEN.map((option) => (
        <li key={option.wert}>
          <button type="button" class="kz-liste__knopf" disabled={gesperrt} aria-current={option.wert === jetzt ? "true" : undefined} onClick={() => { setzen(option.wert); }}>
            <span class="kz-liste__name">{option.text}</span>
            {option.wert === jetzt && <span class="kz-klein">aktuell</span>}
          </button>
        </li>
      ))}</ul>
      {fehler && <p class="kz-fehler" role="alert">{NICHT_GESENDET}</p>}
    </div>
  );
}

function TrefferListe({ treffer }: { treffer: Treffer }) {
  return (
    <>
      <h3 class="kz-unterkopf">Vault · {treffer.vault.length}</h3>
      {treffer.vault.length === 0 ? <p class="kz-leer">Keine Treffer im Vault.</p> : (
        <ul class="kz-liste">{treffer.vault.map((eintrag) => (
          <li key={`${eintrag.pfad}:${String(eintrag.zeile)}`} class="kz-treffer"><span class="kz-liste__name">{eintrag.pfad}:{eintrag.zeile}</span><span class="kz-klein">{eintrag.auszug}</span></li>
        ))}</ul>
      )}
      <h3 class="kz-unterkopf">Erinnerung · {treffer.erinnerung.length}</h3>
      {treffer.erinnerung.length === 0 ? <p class="kz-leer">Keine Treffer in der Erinnerung.</p> : (
        <ul class="kz-liste">{treffer.erinnerung.map((eintrag) => (
          <li key={String(eintrag.id)} class="kz-treffer"><span class="kz-liste__name">{eintrag.titel}</span><span class="kz-klein">#{eintrag.id} · {eintrag.datum}</span></li>
        ))}</ul>
      )}
    </>
  );
}

function Ergebnisse({ treffer }: { treffer: Treffer }) {
  return (
    <div class="kz-ergebnisse" role="region" aria-label={`Treffer für ${treffer.text}`}>
      {treffer.fehler !== null && <p class="kz-fehler" role="alert">{treffer.fehler}</p>}
      <TrefferListe treffer={treffer} />
    </div>
  );
}

export function SucheFenster({ treffer, senden }: { treffer: Treffer | null; senden: Senden }) {
  const [text, setText] = useState("");
  const [gesucht, setGesucht] = useState<string | null>(null);
  const [fehler, setFehler] = useState("");
  const suchen = (ereignis: Event) => {
    ereignis.preventDefault();
    const anfrage = suchAnfrage(text);
    if (anfrage.kind === "leer") return;
    if (anfrage.kind === "fehler") { setFehler(anfrage.text); return; }
    const ok = senden(anfrage.nachricht);
    setFehler(ok ? "" : NICHT_GESENDET);
    if (ok && anfrage.nachricht.typ === "suche") setGesucht(anfrage.nachricht.text);
  };
  const passend = treffer !== null && treffer.text === gesucht ? treffer : null;
  return (
    <div class="kz-fensterinhalt">
      <form class="kz-row kz-row--feld" onSubmit={suchen}>
        <label class="kz-feld kz-feld--wachsen">Suchbegriff<input value={text} maxLength={400} onInput={(ereignis) => { setText(ereignis.currentTarget.value); }} placeholder="im Vault und in der Erinnerung" autoFocus /></label>
        <button type="submit" class="kz-btn kz-btn--go" disabled={text.trim() === ""}>Suchen</button>
      </form>
      {fehler !== "" && <p class="kz-fehler" role="alert">{fehler}</p>}
      {gesucht !== null && passend === null && <p class="kz-leer" role="status">Sucht nach „{gesucht}“ …</p>}
      {passend !== null && <Ergebnisse treffer={passend} />}
    </div>
  );
}

function GeraeteName({ name, umbenennen, speicherOk }: { name: string; umbenennen: (name: string) => boolean; speicherOk: boolean }) {
  const [wert, setWert] = useState(name);
  const [hinweis, setHinweis] = useState("");
  const speichern = (ereignis: Event) => {
    ereignis.preventDefault();
    setHinweis(umbenennen(wert) ? "Gespeichert. Die Seite verbindet sich mit dem neuen Namen neu." : "1 bis 40 Zeichen, ohne Leerzeichen am Rand und ohne Steuerzeichen.");
  };
  return (
    <form class="kz-einstellung" onSubmit={speichern}>
      <label class="kz-feld">Name dieses Geräts<input value={wert} maxLength={40} onInput={(ereignis) => { setWert(ereignis.currentTarget.value); }} /></label>
      <button type="submit" class="kz-btn">Namen speichern</button>
      {!speicherOk && <p class="kz-fehler">Dieser Browser erlaubt kein Speichern. Name und Gerätekennung gelten nur bis zum Neuladen.</p>}
      {hinweis !== "" && <p class="kz-klein" role="status">{hinweis}</p>}
    </form>
  );
}

function Schwelle({ aktuell, steuernd, senden }: { aktuell: number | null; steuernd: boolean; senden: Senden }) {
  const [wert, setWert] = useState("");
  const [hinweis, setHinweis] = useState("");
  const speichern = (ereignis: Event) => {
    ereignis.preventDefault();
    const gelesen = schwelleLesen(wert);
    if (gelesen.kind === "fehler") { setHinweis(gelesen.text); return; }
    setHinweis(senden({ typ: "einstellung", schwelleVerdichten: gelesen.wert }) ? "Gesendet." : NICHT_GESENDET);
  };
  return (
    <form class="kz-einstellung" onSubmit={speichern}>
      <label class="kz-feld">Schwelle für den Verdichtungs-Hinweis (Tokens)
        <input inputMode="numeric" value={wert} placeholder={aktuell === null ? "lädt …" : ZAHL.format(aktuell)} onInput={(ereignis) => { setWert(ereignis.currentTarget.value); }} disabled={!steuernd} />
      </label>
      <p class="kz-klein">Jetzt: {aktuell === null ? "unbekannt" : ZAHL.format(aktuell)} · erlaubt {ZAHL.format(SCHWELLE_MINDESTENS)} bis {ZAHL.format(SCHWELLE_HOECHSTENS)}{steuernd ? "" : ` · ${NUR_STEUERND}`}</p>
      <button type="submit" class="kz-btn" disabled={!steuernd || wert.trim() === ""}>Schwelle speichern</button>
      {hinweis !== "" && <p class="kz-klein" role="status">{hinweis}</p>}
    </form>
  );
}

function Selbsttest({ version, steuernd, senden }: { version: string; steuernd: boolean; senden: Senden }) {
  const [hinweis, setHinweis] = useState("");
  const starten = () => { setHinweis(senden({ typ: "selbsttest" }) ? "Selbsttest gestartet. Ergebnisse erscheinen unter „Wartet auf dich“." : NICHT_GESENDET); };
  return (
    <div class="kz-einstellung">
      <p>Claude Code: {version}</p>
      <button type="button" class="kz-btn" disabled={!steuernd} onClick={starten}>Selbsttest jetzt</button>
      {!steuernd && <p class="kz-klein">{NUR_STEUERND}</p>}
      {hinweis !== "" && <p class="kz-klein" role="status">{hinweis}</p>}
    </div>
  );
}

export interface EinstellungenProps {
  readonly daten: MenueDaten;
  readonly sitzung: SitzungsZustand | null;
  readonly steuernd: boolean;
  readonly senden: Senden;
  readonly geraetName: string;
  readonly umbenennen: (name: string) => boolean;
  readonly speicherOk: boolean;
}

export function EinstellungenFenster({ daten, sitzung, steuernd, senden, geraetName, umbenennen, speicherOk }: EinstellungenProps) {
  const { einstellungen, optionen } = daten;
  const version = einstellungen === null ? "lädt …" : (einstellungen.claudeVersion ?? "Fassung unbekannt");
  return (
    <div class="kz-fensterinhalt">
      {optionen === null ? <p class="kz-leer" role="status">Lädt Erlaubnismodi, Ausgabestile und Vorgaben von der Brücke …</p> : (
        <>
          <DieseSitzung optionen={optionen} sitzung={sitzung} steuernd={steuernd} senden={senden} />
          <VorgabenFormular key={JSON.stringify(optionen.vorgaben)} optionen={optionen} bestand={daten.bestand} ordner={daten.ordner} sitzung={sitzung} steuernd={steuernd} senden={senden} />
        </>
      )}
      <GeraeteName name={geraetName} umbenennen={umbenennen} speicherOk={speicherOk} />
      <Schwelle aktuell={einstellungen?.schwelleVerdichten ?? null} steuernd={steuernd} senden={senden} />
      <Selbsttest version={version} steuernd={steuernd} senden={senden} />
    </div>
  );
}

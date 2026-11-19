import { useEffect, useRef, useState } from "preact/hooks";
import { Mark } from "../../components/Logo";
import { LAENGSTER_TITEL, titelLesen } from "./bestand";
import { reiterStand, uhrzeitText, type ReiterStand } from "./anzeige";
import { CHAT_FLAECHE, reiterKennung } from "./kennungen";
import { naechsterReiter } from "./menuepunkte";
import { useMinute } from "./useJetzt";
import type { SitzungsZustand } from "./verbindung";
import { NICHT_GESENDET } from "./gemeinsam";

const STAND_TEXT: Record<ReiterStand, string> = {
  arbeitet: "arbeitet",
  wartet: "wartet auf dich",
  ruht: "ruht",
  beendet: "beendet",
};

export interface KopfzeileProps {
  readonly sitzungen: readonly SitzungsZustand[];
  readonly aktiv: string | null;
  readonly steuernd: boolean;
  readonly onWaehlen: (sitzung: string) => void;
  readonly onWaehlenUndFokus: (sitzung: string) => void;
  readonly onNeu: () => void;
  readonly onBeenden: () => void;
  readonly onUmbenennen: (sitzung: string, titel: string) => boolean;
}

function NamensFeld({ sitzung, onFertig, onUmbenennen }: { sitzung: SitzungsZustand; onFertig: () => void; onUmbenennen: (sitzung: string, titel: string) => boolean }) {
  const [wert, setWert] = useState(sitzung.titel);
  const [fehler, setFehler] = useState("");
  const ort = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ort.current?.focus();
    ort.current?.select();
  }, []);
  const uebernehmen = () => {
    const gelesen = titelLesen(wert);
    if (gelesen.kind === "fehler") { setFehler(gelesen.text); return; }
    if (gelesen.titel === sitzung.titel || onUmbenennen(sitzung.id, gelesen.titel)) onFertig();
    else setFehler(NICHT_GESENDET);
  };
  const taste = (ereignis: KeyboardEvent) => {
    if (ereignis.key === "Enter") { ereignis.preventDefault(); uebernehmen(); }
    if (ereignis.key === "Escape") { ereignis.preventDefault(); ereignis.stopPropagation(); onFertig(); }
  };
  return (
    <span class="kz-tab kz-tab--an kz-tab--bearbeiten">
      <input ref={ort} class="kz-tab__feld" value={wert} maxLength={LAENGSTER_TITEL + 20} aria-label={`Neuer Name für ${sitzung.titel}`} aria-invalid={fehler !== ""}
        aria-describedby={fehler === "" ? undefined : "kz-tab-fehler"}
        onInput={(ereignis) => { setWert(ereignis.currentTarget.value); setFehler(""); }} onKeyDown={taste} onBlur={onFertig} />
      {fehler !== "" && <span class="kz-tab__fehler" id="kz-tab-fehler" role="alert">{fehler}</span>}
    </span>
  );
}

interface ReiterProps {
  readonly sitzung: SitzungsZustand;
  readonly an: boolean;
  readonly umbenennbar: boolean;
  readonly onWaehlen: (sitzung: string) => void;
  readonly onTaste: (ereignis: KeyboardEvent) => void;
  readonly onBearbeiten: () => void;
}

function Reiter({ sitzung, an, umbenennbar, onWaehlen, onTaste, onBearbeiten }: ReiterProps) {
  const stand = reiterStand(sitzung.stand, sitzung.prozess);
  const fragen = sitzung.wartet.length;
  return (
    <button type="button" role="tab" id={reiterKennung(sitzung.id)} aria-selected={an} aria-controls={CHAT_FLAECHE} tabIndex={an ? 0 : -1}
      class={an ? "kz-tab kz-tab--an" : "kz-tab"} title={umbenennbar ? `${sitzung.ordner} · Doppelklick oder F2 benennt um` : sitzung.ordner}
      onClick={() => { onWaehlen(sitzung.id); }} onDblClick={() => { if (umbenennbar) onBearbeiten(); }}
      onKeyDown={(ereignis) => { if (ereignis.key === "F2" && umbenennbar) { ereignis.preventDefault(); onBearbeiten(); } else onTaste(ereignis); }}>
      <span class={`kz-dot kz-dot--${stand}`} aria-hidden="true" />
      <span class="kz-tab__name">{sitzung.titel}</span>
      {sitzung.pruefung && <span class="kz-tag kz-tag--pruefung">Prüfung</span>}
      <small>{sitzung.pausiert ? "pausiert" : STAND_TEXT[stand]}</small>
      {fragen > 0 && <span class="kz-badge" aria-label={`${String(fragen)} offene Fragen`}>{fragen}</span>}
    </button>
  );
}

function Uhr() {
  const jetzt = useMinute();
  return <span class="kz-uhr">{uhrzeitText(new Date(jetzt))}</span>;
}

function Reiterleiste({ sitzungen, aktiv, steuernd, onWaehlen, onWaehlenUndFokus, onUmbenennen }: Pick<KopfzeileProps, "sitzungen" | "aktiv" | "steuernd" | "onWaehlen" | "onWaehlenUndFokus" | "onUmbenennen">) {
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const fertig = (sitzung: string) => () => {
    setBearbeitet(null);
    requestAnimationFrame(() => { document.getElementById(reiterKennung(sitzung))?.focus(); });
  };
  const taste = (ereignis: KeyboardEvent) => {
    const ziel = naechsterReiter(sitzungen.map((sitzung) => sitzung.id), aktiv, ereignis.key);
    if (ziel === null) return;
    ereignis.preventDefault();
    onWaehlen(ziel);
    requestAnimationFrame(() => { document.getElementById(reiterKennung(ziel))?.focus(); });
  };
  return (
    <nav class="kz-tabs" role="tablist" aria-label="Sitzungen">
      {sitzungen.map((sitzung) => (bearbeitet === sitzung.id && steuernd
        ? <NamensFeld key={sitzung.id} sitzung={sitzung} onFertig={fertig(sitzung.id)} onUmbenennen={onUmbenennen} />
        : <Reiter key={sitzung.id} sitzung={sitzung} an={sitzung.id === aktiv} umbenennbar={steuernd} onWaehlen={onWaehlenUndFokus} onTaste={taste}
          onBearbeiten={() => { onWaehlen(sitzung.id); setBearbeitet(sitzung.id); }} />))}
    </nav>
  );
}

export function Kopfzeile({ sitzungen, aktiv, steuernd, onWaehlen, onWaehlenUndFokus, onNeu, onBeenden, onUmbenennen }: KopfzeileProps) {
  const gewaehlt = sitzungen.find((sitzung) => sitzung.id === aktiv) ?? null;
  const modell = gewaehlt?.modell ?? null;
  const aufwand = gewaehlt?.aufwand ?? null;
  const titel = steuernd ? "Neue Sitzung" : "Neue Sitzungen startet nur das steuernde Gerät";
  const beendenTitel = steuernd ? "Kommandozentrale und alle Sitzungen beenden" : "Beenden kann nur das steuernde Gerät";
  return (
    <header class="kz-bar">
      <a class="kz-brand" href="/" title="Zum Cockpit"><Mark size={26} />REPOCITY</a>
      <Reiterleiste sitzungen={sitzungen} aktiv={aktiv} steuernd={steuernd} onWaehlen={onWaehlen} onWaehlenUndFokus={onWaehlenUndFokus} onUmbenennen={onUmbenennen} />
      <div class="kz-neu">
        <button type="button" class="kz-newtab" disabled={!steuernd} title={titel} aria-label={titel} onClick={onNeu}>+</button>
      </div>
      <div class="kz-meta">
        <span class="kz-chip" title="Modell der gewählten Sitzung laut Statuszeile">◆ {modell ?? "Modell unbekannt"}</span>
        {aufwand !== null && <span class="kz-chip" title="Aufwand der gewählten Sitzung laut Statuszeile">◐ {aufwand}</span>}
        <Uhr />
        <button type="button" class="kz-btn kz-btn--stop" disabled={!steuernd} title={beendenTitel} onClick={onBeenden}>Zentrale beenden</button>
      </div>
    </header>
  );
}

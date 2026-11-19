import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./kommandozentrale.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { AgentenBaum } from "./AgentenBaum";
import { Agentenliste } from "./Agentenliste";
import { BeendenDialog, ZentraleBeendet } from "./Beenden";
import { KeineBruecke } from "./KeineBruecke";
import { seitText } from "./anzeige";
import { Geraet } from "./Geraet";
import { Kopfzeile } from "./Kopfzeile";
import { umbenennen } from "./bestand";
import { Menue, MenueDialog, fensterAnfragen, type MenueFensterArt } from "./Menue";
import { keineDaten } from "./menuepunkte";
import { Mitte } from "./Mitte";
import { Projekte } from "./Projekte";
import { useBruecke, useGeraet, type Bruecke, type GeraeteSpeicher } from "./useBruecke";
import { herunterfahren, steuertHier, type Modus, type SitzungsZustand, type Steuerung, type VerbindungsStand } from "./verbindung";
import { steuerungsText } from "./rueckmeldung";
import { WartetAufDich } from "./WartetAufDich";
import { type Senden } from "./gemeinsam";

const TITEL = "Kommandozentrale · RepoCity";

function useTitel(titel: string): void {
  useEffect(() => {
    const vorher = document.title;
    document.title = titel;
    return () => { document.title = vorher; };
  }, [titel]);
}

function useAktiveSitzung(sitzungen: readonly SitzungsZustand[]): [string | null, (sitzung: string) => void] {
  const [wahl, setWahl] = useState<string | null>(null);
  const aktiv = sitzungen.some((sitzung) => sitzung.id === wahl) ? wahl : (sitzungen[0]?.id ?? null);
  return [aktiv, setWahl];
}

interface BannerProps {
  readonly stand: VerbindungsStand;
  readonly modus: Modus | null;
  readonly steuert: Steuerung | null;
  readonly steuernd: boolean;
  readonly warSteuernd: boolean;
  readonly onUebernehmen: () => void;
  readonly onVerbinden: () => void;
}

function Lagebanner({ stand, modus, steuert, steuernd, warSteuernd, onUebernehmen, onVerbinden }: BannerProps) {
  const neu = <button type="button" class="kz-btn" onClick={onVerbinden}>{stand.kind === "abgewiesen" ? "Erneut verbinden" : "Jetzt verbinden"}</button>;
  if (stand.kind === "getrennt") return <div class="kz-lage kz-lage--warn" role="status">Brücke nicht erreichbar seit {seitText(stand.seit)} · neuer Versuch läuft{neu}</div>;
  if (stand.kind === "abgewiesen") return <div class="kz-lage kz-lage--warn" role="alert">Die Brücke hat die Verbindung abgelehnt: {stand.grund === "" ? "ohne Angabe eines Grundes" : stand.grund}{neu}</div>;
  if (stand.kind === "verbindet") return <div class="kz-lage" role="status">Verbinde mit der Brücke …</div>;
  if (stand.kind !== "offen" || modus === null || steuernd) return null;
  return (
    <div class={warSteuernd && modus === "arbeiten" ? "kz-lage kz-lage--warn" : "kz-lage"} role={warSteuernd ? "alert" : "status"}>
      {steuerungsText(modus, warSteuernd, steuert)}
      <button type="button" class="kz-btn kz-btn--go" onClick={onUebernehmen}>Übernehmen</button>
    </div>
  );
}

interface Entwuerfe {
  readonly entwurf: string;
  readonly setEntwurf: (text: string) => void;
  readonly ersetzen: (sitzung: string, text: string) => void;
  readonly feld: { current: HTMLTextAreaElement | null };
  readonly fokus: () => void;
}

function useEntwuerfe(aktiv: string | null): Entwuerfe {
  const [alle, setAlle] = useState<ReadonlyMap<string, string>>(new Map());
  const feld = useRef<HTMLTextAreaElement>(null);
  const setzen = (sitzung: string, aendern: (alt: string) => string) => {
    setAlle((vorher) => new Map(vorher).set(sitzung, aendern(vorher.get(sitzung) ?? "")));
  };
  const fokus = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (document.querySelector(".kz-tab--bearbeiten") === null) feld.current?.focus();
      });
    });
  };
  return {
    entwurf: aktiv === null ? "" : (alle.get(aktiv) ?? ""),
    setEntwurf: (text) => { if (aktiv !== null) setzen(aktiv, () => text); },
    ersetzen: (sitzung, text) => { setzen(sitzung, () => text); },
    feld,
    fokus,
  };
}

interface Raster {
  readonly bruecke: Bruecke;
  readonly entwuerfe: Entwuerfe;
  readonly aktiv: string | null;
  readonly steuernd: boolean;
  readonly oeffnen: (art: MenueFensterArt) => void;
  readonly zumChat: (sitzung: string) => void;
}

function Hauptteil({ bruecke, entwuerfe, aktiv, steuernd, oeffnen, zumChat }: Raster) {
  const sitzung = bruecke.lage.sitzungen.find((eintrag) => eintrag.id === aktiv) ?? null;
  const reparieren = (ziel: string, auftrag: string) => { entwuerfe.ersetzen(ziel, auftrag); zumChat(ziel); };
  return (
    <main class="kz-main">
      <div class="kz-links">
        <AgentenBaum sitzung={sitzung} keineDaten={keineDaten(sitzung, "agenten")} />
        <Agentenliste sitzung={sitzung} bestand={bruecke.menue.bestand} starts={bruecke.lage.starts} steuernd={steuernd} keineDaten={keineDaten(sitzung, "agenten")} senden={bruecke.senden} />
        <Menue aktiv={aktiv} steuernd={steuernd} senden={bruecke.senden} oeffnen={oeffnen} onFertig={entwuerfe.fokus} />
      </div>
      <Mitte bruecke={bruecke} aktiv={aktiv} steuernd={steuernd} entwurf={entwuerfe.entwurf} setEntwurf={entwuerfe.setEntwurf} feld={entwuerfe.feld} />
      <div class="kz-rechts">
        <WartetAufDich sitzungen={bruecke.lage.sitzungen} meldungen={bruecke.meldungen} steuernd={steuernd} senden={bruecke.senden} verwerfen={bruecke.verwerfen}
          assistenz={bruecke.assistenz} assistenzWeg={bruecke.assistenzWeg}
          onZumChat={zumChat} onReparieren={reparieren} />
        <Projekte projekte={bruecke.menue.projekte} steuernd={steuernd} senden={bruecke.senden} onGestartet={entwuerfe.fokus} />
      </div>
    </main>
  );
}

function useWarSteuernd(steuernd: boolean): boolean {
  const zuletzt = useRef(false);
  const [war, setWar] = useState(false);
  useEffect(() => {
    if (steuernd) setWar(false);
    else if (zuletzt.current) setWar(true);
    zuletzt.current = steuernd;
  }, [steuernd]);
  return war;
}

function useUebernahme(bruecke: Bruecke, setModus: (modus: Modus) => void): () => void {
  const offen = useRef(false);
  const { stand, lage, senden } = bruecke;
  useEffect(() => {
    if (!offen.current || stand.kind !== "offen" || lage.steuert?.du === true) {
      if (lage.steuert?.du === true) offen.current = false;
      return;
    }
    offen.current = !senden({ typ: "uebernehmen" });
  }, [stand.kind, lage.steuert, senden]);
  return () => {
    offen.current = true;
    setModus("arbeiten");
    if (stand.kind === "offen" && lage.steuert?.du !== true) offen.current = !senden({ typ: "uebernehmen" });
  };
}

function useMenueFenster(senden: Senden): [MenueFensterArt | null, (art: MenueFensterArt) => void, () => void] {
  const [offen, setOffen] = useState<MenueFensterArt | null>(null);
  const oeffnen = (art: MenueFensterArt) => {
    for (const anfrage of fensterAnfragen(art)) senden(anfrage);
    setOffen(art);
  };
  return [offen, oeffnen, () => { setOffen(null); }];
}

interface Flaeche {
  readonly bruecke: Bruecke;
  readonly speicher: GeraeteSpeicher;
  readonly modus: Modus | null;
  readonly setModus: (modus: Modus) => void;
}

function gewaehlteSitzung(sitzungen: readonly SitzungsZustand[], aktiv: string | null): SitzungsZustand | null {
  return sitzungen.find((sitzung) => sitzung.id === aktiv) ?? null;
}

function Arbeitsflaeche({ bruecke, speicher, modus, setModus }: Flaeche) {
  const [aktiv, waehlen] = useAktiveSitzung(bruecke.lage.sitzungen);
  const steuernd = steuertHier(bruecke.lage.steuert, modus);
  const entwuerfe = useEntwuerfe(aktiv);
  const uebernehmen = useUebernahme(bruecke, setModus);
  const warSteuernd = useWarSteuernd(steuernd);
  const [fenster, oeffnen, schliessen] = useMenueFenster(bruecke.senden);
  const [beenden, setBeenden] = useState(false);
  const waehlenUndFokus = (sitzung: string) => { waehlen(sitzung); entwuerfe.fokus(); };
  const gewaehlt = gewaehlteSitzung(bruecke.lage.sitzungen, aktiv);
  return (
    <>
      <Kopfzeile sitzungen={bruecke.lage.sitzungen} aktiv={aktiv} steuernd={steuernd} onWaehlen={waehlen} onWaehlenUndFokus={waehlenUndFokus} onNeu={() => { oeffnen("neu"); }} onBeenden={() => { setBeenden(true); }}
        onUmbenennen={(sitzung, titel) => bruecke.senden(umbenennen(sitzung, titel))} />
      <Lagebanner stand={bruecke.stand} modus={modus} steuert={bruecke.lage.steuert} steuernd={steuernd} warSteuernd={warSteuernd} onUebernehmen={uebernehmen} onVerbinden={bruecke.jetztVerbinden} />
      <Hauptteil bruecke={bruecke} entwuerfe={entwuerfe} aktiv={aktiv} steuernd={steuernd} oeffnen={oeffnen} zumChat={waehlenUndFokus} />
      {fenster !== null && (
        <MenueDialog art={fenster} daten={bruecke.menue} sitzung={gewaehlt} steuernd={steuernd} senden={bruecke.senden}
          geraetName={speicher.geraet.name} umbenennen={speicher.umbenennen} speicherOk={speicher.speicherOk} onZu={schliessen} onFertig={() => { schliessen(); entwuerfe.fokus(); }} />
      )}
      {beenden && steuernd && <BeendenDialog onAbbrechen={() => { setBeenden(false); }} onBeenden={() => { setBeenden(false); bruecke.senden(herunterfahren()); }} />}
      {modus === null && bruecke.bereitschaft === "bereit" && <Geraet name={speicher.geraet.name} speicherOk={speicher.speicherOk} onWahl={(gewaehlt) => { if (gewaehlt === "arbeiten") uebernehmen(); else setModus("zusehen"); }} />}
    </>
  );
}

export function Kommandozentrale() {
  useTitel(TITEL);
  const speicher = useGeraet();
  const [modus, setModus] = useState<Modus | null>(null);
  const bruecke = useBruecke(speicher, modus);
  return (
    <div class="kz">
      <Arbeitsflaeche bruecke={bruecke} speicher={speicher} modus={modus} setModus={setModus} />
      {bruecke.stand.kind === "zentrale_beendet" ? <ZentraleBeendet /> : bruecke.bereitschaft === "keine_bruecke" && <KeineBruecke />}
    </div>
  );
}

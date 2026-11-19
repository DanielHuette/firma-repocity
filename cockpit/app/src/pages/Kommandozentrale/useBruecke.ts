import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Bestand, BestandNachricht, Hinzugefuegt, Optionen, Projekt } from "./bestand";
import { chatAnwenden, chatsBehalten, type Chats } from "./chat";
import { startzeiten } from "./menuepunkte";
import {
  Verbindung, browserOeffnen, brueckenAdresse, gespeichertesGeraet, istGeraeteName, neueKennung,
  type AssistenzAntwort, type ClientNachricht, type Einstellungen, type Geraet, type Modus, type OrdnerEintrag, type ServerNachricht, type SitzungsZustand,
  type Steuerung, type Treffer, type Uhr, type VerbindungsStand,
} from "./verbindung";
import { statusAbfragen, type Holen } from "./zugang";

export type Bereitschaft = "pruefen" | "bereit" | "keine_bruecke";

export interface Meldung {
  readonly nummer: number;
  readonly text: string;
}

export interface Lage {
  readonly sitzungen: readonly SitzungsZustand[];
  readonly steuert: Steuerung | null;
  readonly starts: ReadonlyMap<string, number>;
}

export interface MenueDaten {
  readonly bestand: Bestand | null;
  readonly optionen: Optionen | null;
  readonly projekte: readonly Projekt[] | null;
  readonly hinzugefuegt: Hinzugefuegt | null;
  readonly treffer: Treffer | null;
  readonly einstellungen: Einstellungen | null;
  readonly ordner: readonly OrdnerEintrag[] | null;
}

export interface Bruecke {
  readonly bereitschaft: Bereitschaft;
  readonly stand: VerbindungsStand;
  readonly lage: Lage;
  readonly menue: MenueDaten;
  readonly chats: Chats;
  readonly meldungen: readonly Meldung[];
  readonly senden: (nachricht: ClientNachricht) => boolean;
  readonly jetztVerbinden: () => void;
  readonly verwerfen: (nummer: number) => void;
  readonly assistenz: readonly AssistenzAntwort[];
  readonly assistenzWeg: (frage: string) => void;
}

export interface GeraeteSpeicher {
  readonly geraet: Geraet;
  readonly umbenennen: (name: string) => boolean;
  readonly kennungErneuern: () => Geraet;
  readonly speicherOk: boolean;
}

const UNLESBAR = "Die Brücke hat eine Nachricht geschickt, die diese Seite nicht lesen kann. Lade die Seite neu; hilft das nicht, passen Brücke und Seite nicht zusammen.";
const GERAETE_SCHLUESSEL = "kommandozentrale.geraet";
const NAMENS_SCHLUESSEL = "kommandozentrale.geraetename";
const LEER: Lage = { sitzungen: [], steuert: null, starts: new Map() };
const KEIN_MENUE: MenueDaten = { bestand: null, optionen: null, projekte: null, hinzugefuegt: null, treffer: null, einstellungen: null, ordner: null };
const BEIM_VERBINDEN: readonly ClientNachricht[] = [{ typ: "bestand_holen" }, { typ: "optionen_holen" }, { typ: "projekte_holen" }];
const KEINE_CHATS: Chats = new Map();

export const holen: Holen = (adresse, optionen) => fetch(adresse, optionen);

const UHR: Uhr = {
  jetzt: () => Date.now(),
  spaeter: (aufgabe, ms) => {
    const zeitgeber = setTimeout(aufgabe, ms);
    return () => { clearTimeout(zeitgeber); };
  },
};

const zufall = (laenge: number) => crypto.getRandomValues(new Uint8Array(laenge));

function lesen(schluessel: string): { readonly ok: boolean; readonly wert: string | null } {
  try {
    return { ok: true, wert: localStorage.getItem(schluessel) };
  } catch (fehler: unknown) {
    if (fehler instanceof DOMException) return { ok: false, wert: null };
    throw fehler;
  }
}

function schreiben(schluessel: string, wert: string): boolean {
  try {
    localStorage.setItem(schluessel, wert);
    return true;
  } catch (fehler: unknown) {
    if (fehler instanceof DOMException) return false;
    throw fehler;
  }
}

function geraetLaden(): { geraet: Geraet; ok: boolean } {
  const ersatz = window.matchMedia("(pointer: coarse)").matches ? "Handy" : "PC";
  const kennung = lesen(GERAETE_SCHLUESSEL);
  const name = lesen(NAMENS_SCHLUESSEL);
  return { geraet: gespeichertesGeraet({ kennung: kennung.wert, name: name.wert }, ersatz, zufall), ok: kennung.ok && name.ok };
}

export function useGeraet(): GeraeteSpeicher {
  const [start] = useState(geraetLaden);
  const [geraet, setGeraet] = useState(start.geraet);
  const [speicherOk, setSpeicherOk] = useState(start.ok);
  useEffect(() => {
    const ok = schreiben(GERAETE_SCHLUESSEL, geraet.kennung) && schreiben(NAMENS_SCHLUESSEL, geraet.name);
    setSpeicherOk((alt) => alt && ok);
  }, [geraet]);
  const umbenennen = useCallback((name: string) => {
    const neu = name.trim();
    if (!istGeraeteName(neu)) return false;
    setGeraet((alt) => (alt.name === neu ? alt : { ...alt, name: neu }));
    return true;
  }, []);
  const kennungErneuern = useCallback(() => {
    const neu = { ...geraet, kennung: neueKennung(zufall) };
    setGeraet(neu);
    return neu;
  }, [geraet]);
  return { geraet, umbenennen, kennungErneuern, speicherOk };
}

function useMeldungen(): { liste: readonly Meldung[]; melden: (text: string) => void; verwerfen: (nummer: number) => void } {
  const [liste, setListe] = useState<readonly Meldung[]>([]);
  const zaehler = useRef(0);
  const melden = useCallback((text: string) => {
    setListe((alt) => (alt.some((meldung) => meldung.text === text) ? alt : [...alt, { nummer: (zaehler.current += 1), text }]));
  }, []);
  const verwerfen = useCallback((nummer: number) => {
    setListe((alt) => alt.filter((meldung) => meldung.nummer !== nummer));
  }, []);
  return { liste, melden, verwerfen };
}

interface Setzer {
  readonly setStand: (stand: VerbindungsStand) => void;
  readonly setBereitschaft: (bereitschaft: Bereitschaft) => void;
  readonly setLage: (aendern: (alt: Lage) => Lage) => void;
  readonly setMenue: (aendern: (alt: MenueDaten) => MenueDaten) => void;
  readonly setChats: (aendern: (alt: Chats) => Chats) => void;
  readonly melden: (text: string) => void;
  readonly assistenzMelden: (antwort: AssistenzAntwort) => void;
}

interface Laufend {
  ersterZustand: boolean;
}

function lageAus(alt: Lage, nachricht: Extract<ServerNachricht, { typ: "zustand" }>, laufend: Laufend): Lage {
  const agenten = nachricht.sitzungen.flatMap((sitzung) => sitzung.agenten.map((agent) => ({ id: `${sitzung.id}|${agent.id}`, seit: agent.seit })));
  const starts = startzeiten(alt.starts, agenten, Date.now(), laufend.ersterZustand);
  laufend.ersterZustand = false;
  return { sitzungen: nachricht.sitzungen, steuert: nachricht.steuert, starts };
}

function verarbeiten(nachricht: ServerNachricht, setzer: Setzer, laufend: Laufend): void {
  switch (nachricht.typ) {
    case "zustand":
      setzer.setLage((alt) => lageAus(alt, nachricht, laufend));
      setzer.setChats((alt) => chatsBehalten(alt, new Set(nachricht.sitzungen.map((sitzung) => sitzung.id))));
      return;
    case "chat":
    case "chat_neu":
    case "chat_teil":
    case "chat_aktualisiert":
      setzer.setChats((alt) => chatAnwenden(alt, nachricht, Date.now()));
      return;
    case "fehler":
      setzer.melden(nachricht.text);
      return;
    case "beendet":
      return;
    case "assistenz_antwort":
      setzer.assistenzMelden(nachricht);
      return;
    default:
      menueVerarbeiten(nachricht, setzer);
  }
}

function bestandVerarbeiten(nachricht: BestandNachricht, setzer: Setzer): void {
  switch (nachricht.typ) {
    case "bestand":
      setzer.setMenue((alt) => ({ ...alt, bestand: nachricht }));
      return;
    case "optionen":
      setzer.setMenue((alt) => ({ ...alt, optionen: nachricht }));
      return;
    case "projekte":
      setzer.setMenue((alt) => ({ ...alt, projekte: nachricht.liste }));
      return;
    case "hinzugefuegt":
      setzer.setMenue((alt) => ({ ...alt, hinzugefuegt: nachricht }));
      return;
  }
}

function menueVerarbeiten(nachricht: Extract<ServerNachricht, { typ: BestandNachricht["typ"] | "treffer" | "einstellungen" | "ordner" }>, setzer: Setzer): void {
  switch (nachricht.typ) {
    case "bestand":
    case "optionen":
    case "projekte":
    case "hinzugefuegt":
      bestandVerarbeiten(nachricht, setzer);
      return;
    case "treffer":
      setzer.setMenue((alt) => ({ ...alt, treffer: nachricht }));
      return;
    case "einstellungen":
      setzer.setMenue((alt) => ({ ...alt, einstellungen: nachricht }));
      return;
    case "ordner":
      setzer.setMenue((alt) => ({ ...alt, ordner: nachricht.liste }));
      return;
  }
}

interface Rahmen {
  readonly geraet: { readonly current: Geraet };
  readonly kennungErneuern: { readonly current: () => Geraet };
  readonly setzer: Setzer;
}

function neueVerbindung({ geraet, kennungErneuern, setzer }: Rahmen, modus: Modus): Verbindung {
  const laufend: Laufend = { ersterZustand: true };
  const verbindung: Verbindung = new Verbindung({
    adresse: brueckenAdresse(window.location),
    geraet: () => geraet.current,
    geraetErneuern: () => kennungErneuern.current(),
    modus,
    oeffnen: browserOeffnen,
    pruefen: () => statusAbfragen(holen),
    uhr: UHR,
    stand: (stand) => {
      setzer.setStand(stand);
      if (stand.kind === "keine_bruecke") setzer.setBereitschaft("keine_bruecke");
      if (stand.kind !== "offen") return;
      laufend.ersterZustand = true;
      for (const anfrage of BEIM_VERBINDEN) verbindung.senden(anfrage);
    },
    nachricht: (nachricht) => { verarbeiten(nachricht, setzer, laufend); },
    unlesbar: () => { setzer.melden(UNLESBAR); },
  });
  return verbindung;
}

function useProjekteNachSitzungen(sitzungen: readonly SitzungsZustand[], offen: boolean, senden: (nachricht: ClientNachricht) => boolean): void {
  const ordner = [...new Set(sitzungen.map((sitzung) => sitzung.ordner))].sort().join("\n");
  const vorher = useRef(ordner);
  useEffect(() => {
    if (vorher.current === ordner) return;
    vorher.current = ordner;
    if (offen) senden({ typ: "projekte_holen" });
  }, [ordner, offen, senden]);
}

function useBereitschaftsPruefung(setBereitschaft: (bereitschaft: Bereitschaft) => void): void {
  useEffect(() => {
    let aktiv = true;
    void statusAbfragen(holen).then((pruefung) => {
      if (aktiv) setBereitschaft(pruefung === "keine_bruecke" ? "keine_bruecke" : "bereit");
    });
    return () => { aktiv = false; };
  }, [setBereitschaft]);
}

function useVerbindung(rahmen: Rahmen, modus: Modus | null, bereit: boolean, name: string): { current: Verbindung | null } {
  const verbindung = useRef<Verbindung | null>(null);
  const letzterModus = useRef(modus);
  letzterModus.current = modus;
  const gewaehlt = modus !== null;
  const { setzer } = rahmen;
  useEffect(() => {
    const start = letzterModus.current;
    if (!bereit || start === null) return;
    const neu = neueVerbindung(rahmen, start);
    verbindung.current = neu;
    neu.starten();
    return () => { neu.beenden(); verbindung.current = null; };
  }, [setzer, gewaehlt, bereit]);
  useEffect(() => { if (modus !== null) verbindung.current?.modusSetzen(modus); }, [modus]);
  const ersterName = useRef(name);
  useEffect(() => {
    if (ersterName.current === name) return;
    ersterName.current = name;
    verbindung.current?.neuVerbinden();
  }, [name]);
  return verbindung;
}

const HOECHSTENS_ASSISTENZ_ANTWORTEN = 5;

export function assistenzHinzu(alt: readonly AssistenzAntwort[], neu: AssistenzAntwort): readonly AssistenzAntwort[] {
  return [neu, ...alt.filter((antwort) => antwort.frage !== neu.frage)].slice(0, HOECHSTENS_ASSISTENZ_ANTWORTEN);
}

function useAssistenz() {
  const [assistenz, setAssistenz] = useState<readonly AssistenzAntwort[]>([]);
  const assistenzMelden = useCallback((antwort: AssistenzAntwort) => { setAssistenz((alt) => assistenzHinzu(alt, antwort)); }, []);
  const assistenzWeg = useCallback((frage: string) => { setAssistenz((alt) => alt.filter((antwort) => antwort.frage !== frage)); }, []);
  return { assistenz, assistenzMelden, assistenzWeg };
}

function useSetzer(melden: (text: string) => void, assistenzMelden: (antwort: AssistenzAntwort) => void) {
  const [bereitschaft, setBereitschaft] = useState<Bereitschaft>("pruefen");
  const [stand, setStand] = useState<VerbindungsStand>({ kind: "verbindet" });
  const [lage, setLage] = useState<Lage>(LEER);
  const [menue, setMenue] = useState<MenueDaten>(KEIN_MENUE);
  const [chats, setChats] = useState<Chats>(KEINE_CHATS);
  const [setzer] = useState<Setzer>(() => ({ setStand, setBereitschaft, setLage, setMenue, setChats, melden, assistenzMelden }));
  return { bereitschaft, stand, lage, menue, chats, setzer, setBereitschaft };
}

export function useBruecke(speicher: GeraeteSpeicher, modus: Modus | null): Bruecke {
  const meldungen = useMeldungen();
  const { melden } = meldungen;
  const { assistenz, assistenzMelden, assistenzWeg } = useAssistenz();
  const { bereitschaft, stand, lage, menue, chats, setzer, setBereitschaft } = useSetzer(melden, assistenzMelden);
  useBereitschaftsPruefung(setBereitschaft);
  const geraet = useRef(speicher.geraet);
  geraet.current = speicher.geraet;
  const kennungErneuern = useRef(speicher.kennungErneuern);
  kennungErneuern.current = () => { const neu = speicher.kennungErneuern(); geraet.current = neu; return neu; };
  const verbindung = useVerbindung({ geraet, kennungErneuern, setzer }, modus, bereitschaft === "bereit", speicher.geraet.name);
  const senden = useCallback((nachricht: ClientNachricht) => verbindung.current?.senden(nachricht) ?? false, [verbindung]);
  const jetztVerbinden = useCallback(() => { verbindung.current?.jetztVerbinden(); }, [verbindung]);
  useProjekteNachSitzungen(lage.sitzungen, stand.kind === "offen", senden);
  return { bereitschaft, stand, lage, menue, chats, meldungen: meldungen.liste, senden, jetztVerbinden, verwerfen: meldungen.verwerfen, assistenz, assistenzWeg };
}

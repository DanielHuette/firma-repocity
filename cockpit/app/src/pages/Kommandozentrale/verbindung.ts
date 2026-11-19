import { leseChatNachricht, istChatTyp, type Antworten, type ChatNachricht, type PlanEntscheidung } from "./chat";
import { ERLAUBNIS_MODI, istBestandTyp, leseBestandNachricht, type Anbieter, type BestandAnfrage, type BestandNachricht, type Erlaubnis } from "./bestand";
import { gueltigeAus, istAus, istFelder, istGanzzahl, istText, istTextOderNull, istZahl, liste, type Felder } from "./waechter";

export type SitzungsStand = "arbeitet" | "wartet" | "ruht";
export type AgentenStand = "laeuft" | "fertig" | "wartet";
export type HinweisArt = "verdichten" | "selbsttest" | "keine_daten";
export type ProzessStand = "laeuft" | "beendet";
export type Entscheidung = "ja" | "nein" | "immer";
export type Modus = "arbeiten" | "zusehen";

export interface Regel {
  readonly type: string;
  readonly destination: string;
  readonly [feld: string]: unknown;
}

export interface Fortschritt {
  readonly erledigt: number;
  readonly gesamt: number;
}

export interface Agent {
  readonly id: string;
  readonly eltern: string | null;
  readonly name: string;
  readonly typ: string;
  readonly stand: AgentenStand;
  readonly werkzeug: string | null;
  readonly aufrufe: number;
  readonly seit: number;
  readonly skills: readonly string[];
  readonly fortschritt: Fortschritt | null;
}

export interface Frage {
  readonly id: string;
  readonly agent: string;
  readonly werkzeug: string;
  readonly beschreibung: string;
  readonly regelBeiImmer: readonly Regel[] | null;
}

export type Hinweis =
  | { readonly art: "verdichten"; readonly anzeige: string }
  | { readonly art: "keine_daten"; readonly anzeige: string }
  | { readonly art: "selbsttest"; readonly text: string; readonly auftrag: string }
  | { readonly art: "terminal_frage"; readonly text: string };

export interface Steuerung {
  readonly name: string;
  readonly du: boolean;
}

export interface VaultTreffer {
  readonly pfad: string;
  readonly zeile: number;
  readonly auszug: string;
}

export interface Erinnerung {
  readonly id: string | number;
  readonly titel: string;
  readonly datum: string;
}

export interface Treffer {
  readonly text: string;
  readonly vault: readonly VaultTreffer[];
  readonly erinnerung: readonly Erinnerung[];
  readonly fehler: string | null;
}

export interface OrdnerEintrag {
  readonly pfad: string;
  readonly name: string;
}

export interface Einstellungen {
  readonly schwelleVerdichten: number;
  readonly claudeVersion: string | null;
}

export interface SitzungsZustand {
  readonly id: string;
  readonly ordner: string;
  readonly titel: string;
  readonly claudeSitzung: string | null;
  readonly stand: SitzungsStand;
  readonly modell: string | null;
  readonly kontextProzent: number | null;
  readonly kontextVeraltet: boolean;
  readonly agenten: readonly Agent[];
  readonly wartet: readonly Frage[];
  readonly hinweise: readonly Hinweis[];
  readonly prozess: ProzessStand;
  readonly hinweis: string | null;
  readonly aufwand: string | null;
  readonly skills: readonly string[];
  readonly plugins: readonly string[];
  readonly konnektoren: readonly string[] | null;
  readonly erlaubnis: Erlaubnis;
  readonly erlaubnisBestaetigt: boolean;
  readonly modellWahl: string | null;
  readonly pausiert: boolean;
  readonly pruefung: boolean;
  readonly ausgabestil: string | null;
  readonly schnell: boolean;
  readonly anbieter: Anbieter;
  readonly kostenUsd: number | null;
  readonly neustartAusstehend: boolean;
}

export interface AssistenzAntwort {
  readonly sitzung: string;
  readonly frage: string;
  readonly name: string;
  readonly entscheidung: "ja" | "nein";
  readonly werkzeug: string;
  readonly beschreibung: string;
}

export type ServerNachricht =
  | { readonly typ: "zustand"; readonly sitzungen: readonly SitzungsZustand[]; readonly steuert: Steuerung | null }
  | ({ readonly typ: "assistenz_antwort" } & AssistenzAntwort)
  | ChatNachricht
  | { readonly typ: "fehler"; readonly text: string }
  | BestandNachricht
  | ({ readonly typ: "treffer" } & Treffer)
  | ({ readonly typ: "einstellungen" } & Einstellungen)
  | { readonly typ: "ordner"; readonly liste: readonly OrdnerEintrag[] }
  | { readonly typ: "beendet" };

export type ClientNachricht =
  | { readonly typ: "hallo"; readonly geraet: string; readonly name: string; readonly modus: Modus }
  | BestandAnfrage
  | { readonly typ: "suche"; readonly text: string }
  | { readonly typ: "einstellungen" }
  | { readonly typ: "einstellung"; readonly schwelleVerdichten: number }
  | { readonly typ: "selbsttest" }
  | { readonly typ: "ordner" }
  | { readonly typ: "nachricht"; readonly sitzung: string; readonly text: string }
  | { readonly typ: "abbrechen"; readonly sitzung: string }
  | { readonly typ: "frage_antwort"; readonly sitzung: string; readonly eintrag: string; readonly antworten: Antworten }
  | { readonly typ: "plan_antwort"; readonly sitzung: string; readonly eintrag: string; readonly entscheidung: PlanEntscheidung }
  | { readonly typ: "antwort"; readonly frage: string; readonly entscheidung: Entscheidung }
  | { readonly typ: "neu"; readonly ordner: string | null; readonly anbieter?: Anbieter; readonly modell?: string }
  | { readonly typ: "beenden"; readonly sitzung: string }
  | { readonly typ: "fortsetzen"; readonly sitzung: string }
  | { readonly typ: "uebernehmen" }
  | { readonly typ: "herunterfahren" };

export interface Geraet {
  readonly kennung: string;
  readonly name: string;
}

const SITZUNGS_STAENDE = ["arbeitet", "wartet", "ruht"] as const;
const AGENTEN_STAENDE = ["laeuft", "fertig", "wartet"] as const;
const PROZESS_STAENDE = ["laeuft", "beendet"] as const;
const ANBIETER = ["abo", "openrouter"] as const;
const KENNUNG_BYTES = 18;
const LAENGSTER_NAME = 40;
const UNSICHTBAR_ODER_STEUERZEICHEN = /[\p{Cc}\p{Cf}]/u;

export const GERAETE_KENNUNG = /^[A-Za-z0-9_-]{16,64}$/;
const ERSTE_WARTEZEIT_MS = 1000;
const LAENGSTE_WARTEZEIT_MS = 15_000;

const textListe = (wert: unknown): string[] | undefined => liste(wert, (eintrag) => (istText(eintrag) ? eintrag : undefined));
const istMenge = (wert: unknown): wert is number => istGanzzahl(wert) && wert >= 0;

function leseFortschritt(wert: unknown): Fortschritt | null | undefined {
  if (wert === null) return null;
  if (!istFelder(wert)) return undefined;
  const { erledigt, gesamt } = wert;
  return istMenge(erledigt) && istMenge(gesamt) && erledigt <= gesamt ? { erledigt, gesamt } : undefined;
}

function leseAgent(wert: unknown): Agent | undefined {
  if (!istFelder(wert)) return undefined;
  const { id, eltern, name, typ, stand, werkzeug, aufrufe, seit } = wert;
  const skills = textListe(wert.skills);
  const fortschritt = leseFortschritt(wert.fortschritt);
  if (!istText(id) || !istTextOderNull(eltern) || !istText(name) || !istText(typ)) return undefined;
  if (!istAus(AGENTEN_STAENDE, stand) || !istTextOderNull(werkzeug) || !istGanzzahl(aufrufe) || !istZahl(seit)) return undefined;
  if (skills === undefined || fortschritt === undefined) return undefined;
  return { id, eltern, name, typ, stand, werkzeug, aufrufe, seit, skills, fortschritt };
}

function leseRegel(wert: unknown): Regel | undefined {
  if (!istFelder(wert) || !istText(wert.type) || !istText(wert.destination)) return undefined;
  return { ...wert, type: wert.type, destination: wert.destination };
}

function leseFrage(wert: unknown): Frage | undefined {
  if (!istFelder(wert)) return undefined;
  const { id, agent, werkzeug, beschreibung, regelBeiImmer } = wert;
  if (!istText(id) || !istText(agent) || !istText(werkzeug) || !istText(beschreibung)) return undefined;
  const regeln = regelBeiImmer === null ? null : liste(regelBeiImmer, leseRegel);
  if (regeln === undefined) return undefined;
  return { id, agent, werkzeug, beschreibung, regelBeiImmer: regeln };
}

function leseHinweis(wert: unknown): Hinweis | undefined {
  if (!istFelder(wert)) return undefined;
  const { art, anzeige, text, auftrag } = wert;
  if (art === "selbsttest") return istText(text) && istText(auftrag) ? { art, text, auftrag } : undefined;
  if (art === "terminal_frage") return istText(text) ? { art, text } : undefined;
  if ((art === "verdichten" || art === "keine_daten") && istText(anzeige)) return { art, anzeige };
  return undefined;
}

type Kopf = Pick<SitzungsZustand, "id" | "ordner" | "titel" | "claudeSitzung" | "stand" | "modell" | "kontextProzent" | "kontextVeraltet">;

function leseKopf(felder: Felder): Kopf | undefined {
  const { id, ordner, titel, claudeSitzung, stand, modell, kontextProzent, kontextVeraltet } = felder;
  if (!istText(id) || !istText(ordner) || !istText(titel) || titel === "" || !istTextOderNull(claudeSitzung)) return undefined;
  if (!istAus(SITZUNGS_STAENDE, stand) || !istTextOderNull(modell) || typeof kontextVeraltet !== "boolean") return undefined;
  if (kontextProzent !== null && !istZahl(kontextProzent)) return undefined;
  return { id, ordner, titel, claudeSitzung, stand, modell, kontextProzent, kontextVeraltet };
}

type Prozess = Pick<SitzungsZustand, "prozess" | "hinweis">;

function leseProzess(felder: Felder): Prozess | undefined {
  const { prozess, hinweis } = felder;
  if (!istAus(PROZESS_STAENDE, prozess) || !istTextOderNull(hinweis)) return undefined;
  return { prozess, hinweis };
}

type Optionen = Pick<SitzungsZustand, "skills" | "plugins" | "konnektoren" | "erlaubnis" | "erlaubnisBestaetigt" | "modellWahl" | "pausiert" | "pruefung" | "ausgabestil" | "schnell" | "anbieter" | "kostenUsd" | "neustartAusstehend">;

function leseOptionen(felder: Felder): Optionen | undefined {
  const { erlaubnis, erlaubnisBestaetigt, modellWahl, pausiert, pruefung, ausgabestil, schnell, anbieter, kostenUsd, neustartAusstehend } = felder;
  const skills = textListe(felder.skills);
  const plugins = textListe(felder.plugins);
  const konnektoren = felder.konnektoren === null ? null : textListe(felder.konnektoren);
  if (skills === undefined || plugins === undefined || konnektoren === undefined) return undefined;
  if (!istAus(ERLAUBNIS_MODI, erlaubnis) || !istTextOderNull(ausgabestil) || typeof schnell !== "boolean" || !istAus(ANBIETER, anbieter)) return undefined;
  if ((kostenUsd !== null && !istZahl(kostenUsd)) || typeof neustartAusstehend !== "boolean") return undefined;
  if (typeof erlaubnisBestaetigt !== "boolean" || !istTextOderNull(modellWahl) || typeof pausiert !== "boolean" || typeof pruefung !== "boolean") return undefined;
  return { skills, plugins, konnektoren, erlaubnis, erlaubnisBestaetigt, modellWahl, pausiert, pruefung, ausgabestil, schnell, anbieter, kostenUsd, neustartAusstehend };
}

function leseSitzung(wert: unknown): SitzungsZustand | undefined {
  if (!istFelder(wert)) return undefined;
  const kopf = leseKopf(wert);
  const prozess = leseProzess(wert);
  const agenten = liste(wert.agenten, leseAgent);
  const wartet = liste(wert.wartet, leseFrage);
  const hinweise = gueltigeAus(wert.hinweise, leseHinweis);
  const aufwand = wert.aufwand ?? null;
  const optionen = leseOptionen(wert);
  if (kopf === undefined || prozess === undefined || agenten === undefined || wartet === undefined) return undefined;
  if (hinweise === undefined || !istTextOderNull(aufwand) || optionen === undefined) return undefined;
  return { ...kopf, agenten, wartet, hinweise, ...prozess, aufwand, ...optionen };
}

function leseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (fehler: unknown) {
    if (fehler instanceof SyntaxError) return undefined;
    throw fehler;
  }
}

function leseSteuerung(wert: unknown): Steuerung | null | undefined {
  if (wert === null) return null;
  if (!istFelder(wert) || !istText(wert.name) || typeof wert.du !== "boolean") return undefined;
  return { name: wert.name, du: wert.du };
}

function leseZustand(felder: Felder): ServerNachricht | undefined {
  const sitzungen = liste(felder.sitzungen, leseSitzung);
  const steuert = leseSteuerung(felder.steuert);
  if (sitzungen === undefined || steuert === undefined) return undefined;
  return { typ: "zustand", sitzungen, steuert };
}

function leseVaultTreffer(wert: unknown): VaultTreffer | undefined {
  if (!istFelder(wert)) return undefined;
  const { pfad, zeile, auszug } = wert;
  return istText(pfad) && istGanzzahl(zeile) && istText(auszug) ? { pfad, zeile, auszug } : undefined;
}

function leseErinnerung(wert: unknown): Erinnerung | undefined {
  if (!istFelder(wert)) return undefined;
  const { id, titel, datum } = wert;
  if (!(istText(id) || istGanzzahl(id)) || !istText(titel) || !istText(datum)) return undefined;
  return { id, titel, datum };
}

function leseTreffer(felder: Felder): ServerNachricht | undefined {
  const { text, fehler } = felder;
  const vault = liste(felder.vault, leseVaultTreffer);
  const erinnerung = liste(felder.erinnerung, leseErinnerung);
  if (!istText(text) || vault === undefined || erinnerung === undefined) return undefined;
  if (fehler !== undefined && !istTextOderNull(fehler)) return undefined;
  return { typ: "treffer", text, vault, erinnerung, fehler: fehler ?? null };
}

function leseEinstellungen(felder: Felder): ServerNachricht | undefined {
  const { schwelleVerdichten, claudeVersion } = felder;
  if (!istGanzzahl(schwelleVerdichten) || !istTextOderNull(claudeVersion)) return undefined;
  return { typ: "einstellungen", schwelleVerdichten, claudeVersion };
}

function leseOrdner(wert: unknown): OrdnerEintrag | undefined {
  if (!istFelder(wert) || !istText(wert.pfad) || wert.pfad === "" || !istText(wert.name)) return undefined;
  return { pfad: wert.pfad, name: wert.name };
}

function leseMenue(felder: Felder): ServerNachricht | undefined {
  switch (felder.typ) {
    case "ordner": {
      const ordner = liste(felder.liste, leseOrdner);
      return ordner === undefined ? undefined : { typ: "ordner", liste: ordner };
    }
    case "treffer":
      return leseTreffer(felder);
    case "einstellungen":
      return leseEinstellungen(felder);
    default:
      return undefined;
  }
}

const ASSISTENZ_ENTSCHEIDUNGEN = ["ja", "nein"] as const;

function leseAssistenzAntwort(felder: Felder): ServerNachricht | undefined {
  const { sitzung, frage, name, entscheidung, werkzeug, beschreibung } = felder;
  const gefuellt = (wert: unknown): wert is string => istText(wert) && wert !== "";
  if (!gefuellt(sitzung) || !gefuellt(frage) || !gefuellt(name) || !istAus(ASSISTENZ_ENTSCHEIDUNGEN, entscheidung) || !gefuellt(werkzeug) || typeof beschreibung !== "string") return undefined;
  return { typ: "assistenz_antwort", sitzung, frage, name, entscheidung, werkzeug, beschreibung };
}

export function leseNachricht(text: string): ServerNachricht | undefined {
  const felder = leseJson(text);
  if (!istFelder(felder)) return undefined;
  const { typ } = felder;
  if (istChatTyp(typ)) return leseChatNachricht(felder);
  if (istBestandTyp(typ)) return leseBestandNachricht(felder);
  switch (typ) {
    case "zustand":
      return leseZustand(felder);
    case "fehler":
      return istText(felder.text) ? { typ, text: felder.text } : undefined;
    case "beendet":
      return { typ };
    case "assistenz_antwort":
      return leseAssistenzAntwort(felder);
    default:
      return leseMenue(felder);
  }
}

export function hallo(geraet: Geraet, modus: Modus): ClientNachricht {
  return { typ: "hallo", geraet: geraet.kennung, name: geraet.name, modus };
}

export function neueSitzung(ordner: string): ClientNachricht {
  const pfad = ordner.trim();
  return { typ: "neu", ordner: pfad === "" ? null : pfad };
}

export function fortsetzen(sitzung: string): ClientNachricht {
  return { typ: "fortsetzen", sitzung };
}

export function verdichten(sitzung: string): ClientNachricht {
  return { typ: "nachricht", sitzung, text: "/compact" };
}

export function ordnerAnfragen(): ClientNachricht {
  return { typ: "ordner" };
}

export function herunterfahren(): ClientNachricht {
  return { typ: "herunterfahren" };
}

export function steuertHier(steuert: Steuerung | null, modus: Modus | null): boolean {
  return modus === "arbeiten" && steuert?.du === true;
}

export function neueKennung(zufall: (laenge: number) => Uint8Array): string {
  const zeichen = String.fromCharCode(...zufall(KENNUNG_BYTES));
  return btoa(zeichen).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function istGeraeteName(name: string): boolean {
  return name !== "" && name.length <= LAENGSTER_NAME && name.trim() === name && !UNSICHTBAR_ODER_STEUERZEICHEN.test(name);
}

export function gespeichertesGeraet(
  gespeichert: { readonly kennung: string | null; readonly name: string | null },
  ersatzName: string,
  zufall: (laenge: number) => Uint8Array,
): Geraet {
  const kennung = gespeichert.kennung !== null && GERAETE_KENNUNG.test(gespeichert.kennung) ? gespeichert.kennung : neueKennung(zufall);
  const name = gespeichert.name !== null && istGeraeteName(gespeichert.name) ? gespeichert.name : ersatzName;
  return { kennung, name };
}

export function wartezeit(versuch: number): number {
  return Math.min(LAENGSTE_WARTEZEIT_MS, ERSTE_WARTEZEIT_MS * 2 ** versuch);
}

export type VerbindungsStand =
  | { readonly kind: "verbindet" }
  | { readonly kind: "offen" }
  | { readonly kind: "getrennt"; readonly seit: number; readonly versuch: number }
  | { readonly kind: "abgewiesen"; readonly grund: string }
  | { readonly kind: "keine_bruecke" }
  | { readonly kind: "beendet" }
  | { readonly kind: "zentrale_beendet" };

export type Pruefung = "bereit" | "unbekannt" | "keine_bruecke";

export const KENNUNG_VERGEBEN = "Geraetekennung gehoert einem anderen Geraet";
const ABGEWIESEN = 1008;

export interface SockelRueckrufe {
  readonly offen: () => void;
  readonly nachricht: (text: string) => void;
  readonly zu: (code: number, grund: string) => void;
}

export interface SockelGriff {
  readonly senden: (text: string) => void;
  readonly schliessen: () => void;
}

export type Oeffnen = (adresse: string, rueckrufe: SockelRueckrufe) => SockelGriff;

export interface Uhr {
  readonly jetzt: () => number;
  readonly spaeter: (aufgabe: () => void, ms: number) => () => void;
}

export interface VerbindungsOptionen {
  readonly adresse: string;
  readonly geraet: () => Geraet;
  readonly geraetErneuern: () => Geraet;
  readonly modus: Modus;
  readonly oeffnen: Oeffnen;
  readonly pruefen: () => Promise<Pruefung>;
  readonly uhr: Uhr;
  readonly stand: (stand: VerbindungsStand) => void;
  readonly nachricht: (nachricht: ServerNachricht) => void;
  readonly unlesbar: () => void;
}

export class Verbindung {
  readonly #optionen: VerbindungsOptionen;
  #griff: SockelGriff | null = null;
  #offen = false;
  #beendet = false;
  #runde = 0;
  #versuch = 0;
  #getrenntSeit: number | null = null;
  #abbrechen: (() => void) | null = null;
  #modus: Modus;
  #ersatzKennung: string | null = null;
  #zentraleEndet = false;

  constructor(optionen: VerbindungsOptionen) {
    this.#optionen = optionen;
    this.#modus = optionen.modus;
  }

  modusSetzen(modus: Modus): void {
    this.#modus = modus;
  }

  starten(): void {
    this.#verbinden();
  }

  senden(nachricht: ClientNachricht): boolean {
    if (!this.#offen || this.#griff === null) return false;
    this.#griff.senden(JSON.stringify(nachricht));
    if (nachricht.typ === "herunterfahren") this.#zentraleEndet = true;
    return true;
  }

  jetztVerbinden(): void {
    if (this.#offen) return;
    this.neuVerbinden();
  }

  neuVerbinden(): void {
    if (this.#beendet) return;
    this.#abbrechen?.();
    this.#abbrechen = null;
    this.#griff?.schliessen();
    this.#offen = false;
    this.#verbinden();
  }

  beenden(): void {
    this.#beendet = true;
    this.#runde += 1;
    this.#abbrechen?.();
    this.#griff?.schliessen();
    this.#griff = null;
    this.#offen = false;
    this.#optionen.stand({ kind: "beendet" });
  }

  #verbinden(): void {
    const runde = ++this.#runde;
    const aktuell = () => runde === this.#runde;
    if (this.#getrenntSeit === null) this.#optionen.stand({ kind: "verbindet" });
    this.#griff = this.#optionen.oeffnen(this.#optionen.adresse, {
      offen: () => { if (aktuell()) this.#geoeffnet(); },
      nachricht: (text) => { if (aktuell()) this.#empfangen(text); },
      zu: (code, grund) => { if (aktuell()) void this.#geschlossen(code, grund, runde); },
    });
  }

  #geoeffnet(): void {
    this.#offen = true;
    this.#versuch = 0;
    this.#getrenntSeit = null;
    const geraet = this.#optionen.geraet();
    this.#griff?.senden(JSON.stringify(hallo({ ...geraet, kennung: this.#ersatzKennung ?? geraet.kennung }, this.#modus)));
    this.#optionen.stand({ kind: "offen" });
  }

  #empfangen(text: string): void {
    const nachricht = leseNachricht(text);
    if (nachricht === undefined) this.#optionen.unlesbar();
    else if (nachricht.typ === "beendet") this.#zentraleBeendet();
    else this.#optionen.nachricht(nachricht);
  }

  #zentraleBeendet(): void {
    this.#beendet = true;
    this.#offen = false;
    this.#optionen.stand({ kind: "zentrale_beendet" });
  }

  async #geschlossen(code: number, grund: string, runde: number): Promise<void> {
    this.#offen = false;
    this.#griff = null;
    if (this.#zentraleEndet || this.#beendet) {
      this.#zentraleBeendet();
      return;
    }
    if (code === ABGEWIESEN) {
      this.#abgewiesen(grund);
      return;
    }
    const seit = (this.#getrenntSeit ??= this.#optionen.uhr.jetzt());
    this.#versuch += 1;
    this.#optionen.stand({ kind: "getrennt", seit, versuch: this.#versuch });
    const pruefung = await this.#optionen.pruefen();
    if (runde !== this.#runde) return;
    if (pruefung === "keine_bruecke") this.#optionen.stand({ kind: "keine_bruecke" });
    else this.#abbrechen = this.#optionen.uhr.spaeter(() => { this.#verbinden(); }, wartezeit(this.#versuch - 1));
  }

  #abgewiesen(grund: string): void {
    this.#getrenntSeit = null;
    this.#versuch = 0;
    if (grund === KENNUNG_VERGEBEN && this.#ersatzKennung === null) {
      this.#ersatzKennung = this.#optionen.geraetErneuern().kennung;
      this.#verbinden();
      return;
    }
    this.#optionen.stand({ kind: "abgewiesen", grund });
  }

}

export function browserOeffnen(adresse: string, rueckrufe: SockelRueckrufe): SockelGriff {
  const sockel = new WebSocket(adresse);
  sockel.addEventListener("open", () => { rueckrufe.offen(); });
  sockel.addEventListener("message", (ereignis: MessageEvent<unknown>) => {
    if (typeof ereignis.data === "string") rueckrufe.nachricht(ereignis.data);
  });
  sockel.addEventListener("close", (ereignis) => { rueckrufe.zu(ereignis.code, ereignis.reason); });
  return { senden: (text) => { sockel.send(text); }, schliessen: () => { sockel.close(); } };
}

export function brueckenAdresse(ort: Pick<Location, "protocol" | "host">): string {
  return `${ort.protocol === "https:" ? "wss:" : "ws:"}//${ort.host}/ws`;
}

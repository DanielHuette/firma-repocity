import type { ClientNachricht } from "./verbindung";
import { gueltigeAus, istAus, istFelder, istText, istZahl, liste, type Felder } from "./waechter";

export type EintragArt = "du" | "claude" | "werkzeug" | "agent" | "frage" | "plan" | "system";
export type WerkzeugStand = "laeuft" | "ok" | "fehler";
export type PlanEntscheidung = "ja" | "nein";
export type Antworten = Readonly<Record<string, string | readonly string[]>>;

export interface WerkzeugAufruf {
  readonly name: string;
  readonly kurz: string;
  readonly eingabe: unknown;
  readonly ergebnis: string | null;
  readonly status: WerkzeugStand;
}

export interface AgentAufruf {
  readonly typ: string;
  readonly beschreibung: string;
  readonly status: string;
}

export interface Option {
  readonly label: string;
  readonly beschreibung: string;
}

export interface Teilfrage {
  readonly frage: string;
  readonly kopf: string;
  readonly optionen: readonly Option[];
  readonly mehrfach: boolean;
}

export interface FrageInhalt {
  readonly fragen: readonly Teilfrage[];
  readonly beantwortet: Antworten | null;
}

export interface PlanInhalt {
  readonly text: string;
  readonly entschieden: PlanEntscheidung | null;
}

export interface Eintrag {
  readonly id: string;
  readonly art: EintragArt;
  readonly zeit: number;
  readonly text: string | null;
  readonly eltern: string | null;
  readonly werkzeug: WerkzeugAufruf | null;
  readonly agent: AgentAufruf | null;
  readonly frage: FrageInhalt | null;
  readonly plan: PlanInhalt | null;
}

export type ChatNachricht =
  | { readonly typ: "chat"; readonly sitzung: string; readonly eintraege: readonly Eintrag[] }
  | { readonly typ: "chat_neu"; readonly sitzung: string; readonly eintrag: Eintrag }
  | { readonly typ: "chat_teil"; readonly sitzung: string; readonly id: string; readonly text: string }
  | { readonly typ: "chat_aktualisiert"; readonly sitzung: string; readonly eintrag: Eintrag };

export type Chats = ReadonlyMap<string, readonly Eintrag[]>;

export interface Knoten {
  readonly eintrag: Eintrag;
  readonly kinder: readonly Knoten[];
}

export interface Wahl {
  readonly gewaehlt: readonly string[];
  readonly eigene: string;
}

export type NachrichtGelesen =
  | { readonly kind: "leer" }
  | { readonly kind: "zu_lang" }
  | { readonly kind: "ok"; readonly nachricht: ClientNachricht };

export const LAENGSTE_NACHRICHT = 100_000;
const ART_MIT_TEXT: readonly EintragArt[] = ["du", "claude", "system"];
const EINTRAG_ARTEN = ["du", "claude", "werkzeug", "agent", "frage", "plan", "system"] as const;
const WERKZEUG_STAENDE = ["laeuft", "ok", "fehler"] as const;
const PLAN_ENTSCHEIDUNGEN = ["ja", "nein"] as const;
const FOLGE_ABSTAND_PX = 32;
const ANSAGE_LAENGE = 300;
const LEERE_ZEILEN_AM_ENDE = /\s+$/;

function optional<T>(wert: unknown, lesen: (wert: unknown) => T | undefined): T | null | undefined {
  return wert === undefined || wert === null ? null : lesen(wert);
}

function leseZeit(wert: unknown): number | undefined {
  if (istZahl(wert)) return wert;
  if (!istText(wert)) return undefined;
  const zeit = Date.parse(wert);
  return Number.isNaN(zeit) ? undefined : zeit;
}

function ergebnisText(wert: unknown): string {
  return istText(wert) ? wert : JSON.stringify(wert);
}

function leseWerkzeug(wert: unknown): WerkzeugAufruf | undefined {
  if (!istFelder(wert)) return undefined;
  const { name, kurz, eingabe, ergebnis, status } = wert;
  if (!istText(name) || !istText(kurz) || !istAus(WERKZEUG_STAENDE, status)) return undefined;
  return { name, kurz, eingabe, ergebnis: ergebnis === undefined || ergebnis === null ? null : ergebnisText(ergebnis), status };
}

function leseAgent(wert: unknown): AgentAufruf | undefined {
  if (!istFelder(wert)) return undefined;
  const { typ, beschreibung, status } = wert;
  return istText(typ) && istText(beschreibung) && istText(status) ? { typ, beschreibung, status } : undefined;
}

function textOderLeer(wert: unknown): string | undefined {
  if (wert === undefined) return "";
  return istText(wert) ? wert : undefined;
}

function leseOption(wert: unknown): Option | undefined {
  if (!istFelder(wert) || !istText(wert.label)) return undefined;
  const beschreibung = textOderLeer(wert.beschreibung);
  return beschreibung === undefined ? undefined : { label: wert.label, beschreibung };
}

function leseTeilfrage(wert: unknown): Teilfrage | undefined {
  if (!istFelder(wert) || !istText(wert.frage)) return undefined;
  const kopf = textOderLeer(wert.kopf);
  const optionen = liste(wert.optionen, leseOption);
  const mehrfach = wert.mehrfach ?? false;
  if (kopf === undefined || optionen === undefined || typeof mehrfach !== "boolean") return undefined;
  return { frage: wert.frage, kopf, optionen, mehrfach };
}

function leseAntworten(wert: unknown): Antworten | undefined {
  if (!istFelder(wert)) return undefined;
  const gelesen: Record<string, string | readonly string[]> = {};
  for (const [frage, antwort] of Object.entries(wert)) {
    const passend = istText(antwort) ? antwort : liste(antwort, (teil) => (istText(teil) ? teil : undefined));
    if (passend === undefined) return undefined;
    gelesen[frage] = passend;
  }
  return gelesen;
}

function leseFrage(wert: unknown): FrageInhalt | undefined {
  if (!istFelder(wert)) return undefined;
  const fragen = liste(wert.fragen, leseTeilfrage);
  const beantwortet = optional(wert.beantwortet, leseAntworten);
  return fragen === undefined || beantwortet === undefined ? undefined : { fragen, beantwortet };
}

function lesePlan(wert: unknown): PlanInhalt | undefined {
  if (!istFelder(wert) || !istText(wert.text)) return undefined;
  const entschieden = optional(wert.entschieden, (entscheidung) => (istAus(PLAN_ENTSCHEIDUNGEN, entscheidung) ? entscheidung : undefined));
  return entschieden === undefined ? undefined : { text: wert.text, entschieden };
}

function leseInhalt(felder: Felder) {
  return {
    text: optional(felder.text, (text) => (istText(text) ? text : undefined)),
    eltern: optional(felder.eltern, (eltern) => (istText(eltern) ? eltern : undefined)),
    werkzeug: optional(felder.werkzeug, leseWerkzeug),
    agent: optional(felder.agent, leseAgent),
    frage: optional(felder.frage, leseFrage),
    plan: optional(felder.plan, lesePlan),
  };
}

function passtZurArt(art: EintragArt, inhalt: ReturnType<typeof leseInhalt>): boolean {
  if (ART_MIT_TEXT.includes(art)) return inhalt.text !== null;
  if (art === "werkzeug") return inhalt.werkzeug !== null;
  if (art === "agent") return inhalt.agent !== null;
  return art === "frage" ? inhalt.frage !== null : inhalt.plan !== null;
}

export function leseEintrag(wert: unknown): Eintrag | undefined {
  if (!istFelder(wert) || !istText(wert.id) || !istAus(EINTRAG_ARTEN, wert.art)) return undefined;
  const zeit = leseZeit(wert.zeit);
  const inhalt = leseInhalt(wert);
  const { text, eltern, werkzeug, agent, frage, plan } = inhalt;
  if (zeit === undefined || text === undefined || eltern === undefined || werkzeug === undefined) return undefined;
  if (agent === undefined || frage === undefined || plan === undefined) return undefined;
  const gelesen = { text, eltern, werkzeug, agent, frage, plan };
  return passtZurArt(wert.art, gelesen) ? { id: wert.id, art: wert.art, zeit, ...gelesen } : undefined;
}

export function leseChatNachricht(felder: Felder): ChatNachricht | undefined {
  const { typ, sitzung } = felder;
  if (!istText(sitzung)) return undefined;
  switch (typ) {
    case "chat": {
      const eintraege = gueltigeAus(felder.eintraege, leseEintrag);
      return eintraege === undefined ? undefined : { typ, sitzung, eintraege };
    }
    case "chat_neu":
    case "chat_aktualisiert": {
      const eintrag = leseEintrag(felder.eintrag);
      return eintrag === undefined ? undefined : { typ, sitzung, eintrag };
    }
    case "chat_teil":
      return istText(felder.id) && istText(felder.text) ? { typ, sitzung, id: felder.id, text: felder.text } : undefined;
    default:
      return undefined;
  }
}

export function istChatTyp(typ: unknown): boolean {
  return typ === "chat" || typ === "chat_neu" || typ === "chat_teil" || typ === "chat_aktualisiert";
}

function ersetzenOderAnhaengen(eintraege: readonly Eintrag[], neu: Eintrag): Eintrag[] {
  const stelle = eintraege.findIndex((eintrag) => eintrag.id === neu.id);
  return stelle === -1 ? [...eintraege, neu] : eintraege.map((eintrag, index) => (index === stelle ? neu : eintrag));
}

function textAnhaengen(eintraege: readonly Eintrag[], id: string, text: string, jetzt: number): Eintrag[] {
  const alt = eintraege.find((eintrag) => eintrag.id === id);
  const neu: Eintrag = alt === undefined
    ? { id, art: "claude", zeit: jetzt, text, eltern: null, werkzeug: null, agent: null, frage: null, plan: null }
    : { ...alt, text: (alt.text ?? "") + text };
  return ersetzenOderAnhaengen(eintraege, neu);
}

export function chatAnwenden(chats: Chats, nachricht: ChatNachricht, jetzt: number): Chats {
  const alt = chats.get(nachricht.sitzung) ?? [];
  const neu = new Map(chats);
  switch (nachricht.typ) {
    case "chat":
      neu.set(nachricht.sitzung, nachricht.eintraege);
      break;
    case "chat_neu":
    case "chat_aktualisiert":
      neu.set(nachricht.sitzung, ersetzenOderAnhaengen(alt, nachricht.eintrag));
      break;
    case "chat_teil":
      neu.set(nachricht.sitzung, textAnhaengen(alt, nachricht.id, nachricht.text, jetzt));
      break;
  }
  return neu;
}

export function chatsBehalten(chats: Chats, sitzungen: ReadonlySet<string>): Chats {
  return new Map([...chats].filter(([sitzung]) => sitzungen.has(sitzung)));
}

export function verschachteln(eintraege: readonly Eintrag[]): Knoten[] {
  const kinder = new Map<string, Knoten[]>();
  const oben: Knoten[] = [];
  for (const eintrag of eintraege) {
    const eigene: Knoten[] = [];
    const geschwister = eintrag.eltern === null ? undefined : kinder.get(eintrag.eltern);
    (geschwister ?? oben).push({ eintrag, kinder: eigene });
    if (!kinder.has(eintrag.id)) kinder.set(eintrag.id, eigene);
  }
  return oben;
}

function antwortAuf(frage: Teilfrage, wahl: Wahl | undefined): string | string[] | null {
  const eigene = wahl?.eigene.trim() ?? "";
  const gewaehlt = frage.optionen.map((option) => option.label).filter((label) => wahl?.gewaehlt.includes(label) === true);
  if (frage.mehrfach) {
    const alle = eigene === "" ? gewaehlt : [...gewaehlt, eigene];
    return alle.length === 0 ? null : alle;
  }
  return eigene !== "" ? eigene : (gewaehlt[0] ?? null);
}

export function fragenAntwort(fragen: readonly Teilfrage[], wahl: Readonly<Record<string, Wahl>>): Antworten | null {
  const antworten: Record<string, string | readonly string[]> = {};
  for (const frage of fragen) {
    const antwort = antwortAuf(frage, wahl[frage.frage]);
    if (antwort === null) return null;
    antworten[frage.frage] = antwort;
  }
  return antworten;
}

export function nachrichtLesen(sitzung: string, text: string): NachrichtGelesen {
  if (text.trim() === "") return { kind: "leer" };
  const gesendet = text.replace(LEERE_ZEILEN_AM_ENDE, "");
  if (gesendet.length > LAENGSTE_NACHRICHT) return { kind: "zu_lang" };
  return { kind: "ok", nachricht: { typ: "nachricht", sitzung, text: gesendet } };
}

export function befehl(sitzung: string, text: string): ClientNachricht {
  return { typ: "nachricht", sitzung, text };
}

export function abbrechen(sitzung: string): ClientNachricht {
  return { typ: "abbrechen", sitzung };
}

export function frageAntwort(sitzung: string, eintrag: string, antworten: Antworten): ClientNachricht {
  return { typ: "frage_antwort", sitzung, eintrag, antworten };
}

export function planAntwort(sitzung: string, eintrag: string, entscheidung: PlanEntscheidung): ClientNachricht {
  return { typ: "plan_antwort", sitzung, eintrag, entscheidung };
}

export function amEnde(lage: { readonly scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number }): boolean {
  return lage.scrollHeight - lage.clientHeight - lage.scrollTop <= FOLGE_ABSTAND_PX;
}

export function kuerzen(text: string, hoechstens: number): { readonly text: string; readonly gekuerzt: boolean } {
  return text.length <= hoechstens ? { text, gekuerzt: false } : { text: text.slice(0, hoechstens), gekuerzt: true };
}

export function ersteZeile(text: string, hoechstens: number): string {
  const zeile = text.split("\n").map((teil) => teil.trim()).find((teil) => teil !== "") ?? "";
  return zeile.length <= hoechstens ? zeile : `${zeile.slice(0, hoechstens - 1)}…`;
}

export function ansageText(eintraege: readonly Eintrag[]): string {
  const letzter = [...eintraege].reverse().find((eintrag) => eintrag.art !== "werkzeug" && eintrag.art !== "agent" && eintrag.art !== "system");
  if (letzter?.eltern !== null) return "";
  if (letzter.art === "claude") return `Claude: ${ersteZeile((letzter.text ?? "").replace(/\s+/g, " "), ANSAGE_LAENGE)}`;
  if (letzter.art === "frage") return `Claude fragt: ${letzter.frage?.fragen.map((frage) => frage.frage).join(" ") ?? ""}`;
  return letzter.art === "plan" ? "Claude legt einen Plan zur Freigabe vor." : "";
}

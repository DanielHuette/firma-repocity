import type { Eintrag as ChatEintrag } from "./chat.ts";
import type { Entscheidung } from "./meldungen.ts";
import type { Erinnerung, Ordner, VaultTreffer } from "./menue.ts";
import { isThreshold } from "./schwelle.ts";
import type { SelbsttestHinweis } from "./selbsttest.ts";
import type { ProcessState } from "./sitzungen.ts";
import type { Agent, Hinweis, SitzungsZustand } from "./zustand.ts";

export type Modus = "arbeiten" | "zusehen";
export type PlanEntscheidung = "ja" | "nein";

export const BEREICHE = ["Web", "Software", "Agenten", "Dokumente", "Zahlen", "Kunden", "Recherche", "Medien", "Betrieb", "Planung", "Überall", "ohne Bereich"] as const;
export type Bereich = (typeof BEREICHE)[number];
export const ERLAUBNISSE = ["default", "acceptEdits", "plan", "auto"] as const;
export type Erlaubnis = (typeof ERLAUBNISSE)[number];
export const AUFWAENDE = ["low", "medium", "high", "xhigh", "max", "auto"] as const;
export type Anbieter = "abo" | "openrouter";
export type HakenArt = "skill" | "plugin" | "konnektor";
export type Weg = "bibliothek" | "link" | "neu";
export type EinstellungsSchluessel = "erlaubnis" | "ausgabestil" | "schnell";

export interface Skill {
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly bereiche: readonly Bereich[];
  readonly sammlung: string | null;
  readonly quelle: "persoenlich" | "skillbase" | "plugin";
  readonly immerAktiv: boolean;
}

export interface Plugin {
  readonly kennung: string;
  readonly name: string;
  readonly marktplatz: string;
  readonly beschreibung: string;
  readonly bereiche: readonly Bereich[];
  readonly aktivGlobal: boolean;
  readonly skills: readonly string[];
}

export interface Konnektor {
  readonly kennung: string;
  readonly name: string;
  readonly art: "mcp" | "plugin" | "claudeai";
  readonly bereiche: readonly Bereich[];
  readonly jeSitzungSchaltbar: boolean;
}

export interface Angebot {
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly bereiche: readonly Bereich[];
  readonly braeuchteGeheimnis: boolean;
}

export interface JeArt<T> {
  readonly skills: readonly T[];
  readonly plugins: readonly T[];
  readonly konnektoren: readonly T[];
}

export interface Bestand {
  readonly skills: readonly Skill[];
  readonly plugins: readonly Plugin[];
  readonly konnektoren: readonly Konnektor[];
  readonly bibliothek: JeArt<Angebot>;
  readonly favoriten: JeArt<string>;
}

export interface Vorgaben {
  readonly modell: string;
  readonly aufwand: string;
  readonly ordner: string | null;
  readonly ausgabestil: string | null;
  readonly erlaubnis: Erlaubnis;
  readonly skills: readonly string[];
  readonly plugins: readonly string[];
  readonly konnektoren: readonly string[];
}

export interface ClaudeModell {
  readonly wert: string;
  readonly text: string;
}

export interface OpenRouterModell {
  readonly id: string;
  readonly name: string;
  readonly preisEinProMio: number;
  readonly preisAusProMio: number;
  readonly kontextFenster: number | null;
}

export interface Modelle {
  readonly claude: readonly ClaudeModell[];
  readonly openrouter: readonly OpenRouterModell[] | null;
  readonly openrouterGrund: string | null;
}

export interface Optionen {
  readonly erlaubnis: readonly Erlaubnis[];
  readonly ausgabestile: readonly string[];
  readonly modelle: Modelle;
  readonly vorgaben: Vorgaben;
  readonly linkGesperrt: string | null;
}

export interface Phase {
  readonly phase: string;
  readonly status: string;
  readonly datum: string;
}

export interface ProjektStatus {
  readonly phasen: readonly Phase[];
  readonly letzteEntscheidung: string | null;
}

export interface Projekt {
  readonly ordner: string;
  readonly name: string;
  readonly zuletzt: number;
  readonly status: ProjektStatus | null;
}

export interface Fortschritt {
  readonly erledigt: number;
  readonly gesamt: number;
}

export type AgentAnzeige = Agent & { readonly skills: readonly string[]; readonly fortschritt: Fortschritt | null };

export type ClientMessage =
  | { readonly typ: "hallo"; readonly geraet: string; readonly name: string; readonly modus: Modus }
  | { readonly typ: "hallo_assistenz"; readonly geraet: string; readonly name: string; readonly geheimnis: string }
  | { readonly typ: "nachricht"; readonly sitzung: string; readonly text: string }
  | { readonly typ: "abbrechen"; readonly sitzung: string }
  | { readonly typ: "frage_antwort"; readonly sitzung: string; readonly eintrag: string; readonly antworten: Readonly<Record<string, unknown>> }
  | { readonly typ: "plan_antwort"; readonly sitzung: string; readonly eintrag: string; readonly entscheidung: PlanEntscheidung }
  | { readonly typ: "antwort"; readonly frage: string; readonly entscheidung: Entscheidung }
  | { readonly typ: "neu"; readonly ordner: string | null; readonly anbieter?: Anbieter; readonly modell?: string }
  | { readonly typ: "beenden"; readonly sitzung: string }
  | { readonly typ: "fortsetzen"; readonly sitzung: string }
  | { readonly typ: "uebernehmen" }
  | { readonly typ: "bestand_holen" }
  | { readonly typ: "optionen_holen" }
  | { readonly typ: "projekte_holen" }
  | { readonly typ: "sitzung_umbenennen"; readonly sitzung: string; readonly titel: string }
  | { readonly typ: "haken"; readonly sitzung: string; readonly art: HakenArt; readonly kennung: string; readonly an: boolean }
  | { readonly typ: "favorit"; readonly art: HakenArt; readonly kennung: string; readonly an: boolean }
  | SitzungsEinstellung
  | { readonly typ: "vorgaben"; readonly werte: Vorgaben }
  | { readonly typ: "hinzufuegen"; readonly art: HakenArt; readonly weg: Weg; readonly wert: string; readonly sitzung: string | null }
  | { readonly typ: "suche"; readonly text: string }
  | { readonly typ: "einstellung"; readonly schwelleVerdichten: number }
  | { readonly typ: "einstellungen" }
  | { readonly typ: "selbsttest" }
  | { readonly typ: "ordner" }
  | { readonly typ: "herunterfahren" };

export type SitzungsEinstellung =
  | { readonly typ: "sitzung_einstellung"; readonly sitzung: string; readonly schluessel: "erlaubnis"; readonly wert: Erlaubnis }
  | { readonly typ: "sitzung_einstellung"; readonly sitzung: string; readonly schluessel: "ausgabestil"; readonly wert: string }
  | { readonly typ: "sitzung_einstellung"; readonly sitzung: string; readonly schluessel: "schnell"; readonly wert: boolean };

export interface SitzungsOptionen {
  readonly titel: string;
  readonly skills: readonly string[];
  readonly plugins: readonly string[];
  readonly konnektoren: readonly string[] | null;
  readonly erlaubnis: Erlaubnis;
  readonly erlaubnisBestaetigt: boolean;
  readonly ausgabestil: string | null;
  readonly schnell: boolean;
  readonly anbieter: Anbieter;
  readonly modellWahl: string | null;
  readonly kostenUsd: number | null;
  readonly neustartAusstehend: boolean;
  readonly pausiert: boolean;
  readonly pruefung: boolean;
}

export type SitzungsAnzeige = Omit<SitzungsZustand, "hinweise" | "letzterStop" | "kontextFenster" | "agenten" | "titel"> &
  SitzungsOptionen & {
    readonly agenten: readonly AgentAnzeige[];
    readonly hinweise: readonly (Hinweis | SelbsttestHinweis)[];
    readonly prozess: ProcessState;
    readonly hinweis: string | null;
  };

export interface Steuerung {
  readonly name: string;
  readonly du: boolean;
}

export type ServerMessage =
  | { readonly typ: "zustand"; readonly sitzungen: readonly SitzungsAnzeige[]; readonly steuert: Steuerung | null }
  | { readonly typ: "fehler"; readonly text: string }
  | { readonly typ: "chat"; readonly sitzung: string; readonly eintraege: readonly ChatEintrag[] }
  | { readonly typ: "chat_neu"; readonly sitzung: string; readonly eintrag: ChatEintrag }
  | { readonly typ: "chat_teil"; readonly sitzung: string; readonly id: string; readonly text: string }
  | { readonly typ: "chat_aktualisiert"; readonly sitzung: string; readonly eintrag: ChatEintrag }
  | ({ readonly typ: "bestand" } & Bestand)
  | ({ readonly typ: "optionen" } & Optionen)
  | { readonly typ: "projekte"; readonly liste: readonly Projekt[] }
  | { readonly typ: "hinzugefuegt"; readonly art: HakenArt; readonly weg: Weg; readonly ok: boolean; readonly text: string; readonly einrichtung: string | null }
  | {
      readonly typ: "treffer";
      readonly text: string;
      readonly vault: readonly VaultTreffer[];
      readonly erinnerung: readonly Erinnerung[];
      readonly fehler?: string;
    }
  | { readonly typ: "einstellungen"; readonly schwelleVerdichten: number; readonly claudeVersion: string | null }
  | { readonly typ: "ordner"; readonly liste: readonly Ordner[] }
  | { readonly typ: "beendet" }
  | { readonly typ: "antwort_ergebnis"; readonly frage: string; readonly entscheidung: Entscheidung; readonly angenommen: boolean; readonly grund: string | null }
  | {
      readonly typ: "assistenz_antwort";
      readonly sitzung: string;
      readonly frage: string;
      readonly name: string;
      readonly entscheidung: "ja" | "nein";
      readonly werkzeug: string;
      readonly beschreibung: string;
    };

type Fields = Readonly<Record<string, unknown>>;

const REQUIRED_FIELDS = {
  hallo: ["geraet", "name", "modus"],
  hallo_assistenz: ["geraet", "name", "geheimnis"],
  nachricht: ["sitzung", "text"],
  abbrechen: ["sitzung"],
  frage_antwort: ["sitzung", "eintrag", "antworten"],
  plan_antwort: ["sitzung", "eintrag", "entscheidung"],
  antwort: ["frage", "entscheidung"],
  neu: [],
  beenden: ["sitzung"],
  fortsetzen: ["sitzung"],
  uebernehmen: [],
  bestand_holen: [],
  optionen_holen: [],
  projekte_holen: [],
  sitzung_umbenennen: ["sitzung", "titel"],
  haken: ["sitzung", "art", "kennung", "an"],
  favorit: ["art", "kennung", "an"],
  sitzung_einstellung: ["sitzung", "schluessel", "wert"],
  vorgaben: ["werte"],
  hinzufuegen: ["art", "weg", "wert", "sitzung"],
  suche: ["text"],
  einstellung: ["schwelleVerdichten"],
  einstellungen: [],
  selbsttest: [],
  ordner: [],
  herunterfahren: [],
} as const satisfies Record<ClientMessage["typ"], readonly string[]>;

const OPTIONAL_FIELDS: Readonly<Partial<Record<ClientMessage["typ"], readonly string[]>>> = { neu: ["ordner", "anbieter", "modell"] };
const VORGABEN_FIELDS = ["modell", "aufwand", "ordner", "ausgabestil", "erlaubnis", "skills", "plugins", "konnektoren"] as const;
const DEVICE_FORMAT = /^[A-Za-z0-9_-]{16,64}$/;
const ASSISTANT_SECRET_FORMAT = /^[0-9a-f]{64}$/;
const LONGEST_DEVICE_NAME = 40;
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;
const LONGEST_ID = 128;
const LONGEST_SEARCH = 200;
export const LONGEST_TITLE = 60;
export const LONGEST_KENNUNG = 200;
export const LONGEST_STYLE = 100;
export const LONGEST_FOLDER = 4096;
export const LONGEST_LINK = 500;
export const LONGEST_WISH = 2000;
export const MOST_CHOSEN = 500;
export const MODEL_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,199}$/;
const LINK_FORMAT = /^https:\/\/[^\s]+$/;
const LIBRARY_NAME = /^[A-Za-z0-9][A-Za-z0-9._@:-]{0,199}$/;
const DECISIONS: ReadonlySet<unknown> = new Set<Entscheidung>(["ja", "nein", "immer"]);
const MODES: ReadonlySet<unknown> = new Set<Modus>(["arbeiten", "zusehen"]);
const PLAN_DECISIONS: ReadonlySet<unknown> = new Set<PlanEntscheidung>(["ja", "nein"]);
const PERMISSIONS: ReadonlySet<unknown> = new Set<unknown>(ERLAUBNISSE);
const EFFORTS: ReadonlySet<unknown> = new Set<unknown>(AUFWAENDE);
const KINDS: ReadonlySet<unknown> = new Set<HakenArt>(["skill", "plugin", "konnektor"]);
const WAYS: ReadonlySet<unknown> = new Set<Weg>(["bibliothek", "link", "neu"]);
const PROVIDERS: ReadonlySet<unknown> = new Set<Anbieter>(["abo", "openrouter"]);
export const LONGEST_MESSAGE = 100_000;

type MessageType = keyof typeof REQUIRED_FIELDS;

function isMessageType(value: unknown): value is MessageType {
  return typeof value === "string" && Object.hasOwn(REQUIRED_FIELDS, value);
}

function hasExactFields(fields: Fields, type: MessageType): boolean {
  const required: readonly string[] = REQUIRED_FIELDS[type];
  const allowed = new Set(["typ", ...required, ...(OPTIONAL_FIELDS[type] ?? [])]);
  const keys = Object.keys(fields);
  return keys.every((key) => allowed.has(key)) && required.every((key) => keys.includes(key));
}

function isPlainObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= LONGEST_ID;
}

function isVisibleText(value: unknown, longest: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= longest && !INVISIBLE_OR_CONTROL.test(value);
}

function isTrimmedText(value: unknown, longest: number): value is string {
  return isVisibleText(value, longest) && value.trim() === value;
}

function isDeviceName(value: unknown): value is string {
  return isTrimmedText(value, LONGEST_DEVICE_NAME);
}

function isSearchText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= LONGEST_SEARCH && !INVISIBLE_OR_CONTROL.test(value);
}

function isMessageText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= LONGEST_MESSAGE;
}

export function isKennung(value: unknown): value is string {
  return isTrimmedText(value, LONGEST_KENNUNG);
}

export function isTitle(value: unknown): value is string {
  return isTrimmedText(value, LONGEST_TITLE);
}

export function isStyleName(value: unknown): value is string {
  return isTrimmedText(value, LONGEST_STYLE);
}

export function isModelName(value: unknown): value is string {
  return typeof value === "string" && MODEL_FORMAT.test(value);
}

export function isPermission(value: unknown): value is Erlaubnis {
  return PERMISSIONS.has(value);
}

function isKind(value: unknown): value is HakenArt {
  return KINDS.has(value);
}

function isWay(value: unknown): value is Weg {
  return WAYS.has(value);
}

function isProvider(value: unknown): value is Anbieter {
  return PROVIDERS.has(value);
}

function isPlanDecision(value: unknown): value is PlanEntscheidung {
  return PLAN_DECISIONS.has(value);
}

function isAnswers(value: unknown): value is Readonly<Record<string, unknown>> {
  return isPlainObject(value);
}

function isMode(value: unknown): value is Modus {
  return MODES.has(value);
}

function isDecision(value: unknown): value is Entscheidung {
  return DECISIONS.has(value);
}

function isKennungen(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MOST_CHOSEN) return false;
  return value.every(isKennung) && new Set(value).size === value.length;
}

function isFolderOrNull(value: unknown): value is string | null {
  return value === null || isVisibleText(value, LONGEST_FOLDER);
}

function isStyleOrNull(value: unknown): value is string | null {
  return value === null || isStyleName(value);
}

function hasExactKeys(fields: Fields, keys: readonly string[]): boolean {
  const present = Object.keys(fields);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(fields, key));
}

export function parseVorgaben(value: unknown): Vorgaben | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, VORGABEN_FIELDS)) return undefined;
  const { modell, aufwand, ordner, ausgabestil, erlaubnis, skills, plugins, konnektoren } = value;
  if (!isModelName(modell) || !EFFORTS.has(aufwand) || typeof aufwand !== "string") return undefined;
  if (!isFolderOrNull(ordner) || !isStyleOrNull(ausgabestil) || !isPermission(erlaubnis)) return undefined;
  if (!isKennungen(skills) || !isKennungen(plugins) || !isKennungen(konnektoren)) return undefined;
  return { modell, aufwand, ordner, ausgabestil, erlaubnis, skills, plugins, konnektoren };
}

export function isLink(value: unknown): value is string {
  return isVisibleText(value, LONGEST_LINK) && LINK_FORMAT.test(value) && URL.canParse(value) && new URL(value).protocol === "https:";
}

function isWish(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= LONGEST_WISH && !/[\p{Cf}]|[^\P{Cc}\n\t]/u.test(value);
}

function isAddition(way: Weg, value: unknown): value is string {
  switch (way) {
    case "bibliothek":
      return typeof value === "string" && LIBRARY_NAME.test(value) && !value.includes("..");
    case "link":
      return isLink(value);
    case "neu":
      return isWish(value);
  }
}

function chatMessageOf(type: "nachricht" | "abbrechen" | "frage_antwort" | "plan_antwort", fields: Fields): ClientMessage | undefined {
  const { sitzung, eintrag, text, antworten, entscheidung } = fields;
  if (!isId(sitzung)) return undefined;
  switch (type) {
    case "nachricht":
      return isMessageText(text) ? { typ: type, sitzung, text } : undefined;
    case "abbrechen":
      return { typ: type, sitzung };
    case "frage_antwort":
      return isId(eintrag) && isAnswers(antworten) ? { typ: type, sitzung, eintrag, antworten } : undefined;
    case "plan_antwort":
      return isId(eintrag) && isPlanDecision(entscheidung) ? { typ: type, sitzung, eintrag, entscheidung } : undefined;
  }
}

function settingOf(sitzung: string, schluessel: unknown, wert: unknown): ClientMessage | undefined {
  const typ = "sitzung_einstellung";
  if (schluessel === "erlaubnis") return isPermission(wert) ? { typ, sitzung, schluessel, wert } : undefined;
  if (schluessel === "ausgabestil") return isStyleName(wert) ? { typ, sitzung, schluessel, wert } : undefined;
  if (schluessel === "schnell") return typeof wert === "boolean" ? { typ, sitzung, schluessel, wert } : undefined;
  return undefined;
}

function newSessionOf(fields: Fields): ClientMessage | undefined {
  const { ordner, anbieter, modell } = fields;
  if (ordner !== undefined && ordner !== null && typeof ordner !== "string") return undefined;
  if (anbieter !== undefined && !isProvider(anbieter)) return undefined;
  if (modell !== undefined && !isModelName(modell)) return undefined;
  return { typ: "neu", ordner: ordner ?? null, ...(anbieter === undefined ? {} : { anbieter }), ...(modell === undefined ? {} : { modell }) };
}

type OptionType = "sitzung_umbenennen" | "haken" | "favorit" | "sitzung_einstellung" | "vorgaben" | "hinzufuegen";

function additionOf(fields: Fields): ClientMessage | undefined {
  const { art, weg, wert, sitzung } = fields;
  if (!isKind(art) || !isWay(weg) || !isAddition(weg, wert)) return undefined;
  if (sitzung === null) return weg === "bibliothek" ? { typ: "hinzufuegen", art, weg, wert, sitzung } : undefined;
  return isId(sitzung) ? { typ: "hinzufuegen", art, weg, wert, sitzung } : undefined;
}

function optionMessageOf(type: OptionType, fields: Fields): ClientMessage | undefined {
  const { sitzung, titel, art, kennung, an, schluessel, wert, werte } = fields;
  switch (type) {
    case "sitzung_umbenennen":
      return isId(sitzung) && isTitle(titel) ? { typ: type, sitzung, titel } : undefined;
    case "haken":
      return isId(sitzung) && isKind(art) && isKennung(kennung) && typeof an === "boolean" ? { typ: type, sitzung, art, kennung, an } : undefined;
    case "favorit":
      return isKind(art) && isKennung(kennung) && typeof an === "boolean" ? { typ: type, art, kennung, an } : undefined;
    case "sitzung_einstellung":
      return isId(sitzung) ? settingOf(sitzung, schluessel, wert) : undefined;
    case "vorgaben": {
      const gelesen = parseVorgaben(werte);
      return gelesen === undefined ? undefined : { typ: type, werte: gelesen };
    }
    case "hinzufuegen":
      return additionOf(fields);
  }
}

function simpleMessageOf(type: MessageType, fields: Fields): ClientMessage | undefined {
  const { geraet, name, modus, sitzung, frage, entscheidung } = fields;
  switch (type) {
    case "hallo":
      return typeof geraet === "string" && DEVICE_FORMAT.test(geraet) && isDeviceName(name) && isMode(modus) ? { typ: type, geraet, name, modus } : undefined;
    case "hallo_assistenz": {
      const { geheimnis } = fields;
      const passt = typeof geraet === "string" && DEVICE_FORMAT.test(geraet) && isDeviceName(name) && typeof geheimnis === "string" && ASSISTANT_SECRET_FORMAT.test(geheimnis);
      return passt ? { typ: type, geraet, name, geheimnis } : undefined;
    }
    case "antwort":
      return isId(frage) && isDecision(entscheidung) ? { typ: type, frage, entscheidung } : undefined;
    case "beenden":
    case "fortsetzen":
      return isId(sitzung) ? { typ: type, sitzung } : undefined;
    case "suche":
      return isSearchText(fields.text) ? { typ: type, text: fields.text } : undefined;
    case "einstellung":
      return isThreshold(fields.schwelleVerdichten) ? { typ: type, schwelleVerdichten: fields.schwelleVerdichten } : undefined;
    default:
      return undefined;
  }
}

function messageOf(type: MessageType, fields: Fields): ClientMessage | undefined {
  switch (type) {
    case "nachricht":
    case "abbrechen":
    case "frage_antwort":
    case "plan_antwort":
      return chatMessageOf(type, fields);
    case "sitzung_umbenennen":
    case "haken":
    case "favorit":
    case "sitzung_einstellung":
    case "vorgaben":
    case "hinzufuegen":
      return optionMessageOf(type, fields);
    case "neu":
      return newSessionOf(fields);
    case "uebernehmen":
    case "bestand_holen":
    case "optionen_holen":
    case "projekte_holen":
    case "einstellungen":
    case "selbsttest":
    case "ordner":
    case "herunterfahren":
      return { typ: type };
    default:
      return simpleMessageOf(type, fields);
  }
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function parseClientMessage(text: string): ClientMessage | undefined {
  const parsed = jsonOf(text);
  if (!isPlainObject(parsed)) return undefined;
  if (!isMessageType(parsed.typ) || !hasExactFields(parsed, parsed.typ)) return undefined;
  return messageOf(parsed.typ, parsed);
}

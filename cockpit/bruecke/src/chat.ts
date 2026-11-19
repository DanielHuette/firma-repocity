import { isFields, type Fields } from "./felder.ts";
export type EintragsArt = "du" | "claude" | "werkzeug" | "agent" | "frage" | "plan" | "system";
export type Status = "laeuft" | "ok" | "fehler";
export type Antworten = Readonly<Record<string, string | readonly string[]>>;

export interface WerkzeugAufruf {
  readonly name: string;
  readonly kurz: string;
  readonly eingabe: string;
  readonly ergebnis?: string;
  readonly status: Status;
}

export interface AgentAufruf {
  readonly typ: string;
  readonly beschreibung: string;
  readonly status: Status;
}

export interface Option {
  readonly label: string;
  readonly beschreibung: string;
}

export interface EinzelFrage {
  readonly frage: string;
  readonly kopf: string;
  readonly optionen: readonly Option[];
  readonly mehrfach: boolean;
}

export interface FrageKarte {
  readonly fragen: readonly EinzelFrage[];
  readonly beantwortet?: Antworten;
}

export interface PlanKarte {
  readonly text: string;
  readonly entschieden?: "ja" | "nein";
}

export interface Eintrag {
  readonly id: string;
  readonly art: EintragsArt;
  readonly zeit: number;
  readonly text?: string;
  readonly eltern?: string;
  readonly werkzeug?: WerkzeugAufruf;
  readonly agent?: AgentAufruf;
  readonly frage?: FrageKarte;
  readonly plan?: PlanKarte;
}

export type ChatSchritt =
  | { readonly art: "neu"; readonly eintrag: Eintrag }
  | { readonly art: "teil"; readonly id: string; readonly text: string }
  | { readonly art: "aktualisiert"; readonly eintrag: Eintrag };

export interface LiveEinstellungen {
  readonly erlaubnis: string | null;
  readonly ausgabestil: string | null;
  readonly plugins: readonly string[];
  readonly konnektoren: readonly string[];
  readonly schnell: boolean;
}

export interface ChatDaten {
  readonly modell?: string;
  readonly claudeSitzung?: string;
  readonly eingabeTokens?: number;
  readonly kontextFenster?: number;
  readonly zugEnde?: boolean;
  readonly einstellungen?: LiveEinstellungen;
  readonly kostenUsd?: number;
  readonly wartendeZuege?: number;
}

export interface Anfrage {
  readonly requestId: string;
  readonly eintrag: string;
  readonly eingabe: Readonly<Record<string, unknown>>;
}

export interface Erlaubnisanfrage {
  readonly requestId: string;
  readonly werkzeug: string;
  readonly eingabe: Readonly<Record<string, unknown>>;
}

export interface Gelesen {
  readonly schritte: readonly ChatSchritt[];
  readonly daten: ChatDaten;
  readonly anfrage?: Anfrage;
  readonly abgebrochen?: string;
  readonly erlaubnis?: Erlaubnisanfrage;
  readonly zurueckgezogen?: string;
}

export const LONGEST_INPUT = 2_000;
export const LONGEST_RESULT = 4_000;
export const MOST_ENTRIES = 2_000;
const LONGEST_SHORT = 200;
const SHORT_FIELDS = ["command", "file_path", "url", "pattern", "query", "description", "skill"] as const;
const AGENT_TOOLS = new Set(["Agent", "Task"]);
const QUESTION_TOOL = "AskUserQuestion";
const PLAN_TOOL = "ExitPlanMode";
const SYNTHETIC_MODEL = "<synthetic>";
const FAST_MODE_ON = "on";
const SWITCHED_OFF = "disabled";
const LOCAL_OUTPUT = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/;
const INTERRUPTED = "[Request interrupted by user]";
const CUT_MARK = " …";
const NOTHING: Gelesen = { schritte: [], daten: {} };
const UNKNOWN_TOOL = "unbekanntes Werkzeug";

function text(felder: Fields, name: string): string | null {
  const wert = felder[name];
  return typeof wert === "string" ? wert : null;
}

function zahl(wert: unknown): number | null {
  return typeof wert === "number" && Number.isSafeInteger(wert) && wert >= 0 ? wert : null;
}

export function gekuerzt(wert: string, laenge: number): string {
  return wert.length <= laenge ? wert : `${wert.slice(0, laenge)}${CUT_MARK}`;
}

function kurzVon(name: string, eingabe: Fields): string {
  for (const feld of SHORT_FIELDS) {
    const wert = text(eingabe, feld);
    if (wert !== null && wert !== "") return gekuerzt(wert, LONGEST_SHORT);
  }
  return name;
}

function ergebnisText(inhalt: unknown): string {
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return "";
  return (inhalt as unknown[]).flatMap((teil) => (isFields(teil) && typeof teil.text === "string" ? [teil.text] : [])).join("\n");
}

function optionen(wert: unknown): Option[] {
  if (!Array.isArray(wert)) return [];
  return (wert as unknown[]).flatMap((option) =>
    isFields(option) && typeof option.label === "string" ? [{ label: option.label, beschreibung: text(option, "description") ?? "" }] : [],
  );
}

export function fragenAus(eingabe: Fields): EinzelFrage[] {
  const fragen = eingabe.questions;
  if (!Array.isArray(fragen)) return [];
  return (fragen as unknown[]).flatMap((frage) => {
    if (!isFields(frage) || typeof frage.question !== "string") return [];
    return [{ frage: frage.question, kopf: text(frage, "header") ?? "", optionen: optionen(frage.options), mehrfach: frage.multiSelect === true }];
  });
}

function eingabeTokens(nutzung: unknown): number | null {
  if (!isFields(nutzung)) return null;
  let summe = 0;
  for (const teil of [nutzung.input_tokens, nutzung.cache_creation_input_tokens, nutzung.cache_read_input_tokens].map(zahl)) {
    if (teil === null) return null;
    summe += teil;
  }
  return summe;
}

function namen(wert: unknown, feld: string, ohne?: (eintrag: Fields) => boolean): string[] {
  if (!Array.isArray(wert)) return [];
  return (wert as unknown[]).flatMap((eintrag) => (isFields(eintrag) && typeof eintrag[feld] === "string" && ohne?.(eintrag) !== true ? [eintrag[feld]] : []));
}

function liveEinstellungen(zeile: Fields): LiveEinstellungen {
  return {
    erlaubnis: text(zeile, "permissionMode"),
    ausgabestil: text(zeile, "output_style"),
    plugins: namen(zeile.plugins, "source"),
    konnektoren: namen(zeile.mcp_servers, "name", (eintrag) => eintrag.status === SWITCHED_OFF),
    schnell: zeile.fast_mode_state === FAST_MODE_ON,
  };
}

function kosten(wert: unknown): number | null {
  return typeof wert === "number" && Number.isFinite(wert) && wert >= 0 ? wert : null;
}

function kontextFenster(ergebnis: Fields, modell: string | null): number | null {
  const nutzung = ergebnis.modelUsage;
  if (modell === null || !isFields(nutzung)) return null;
  const eintrag = nutzung[modell];
  return isFields(eintrag) ? zahl(eintrag.contextWindow) : null;
}

export class Chatverlauf {
  readonly #eintraege = new Map<string, Eintrag>();
  readonly #jetzt: () => number;
  readonly #neueId: () => string;
  readonly #anfragen = new Map<string, Anfrage>();
  readonly #erlaubnisse = new Map<string, Erlaubnisanfrage>();
  #offen: { nachricht: string; index: number } | null = null;
  #modell: string | null = null;

  constructor(jetzt: () => number, neueId: () => string, gespeichert: readonly Eintrag[] = []) {
    this.#jetzt = jetzt;
    this.#neueId = neueId;
    for (const eintrag of gespeichert) this.#eintraege.set(eintrag.id, eintrag);
  }

  alle(): Eintrag[] {
    return [...this.#eintraege.values()];
  }

  eintrag(id: string): Eintrag | undefined {
    return this.#eintraege.get(id);
  }

  anfrage(eintrag: string): Anfrage | undefined {
    return this.#anfragen.get(eintrag);
  }

  erlaubnis(requestId: string): Erlaubnisanfrage | undefined {
    return this.#erlaubnisse.get(requestId);
  }

  erlaubnisErledigt(requestId: string): void {
    this.#erlaubnisse.delete(requestId);
  }

  eigeneNachricht(nachricht: string): ChatSchritt {
    return this.#neu({ id: this.#neueId(), art: "du", zeit: this.#jetzt(), text: nachricht });
  }

  systemHinweis(nachricht: string): ChatSchritt {
    return this.#hinweis(nachricht);
  }

  wartetAufAntwort(): boolean {
    return this.#anfragen.size > 0 || this.#erlaubnisse.size > 0;
  }

  agentenLaufen(): boolean {
    return [...this.#eintraege.values()].some((eintrag) => eintrag.agent?.status === "laeuft");
  }

  beantwortet(id: string, aendern: (eintrag: Eintrag) => Eintrag): ChatSchritt | undefined {
    const alt = this.#eintraege.get(id);
    this.#anfragen.delete(id);
    return alt === undefined ? undefined : this.#aendern(aendern(alt));
  }

  lesen(zeile: unknown): Gelesen {
    if (!isFields(zeile)) return NOTHING;
    switch (zeile.type) {
      case "system":
        return this.#system(zeile);
      case "stream_event":
        return this.#strom(zeile);
      case "assistant":
        return this.#antwort(zeile);
      case "user":
        return this.#rueckmeldung(zeile);
      case "result":
        return this.#ergebnis(zeile);
      case "control_request":
        return this.#anfrageGelesen(zeile);
      case "control_cancel_request":
        return this.#anfrageZurueck(zeile);
      default:
        return NOTHING;
    }
  }

  #neu(eintrag: Eintrag): ChatSchritt {
    this.#eintraege.set(eintrag.id, eintrag);
    for (const aeltester of this.#eintraege.keys()) {
      if (this.#eintraege.size <= MOST_ENTRIES) break;
      this.#eintraege.delete(aeltester);
    }
    return { art: "neu", eintrag };
  }

  #aendern(eintrag: Eintrag): ChatSchritt {
    this.#eintraege.set(eintrag.id, eintrag);
    return { art: "aktualisiert", eintrag };
  }

  #hinweis(nachricht: string): ChatSchritt {
    return this.#neu({ id: this.#neueId(), art: "system", zeit: this.#jetzt(), text: nachricht });
  }

  #system(zeile: Fields): Gelesen {
    if (zeile.subtype === "init") {
      this.#modell = text(zeile, "model");
      const sitzung = text(zeile, "session_id");
      const daten: ChatDaten = { ...(this.#modell === null ? {} : { modell: this.#modell }), ...(sitzung === null ? {} : { claudeSitzung: sitzung }), einstellungen: liveEinstellungen(zeile) };
      return { schritte: [], daten };
    }
    if (zeile.subtype !== "compact_boundary") return NOTHING;
    const angaben = isFields(zeile.compact_metadata) ? zeile.compact_metadata : {};
    const vorher = zahl(angaben.pre_tokens);
    const nachher = zahl(angaben.post_tokens);
    const zahlen = vorher === null || nachher === null ? "" : ` (${String(vorher)} → ${String(nachher)} Tokens)`;
    return { schritte: [this.#hinweis(`Kontext verdichtet${zahlen}`)], daten: {} };
  }

  #strom(zeile: Fields): Gelesen {
    if (zeile.parent_tool_use_id !== null || !isFields(zeile.event)) return NOTHING;
    const ereignis = zeile.event;
    if (ereignis.type === "message_start" && isFields(ereignis.message)) return this.#nachrichtBeginnt(ereignis.message);
    if (ereignis.type === "message_delta") return this.#verbrauch(ereignis.usage);
    const index = zahl(ereignis.index);
    if (index === null || this.#offen === null) return NOTHING;
    if (ereignis.type === "content_block_start") return this.#blockBeginnt(index, ereignis.content_block);
    if (ereignis.type === "content_block_delta") return this.#textStueck(index, ereignis.delta);
    return NOTHING;
  }

  #nachrichtBeginnt(nachricht: Fields): Gelesen {
    this.#offen = { nachricht: text(nachricht, "id") ?? this.#neueId(), index: -1 };
    const verbrauch = this.#verbrauch(nachricht.usage);
    const modell = text(nachricht, "model");
    if (modell === null || modell === SYNTHETIC_MODEL || modell === this.#modell) return verbrauch;
    this.#modell = modell;
    return { schritte: [], daten: { ...verbrauch.daten, modell } };
  }

  #verbrauch(nutzung: unknown): Gelesen {
    const tokens = eingabeTokens(nutzung);
    return tokens === null || tokens === 0 ? NOTHING : { schritte: [], daten: { eingabeTokens: tokens } };
  }

  #blockBeginnt(index: number, block: unknown): Gelesen {
    if (this.#offen === null) return NOTHING;
    this.#offen = { ...this.#offen, index };
    if (!isFields(block) || block.type !== "text") return NOTHING;
    const id = `${this.#offen.nachricht}:${String(index)}`;
    if (this.#eintraege.has(id)) return NOTHING;
    return { schritte: [this.#neu({ id, art: "claude", zeit: this.#jetzt(), text: "" })], daten: {} };
  }

  #textStueck(index: number, delta: unknown): Gelesen {
    if (this.#offen === null || !isFields(delta) || delta.type !== "text_delta" || typeof delta.text !== "string") return NOTHING;
    const id = `${this.#offen.nachricht}:${String(index)}`;
    const alt = this.#eintraege.get(id);
    if (alt === undefined) return NOTHING;
    this.#eintraege.set(id, { ...alt, text: `${alt.text ?? ""}${delta.text}` });
    return { schritte: [{ art: "teil", id, text: delta.text }], daten: {} };
  }

  #antwort(zeile: Fields): Gelesen {
    const nachricht = isFields(zeile.message) ? zeile.message : {};
    const bloecke = Array.isArray(nachricht.content) ? (nachricht.content as unknown[]) : [];
    const eltern = text(zeile, "parent_tool_use_id");
    if (text(nachricht, "model") === SYNTHETIC_MODEL) {
      const meldung = bloecke.map((block) => (isFields(block) ? (text(block, "text") ?? "") : "")).join("\n").trim();
      return { schritte: meldung === "" ? [] : [this.#hinweis(meldung)], daten: {} };
    }
    const kennung = text(nachricht, "id") ?? this.#neueId();
    const schritte = bloecke.flatMap((block, stelle) => (isFields(block) ? this.#block(block, kennung, stelle, eltern) : []));
    return { schritte, daten: {} };
  }

  #textIndex(kennung: string, stelle: number): number {
    return this.#offen?.nachricht === kennung && this.#offen.index >= 0 ? this.#offen.index : stelle;
  }

  #block(block: Fields, kennung: string, stelle: number, eltern: string | null): ChatSchritt[] {
    const zusatz = eltern === null ? {} : { eltern };
    if (block.type === "text") {
      const inhalt = text(block, "text") ?? "";
      const id = `${kennung}:${String(this.#textIndex(kennung, stelle))}`;
      const alt = this.#eintraege.get(id);
      if (alt === undefined) return [this.#neu({ id, art: "claude", zeit: this.#jetzt(), text: inhalt, ...zusatz })];
      return alt.text === inhalt ? [] : [this.#aendern({ ...alt, text: inhalt })];
    }
    if (block.type !== "tool_use") return [];
    const id = text(block, "id");
    const name = text(block, "name");
    if (id === null || name === null || this.#eintraege.has(id)) return [];
    return [this.#neu(this.#aufruf(id, name, isFields(block.input) ? block.input : {}, zusatz))];
  }

  #aufruf(id: string, name: string, eingabe: Fields, zusatz: { eltern?: string }): Eintrag {
    const grund = { id, zeit: this.#jetzt(), ...zusatz };
    if (name === QUESTION_TOOL) return { ...grund, art: "frage", frage: { fragen: fragenAus(eingabe) } };
    if (name === PLAN_TOOL) return { ...grund, art: "plan", plan: { text: text(eingabe, "plan") ?? "" } };
    if (AGENT_TOOLS.has(name)) {
      const agent: AgentAufruf = { typ: text(eingabe, "subagent_type") ?? "general-purpose", beschreibung: text(eingabe, "description") ?? "", status: "laeuft" };
      return { ...grund, art: "agent", agent };
    }
    const werkzeug: WerkzeugAufruf = { name, kurz: kurzVon(name, eingabe), eingabe: gekuerzt(JSON.stringify(eingabe), LONGEST_INPUT), status: "laeuft" };
    return { ...grund, art: "werkzeug", werkzeug };
  }

  #rueckmeldung(zeile: Fields): Gelesen {
    const nachricht = isFields(zeile.message) ? zeile.message : {};
    const inhalt = nachricht.content;
    if (typeof inhalt === "string") return this.#lokaleAusgabe(inhalt);
    if (!Array.isArray(inhalt)) return NOTHING;
    const schritte = (inhalt as unknown[]).flatMap((block) => (isFields(block) ? this.#ergebnisBlock(block) : []));
    return { schritte, daten: {} };
  }

  #lokaleAusgabe(inhalt: string): Gelesen {
    const treffer = LOCAL_OUTPUT.exec(inhalt.trim());
    const meldung = treffer?.[1]?.trim() ?? "";
    return meldung === "" ? NOTHING : { schritte: [this.#hinweis(meldung)], daten: {} };
  }

  #ergebnisBlock(block: Fields): ChatSchritt[] {
    if (block.type === "text" && block.text === INTERRUPTED) return [this.#hinweis("Abgebrochen.")];
    if (block.type !== "tool_result") return [];
    const id = text(block, "tool_use_id");
    const alt = id === null ? undefined : this.#eintraege.get(id);
    if (alt === undefined) return [];
    const status: Status = block.is_error === true ? "fehler" : "ok";
    if (alt.werkzeug !== undefined) {
      return [this.#aendern({ ...alt, werkzeug: { ...alt.werkzeug, status, ergebnis: gekuerzt(ergebnisText(block.content), LONGEST_RESULT) } })];
    }
    if (alt.agent !== undefined) return [this.#aendern({ ...alt, agent: { ...alt.agent, status } })];
    return [];
  }

  #ergebnis(zeile: Fields): Gelesen {
    this.#offen = null;
    const fenster = kontextFenster(zeile, this.#modell);
    const betrag = kosten(zeile.total_cost_usd);
    const wartend = zahl(zeile.queued_turn_count);
    const daten: ChatDaten = {
      zugEnde: true,
      ...(fenster === null ? {} : { kontextFenster: fenster }),
      ...(betrag === null ? {} : { kostenUsd: betrag }),
      ...(wartend === null ? {} : { wartendeZuege: wartend }),
    };
    if (zeile.is_error !== true) return { schritte: [], daten };
    const meldung = text(zeile, "result") ?? (Array.isArray(zeile.errors) ? (zeile.errors as unknown[]).map(String).join("; ") : "");
    return { schritte: [this.#hinweis(`Fehler: ${meldung === "" ? String(zeile.subtype) : meldung}`)], daten };
  }

  #anfrageGelesen(zeile: Fields): Gelesen {
    const anfrage = isFields(zeile.request) ? zeile.request : {};
    const requestId = text(zeile, "request_id");
    const eintrag = text(anfrage, "tool_use_id");
    const name = text(anfrage, "tool_name");
    if (anfrage.subtype !== "can_use_tool" || requestId === null) return NOTHING;
    const eingabe = isFields(anfrage.input) ? anfrage.input : {};
    if (name !== QUESTION_TOOL && name !== PLAN_TOOL) return this.#erlaubnisGelesen(requestId, name ?? UNKNOWN_TOOL, eingabe);
    if (eintrag === null) return NOTHING;
    const offen: Anfrage = { requestId, eintrag, eingabe };
    this.#anfragen.set(eintrag, offen);
    const schritte = this.#eintraege.has(eintrag) ? [] : [this.#neu(this.#aufruf(eintrag, name, eingabe, {}))];
    return { schritte, daten: {}, anfrage: offen };
  }

  #erlaubnisGelesen(requestId: string, werkzeug: string, eingabe: Fields): Gelesen {
    const erlaubnis: Erlaubnisanfrage = { requestId, werkzeug, eingabe };
    this.#erlaubnisse.set(requestId, erlaubnis);
    return { ...NOTHING, erlaubnis };
  }

  #anfrageZurueck(zeile: Fields): Gelesen {
    const requestId = text(zeile, "request_id");
    if (requestId !== null && this.#erlaubnisse.delete(requestId)) return { ...NOTHING, zurueckgezogen: requestId };
    for (const [eintrag, anfrage] of this.#anfragen) {
      if (anfrage.requestId === requestId) {
        this.#anfragen.delete(eintrag);
        return { ...NOTHING, abgebrochen: eintrag };
      }
    }
    return NOTHING;
  }
}

export const LONGEST_ANSWER = 10_000;
const LIST_SEPARATOR = ", ";

function antwortText(wert: unknown, mehrfach: boolean): string | undefined {
  if (typeof wert === "string") return wert.trim() === "" || wert.length > LONGEST_ANSWER ? undefined : wert;
  if (!mehrfach || !Array.isArray(wert) || wert.length === 0) return undefined;
  const teile = (wert as unknown[]).map((teil) => antwortText(teil, false));
  return teile.every((teil) => teil !== undefined) ? teile.join(LIST_SEPARATOR) : undefined;
}

export function antwortenPruefen(fragen: readonly EinzelFrage[], antworten: unknown): Record<string, string> | undefined {
  if (!isFields(antworten)) return undefined;
  const bekannt = new Set(fragen.map((frage) => frage.frage));
  if (Object.keys(antworten).some((schluessel) => !bekannt.has(schluessel))) return undefined;
  const ergebnis: Record<string, string> = {};
  for (const frage of fragen) {
    const text = antwortText(antworten[frage.frage], frage.mehrfach);
    if (text === undefined) return undefined;
    ergebnis[frage.frage] = text;
  }
  return ergebnis;
}

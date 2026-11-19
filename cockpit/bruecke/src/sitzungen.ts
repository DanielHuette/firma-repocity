import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { antwortenPruefen, Chatverlauf, type ChatDaten, type ChatSchritt, type Eintrag, type Erlaubnisanfrage, type LiveEinstellungen } from "./chat.ts";
import { ChatProtokoll, chatDatei, chatLaden } from "./chatprotokoll.ts";
import { ChatProzess, ChatStartFehler, type Antwort } from "./chatprozess.ts";
import { abgleichen } from "./abgleich.ts";
import { Agentenfortschritt, type AgentDetails, type StreamAgent } from "./agentenfortschritt.ts";
import { childEnvironment } from "./kindprozess.ts";
import { isPermission } from "./nachrichten.ts";
import type { ClaudeModell, EinstellungsSchluessel, Erlaubnis, HakenArt, SitzungsOptionen } from "./nachrichten.ts";
import { OpenRouterError, redact, withProvider } from "./openrouter.ts";
import { isInside } from "./pfade.ts";
import { hasErrorCode, writePrivateFile } from "./private_datei.ts";
import { differences, isSettled, OHNE_OPTIONEN, parseStoredOptions, skillLine, startArguments, withSkillLine } from "./sitzungsoptionen.ts";
import type { GespeicherteOptionen, StartKontext } from "./sitzungsoptionen.ts";

export const MAX_RUNNING_SESSIONS = 8;
export const NEW_CONVERSATION_NOTE = "neues Gespräch, altes nicht wiederherstellbar";
const STATE_FILE = "zustand.json";
const MAX_NOTE_LENGTH = 2000;
const CLAUDE_SESSION_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SESSION_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATH_SEPARATORS = path.sep === "\\" ? /[\\/]/ : /\//;
const PLAN_REFUSED = "Plan in der Kommandozentrale abgelehnt.";
const PERMISSION_REFUSED = "In der Kommandozentrale abgelehnt.";
export const READY_WITHIN_MS = 30_000;
export const RESTART_FAILED = "Neustart mit den neuen Einstellungen fehlgeschlagen; die bisherigen Einstellungen gelten weiter.";
const FRESH_CONVERSATION_COMMANDS = /^\/(?:clear|compact)(?:\s|$)/;
const NEW_CONVERSATION_COMMAND = /^\/clear(?:\s|$)/;
export const PAUSED_NOTE = "pausiert: OpenRouter-Sitzungen werden nach einem Neustart der Brücke erst auf Knopfdruck fortgesetzt";

export interface Standard {
  readonly erlaubnis: Erlaubnis;
  readonly plugins: readonly string[];
}
const NO_CONTEXT: StartKontext = { installiertePlugins: [] };
const MODEL_COMMAND = /^\/model\s+(\S+)\s*$/;

export interface Faehigkeiten {
  readonly modelle: readonly ClaudeModell[];
  readonly ausgabestile: readonly string[];
}

export interface SessionSettings {
  readonly vault: string;
  readonly erlaubteOrdner: readonly string[];
  readonly claudeBefehl: readonly string[];
  readonly datenordner: string;
}

export interface SessionOptions {
  readonly zusatzUmgebung?: Readonly<Record<string, string>>;
  readonly jetzt?: () => number;
  readonly gnadenfrist?: number;
  readonly startKontext?: (optionen: GespeicherteOptionen, sitzung: string) => Promise<StartKontext>;
  readonly schluessel?: () => Promise<string>;
  readonly bereitBinnen?: number;
  readonly standard?: () => Standard;
  readonly protokollGrenze?: number;
}

export type ProcessState = "laeuft" | "beendet";

export interface SessionInfo {
  readonly id: string;
  readonly ordner: string;
  readonly claudeSitzung: string | null;
  readonly prozess: ProcessState;
  readonly exitCode: number | null;
  readonly hinweis: string | null;
  readonly optionen: GespeicherteOptionen;
}

export type SessionEvent =
  | { kind: "chat"; sitzung: string; schritt: ChatSchritt }
  | { kind: "daten"; sitzung: string; daten: ChatDaten }
  | { kind: "stoerung"; sitzung: string; text: string }
  | { kind: "erlaubnis"; sitzung: string; anfrage: Erlaubnisanfrage }
  | { kind: "erlaubnis_weg"; sitzung: string; requestId: string }
  | { kind: "geaendert" }
  | { kind: "fehler"; fehler: unknown };

export type SendResult = { kind: "ok" } | { kind: "unbekannt" } | { kind: "beendet" };
export type OptionResult = { kind: "ok" } | { kind: "unbekannt" };
export type ResumeResult = OptionResult | { kind: "nicht_pausiert" };
export type SettingResult = OptionResult | { kind: "gesperrt" };
export type CardResult = SendResult | { kind: "keine_frage" } | { kind: "ungueltig" };
export type TakeOverResult = { kind: "ok" } | { kind: "nicht_verbunden" };
export type EndResult = { kind: "ok" } | { kind: "unbekannt" };

export class SessionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionError";
  }
}

async function realFolder(folder: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(folder);
  } catch (error: unknown) {
    throw new SessionError(`folder does not exist: ${folder}`, { cause: error });
  }
  if (!(await stat(real)).isDirectory()) throw new SessionError(`not a folder: ${folder}`);
  return real;
}

async function realAllowedFolder(folder: string): Promise<string | null> {
  try {
    return await realpath(folder);
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function resolveSessionFolder(
  settings: Pick<SessionSettings, "vault" | "erlaubteOrdner">,
  requested: string | undefined,
): Promise<string> {
  const folder = requested ?? settings.vault;
  if (!path.isAbsolute(folder)) throw new SessionError(`folder must be an absolute path: ${folder}`);
  if (folder.split(PATH_SEPARATORS).includes("..")) throw new SessionError(`folder must not contain "..": ${folder}`);
  const real = await realFolder(folder);
  const allowed = await Promise.all(settings.erlaubteOrdner.map(realAllowedFolder));
  if (!allowed.some((entry) => entry !== null && isInside(entry, real))) {
    throw new SessionError(`folder is outside the allowed folders: ${folder}`);
  }
  return real;
}

function storedSession(entry: unknown): SessionInfo | undefined {
  if (!isStoredSession(entry)) return undefined;
  const optionen = parseStoredOptions((entry as Record<string, unknown>).optionen);
  if (optionen === undefined) return undefined;
  const { id, ordner, claudeSitzung, prozess, exitCode, hinweis } = entry;
  return { id, ordner, claudeSitzung, prozess, exitCode, hinweis, optionen };
}

function isStoredSession(entry: unknown): entry is Omit<SessionInfo, "optionen"> {
  if (typeof entry !== "object" || entry === null) return false;
  const { id, ordner, claudeSitzung, prozess, exitCode, hinweis } = entry as Record<string, unknown>;
  return (
    typeof id === "string" &&
    SESSION_ID_FORMAT.test(id) &&
    typeof ordner === "string" &&
    path.isAbsolute(ordner) &&
    (claudeSitzung === null || (typeof claudeSitzung === "string" && CLAUDE_SESSION_FORMAT.test(claudeSitzung))) &&
    (prozess === "laeuft" || prozess === "beendet") &&
    (exitCode === null || (typeof exitCode === "number" && Number.isSafeInteger(exitCode))) &&
    (hinweis === null || (typeof hinweis === "string" && hinweis.length <= MAX_NOTE_LENGTH))
  );
}

async function readStoredSessions(file: string): Promise<SessionInfo[]> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw new SessionError(`session file ${file} cannot be read`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new SessionError(`session file ${file} is not valid JSON`, { cause: error });
  }
  const sessions = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).sitzungen : undefined;
  const read = Array.isArray(sessions) ? sessions.map(storedSession) : [undefined];
  if (!read.every((entry) => entry !== undefined)) {
    throw new SessionError(
      `session file ${file} must hold {"sitzungen": [{id, ordner, claudeSitzung, prozess, exitCode, hinweis, optionen?}]}`,
    );
  }
  return read;
}

async function restorable(settings: SessionSettings, stored: SessionInfo): Promise<SessionInfo> {
  if (stored.prozess === "beendet") return stored;
  try {
    await resolveSessionFolder(settings, stored.ordner);
  } catch (error: unknown) {
    if (!(error instanceof SessionError)) throw error;
    return { ...stored, prozess: "beendet", exitCode: null, hinweis: `Ordner nicht mehr erlaubt: ${error.message}` };
  }
  return { ...stored, hinweis: stored.claudeSitzung === null ? NEW_CONVERSATION_NOTE : null };
}

interface Session {
  readonly id: string;
  readonly ordner: string;
  claudeSitzung: string | null;
  prozess: ProcessState;
  exitCode: number | null;
  hinweis: string | null;
  optionen: GespeicherteOptionen;
  laufend: GespeicherteOptionen | null;
  live: LiveEinstellungen | null;
  kostenUsd: number | null;
  offeneZuege: number;
  pausiert: boolean;
  gesendet: Map<string, number>;
  gemeldet: readonly string[];
  wechselt: boolean;
  warteschlange: Promise<void> | null;
  schluessel: string | null;
  neustartNoetig: boolean;
  faehigkeiten: Faehigkeiten | null;
  fortschritt: Agentenfortschritt;
  readonly chat: Chatverlauf;
  readonly protokoll: ChatProtokoll;
  readonly geteilt: Set<string>;
  claude: ChatProzess | null;
}

function snapshot(session: Session): SessionInfo {
  const { id, ordner, claudeSitzung, prozess, exitCode, hinweis, optionen } = session;
  return { id, ordner, claudeSitzung, prozess, exitCode, hinweis, optionen };
}

function livePermission(live: LiveEinstellungen | null): Erlaubnis | null {
  const value = live?.erlaubnis;
  return isPermission(value) ? value : null;
}

function cleanEntry(entry: Eintrag, key: string | null): Eintrag {
  if (key === null || !JSON.stringify(entry).includes(key)) return entry;
  return JSON.parse(redact(JSON.stringify(entry), key)) as Eintrag;
}

function withEntry(list: readonly string[], entry: string, on: boolean): string[] {
  const without = list.filter((item) => item !== entry);
  return on ? [...without, entry] : without;
}

function modelsOf(value: unknown): ClaudeModell[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { value: wert, displayName } = entry as Record<string, unknown>;
    return typeof wert === "string" && typeof displayName === "string" ? [{ wert, text: displayName }] : [];
  });
}

function stylesOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as unknown[]).filter((entry): entry is string => typeof entry === "string") : [];
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

type Reach = { kind: "ok"; session: Session; claude: ChatProzess } | { kind: "unbekannt" } | { kind: "beendet" };

export class Sessions {
  readonly #settings: SessionSettings;
  readonly #file: string;
  readonly #onEvent: (event: SessionEvent) => void;
  readonly #extraEnvironment: Readonly<Record<string, string>>;
  readonly #now: () => number;
  readonly #grace: number | undefined;
  readonly #context: (optionen: GespeicherteOptionen, sitzung: string) => Promise<StartKontext>;
  readonly #key: () => Promise<string>;
  readonly #readyWithin: number;
  readonly #standard: () => Standard;
  readonly #logLimit: number | undefined;
  readonly #sessions = new Map<string, Session>();
  readonly #connections = new Map<string, number>();
  #controller: string | null = null;
  #writing: Promise<void> = Promise.resolve();
  #closing = false;

  private constructor(settings: SessionSettings, onEvent: (event: SessionEvent) => void, options: SessionOptions) {
    this.#settings = settings;
    this.#file = path.join(settings.datenordner, STATE_FILE);
    this.#onEvent = onEvent;
    this.#extraEnvironment = options.zusatzUmgebung ?? {};
    this.#now = options.jetzt ?? Date.now;
    this.#grace = options.gnadenfrist;
    this.#context = options.startKontext ?? (() => Promise.resolve(NO_CONTEXT));
    this.#key = options.schluessel ?? (() => Promise.reject(new OpenRouterError("OpenRouter ist nicht eingerichtet")));
    this.#readyWithin = options.bereitBinnen ?? READY_WITHIN_MS;
    this.#standard = options.standard ?? (() => ({ erlaubnis: "default", plugins: [] }));
    this.#logLimit = options.protokollGrenze;
  }

  static async open(settings: SessionSettings, onEvent: (event: SessionEvent) => void, options: SessionOptions = {}): Promise<Sessions> {
    if (settings.claudeBefehl.length === 0) throw new SessionError("claudeBefehl must name a command");
    const sessions = new Sessions(settings, onEvent, options);
    const stored = await readStoredSessions(sessions.#file);
    for (const entry of await Promise.all(stored.map((session) => restorable(settings, session)))) {
      const session = await sessions.#loaded(entry);
      sessions.#sessions.set(session.id, session);
      session.optionen = { ...session.optionen, schnell: false };
      if (session.prozess === "laeuft" && session.optionen.anbieter === "openrouter") session.pausiert = true;
      else if (session.prozess === "laeuft") await sessions.#restart(session);
    }
    await sessions.#save().catch((error: unknown) => {
      onEvent({ kind: "fehler", fehler: error });
    });
    return sessions;
  }

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map(snapshot);
  }

  controller(): string | null {
    return this.#controller;
  }

  chat(id: string): Eintrag[] | undefined {
    const session = this.#sessions.get(id);
    return session?.chat.alle().map((entry) => cleanEntry(entry, session.schluessel));
  }

  async resume(id: string): Promise<ResumeResult> {
    const session = this.#sessions.get(id);
    if (session === undefined) return { kind: "unbekannt" };
    if (!session.pausiert) return { kind: "nicht_pausiert" };
    session.pausiert = false;
    await this.#restart(session);
    await this.#changed();
    return { kind: "ok" };
  }

  connect(device: string, takesControl = true): void {
    this.#connections.set(device, (this.#connections.get(device) ?? 0) + 1);
    if (this.#controller === null && takesControl) this.#setController(device);
  }

  disconnect(device: string): void {
    const remaining = (this.#connections.get(device) ?? 0) - 1;
    if (remaining > 0) {
      this.#connections.set(device, remaining);
      return;
    }
    this.#connections.delete(device);
    if (this.#controller === device) this.#setController(null);
  }

  takeOver(device: string): TakeOverResult {
    if (!this.#connections.has(device)) return { kind: "nicht_verbunden" };
    if (this.#controller !== device) this.#setController(device);
    return { kind: "ok" };
  }

  send(id: string, text: string, mayRestart = true): SendResult {
    const session = this.#sessions.get(id);
    if (session === undefined) return { kind: "unbekannt" };
    const model = MODEL_COMMAND.exec(text)?.[1];
    if (session.warteschlange === null) {
      const reach = this.#reach(id);
      if (reach.kind !== "ok") return reach;
      if (model === undefined && !this.#pending(session)) return this.#sendNow(session, text);
    }
    this.#show(session, [session.chat.eigeneNachricht(text)]);
    this.#queue(session, async () => {
      if (model !== undefined) {
        await this.#switchModel(session, model);
        return;
      }
      await this.#prepare(session, mayRestart);
      if (!this.#deliver(session, text)) this.#show(session, [session.chat.systemHinweis("Nachricht nicht zugestellt: die Sitzung ist beendet.")]);
    });
    return { kind: "ok" };
  }

  #sendNow(session: Session, text: string): SendResult {
    if (!this.#deliver(session, text)) return { kind: "beendet" };
    this.#show(session, [session.chat.eigeneNachricht(text)]);
    return { kind: "ok" };
  }

  capabilities(): Faehigkeiten | null {
    return [...this.#sessions.values()].findLast((session) => session.faehigkeiten !== null)?.faehigkeiten ?? null;
  }

  agents(id: string): { readonly agenten: readonly StreamAgent[]; readonly von: (parent: string) => AgentDetails } | undefined {
    const fortschritt = this.#sessions.get(id)?.fortschritt;
    return fortschritt === undefined ? undefined : { agenten: fortschritt.agenten(), von: (parent) => fortschritt.von(parent) };
  }

  options(id: string): SitzungsOptionen | undefined {
    const session = this.#sessions.get(id);
    if (session === undefined) return undefined;
    const { optionen, live, laufend } = session;
    const standard = this.#standard();
    return {
      titel: optionen.titel ?? path.basename(session.ordner),
      skills: optionen.skills,
      plugins: optionen.plugins ?? live?.plugins ?? standard.plugins,
      konnektoren: live === null ? null : live.konnektoren.filter((name) => !optionen.konnektorenAus.includes(name)),
      erlaubnis: laufend?.erlaubnis ?? livePermission(live) ?? standard.erlaubnis,
      erlaubnisBestaetigt: optionen.erlaubnis === null || session.claude === null || laufend?.erlaubnis === optionen.erlaubnis,
      ausgabestil: optionen.ausgabestil ?? live?.ausgabestil ?? null,
      schnell: optionen.schnell,
      anbieter: optionen.anbieter,
      modellWahl: optionen.modell,
      kostenUsd: optionen.anbieter === "openrouter" ? session.kostenUsd : null,
      neustartAusstehend: laufend !== null && (session.neustartNoetig || laufend.schnell !== optionen.schnell),
      pausiert: session.pausiert,
      pruefung: optionen.pruefung,
    };
  }

  rename(id: string, titel: string): Promise<OptionResult> {
    return this.#changeOptions(id, (optionen) => ({ ...optionen, titel }));
  }

  tick(id: string, art: HakenArt, kennung: string, an: boolean, basis: readonly string[]): Promise<OptionResult> {
    return this.#changeOptions(id, (optionen) => {
      if (art === "skill") return { ...optionen, skills: withEntry(optionen.skills, kennung, an) };
      if (art === "plugin") return { ...optionen, plugins: withEntry(optionen.plugins ?? basis, kennung, an) };
      return { ...optionen, konnektorenAus: withEntry(optionen.konnektorenAus, kennung, !an) };
    });
  }

  clean<T>(id: string, value: T): T {
    const key = this.#sessions.get(id)?.schluessel ?? null;
    if (key === null || !JSON.stringify(value).includes(key)) return value;
    return JSON.parse(redact(JSON.stringify(value), key)) as T;
  }

  isCheck(id: string): boolean {
    return this.#sessions.get(id)?.optionen.pruefung === true;
  }

  async setSetting(id: string, schluessel: EinstellungsSchluessel, wert: string | boolean): Promise<SettingResult> {
    const permission = schluessel === "erlaubnis";
    if (permission && this.isCheck(id)) return { kind: "gesperrt" };
    const result = await this.#changeOptions(id, (optionen) => ({ ...optionen, [schluessel]: wert }), !permission);
    const session = this.#sessions.get(id);
    if (permission && session !== undefined) void this.#sendPermission(session);
    return result;
  }

  async #sendPermission(session: Session): Promise<void> {
    const { claude, laufend } = session;
    const wanted = session.optionen.erlaubnis;
    if (claude === null || laufend === null || wanted === null || session.wechselt) return;
    const answer = await claude.steuern("set_permission_mode", { mode: wanted });
    if (session.optionen.erlaubnis !== wanted || session.laufend === null) return;
    if (answer.kind === "ok") session.laufend = { ...session.laufend, erlaubnis: wanted };
    else {
      session.neustartNoetig = true;
      this.#show(session, [session.chat.systemHinweis(`Erlaubnismodus nicht übernommen (${answer.grund}); die Brücke startet die Sitzung vor dem nächsten Schritt mit der Einstellung neu.`)]);
    }
    await this.#changed();
  }

  interrupt(id: string): SendResult {
    const reach = this.#reach(id);
    if (reach.kind !== "ok") return reach;
    return reach.claude.unterbrechen() ? { kind: "ok" } : { kind: "beendet" };
  }

  answerQuestion(id: string, entry: string, answers: unknown): CardResult {
    const reach = this.#reach(id);
    if (reach.kind !== "ok") return reach;
    const request = reach.session.chat.anfrage(entry);
    const card = reach.session.chat.eintrag(entry)?.frage;
    if (request === undefined || card === undefined) return { kind: "keine_frage" };
    const checked = antwortenPruefen(card.fragen, answers);
    if (checked === undefined) return { kind: "ungueltig" };
    reach.claude.antworten(request.requestId, { behavior: "allow", updatedInput: { ...request.eingabe, answers: checked } });
    return this.#answered(reach.session, entry, (eintrag) => ({ ...eintrag, frage: { ...card, beantwortet: checked } }));
  }

  answerPermission(id: string, requestId: string, allow: boolean): CardResult {
    const reach = this.#reach(id);
    if (reach.kind !== "ok") return reach;
    const request = reach.session.chat.erlaubnis(requestId);
    if (request === undefined) return { kind: "keine_frage" };
    reach.claude.antworten(requestId, allow ? { behavior: "allow", updatedInput: request.eingabe } : { behavior: "deny", message: PERMISSION_REFUSED });
    reach.session.chat.erlaubnisErledigt(requestId);
    this.#onEvent({ kind: "erlaubnis_weg", sitzung: id, requestId });
    return { kind: "ok" };
  }

  answerPlan(id: string, entry: string, decision: "ja" | "nein"): CardResult {
    const reach = this.#reach(id);
    if (reach.kind !== "ok") return reach;
    const request = reach.session.chat.anfrage(entry);
    const card = reach.session.chat.eintrag(entry)?.plan;
    if (request === undefined || card === undefined) return { kind: "keine_frage" };
    const answer: Antwort = decision === "ja" ? { behavior: "allow", updatedInput: request.eingabe } : { behavior: "deny", message: PLAN_REFUSED };
    reach.claude.antworten(request.requestId, answer);
    return this.#answered(reach.session, entry, (eintrag) => ({ ...eintrag, plan: { ...card, entschieden: decision } }));
  }

  async create(folder?: string, wahl: Partial<GespeicherteOptionen> = {}): Promise<SessionInfo> {
    const ordner = await resolveSessionFolder(this.#settings, folder);
    const running = [...this.#sessions.values()].filter((session) => session.prozess === "laeuft").length;
    if (running >= MAX_RUNNING_SESSIONS) {
      throw new SessionError(`at most ${String(MAX_RUNNING_SESSIONS)} sessions can run at the same time; end one first`);
    }
    const optionen = { ...OHNE_OPTIONEN, ...wahl };
    const session = this.#fresh({ id: randomUUID(), ordner, claudeSitzung: null, prozess: "laeuft", exitCode: null, hinweis: null, optionen }, []);
    this.#sessions.set(session.id, session);
    try {
      await this.#start(session);
      await this.#changed();
    } catch (error: unknown) {
      await this.#discard(session);
      throw error;
    }
    return snapshot(session);
  }

  async setClaudeSession(id: string, claudeSession: string): Promise<void> {
    const session = this.#sessions.get(id);
    if (session === undefined) throw new SessionError(`unknown session ${id}`);
    if (!CLAUDE_SESSION_FORMAT.test(claudeSession)) {
      throw new SessionError("the Claude session id must be 1 to 128 letters, digits, _ or -, starting with a letter or digit");
    }
    session.claudeSitzung = claudeSession;
    await this.#changed();
  }

  async end(id: string): Promise<EndResult> {
    const session = this.#sessions.get(id);
    if (session === undefined) return { kind: "unbekannt" };
    await this.#discard(session);
    await this.#changed();
    return { kind: "ok" };
  }

  async close(): Promise<void> {
    this.#closing = true;
    const all = [...this.#sessions.values()];
    await Promise.all(all.flatMap((session) => (session.claude === null ? [] : [session.claude.beenden()])));
    await Promise.all(all.map((session) => session.protokoll.fertig()));
    await this.#writing;
  }

  async #loaded(info: SessionInfo): Promise<Session> {
    const file = chatDatei(this.#settings.datenordner, info.id);
    const { eintraege, kaputt } = await chatLaden(file);
    if (kaputt > 0) this.#onEvent({ kind: "stoerung", sitzung: info.id, text: `${String(kaputt)} unreadable lines in ${file} were skipped` });
    return this.#fresh(info, eintraege);
  }

  #fresh(info: SessionInfo, entries: readonly Eintrag[]): Session {
    const chat = new Chatverlauf(this.#now, randomUUID, entries);
    const protokoll = new ChatProtokoll(chatDatei(this.#settings.datenordner, info.id), this.#logLimit);
    const fresh = { laufend: null, live: null, kostenUsd: null, offeneZuege: 0, pausiert: false, gesendet: new Map<string, number>(), gemeldet: [], wechselt: false, warteschlange: null, schluessel: null };
    const more = { neustartNoetig: false, faehigkeiten: null, fortschritt: new Agentenfortschritt() };
    return { ...info, ...fresh, ...more, chat, protokoll, geteilt: new Set(), claude: null };
  }

  async #changeOptions(id: string, change: (optionen: GespeicherteOptionen) => GespeicherteOptionen, settle = true): Promise<OptionResult> {
    const session = this.#sessions.get(id);
    if (session === undefined) return { kind: "unbekannt" };
    session.optionen = change(session.optionen);
    await this.#changed();
    if (settle && session.claude !== null && session.offeneZuege === 0 && !session.wechselt) this.#queue(session, () => this.#settle(session));
    return { kind: "ok" };
  }

  #pending(session: Session): boolean {
    return session.laufend !== null && (session.neustartNoetig || !isSettled(differences(session.laufend, session.optionen)));
  }

  #restartDue(session: Session): boolean {
    if (session.laufend === null || session.offeneZuege > 0 || session.chat.wartetAufAntwort() || session.chat.agentenLaufen()) return false;
    return session.neustartNoetig || session.laufend.schnell !== session.optionen.schnell;
  }

  async #prepare(session: Session, mayRestart: boolean): Promise<void> {
    if (mayRestart && this.#restartDue(session)) await this.#restartWithWanted(session);
    if (session.offeneZuege === 0) await this.#settle(session);
  }

  async #settle(session: Session): Promise<void> {
    const { claude, laufend } = session;
    if (claude === null || laufend === null || isSettled(differences(laufend, session.optionen))) return;
    const { installiertePlugins } = await this.#startContext(session);
    const result = await abgleichen(claude, laufend, session.optionen, installiertePlugins);
    session.laufend = result.laufend;
    const refused = (name: string): boolean => result.abgelehnt.some((entry) => entry.name === name);
    const reverted = session.optionen.konnektorenAus.filter((name) => !refused(name));
    session.optionen = { ...session.optionen, konnektorenAus: [...reverted, ...result.abgelehnt.filter((entry) => entry.enabled).map((entry) => entry.name)] };
    session.neustartNoetig ||= result.neustart;
    this.#show(session, result.hinweise.map((hinweis) => session.chat.systemHinweis(hinweis)));
    await this.#changed();
  }

  async #switchModel(session: Session, model: string): Promise<void> {
    const answer = (await session.claude?.steuern("set_model", { model })) ?? { kind: "fehler", grund: "die Sitzung ist beendet" };
    if (answer.kind === "fehler") {
      this.#show(session, [session.chat.systemHinweis(`Modellwechsel auf ${model} abgelehnt: ${answer.grund}`)]);
      return;
    }
    const resolved = typeof answer.antwort.model === "string" ? answer.antwort.model : model;
    session.optionen = { ...session.optionen, modell: model };
    if (session.laufend !== null) session.laufend = { ...session.laufend, modell: model };
    this.#show(session, [session.chat.systemHinweis(`Modell: ${resolved}`)]);
    this.#onEvent({ kind: "daten", sitzung: session.id, daten: { modell: resolved } });
    await this.#changed();
    await this.#measure(session);
  }

  async #measure(session: Session): Promise<void> {
    const answer = await session.claude?.steuern("get_context_usage");
    if (answer?.kind !== "ok") return;
    const eingabeTokens = count(answer.antwort.totalTokens);
    const kontextFenster = count(answer.antwort.maxTokens);
    if (eingabeTokens === null || kontextFenster === null || kontextFenster === 0) return;
    this.#onEvent({ kind: "daten", sitzung: session.id, daten: { eingabeTokens, kontextFenster } });
  }

  async #learn(session: Session): Promise<void> {
    const answer = await session.claude?.steuern("initialize");
    if (answer?.kind !== "ok") return;
    session.faehigkeiten = { modelle: modelsOf(answer.antwort.models), ausgabestile: stylesOf(answer.antwort.available_output_styles) };
    this.#onEvent({ kind: "geaendert" });
  }

  #queue(session: Session, work: () => Promise<void>): void {
    const run = (session.warteschlange ?? Promise.resolve()).then(work).catch((error: unknown) => {
      this.#onEvent({ kind: "fehler", fehler: error });
    });
    session.warteschlange = run;
    void run.finally(() => {
      if (session.warteschlange === run) session.warteschlange = null;
    });
  }

  #deliver(session: Session, text: string): boolean {
    const wanted = session.optionen.skills;
    const added = wanted.filter((skill) => !session.gemeldet.includes(skill));
    const line = text.startsWith("/") ? null : skillLine(added, session.gemeldet.filter((skill) => !wanted.includes(skill)));
    if (session.claude?.nachricht(withSkillLine(text, line)) !== true) return false;
    session.offeneZuege += 1;
    if (line !== null) session.gemeldet = wanted;
    if (FRESH_CONVERSATION_COMMANDS.test(text)) session.gemeldet = [];
    if (NEW_CONVERSATION_COMMAND.test(text)) session.fortschritt = new Agentenfortschritt();
    return true;
  }

  async #restartWithWanted(session: Session): Promise<void> {
    const before = session.laufend;
    session.wechselt = true;
    try {
      await session.claude?.beenden();
      if (await this.#tryStart(session)) return;
      this.#show(session, [session.chat.systemHinweis(RESTART_FAILED)]);
      if (before !== null) {
        const { plugins, konnektorenAus, schnell, erlaubnis, ausgabestil, modell } = before;
        session.optionen = { ...session.optionen, plugins, konnektorenAus, schnell, erlaubnis, ausgabestil, modell };
      }
      if (!(await this.#tryStart(session))) this.#ended(session, null, true);
    } finally {
      session.wechselt = false;
      session.gemeldet = [];
      await this.#changed();
    }
  }

  async #tryStart(session: Session): Promise<boolean> {
    try {
      await this.#start(session);
    } catch (error: unknown) {
      if (!(error instanceof SessionError)) throw error;
      this.#onEvent({ kind: "stoerung", sitzung: session.id, text: error.message });
      return false;
    }
    const { claude } = session;
    if (claude === null) return false;
    const enough = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, this.#readyWithin).unref();
    });
    return Promise.race([claude.bereit(), enough]);
  }

  #answered(session: Session, entry: string, change: (eintrag: Eintrag) => Eintrag): CardResult {
    const step = session.chat.beantwortet(entry, change);
    if (step !== undefined) this.#show(session, [step]);
    return { kind: "ok" };
  }

  async #discard(session: Session): Promise<void> {
    this.#sessions.delete(session.id);
    await session.claude?.beenden();
    await session.protokoll.loeschen();
  }

  async #restart(session: Session): Promise<void> {
    try {
      await this.#start(session);
    } catch (error: unknown) {
      if (!(error instanceof SessionError)) throw error;
      session.prozess = "beendet";
      session.exitCode = null;
      session.hinweis = `Start fehlgeschlagen: ${error.message}`;
    }
  }

  async #environment(session: Session): Promise<Record<string, string>> {
    const umgebung = childEnvironment(process.env, session.id, this.#extraEnvironment);
    if (session.optionen.anbieter === "openrouter") {
      try {
        session.schluessel = await this.#key();
      } catch (error: unknown) {
        if (error instanceof OpenRouterError) throw new SessionError(error.message, { cause: error });
        throw error;
      }
    }
    return withProvider(umgebung, session.optionen.anbieter, session.schluessel);
  }

  async #startContext(session: Session): Promise<StartKontext> {
    try {
      return await this.#context(session.optionen, session.id);
    } catch (error: unknown) {
      this.#onEvent({ kind: "stoerung", sitzung: session.id, text: `the list of installed plugins is missing, the plugin choice of this session is not applied: ${error instanceof Error ? error.message : String(error)}` });
      return NO_CONTEXT;
    }
  }

  async #start(session: Session): Promise<void> {
    const optionen = session.optionen;
    const umgebung = await this.#environment(session);
    const zusatz = startArguments(optionen, await this.#startContext(session));
    const schwaerzen = (text: string): string => redact(text, session.schluessel);
    const start = { befehl: this.#settings.claudeBefehl, ordner: session.ordner, umgebung, fortsetzen: session.claudeSitzung, optionen: zusatz, schwaerzen };
    try {
      session.claude = await ChatProzess.starten(this.#grace === undefined ? start : { ...start, gnadenfrist: this.#grace }, {
        zeile: (wert) => { this.#line(session, wert); },
        stoerung: (text) => { this.#onEvent({ kind: "stoerung", sitzung: session.id, text: schwaerzen(text) }); },
        ende: (code) => { this.#ended(session, code); },
      });
    } catch (error: unknown) {
      if (error instanceof ChatStartFehler) throw new SessionError(error.message, { cause: error });
      throw error;
    }
    session.laufend = { ...optionen, konnektorenAus: [] };
    session.neustartNoetig = false;
    session.offeneZuege = 0;
    session.faehigkeiten = null;
    void this.#learn(session);
    if (optionen.konnektorenAus.length > 0) this.#queue(session, () => this.#settle(session));
  }

  #line(session: Session, value: unknown): void {
    const read = session.chat.lesen(value);
    session.fortschritt.lesen(value);
    this.#show(session, read.schritte);
    if (read.erlaubnis !== undefined) this.#onEvent({ kind: "erlaubnis", sitzung: session.id, anfrage: read.erlaubnis });
    if (read.zurueckgezogen !== undefined) this.#onEvent({ kind: "erlaubnis_weg", sitzung: session.id, requestId: read.zurueckgezogen });
    if (session.schluessel !== null && (read.daten.zugEnde === true || (typeof value === "object" && value !== null && (value as Record<string, unknown>).type === "assistant"))) this.#flush(session);
    this.#takeLive(session, read.daten);
    const { claudeSitzung } = read.daten;
    if (claudeSitzung !== undefined && session.claudeSitzung === null) {
      this.setClaudeSession(session.id, claudeSitzung).catch((error: unknown) => {
        this.#onEvent({ kind: "fehler", fehler: error });
      });
    }
    if (Object.keys(read.daten).length > 0) this.#onEvent({ kind: "daten", sitzung: session.id, daten: read.daten });
    if (read.daten.zugEnde === true) this.#keepPieces(session);
  }

  #takeLive(session: Session, daten: ChatDaten): void {
    if (daten.zugEnde === true) {
      session.offeneZuege = daten.wartendeZuege ?? Math.max(0, session.offeneZuege - 1);
      void this.#measure(session);
    }
    if (daten.einstellungen === undefined && daten.kostenUsd === undefined) return;
    if (daten.einstellungen !== undefined) session.live = daten.einstellungen;
    if (daten.kostenUsd !== undefined) session.kostenUsd = daten.kostenUsd;
    this.#onEvent({ kind: "geaendert" });
  }

  #clean(session: Session, step: ChatSchritt): ChatSchritt[] {
    const key = session.schluessel;
    if (key === null) return [step];
    if (step.art === "teil") return this.#heldBack(session, step.id, key);
    session.gesendet.delete(step.eintrag.id);
    return [{ ...step, eintrag: cleanEntry(step.eintrag, key) }];
  }

  #heldBack(session: Session, id: string, key: string): ChatSchritt[] {
    const full = redact(session.chat.eintrag(id)?.text ?? "", key);
    const safe = full.length - (key.length - 1);
    const sent = session.gesendet.get(id) ?? 0;
    session.gesendet.set(id, sent);
    if (safe <= sent) return [];
    session.gesendet.set(id, safe);
    return [{ art: "teil", id, text: full.slice(sent, safe) }];
  }

  #flush(session: Session): void {
    const steps = [...session.gesendet.keys()].flatMap((id): ChatSchritt[] => {
      const entry = session.chat.eintrag(id);
      return entry === undefined ? [] : [{ art: "aktualisiert", eintrag: entry }];
    });
    if (steps.length > 0) this.#show(session, steps);
  }

  #show(session: Session, shown: readonly ChatSchritt[]): void {
    const changed: Eintrag[] = [];
    for (const step of shown) if (step.art === "teil") session.geteilt.add(step.id);
    for (const step of shown.flatMap((entry) => this.#clean(session, entry))) {
      this.#onEvent({ kind: "chat", sitzung: session.id, schritt: step });
      if (step.art !== "teil") changed.push(step.eintrag);
    }
    this.#keep(session, changed);
  }

  #keepPieces(session: Session): void {
    const pieces = [...session.geteilt].flatMap((id) => session.chat.eintrag(id) ?? []);
    session.geteilt.clear();
    this.#keep(session, pieces);
  }

  #keep(session: Session, entries: readonly Eintrag[]): void {
    if (entries.length === 0) return;
    const clean = (entry: Eintrag): Eintrag => cleanEntry(entry, session.schluessel);
    session.protokoll.schreiben(entries.map(clean), () => session.chat.alle().map(clean)).catch((error: unknown) => {
      this.#onEvent({ kind: "fehler", fehler: error });
    });
  }

  #ended(session: Session, exitCode: number | null, afterRestart = false): void {
    session.claude = null;
    session.offeneZuege = 0;
    this.#keepPieces(session);
    if (this.#closing || !this.#sessions.has(session.id) || (session.wechselt && !afterRestart)) return;
    session.prozess = "beendet";
    session.exitCode = exitCode;
    this.#changed().catch((error: unknown) => {
      this.#onEvent({ kind: "fehler", fehler: error });
    });
  }

  #reach(id: string): Reach {
    const session = this.#sessions.get(id);
    if (session === undefined) return { kind: "unbekannt" };
    const { claude } = session;
    if (claude?.laeuft() !== true) return { kind: "beendet" };
    return { kind: "ok", session, claude };
  }

  #setController(device: string | null): void {
    this.#controller = device;
    this.#onEvent({ kind: "geaendert" });
  }

  #changed(): Promise<void> {
    this.#onEvent({ kind: "geaendert" });
    return this.#save();
  }

  #save(): Promise<void> {
    const content = JSON.stringify({ sitzungen: this.list() });
    const write = this.#writing.then(() => writePrivateFile(this.#file, content));
    this.#writing = write.catch(() => undefined);
    return write;
  }
}

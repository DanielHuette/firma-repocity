import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Settings } from "./einstellungen.ts";
import { SessionError } from "./sitzungen.ts";
import type { SessionInfo } from "./sitzungen.ts";
import { readReport } from "./zustand.ts";
import type { Berichtsart, Ereignis, Frage, GeleseneMeldung } from "./zustand.ts";

export const REPORT_PATH = "/melden";
export const SECRET_HEADER = "x-kommandozentrale-geheimnis";
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;
export const PORT_VARIABLE = "KOMMANDOZENTRALE_MELDEPORT";
export const SECRET_FILE_VARIABLE = "KOMMANDOZENTRALE_GEHEIMNIS_DATEI";
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::ffff:127.0.0.1"]);
export const JSON_TYPE = /^application\/json(\s*;.*)?$/i;
const DENY_MESSAGE = "Denied in the Kommandozentrale.";
const ANSWER_NAME = "Antwort";
const WITHDRAWAL_NAME = "Ruecknahme";
const SAME_SESSION_SOURCES = new Set(["clear", "compact", "resume", "fork"]);
const PASSIVE_REPORTS = new Set(["Statuszeile", "SessionEnd"]);
const SESSION_START = "SessionStart";
export const TAKEOVER_MS = 60_000;
export const HOLD_UNKNOWN_MS = 5_000;

export type Entscheidung = "ja" | "nein" | "immer";
export type AnswerResult = { kind: "ok" } | { kind: "unbekannt" } | { kind: "keine_regel" };

export type InletReport =
  | { kind: "zentrale"; sitzung: string; ereignisName: string; ereignis: Ereignis | null; aufwand: string | null }
  | { kind: "fremd"; sitzung: string | null; ereignisName: string };

export interface ReportSessions {
  list(): readonly Pick<SessionInfo, "id" | "claudeSitzung" | "prozess">[];
  setClaudeSession(id: string, claudeSession: string): Promise<void>;
}

export interface ReportInletOptions {
  readonly secret: string;
  readonly sessions: ReportSessions;
  readonly onReport: (report: InletReport) => void;
  readonly onError: (error: unknown) => void;
  readonly newQuestionId?: () => string;
  readonly now?: () => number;
  readonly holdUnknownMs?: number;
}

export interface OpenQuestion {
  readonly frage: string;
  readonly sitzung: string;
}

interface Pending {
  readonly sitzung: string;
  readonly sessionId: string;
  readonly frage: Frage;
  readonly response: ServerResponse;
}

interface Takeover {
  readonly alt: string;
  readonly neu: string;
  readonly seit: number;
}

interface Waiter {
  readonly sitzung: string;
  readonly sessionId: string;
  readonly done: (bound: boolean) => void;
}

interface Envelope {
  readonly sitzung: string | null;
  readonly art: Berichtsart;
  readonly daten: unknown;
}

class RequestRejected extends Error {
  readonly status: number;

  constructor(status: number, options?: ErrorOptions) {
    super(`report rejected with ${String(status)}`, options);
    this.name = "RequestRejected";
    this.status = status;
  }
}

export function reportEnvironment(settings: Pick<Settings, "portMeldeeingang" | "geheimnis">): Record<string, string> {
  return { [PORT_VARIABLE]: String(settings.portMeldeeingang), [SECRET_FILE_VARIABLE]: settings.geheimnis };
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function decision(question: Frage, answer: Entscheidung): unknown {
  const chosen =
    answer === "nein"
      ? { behavior: "deny", message: DENY_MESSAGE }
      : answer === "immer"
        ? { behavior: "allow", updatedPermissions: question.regelBeiImmer }
        : { behavior: "allow" };
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: chosen } };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_REPORT_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_REPORT_BYTES) reject(new RequestRejected(413));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function envelopeOf(body: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error: unknown) {
    throw new RequestRejected(400, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new RequestRejected(400);
  const { sitzung, art, daten } = parsed as Record<string, unknown>;
  if (sitzung !== null && typeof sitzung !== "string") throw new RequestRejected(400);
  if (art !== "hook" && art !== "statuszeile") throw new RequestRejected(400);
  return { sitzung, art, daten };
}

export function senderAllowed(remote: string | undefined, local: number | undefined, host: string | undefined): boolean {
  if (remote === undefined || local === undefined || !LOOPBACK_ADDRESSES.has(remote)) return false;
  return host === `127.0.0.1:${String(local)}`;
}

function takesNewSessionId(current: string | null, event: Ereignis | null): boolean {
  if (event?.kind !== "SessionStart") return false;
  return current === null || (event.quelle !== null && SAME_SESSION_SOURCES.has(event.quelle));
}

function reply(response: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export class ReportInlet {
  readonly #secret: Buffer;
  readonly #sessions: ReportSessions;
  readonly #onReport: (report: InletReport) => void;
  readonly #onError: (error: unknown) => void;
  readonly #newQuestionId: () => string;
  readonly #now: () => number;
  readonly #holdUnknownMs: number;
  readonly #waiters = new Set<Waiter>();
  readonly #pending = new Map<string, Pending>();
  readonly #takeovers = new Map<string, Takeover>();
  readonly #foreign = new Map<string, Set<string>>();

  constructor(options: ReportInletOptions) {
    this.#secret = digest(options.secret);
    this.#sessions = options.sessions;
    this.#onReport = options.onReport;
    this.#onError = options.onError;
    this.#newQuestionId = options.newQuestionId ?? randomUUID;
    this.#now = options.now ?? Date.now;
    this.#holdUnknownMs = options.holdUnknownMs ?? HOLD_UNKNOWN_MS;
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    this.#receive(request, response).catch((error: unknown) => {
      if (!response.headersSent) reply(response, error instanceof RequestRejected ? error.status : 500);
      if (!(error instanceof RequestRejected)) this.#onError(error);
    });
  }

  answer(questionId: string, answer: Entscheidung): AnswerResult {
    const pending = this.#pending.get(questionId);
    if (pending === undefined) return { kind: "unbekannt" };
    if (answer === "immer" && pending.frage.regelBeiImmer === null) return { kind: "keine_regel" };
    this.#settle(questionId, pending);
    reply(pending.response, 200, decision(pending.frage, answer));
    return { kind: "ok" };
  }

  sessionsChanged(): void {
    const running = new Set(this.#sessions.list().flatMap((entry) => (entry.prozess === "laeuft" ? [entry.id] : [])));
    for (const [questionId, pending] of this.#pending) {
      if (running.has(pending.sitzung)) continue;
      this.#settle(questionId, pending);
      reply(pending.response, 204);
    }
    for (const sitzung of this.#takeovers.keys()) {
      if (!running.has(sitzung)) this.#takeovers.delete(sitzung);
    }
  }

  openQuestions(): OpenQuestion[] {
    return [...this.#pending.values()].map(({ sitzung, frage }) => ({ frage: frage.id, sitzung }));
  }

  #guard(request: IncomingMessage): void {
    const { remoteAddress, localPort } = request.socket;
    if (!senderAllowed(remoteAddress, localPort, header(request, "host"))) throw new RequestRejected(403);
    if (request.method !== "POST") throw new RequestRejected(405);
    if (request.url !== REPORT_PATH) throw new RequestRejected(404);
    if (!timingSafeEqual(digest(header(request, SECRET_HEADER) ?? ""), this.#secret)) throw new RequestRejected(401);
    if (!JSON_TYPE.test(header(request, "content-type") ?? "")) throw new RequestRejected(415);
  }

  async #receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#guard(request);
    const envelope = envelopeOf(await readBody(request));
    const read = readReport(envelope.art, envelope.daten, this.#newQuestionId);
    if (read === undefined) throw new RequestRejected(400);
    const sitzung = envelope.sitzung;
    if (sitzung === null || !(await this.#fromZentrale(sitzung, read))) {
      this.#onReport({ kind: "fremd", sitzung, ereignisName: read.ereignisName });
      reply(response, 204);
      return;
    }
    this.#onReport({ kind: "zentrale", sitzung, ereignisName: read.ereignisName, ereignis: read.ereignis, aufwand: read.aufwand });
    this.#release(sitzung, read.sessionId);
    if (read.ereignis?.kind === "PermissionRequest") this.#hold(sitzung, read.sessionId, read.ereignis.frage, response);
    else reply(response, 204);
  }

  async #fromZentrale(sitzung: string, read: GeleseneMeldung): Promise<boolean> {
    const known = this.#sessions.list().find((entry) => entry.id === sitzung);
    if (known === undefined || this.#foreign.get(sitzung)?.has(read.sessionId) === true) return false;
    if (known.claudeSitzung === read.sessionId) return true;
    const takeover = this.#currentTakeover(sitzung);
    if (takeover?.neu === known.claudeSitzung && takeover.alt === read.sessionId) {
      return !PASSIVE_REPORTS.has(read.ereignisName) && this.#withdraw(sitzung, takeover);
    }
    if (takesNewSessionId(known.claudeSitzung, read.ereignis)) return this.#adopt(sitzung, known.claudeSitzung, read.sessionId);
    return read.ereignisName !== SESSION_START && this.#boundWithin(sitzung, read.sessionId);
  }

  #currentTakeover(sitzung: string): Takeover | undefined {
    const takeover = this.#takeovers.get(sitzung);
    if (takeover === undefined || this.#now() - takeover.seit <= TAKEOVER_MS) return takeover;
    this.#takeovers.delete(sitzung);
    return undefined;
  }

  async #adopt(sitzung: string, previous: string | null, sessionId: string): Promise<boolean> {
    if (!(await this.#bind(sitzung, sessionId))) return false;
    if (previous !== null) this.#takeovers.set(sitzung, { alt: previous, neu: sessionId, seit: this.#now() });
    return true;
  }

  #release(sitzung: string, sessionId: string): void {
    for (const waiter of this.#waiters) {
      if (waiter.sitzung === sitzung && waiter.sessionId === sessionId) waiter.done(true);
    }
  }

  #boundWithin(sitzung: string, sessionId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        sitzung,
        sessionId,
        done: (bound) => {
          clearTimeout(timer);
          this.#waiters.delete(waiter);
          resolve(bound);
        },
      };
      const timer = setTimeout(() => {
        waiter.done(false);
      }, this.#holdUnknownMs);
      timer.unref();
      this.#waiters.add(waiter);
    });
  }

  async #bind(sitzung: string, sessionId: string): Promise<boolean> {
    try {
      await this.#sessions.setClaudeSession(sitzung, sessionId);
    } catch (error: unknown) {
      if (error instanceof SessionError) return false;
      throw error;
    }
    return true;
  }

  async #withdraw(sitzung: string, takeover: Takeover): Promise<boolean> {
    if (!(await this.#bind(sitzung, takeover.alt))) return false;
    this.#takeovers.delete(sitzung);
    const foreign = this.#foreign.get(sitzung) ?? new Set<string>();
    this.#foreign.set(sitzung, foreign.add(takeover.neu));
    const ereignis: Ereignis = { kind: "Ruecknahme", sessionId: takeover.alt };
    this.#onReport({ kind: "zentrale", sitzung, ereignisName: WITHDRAWAL_NAME, ereignis, aufwand: null });
    for (const [questionId, pending] of this.#pending) {
      if (pending.sitzung !== sitzung || pending.sessionId !== takeover.neu) continue;
      this.#settle(questionId, pending);
      reply(pending.response, 204);
    }
    return true;
  }

  #hold(sitzung: string, sessionId: string, frage: Frage, response: ServerResponse): void {
    const pending: Pending = { sitzung, sessionId, frage, response };
    this.#pending.set(frage.id, pending);
    response.on("close", () => {
      if (this.#pending.get(frage.id) === pending) this.#settle(frage.id, pending);
    });
  }

  #settle(questionId: string, pending: Pending): void {
    this.#pending.delete(questionId);
    this.#onReport({
      kind: "zentrale",
      sitzung: pending.sitzung,
      ereignisName: ANSWER_NAME,
      ereignis: { kind: "Antwort", frage: questionId },
      aufwand: null,
    });
  }
}

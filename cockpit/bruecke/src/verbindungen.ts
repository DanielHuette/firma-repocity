import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import type { AnswerResult, Entscheidung, InletReport } from "./meldungen.ts";
import { parseClientMessage } from "./nachrichten.ts";
import type { ChatDaten, ChatSchritt, Erlaubnisanfrage } from "./chat.ts";
import type { AgentAnzeige, ClientMessage, ServerMessage, SitzungsAnzeige, Steuerung } from "./nachrichten.ts";
import type { Menu } from "./menue.ts";
import { MAIN_PARENT, type AgentDetails, type StreamAgent } from "./agentenfortschritt.ts";
import { OptionsFehler } from "./optionsdienst.ts";
import type { Antwort, Optionsdienst, OptionsMessage } from "./optionsdienst.ts";
import type { Log } from "./protokoll.ts";
import type { SelfTest } from "./selbsttest.ts";
import { SessionError } from "./sitzungen.ts";
import type { SessionEvent, Sessions } from "./sitzungen.ts";
import { describeInput, displayed, MAIN_AGENT, newSessionState, nextState } from "./zustand.ts";
import type { Agent, Ereignis, Frage, SitzungsZustand } from "./zustand.ts";

interface StreamDetails {
  readonly agenten: readonly StreamAgent[];
  readonly von: (parent: string) => AgentDetails;
}

export const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
export const HELLO_WITHIN_MS = 10_000;
export const UNREADABLE_ANSWERS = 5;
export const UNREADABLE_WINDOW_MS = 10_000;
const POLICY_VIOLATION = 1008;
const REFUSED: Readonly<Partial<Record<ClientMessage["typ"], string>>> = { neu: "Neue Sitzung abgelehnt", hinzufuegen: "Hinzufügen fehlgeschlagen" };
const GOING_AWAY = 1001;
const UNREADABLE = "Nachricht nicht verstanden: unbekannte Art oder ungültige Angaben.";
const REJECTIONS: Readonly<Record<string, string>> = {
  nicht_steuernd: "Dieses Gerät steuert nicht; erst übernehmen.",
  unbekannt: "Unbekannt oder schon erledigt.",
  beendet: "Diese Sitzung ist beendet.",
  ungueltig: "Die Antwort passt nicht zu den Fragen.",
  keine_frage: "Diese Frage ist schon beantwortet oder nicht mehr offen.",
  keine_regel: "Für diese Frage gibt es keine Regel für „Immer“.",
  nicht_verbunden: "Dieses Gerät ist nicht verbunden.",
  nicht_pausiert: "Diese Sitzung ist nicht pausiert.",
  nur_einmal: "In einer Prüfsitzung gilt jede Freigabe nur einmal; „Immer“ ist dort nicht möglich.",
};

export type HubSessions = Pick<
  Sessions,
  "list" | "controller" | "chat" | "connect" | "disconnect" | "takeOver" | "send" | "interrupt" | "answerQuestion" | "answerPlan" | "answerPermission" | "end" | "options" | "agents" | "resume" | "clean" | "isCheck"
>;

export interface HubOptions {
  readonly sessions: HubSessions;
  readonly answer: (frage: string, entscheidung: Entscheidung) => AnswerResult;
  readonly log: Log;
  readonly now: () => number;
  readonly schwelleVerdichten: number;
  readonly helloWithinMs?: number;
  readonly menu: Pick<Menu, "search" | "folders">;
  readonly dienst: Pick<Optionsdienst, "handle">;
  readonly selfTest: Pick<SelfTest, "version" | "versionSeen" | "hints" | "inputSent" | "observe" | "restart">;
  readonly readVersion?: () => Promise<string | null>;
  readonly storeThreshold: (value: number) => Promise<void>;
  readonly shutDown: () => void;
  readonly assistenzGeheimnis?: string;
}

interface Client {
  readonly socket: WebSocket;
  device: string | null;
  waiting: string[] | null;
  waitingBytes: number;
  alive: boolean;
  queue: Promise<void>;
  search: AbortController | null;
  unreadable: number[];
  readonly helloTimer: NodeJS.Timeout;
  assistenz: string | null;
}

type ChatMessage = Extract<ClientMessage, { typ: "nachricht" | "abbrechen" | "frage_antwort" | "plan_antwort" }>;
type ReadMessage = Extract<OptionsMessage, { typ: "bestand_holen" | "optionen_holen" | "projekte_holen" }>;
type ChangeMessage = Exclude<OptionsMessage, ReadMessage>;
type ControlMessage = Extract<ClientMessage, { typ: "antwort" | "beenden" | "fortsetzen" | "einstellung" | "selbsttest" | "herunterfahren" }> | ChatMessage | ChangeMessage;
const CHAT_MESSAGES = new Set<ClientMessage["typ"]>(["nachricht", "abbrechen", "frage_antwort", "plan_antwort"]);
const READ_MESSAGES = new Set<ClientMessage["typ"]>(["bestand_holen", "optionen_holen", "projekte_holen"]);
const CHANGE_MESSAGES = new Set<ClientMessage["typ"]>(["sitzung_umbenennen", "haken", "favorit", "sitzung_einstellung", "vorgaben", "neu", "hinzufuegen"]);

function isChatMessage(message: ControlMessage): message is ChatMessage {
  return CHAT_MESSAGES.has(message.typ);
}

function isChangeMessage(message: ControlMessage): message is ChangeMessage {
  return CHANGE_MESSAGES.has(message.typ);
}

function isReadMessage(message: ClientMessage): message is ReadMessage {
  return READ_MESSAGES.has(message.typ);
}

export function streamParents(agents: readonly Agent[], stream: readonly { readonly id: string; readonly typ: string }[]): Map<string, string> {
  const parents = new Map<string, string>([[MAIN_AGENT, MAIN_PARENT]]);
  const unused = [...stream];
  for (const agent of agents.filter((entry) => entry.id !== MAIN_AGENT).toSorted((a, b) => a.seit - b.seit)) {
    const index = unused.findIndex((entry) => entry.typ === agent.typ);
    if (index === -1) continue;
    parents.set(agent.id, unused[index]?.id ?? "");
    unused.splice(index, 1);
  }
  return parents;
}

export const TOOL_QUESTION_PREFIX = "werkzeug-";

export function toolQuestion(anfrage: Erlaubnisanfrage): Frage {
  return { id: TOOL_QUESTION_PREFIX + anfrage.requestId, agent: MAIN_AGENT, werkzeug: anfrage.werkzeug, beschreibung: describeInput(anfrage.eingabe), regelBeiImmer: null };
}

const ASSISTANT_SECRET_WRONG = "Geheimnis der Assistenz passt nicht";
const ASSISTANT_BLOCKED = "Für die Assistenz gesperrt; sie darf nur Fragen mit Ja oder Nein beantworten.";
const ASSISTANT_NEVER_ALWAYS = "„Immer“ nimmt die Brücke von der Assistenz nie an.";

function answerResult(frage: string, entscheidung: Entscheidung, grund: string | null): ServerMessage {
  return { typ: "antwort_ergebnis", frage, entscheidung, angenommen: grund === null, grund };
}

export function agentsWithDetails(agents: readonly Agent[], details: StreamDetails | undefined): AgentAnzeige[] {
  if (details === undefined) return agents.map((agent) => ({ ...agent, skills: [], fortschritt: null }));
  const parents = streamParents(agents, details.agenten);
  return agents.map((agent) => {
    const parent = parents.get(agent.id);
    if (parent === undefined) return { ...agent, skills: [], fortschritt: null };
    const name = details.agenten.find((stream) => stream.id === parent)?.beschreibung ?? agent.name;
    return { ...agent, name, ...details.von(parent) };
  });
}

function chatMessage(sitzung: string, schritt: ChatSchritt): ServerMessage {
  switch (schritt.art) {
    case "neu":
      return { typ: "chat_neu", sitzung, eintrag: schritt.eintrag };
    case "teil":
      return { typ: "chat_teil", sitzung, id: schritt.id, text: schritt.text };
    case "aktualisiert":
      return { typ: "chat_aktualisiert", sitzung, eintrag: schritt.eintrag };
  }
}

function chatEvent(daten: ChatDaten): Ereignis | null {
  const { modell, eingabeTokens, kontextFenster } = daten;
  if (modell === undefined && eingabeTokens === undefined && kontextFenster === undefined) return null;
  return {
    kind: "Chatdaten",
    ...(modell === undefined ? {} : { modell }),
    ...(eingabeTokens === undefined ? {} : { eingabeTokens }),
    ...(kontextFenster === undefined ? {} : { kontextFenster }),
  };
}

function textOf(data: RawData, isBinary: boolean): string | undefined {
  return !isBinary && Buffer.isBuffer(data) ? data.toString("utf8") : undefined;
}

function sendWaiting(client: Client, text: string): Promise<void> {
  return new Promise((resolve) => {
    if (client.socket.readyState !== WebSocket.OPEN) {
      resolve();
      return;
    }
    client.socket.send(text, () => {
      resolve();
    });
  });
}

export class Hub {
  readonly #options: HubOptions;
  readonly #clients = new Set<Client>();
  readonly #users = new Map<string, Client>();
  readonly #names = new Map<string, string>();
  #states = new Map<string, SitzungsZustand>();
  #threshold: number;
  #allLeft: (() => void) | null = null;

  constructor(options: HubOptions) {
    this.#options = options;
    this.#threshold = options.schwelleVerdichten;
    this.#sync();
  }

  refresh(): void {
    this.#broadcastState();
  }

  onSessionEvent(event: SessionEvent): void {
    switch (event.kind) {
      case "chat":
        this.#broadcast(JSON.stringify(chatMessage(event.sitzung, event.schritt)));
        return;
      case "daten": {
        const ereignis = chatEvent(event.daten);
        if (ereignis !== null) this.#apply(event.sitzung, ereignis);
        return;
      }
      case "stoerung":
        this.#options.log.info(`session ${event.sitzung}: ${event.text}`);
        return;
      case "erlaubnis":
        this.#apply(event.sitzung, { kind: "PermissionRequest", frage: toolQuestion(event.anfrage) });
        return;
      case "erlaubnis_weg":
        this.#apply(event.sitzung, { kind: "Antwort", frage: TOOL_QUESTION_PREFIX + event.requestId });
        return;
      case "geaendert":
        this.#sync();
        this.#broadcastState();
        return;
      case "fehler":
        this.#options.log.error("a session reported an error", event.fehler);
        return;
    }
  }

  onReport(report: InletReport): void {
    if (report.kind === "zentrale") {
      this.#options.selfTest.observe(report.sitzung, report.ereignisName);
      if (report.aufwand !== null) this.#apply(report.sitzung, { kind: "Aufwand", aufwand: report.aufwand });
      if (report.ereignis !== null) this.#apply(report.sitzung, report.ereignis);
      return;
    }
    if (report.sitzung !== null) {
      this.#options.log.info(`report ${report.ereignisName} of session ${report.sitzung} does not match its Claude session`);
    }
  }

  accept(socket: WebSocket): void {
    const helloTimer = setTimeout(() => {
      if (client.device === null) socket.close(POLICY_VIOLATION, "kein hallo");
    }, this.#options.helloWithinMs ?? HELLO_WITHIN_MS);
    const client: Client = {
      socket,
      device: null,
      waiting: null,
      waitingBytes: 0,
      alive: true,
      queue: Promise.resolve(),
      search: null,
      unreadable: [],
      helloTimer,
      assistenz: null,
    };
    this.#clients.add(client);
    this.#listen(client);
  }

  heartbeat(): void {
    for (const client of this.#clients) {
      if (!client.alive) {
        this.#options.log.info("a connection did not answer the ping and was dropped");
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      if (client.socket.readyState === WebSocket.OPEN) client.socket.ping();
    }
  }

  closeAll(): Promise<void> {
    for (const client of this.#clients) client.socket.close(GOING_AWAY, "Bruecke wird beendet");
    if (this.#clients.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#allLeft = resolve;
    });
  }

  #listen(client: Client): void {
    const { socket } = client;
    socket.on("message", (data, isBinary) => {
      const text = textOf(data, isBinary);
      client.queue = client.queue
        .then(() => {
          this.#process(client, text);
        })
        .catch((error: unknown) => {
          this.#options.log.error("handling a message failed", error);
        });
    });
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("close", (code) => {
      this.#leave(client, code);
    });
    socket.on("error", (error) => {
      this.#options.log.error("a WebSocket failed", error);
    });
  }

  #process(client: Client, text: string | undefined): void {
    const message = text === undefined ? undefined : parseClientMessage(text);
    if (client.device === null) this.#greet(client, message);
    else if (message === undefined) this.#unreadable(client);
    else if (client.assistenz !== null) this.#fromAssistant(client, client.assistenz, message);
    else this.#handle(client, client.device, message);
  }

  #unreadable(client: Client): void {
    const now = this.#options.now();
    client.unreadable = client.unreadable.filter((at) => now - at < UNREADABLE_WINDOW_MS);
    if (client.unreadable.length >= UNREADABLE_ANSWERS) return;
    client.unreadable.push(now);
    this.#tell(client, UNREADABLE);
  }

  #greet(client: Client, message: ClientMessage | undefined): void {
    if (message?.typ !== "hallo" && message?.typ !== "hallo_assistenz") {
      client.socket.close(POLICY_VIOLATION, "erst hallo");
      return;
    }
    if (message.typ === "hallo_assistenz" && !this.#isAssistantSecret(message.geheimnis)) {
      client.socket.close(POLICY_VIOLATION, ASSISTANT_SECRET_WRONG);
      return;
    }
    if (this.#users.has(message.geraet)) {
      this.#options.log.info(`device id ${message.geraet} refused, another open connection uses it`);
      client.socket.close(POLICY_VIOLATION, "Geraetekennung gehoert einem anderen Geraet");
      return;
    }
    this.#users.set(message.geraet, client);
    this.#names.set(message.geraet, message.name);
    clearTimeout(client.helloTimer);
    client.device = message.geraet;
    client.waiting = [];
    this.#options.log.info(`device ${message.geraet} (${message.name}) connected`);
    if (message.typ === "hallo_assistenz") client.assistenz = message.name;
    this.#options.sessions.connect(message.geraet, message.typ === "hallo" && message.modus === "arbeiten");
    void this.#sendHistory(client);
  }

  async #sendHistory(client: Client): Promise<void> {
    const { sessions } = this.#options;
    const histories = sessions.list().map(({ id }) => ({ typ: "chat", sitzung: id, eintraege: sessions.chat(id) ?? [] }) satisfies ServerMessage);
    await sendWaiting(client, JSON.stringify(this.#stateFor(client)));
    for (const history of histories) await sendWaiting(client, JSON.stringify(history));
    const waiting = client.waiting ?? [];
    client.waiting = null;
    client.waitingBytes = 0;
    for (const text of waiting) this.#send(client, text);
  }

  #isAssistantSecret(given: string): boolean {
    const known = this.#options.assistenzGeheimnis;
    if (known?.length !== given.length) return false;
    return timingSafeEqual(Buffer.from(known), Buffer.from(given));
  }

  #fromAssistant(client: Client, name: string, message: ClientMessage): void {
    if (message.typ === "hallo" || message.typ === "hallo_assistenz") return;
    if (message.typ !== "antwort") {
      this.#tell(client, ASSISTANT_BLOCKED);
      return;
    }
    const { frage, entscheidung } = message;
    if (entscheidung === "immer") {
      this.#deliver(client, JSON.stringify(answerResult(frage, entscheidung, ASSISTANT_NEVER_ALWAYS)));
      return;
    }
    const owner = [...this.#states.values()].find((state) => state.wartet.some((question) => question.id === frage));
    const question = owner?.wartet.find((entry) => entry.id === frage);
    const result = this.#answerQuestion(frage, entscheidung);
    const accepted = result.kind === "ok";
    this.#deliver(client, JSON.stringify(answerResult(frage, entscheidung, accepted ? null : (REJECTIONS[result.kind] ?? result.kind))));
    if (!accepted || owner === undefined || question === undefined) return;
    this.#options.log.info(`assistant ${name} answered ${frage} with ${entscheidung}`);
    const shown: ServerMessage = { typ: "assistenz_antwort", sitzung: owner.id, frage, name, entscheidung, werkzeug: question.werkzeug, beschreibung: question.beschreibung };
    this.#broadcast(JSON.stringify(shown));
  }

  #handle(client: Client, device: string, message: ClientMessage): void {
    switch (message.typ) {
      case "hallo":
      case "hallo_assistenz":
        return;
      case "uebernehmen":
        this.#note(client, "take over", this.#options.sessions.takeOver(device));
        return;
      default:
        this.#handleOther(client, device, message);
    }
  }

  #handleOther(client: Client, device: string, message: Exclude<ClientMessage, { typ: "hallo" | "hallo_assistenz" | "uebernehmen" }>): void {
    if (isReadMessage(message)) {
      this.#serve(client, message);
      return;
    }
    switch (message.typ) {
      case "suche":
        this.#sendSearch(client, message.text);
        return;
      case "einstellungen":
        this.#deliver(client, this.#settingsText());
        return;
      case "ordner":
        this.#sendFolders(client);
        return;
      default:
        if (this.#options.sessions.controller() === device) this.#control(client, message);
        else this.#note(client, message.typ, { kind: "nicht_steuernd" });
    }
  }

  #control(client: Client, message: ControlMessage): void {
    if (isChatMessage(message)) {
      this.#chat(client, message);
      return;
    }
    if (isChangeMessage(message)) {
      this.#serve(client, message);
      return;
    }
    switch (message.typ) {
      case "antwort":
        this.#note(client, "answer", this.#answerQuestion(message.frage, message.entscheidung));
        return;
      case "beenden":
        this.#end(client, message.sitzung);
        return;
      case "fortsetzen":
        this.#resume(client, message.sitzung);
        return;
      case "einstellung":
        this.#setThreshold(client, message.schwelleVerdichten);
        return;
      case "selbsttest":
        this.#options.selfTest.restart();
        return;
      case "herunterfahren":
        this.#shutDown();
        return;
    }
  }

  #chat(client: Client, message: ChatMessage): void {
    const { sessions } = this.#options;
    switch (message.typ) {
      case "nachricht":
        this.#message(client, message.sitzung, message.text);
        return;
      case "abbrechen":
        this.#note(client, "interrupt", sessions.interrupt(message.sitzung));
        return;
      case "frage_antwort":
        this.#note(client, "question answer", sessions.answerQuestion(message.sitzung, message.eintrag, message.antworten));
        return;
      case "plan_antwort":
        this.#note(client, "plan answer", sessions.answerPlan(message.sitzung, message.eintrag, message.entscheidung));
        return;
    }
  }

  #answerQuestion(frage: string, entscheidung: Entscheidung): { readonly kind: string } {
    const owner = [...this.#states.values()].find((state) => state.wartet.some((question) => question.id === frage));
    if (frage.startsWith(TOOL_QUESTION_PREFIX)) {
      if (owner === undefined) return { kind: "keine_frage" };
      if (entscheidung === "immer") return { kind: "nur_einmal" };
      return this.#options.sessions.answerPermission(owner.id, frage.slice(TOOL_QUESTION_PREFIX.length), entscheidung === "ja");
    }
    if (entscheidung === "immer" && owner !== undefined && this.#options.sessions.isCheck(owner.id)) return { kind: "nur_einmal" };
    return this.#options.answer(frage, entscheidung);
  }

  #resume(client: Client, session: string): void {
    this.#options.sessions.resume(session).then(
      (result) => {
        this.#note(client, "resume", result);
      },
      (error: unknown) => {
        this.#failed(client, "Fortsetzen fehlgeschlagen", error);
      },
    );
  }

  #serve(client: Client, message: OptionsMessage): void {
    this.#options.dienst.handle(message).then(
      (answers) => {
        this.#answer(client, answers);
        if (message.typ === "neu") this.#rereadVersion();
      },
      (error: unknown) => {
        if (error instanceof OptionsFehler) this.#tell(client, error.message);
        else this.#failed(client, REFUSED[message.typ] ?? `${message.typ} abgelehnt`, error);
      },
    );
  }

  #answer(client: Client, answers: readonly Antwort[]): void {
    for (const { an, nachricht } of answers) {
      if (an === "alle") this.#broadcast(JSON.stringify(nachricht));
      else this.#deliver(client, JSON.stringify(nachricht));
    }
  }

  #message(client: Client, session: string, text: string): void {
    const mayRestart = (this.#states.get(session)?.wartet.length ?? 0) === 0;
    const result = this.#options.sessions.send(session, text, mayRestart);
    if (result.kind !== "ok") {
      this.#note(client, "message", result);
      return;
    }
    this.#options.selfTest.inputSent(session);
    this.#apply(session, { kind: "Nachricht" });
  }

  #shutDown(): void {
    this.#options.log.info("the controlling device ends the Kommandozentrale");
    this.#broadcast(JSON.stringify({ typ: "beendet" } satisfies ServerMessage));
    this.#options.shutDown();
  }

  #rereadVersion(): void {
    this.#options.readVersion?.().then(
      (version) => {
        this.#options.selfTest.versionSeen(version);
      },
      (error: unknown) => {
        this.#options.log.error("reading the version of Claude Code failed", error);
      },
    );
  }

  #end(client: Client, session: string): void {
    this.#options.sessions.end(session).then(
      (result) => {
        this.#note(client, "end", result);
      },
      (error: unknown) => {
        this.#failed(client, "Beenden fehlgeschlagen", error);
      },
    );
  }

  #setThreshold(client: Client, value: number): void {
    this.#options.storeThreshold(value).then(
      () => {
        this.#threshold = value;
        this.#options.log.info(`compaction threshold set to ${String(value)}`);
        this.#broadcast(this.#settingsText());
      },
      (error: unknown) => {
        this.#failed(client, "Schwelle nicht gespeichert", error);
      },
    );
  }

  #settingsText(): string {
    const settings: ServerMessage = { typ: "einstellungen", schwelleVerdichten: this.#threshold, claudeVersion: this.#options.selfTest.version() };
    return JSON.stringify(settings);
  }

  #sendFolders(client: Client): void {
    this.#options.menu.folders().then(
      (liste) => {
        this.#deliver(client, JSON.stringify({ typ: "ordner", liste } satisfies ServerMessage));
      },
      (error: unknown) => {
        this.#failed(client, "Ordnerliste nicht lesbar", error);
      },
    );
  }

  #sendSearch(client: Client, text: string): void {
    client.search?.abort();
    const search = new AbortController();
    client.search = search;
    this.#options.menu.search(text, search.signal).then(
      (result) => {
        if (client.search !== search) return;
        client.search = null;
        this.#deliver(client, JSON.stringify({ typ: "treffer", text, ...result } satisfies ServerMessage));
      },
      (error: unknown) => {
        if (search.signal.aborted) return;
        client.search = null;
        this.#failed(client, "Suche fehlgeschlagen", error);
      },
    );
  }

  #failed(client: Client, action: string, error: unknown): void {
    if (error instanceof SessionError) {
      this.#options.log.info(`${action}: ${error.message}`);
      this.#tell(client, `${action}: ${error.message}`);
      return;
    }
    this.#options.log.error(action, error);
    this.#tell(client, `${action}.`);
  }

  #note(client: Client, action: string, result: { readonly kind: string }): void {
    if (result.kind === "ok") return;
    this.#options.log.info(`${action} rejected: ${result.kind}`);
    this.#tell(client, REJECTIONS[result.kind] ?? result.kind);
  }

  #tell(client: Client, text: string): void {
    this.#deliver(client, JSON.stringify({ typ: "fehler", text } satisfies ServerMessage));
  }

  #apply(session: string, event: Ereignis): void {
    const current = this.#states.get(session);
    if (current === undefined) return;
    const next = nextState(current, event, { jetzt: this.#options.now(), schwelleVerdichten: this.#threshold });
    if (next === current) return;
    this.#states.set(session, next);
    this.#broadcastState();
  }

  #sync(): void {
    const { sessions, now } = this.#options;
    const next = new Map<string, SitzungsZustand>();
    for (const { id, ordner, claudeSitzung } of sessions.list()) {
      next.set(id, this.#states.get(id) ?? newSessionState({ id, ordner, titel: path.basename(ordner), claudeSitzung }, now()));
    }
    this.#states = next;
  }

  #view(): SitzungsAnzeige[] {
    const { sessions } = this.#options;
    return sessions.list().flatMap(({ id, prozess, hinweis }) => {
      const state = this.#states.get(id);
      const optionen = sessions.options(id);
      if (state === undefined || optionen === undefined) return [];
      const shown = displayed(state);
      const hinweise = [...shown.hinweise, ...this.#options.selfTest.hints(id)];
      return [sessions.clean(id, { ...shown, ...optionen, agenten: this.#agentsOf(id, shown.agenten), hinweise, prozess, hinweis })];
    });
  }

  #agentsOf(id: string, agents: readonly Agent[]): AgentAnzeige[] {
    return agentsWithDetails(agents, this.#options.sessions.agents(id));
  }

  #stateFor(client: Client): ServerMessage {
    const controller = this.#options.sessions.controller();
    const steuert: Steuerung | null =
      controller === null ? null : { name: this.#names.get(controller) ?? "", du: controller === client.device };
    return { typ: "zustand", sitzungen: this.#view(), steuert };
  }

  #broadcastState(): void {
    for (const client of this.#clients) {
      if (client.device !== null) this.#deliver(client, JSON.stringify(this.#stateFor(client)));
    }
  }

  #broadcast(text: string): void {
    for (const client of this.#clients) {
      if (client.device !== null) this.#deliver(client, text);
    }
  }

  #deliver(client: Client, text: string): void {
    if (client.waiting === null) {
      this.#send(client, text);
      return;
    }
    client.waitingBytes += Buffer.byteLength(text);
    if (client.waitingBytes + client.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#tooSlow(client);
      return;
    }
    client.waiting.push(text);
  }

  #send(client: Client, text: string): void {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (client.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#tooSlow(client);
      return;
    }
    client.socket.send(text);
  }

  #tooSlow(client: Client): void {
    this.#options.log.info("a device reads too slowly, its connection was dropped");
    client.socket.terminate();
  }

  #leave(client: Client, code: number): void {
    clearTimeout(client.helloTimer);
    client.search?.abort();
    this.#clients.delete(client);
    if (client.device !== null) {
      if (this.#users.get(client.device) === client) this.#users.delete(client.device);
      this.#options.sessions.disconnect(client.device);
      this.#options.log.info(`device ${client.device} disconnected (${String(code)})`);
    }
    if (this.#clients.size === 0) this.#allLeft?.();
  }
}

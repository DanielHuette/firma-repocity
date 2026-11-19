export const MAIN_AGENT = "haupt";
import { isFields, type Fields } from "./felder.ts";
const MAIN_AGENT_NAME = "Hauptsitzung";
const MAIN_AGENT_TYPE = "haupt";
const UNKNOWN_AGENT_TYPE = "unbekannt";
const SKILL_TOOL = "Skill";
const IDLE_NOTIFICATION = "idle_prompt";
const STATUS_LINE_NAME = "Statuszeile";
const NEW_CONVERSATION_SOURCES = new Set(["clear", "resume", "fork"]);
const COMPACT_SOURCE = "compact";
const LONGEST_DESCRIPTION = 1_000;
const DESCRIPTION_FIELDS = ["command", "file_path", "url", "pattern", "description"] as const;
const TOKEN_FORMAT = new Intl.NumberFormat("de-DE");
const CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
const PERCENT = 100;

const RULE_TYPES = new Set(["addRules", "replaceRules", "removeRules"]);
const DIRECTORY_TYPES = new Set(["addDirectories", "removeDirectories"]);
const RULE_BEHAVIORS = new Set(["allow", "deny", "ask"]);
const DESTINATIONS = new Set(["session", "localSettings", "projectSettings", "userSettings"]);
const MODES = new Set(["default", "auto", "acceptEdits", "dontAsk", "bypassPermissions", "plan", "manual"]);

export type SitzungsStand = "arbeitet" | "wartet" | "ruht";
export type AgentenStand = "laeuft" | "fertig" | "wartet";
export type Berichtsart = "hook" | "statuszeile";

export type PermissionUpdate = Readonly<Record<string, unknown>> & { readonly type: string; readonly destination: string };

export interface Agent {
  readonly id: string;
  readonly eltern: string | null;
  readonly name: string;
  readonly typ: string;
  readonly stand: AgentenStand;
  readonly werkzeug: string | null;
  readonly aufrufe: number;
  readonly seit: number;
}

export interface Frage {
  readonly id: string;
  readonly agent: string;
  readonly werkzeug: string;
  readonly beschreibung: string;
  readonly regelBeiImmer: readonly PermissionUpdate[] | null;
}

export interface Hinweis {
  readonly art: "verdichten";
  readonly anzeige: string;
}

export interface LetzterStop {
  readonly prompt: string | null;
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
  readonly eingabeTokens: number | null;
  readonly schwelleUeberschritten: boolean;
  readonly agenten: readonly Agent[];
  readonly wartet: readonly Frage[];
  readonly hinweise: readonly Hinweis[];
  readonly aufwand: string | null;
  readonly letzterStop: LetzterStop | null;
  readonly kontextFenster: number | null;
}

export type Ereignis =
  | { readonly kind: "SessionStart"; readonly sessionId: string; readonly quelle: string | null }
  | { readonly kind: "SubagentStart"; readonly agent: string; readonly typ: string; readonly prompt: string | null }
  | { readonly kind: "SubagentStop"; readonly agent: string }
  | {
      readonly kind: "PreToolUse";
      readonly agent: string | null;
      readonly typ: string | null;
      readonly werkzeug: string;
      readonly prompt: string | null;
    }
  | { readonly kind: "PermissionRequest"; readonly frage: Frage }
  | { readonly kind: "Antwort"; readonly frage: string }
  | { readonly kind: "Notification"; readonly typ: string | null }
  | { readonly kind: "Stop"; readonly prompt: string | null }
  | { readonly kind: "PostCompact" }
  | {
      readonly kind: "Statuszeile";
      readonly modell: string | null;
      readonly kontextProzent: number | null;
      readonly eingabeTokens: number | null;
      readonly aufwand: string | null;
    }
  | { readonly kind: "Nachricht" }
  | { readonly kind: "Chatdaten"; readonly modell?: string; readonly eingabeTokens?: number; readonly kontextFenster?: number }
  | { readonly kind: "Aufwand"; readonly aufwand: string }
  | { readonly kind: "Ruecknahme"; readonly sessionId: string };

export interface GeleseneMeldung {
  readonly sessionId: string;
  readonly ereignisName: string;
  readonly ereignis: Ereignis | null;
  readonly aufwand: string | null;
}

export interface Umgebung {
  readonly jetzt: number;
  readonly schwelleVerdichten: number;
}

function text(fields: Fields, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function nested(fields: Fields, key: string): Fields {
  const value = fields[key];
  return isFields(value) ? value : {};
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRule(value: unknown): boolean {
  if (!isFields(value) || typeof value.toolName !== "string" || value.toolName === "") return false;
  return value.ruleContent === undefined || typeof value.ruleContent === "string";
}

function isPermissionUpdate(entry: unknown): entry is PermissionUpdate {
  if (!isFields(entry) || typeof entry.type !== "string" || typeof entry.destination !== "string") return false;
  if (!DESTINATIONS.has(entry.destination)) return false;
  if (RULE_TYPES.has(entry.type)) {
    const { rules, behavior } = entry;
    return Array.isArray(rules) && rules.length > 0 && rules.every(isRule) && typeof behavior === "string" && RULE_BEHAVIORS.has(behavior);
  }
  if (entry.type === "setMode") return typeof entry.mode === "string" && MODES.has(entry.mode);
  return DIRECTORY_TYPES.has(entry.type) && isStringList(entry.directories) && entry.directories.length > 0;
}

function ruleForAlways(suggestions: unknown): readonly PermissionUpdate[] | null {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;
  return suggestions.every(isPermissionUpdate) ? suggestions : null;
}

export function describeInput(input: Fields): string {
  for (const field of DESCRIPTION_FIELDS) {
    const value = text(input, field);
    if (value !== null) return value.slice(0, LONGEST_DESCRIPTION);
  }
  return JSON.stringify(input).slice(0, LONGEST_DESCRIPTION);
}

function toolShown(fields: Fields, tool: string): string {
  if (tool !== SKILL_TOOL) return tool;
  return text(nested(fields, "tool_input"), "skill") ?? SKILL_TOOL;
}

function questionOf(fields: Fields, newQuestionId: () => string): Frage {
  const tool = text(fields, "tool_name") ?? UNKNOWN_AGENT_TYPE;
  return {
    id: newQuestionId(),
    agent: text(fields, "agent_id") ?? MAIN_AGENT,
    werkzeug: tool,
    beschreibung: describeInput(nested(fields, "tool_input")),
    regelBeiImmer: ruleForAlways(fields.permission_suggestions),
  };
}

function permissionEvent(fields: Fields, newQuestionId: () => string): Ereignis | null {
  if (CARD_TOOLS.has(text(fields, "tool_name") ?? "")) return null;
  return { kind: "PermissionRequest", frage: questionOf(fields, newQuestionId) };
}

function toolEvent(fields: Fields, agent: string | null, type: string | null, prompt: string | null): Ereignis {
  const werkzeug = toolShown(fields, text(fields, "tool_name") ?? UNKNOWN_AGENT_TYPE);
  return { kind: "PreToolUse", agent, typ: type, werkzeug, prompt };
}

function hookEvent(name: string, sessionId: string, fields: Fields, newQuestionId: () => string): Ereignis | null {
  const agent = text(fields, "agent_id");
  const type = text(fields, "agent_type");
  const prompt = text(fields, "prompt_id");
  switch (name) {
    case "SessionStart":
      return { kind: "SessionStart", sessionId, quelle: text(fields, "source") };
    case "SubagentStart":
      return agent === null ? null : { kind: "SubagentStart", agent, typ: type ?? UNKNOWN_AGENT_TYPE, prompt };
    case "SubagentStop":
      return agent === null ? null : { kind: "SubagentStop", agent };
    case "PreToolUse":
      return toolEvent(fields, agent, type, prompt);
    case "PermissionRequest":
      return permissionEvent(fields, newQuestionId);
    case "Notification":
      return { kind: "Notification", typ: text(fields, "notification_type") };
    case "Stop":
      return { kind: "Stop", prompt };
    case "PostCompact":
      return { kind: "PostCompact" };
    default:
      return null;
  }
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function inputTokens(usage: unknown): number | null {
  if (!isFields(usage)) return null;
  const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].map(tokenCount);
  let sum = 0;
  for (const part of parts) {
    if (part === null) return null;
    sum += part;
  }
  return sum;
}

function percentage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function statusLineEvent(fields: Fields): Ereignis {
  const context = nested(fields, "context_window");
  return {
    kind: "Statuszeile",
    modell: text(nested(fields, "model"), "display_name"),
    kontextProzent: percentage(context.used_percentage),
    eingabeTokens: inputTokens(context.current_usage),
    aufwand: text(nested(fields, "effort"), "level"),
  };
}

export function readReport(art: Berichtsart, daten: unknown, newQuestionId: () => string): GeleseneMeldung | undefined {
  if (!isFields(daten)) return undefined;
  const sessionId = text(daten, "session_id");
  if (sessionId === null) return undefined;
  const aufwand = text(nested(daten, "effort"), "level");
  if (art === "statuszeile") return { sessionId, ereignisName: STATUS_LINE_NAME, ereignis: statusLineEvent(daten), aufwand };
  const name = text(daten, "hook_event_name");
  if (name === null) return undefined;
  return { sessionId, ereignisName: name, ereignis: hookEvent(name, sessionId, daten, newQuestionId), aufwand };
}

export function newSessionState(
  basis: Pick<SitzungsZustand, "id" | "ordner" | "titel" | "claudeSitzung">,
  now: number,
): SitzungsZustand {
  const main: Agent = {
    id: MAIN_AGENT,
    eltern: null,
    name: MAIN_AGENT_NAME,
    typ: MAIN_AGENT_TYPE,
    stand: "fertig",
    werkzeug: null,
    aufrufe: 0,
    seit: now,
  };
  return {
    ...basis,
    stand: "ruht",
    modell: null,
    kontextProzent: null,
    kontextVeraltet: false,
    eingabeTokens: null,
    schwelleUeberschritten: false,
    agenten: [main],
    wartet: [],
    hinweise: [],
    aufwand: null,
    letzterStop: null,
    kontextFenster: null,
  };
}

export function displayed(state: SitzungsZustand): Omit<SitzungsZustand, "letzterStop" | "kontextFenster"> {
  const { id, ordner, titel, claudeSitzung, stand, modell, kontextProzent, kontextVeraltet, eingabeTokens, schwelleUeberschritten, agenten, wartet, hinweise, aufwand } =
    state;
  return { id, ordner, titel, claudeSitzung, stand, modell, kontextProzent, kontextVeraltet, eingabeTokens, schwelleUeberschritten, agenten, wartet, hinweise, aufwand };
}

function withAgent(state: SitzungsZustand, id: string, change: (agent: Agent) => Agent): SitzungsZustand {
  return { ...state, agenten: state.agenten.map((agent) => (agent.id === id ? change(agent) : agent)) };
}

function ensureAgent(state: SitzungsZustand, id: string, type: string | null, now: number): SitzungsZustand {
  if (state.agenten.some((agent) => agent.id === id)) return state;
  const typ = type ?? UNKNOWN_AGENT_TYPE;
  const agent: Agent = { id, eltern: MAIN_AGENT, name: typ, typ, stand: "laeuft", werkzeug: null, aufrufe: 0, seit: now };
  return { ...state, agenten: [...state.agenten, agent] };
}

function asking(state: SitzungsZustand, agent: string): boolean {
  return state.wartet.some((question) => question.agent === agent);
}

function working(state: SitzungsZustand): SitzungsZustand {
  const busy: SitzungsZustand = { ...state, stand: state.wartet.length > 0 ? "wartet" : "arbeitet" };
  return asking(busy, MAIN_AGENT) ? busy : withAgent(busy, MAIN_AGENT, (agent) => ({ ...agent, stand: "laeuft" }));
}

function resting(state: SitzungsZustand): SitzungsZustand {
  const idle: SitzungsZustand = { ...state, stand: state.wartet.length > 0 ? "wartet" : "ruht" };
  return asking(idle, MAIN_AGENT) ? idle : withAgent(idle, MAIN_AGENT, (agent) => ({ ...agent, stand: "fertig" }));
}

function arrivedLate(state: SitzungsZustand, prompt: string | null): boolean {
  return state.letzterStop !== null && (prompt === null || prompt === state.letzterStop.prompt);
}

function workingAgain(state: SitzungsZustand): SitzungsZustand {
  return working({ ...state, letzterStop: null });
}

function toolUsed(state: SitzungsZustand, event: Extract<Ereignis, { kind: "PreToolUse" }>, now: number): SitzungsZustand {
  const id = event.agent ?? MAIN_AGENT;
  if (arrivedLate(state, event.prompt)) {
    return withAgent(ensureAgent(state, id, event.typ, now), id, (agent) => ({ ...agent, aufrufe: agent.aufrufe + 1 }));
  }
  const known = ensureAgent(workingAgain(state), id, event.typ, now);
  return withAgent(known, id, (agent) => ({
    ...agent,
    stand: asking(known, id) ? "wartet" : "laeuft",
    werkzeug: event.werkzeug,
    aufrufe: agent.aufrufe + 1,
  }));
}

function subagentStarted(state: SitzungsZustand, event: Extract<Ereignis, { kind: "SubagentStart" }>, now: number): SitzungsZustand {
  const known = ensureAgent(arrivedLate(state, event.prompt) ? state : workingAgain(state), event.agent, event.typ, now);
  return withAgent(known, event.agent, (agent) => ({ ...agent, stand: asking(known, agent.id) ? "wartet" : "laeuft" }));
}

function questionAsked(state: SitzungsZustand, question: Frage, now: number): SitzungsZustand {
  if (state.wartet.some((entry) => entry.id === question.id)) return state;
  const known = ensureAgent(state, question.agent, null, now);
  const waiting: SitzungsZustand = { ...known, stand: "wartet", wartet: [...known.wartet, question] };
  return withAgent(waiting, question.agent, (agent) => ({ ...agent, stand: "wartet" }));
}

function questionAnswered(state: SitzungsZustand, id: string): SitzungsZustand {
  const question = state.wartet.find((entry) => entry.id === id);
  if (question === undefined) return state;
  const rest: SitzungsZustand = { ...state, wartet: state.wartet.filter((entry) => entry.id !== id) };
  const released = asking(rest, question.agent) ? rest : withAgent(rest, question.agent, (agent) => ({ ...agent, stand: "laeuft" }));
  return { ...released, stand: released.wartet.length > 0 ? "wartet" : "arbeitet" };
}

function compactionHint(tokens: number): Hinweis {
  return { art: "verdichten", anzeige: `Kontext bei ${TOKEN_FORMAT.format(tokens)} Tokens – Verdichten empfohlen` };
}

function stopped(state: SitzungsZustand, event: Extract<Ereignis, { kind: "Stop" }>, threshold: number): SitzungsZustand {
  const idle: SitzungsZustand = { ...resting(state), letzterStop: { prompt: event.prompt } };
  const tokens = idle.eingabeTokens;
  if (tokens === null || tokens < threshold || idle.schwelleUeberschritten) return idle;
  return { ...idle, schwelleUeberschritten: true, hinweise: [compactionHint(tokens)] };
}

function withoutCompactionHint(state: SitzungsZustand): SitzungsZustand {
  return { ...state, schwelleUeberschritten: false, hinweise: [] };
}

function compacted(state: SitzungsZustand): SitzungsZustand {
  return { ...withoutCompactionHint(state), eingabeTokens: null, kontextVeraltet: true };
}

function startsNewConversation(state: SitzungsZustand, event: Extract<Ereignis, { kind: "SessionStart" }>): boolean {
  if (state.claudeSitzung === null || state.claudeSitzung === event.sessionId || event.quelle === null) return false;
  return NEW_CONVERSATION_SOURCES.has(event.quelle);
}

function sessionStarted(state: SitzungsZustand, event: Extract<Ereignis, { kind: "SessionStart" }>): SitzungsZustand {
  const moved: SitzungsZustand = { ...state, claudeSitzung: event.sessionId };
  if (event.quelle === COMPACT_SOURCE) return withoutCompactionHint(moved);
  if (!startsNewConversation(state, event)) return moved;
  const mainOnly = moved.agenten.filter((agent) => agent.id === MAIN_AGENT);
  return { ...withoutCompactionHint(moved), agenten: mainOnly, eingabeTokens: null };
}

function statusLineSeen(
  state: SitzungsZustand,
  event: Extract<Ereignis, { kind: "Statuszeile" }>,
  threshold: number,
): SitzungsZustand {
  const modell = event.modell ?? state.modell;
  const { aufwand } = event;
  if (event.eingabeTokens === null) return { ...state, modell, aufwand, kontextVeraltet: true };
  return {
    ...state,
    modell,
    aufwand,
    kontextProzent: event.kontextProzent,
    kontextVeraltet: false,
    eingabeTokens: event.eingabeTokens,
    schwelleUeberschritten: state.schwelleUeberschritten && event.eingabeTokens >= threshold,
  };
}

function modelSwitched(state: SitzungsZustand, modell: string | undefined): SitzungsZustand {
  if (modell === undefined || state.modell === null || modell === state.modell) return state;
  return { ...state, kontextFenster: null, kontextProzent: null };
}

function chatDataSeen(current: SitzungsZustand, event: Extract<Ereignis, { kind: "Chatdaten" }>, threshold: number): SitzungsZustand {
  const state = modelSwitched(current, event.modell);
  const modell = event.modell ?? state.modell;
  const kontextFenster = event.kontextFenster ?? state.kontextFenster;
  const eingabeTokens = event.eingabeTokens ?? state.eingabeTokens;
  const kontextProzent = eingabeTokens !== null && kontextFenster !== null && kontextFenster > 0 ? (eingabeTokens / kontextFenster) * PERCENT : state.kontextProzent;
  const frisch = event.eingabeTokens !== undefined;
  return {
    ...state,
    modell,
    kontextFenster,
    eingabeTokens,
    kontextProzent,
    kontextVeraltet: frisch ? false : state.kontextVeraltet,
    schwelleUeberschritten: frisch ? state.schwelleUeberschritten && event.eingabeTokens >= threshold : state.schwelleUeberschritten,
  };
}

type OtherEvent = Extract<Ereignis, { kind: "Chatdaten" | "Aufwand" | "Nachricht" | "Antwort" }>;

function otherEvent(state: SitzungsZustand, event: OtherEvent, threshold: number): SitzungsZustand {
  switch (event.kind) {
    case "Chatdaten":
      return chatDataSeen(state, event, threshold);
    case "Aufwand":
      return state.aufwand === event.aufwand ? state : { ...state, aufwand: event.aufwand };
    case "Nachricht":
      return workingAgain(state);
    case "Antwort":
      return questionAnswered(state, event.frage);
  }
}

export function nextState(state: SitzungsZustand, event: Ereignis, environment: Umgebung): SitzungsZustand {
  switch (event.kind) {
    case "SessionStart":
      return sessionStarted(state, event);
    case "Ruecknahme":
      return { ...state, claudeSitzung: event.sessionId };
    case "SubagentStart":
      return subagentStarted(state, event, environment.jetzt);
    case "SubagentStop":
      return withAgent(state, event.agent, (agent) => ({ ...agent, stand: "fertig" }));
    case "PreToolUse":
      return toolUsed(state, event, environment.jetzt);
    case "PermissionRequest":
      return questionAsked(state, event.frage, environment.jetzt);
    case "Notification":
      return event.typ === IDLE_NOTIFICATION ? resting(state) : state;
    case "Stop":
      return stopped(state, event, environment.schwelleVerdichten);
    case "PostCompact":
      return compacted(state);
    case "Statuszeile":
      return statusLineSeen(state, event, environment.schwelleVerdichten);
    default:
      return otherEvent(state, event, environment.schwelleVerdichten);
  }
}

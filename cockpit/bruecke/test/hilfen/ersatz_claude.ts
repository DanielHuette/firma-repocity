import { writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const EXIT_WORD = "ende";
const EXIT_CODE = 3;
const MODEL = "ersatz-modell";
const CONTEXT_WINDOW = 200_000;
const SHOWN_VARIABLES = [
  "KOMMANDOZENTRALE_SITZUNG",
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "INIT_CWD",
  "npm_config_ersatz",
  "KOMMANDOZENTRALE_MELDEPORT",
  "KOMMANDOZENTRALE_GEHEIMNIS_DATEI",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
];
const COST_USD = 0.25;
const BRIDGE_BIN = path.resolve(import.meta.dirname, "..", "..", "node_modules", ".bin");
const resumeIndex = process.argv.indexOf("--resume");
const SESSION = resumeIndex === -1 ? process.env.ERSATZ_CLAUDE_SITZUNG : process.argv[resumeIndex + 1];

let message = 0;
let streaming: NodeJS.Timeout | null = null;
const waiting = new Map<string, (response: Record<string, unknown>) => void>();

function emit(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(SESSION === undefined ? value : { ...value, session_id: SESSION })}\n`);
}

function stream(event: Record<string, unknown>): void {
  emit({ type: "stream_event", event, parent_tool_use_id: null });
}

function assistant(id: string, content: unknown[], model = MODEL): void {
  emit({ type: "assistant", message: { id, model, role: "assistant", content }, parent_tool_use_id: null });
}

function result(isError = false, subtype = "success"): void {
  emit({ type: "result", subtype, is_error: isError, result: "", total_cost_usd: COST_USD, queued_turn_count: streaming === null ? 0 : 1, modelUsage: { [MODEL]: { contextWindow: CONTEXT_WINDOW } } });
}

function startMessage(): string {
  message += 1;
  const id = `msg_ersatz_${String(message)}`;
  stream({ type: "message_start", message: { id, model: MODEL, usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 * message } } });
  return id;
}

function answerText(text: string): void {
  emit({ type: "system", subtype: "init", model: MODEL, cwd: process.cwd() });
  const id = startMessage();
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ECHO " } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
  assistant(id, [{ type: "text", text: `ECHO ${text}` }]);
  stream({ type: "message_stop" });
  result();
}

function environment(): string {
  const searchPath = (process.env.PATH ?? "").split(path.delimiter).map((entry) => path.resolve(entry).toLowerCase());
  const lines = SHOWN_VARIABLES.map((name) => `ENV ${name}=${process.env[name] ?? "fehlt"}`);
  return [...lines, `BIN ${searchPath.includes(BRIDGE_BIN.toLowerCase()) ? "ja" : "nein"}`].join("\n");
}

function asked(tool: string, input: Record<string, unknown>, reply: (response: Record<string, unknown>) => string): void {
  const id = startMessage();
  const toolUse = `toolu_${tool}_${String(message)}`;
  assistant(id, [{ type: "tool_use", id: toolUse, name: tool, input }]);
  const request = `anfrage-${String(message)}`;
  waiting.set(request, (response) => {
    emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse, content: "beantwortet" }] }, parent_tool_use_id: null });
    assistant(startMessage(), [{ type: "text", text: reply(response) }]);
    result();
  });
  emit({ type: "control_request", request_id: request, request: { subtype: "can_use_tool", tool_name: tool, tool_use_id: toolUse, input } });
}

function longAnswer(): void {
  startMessage();
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  let count = 0;
  streaming = setInterval(() => {
    count += 1;
    stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${String(count)} ` } });
  }, 50);
}

function interrupted(requestId: string): void {
  emit({ type: "control_response", response: { subtype: "success", request_id: requestId, response: { still_queued: [] } } });
  if (streaming === null) return;
  clearInterval(streaming);
  streaming = null;
  emit({ type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] }, parent_tool_use_id: null });
  result(true, "error_during_execution");
}

function toolCall(): void {
  const id = startMessage();
  assistant(id, [{ type: "tool_use", id: "toolu_bash_1", name: "Bash", input: { command: "ls" } }]);
  emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_bash_1", content: "datei.txt" }] }, parent_tool_use_id: null });
  result();
}

const controls: unknown[] = [];
const MODELS = [{ value: "default", displayName: "Default" }, { value: "haiku", displayName: "Haiku" }];

function controlAnswer(request: Record<string, unknown>): Record<string, unknown> | string {
  switch (request.subtype) {
    case "initialize":
      return { models: MODELS, available_output_styles: ["default", "Explanatory"], commands: [] };
    case "list_models":
      return { models: MODELS };
    case "set_model":
      return request.model === "unbekannt" ? "Model 'unbekannt' not found" : { model: `aufgeloest-${String(request.model)}` };
    case "get_context_usage":
      return { totalTokens: 1_234, maxTokens: 100_000, percentage: 1, model: MODEL };
    default:
      return {};
  }
}

function control(requestId: string, request: Record<string, unknown>): void {
  controls.push(request);
  const answer = process.env.ERSATZ_STEUERUNG_SCHEITERT === request.subtype ? "abgelehnt" : controlAnswer(request);
  const response = typeof answer === "string" ? { subtype: "error", request_id: requestId, error: answer } : { subtype: "success", request_id: requestId, response: answer };
  emit({ type: "control_response", response });
}

function splitSecret(): void {
  const secret = process.env.ANTHROPIC_AUTH_TOKEN ?? "kein-schluessel";
  const id = startMessage();
  const half = Math.floor(secret.length / 2);
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `A ${secret.slice(0, half)}` } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${secret.slice(half)} B` } });
  process.stderr.write(`stderr ${secret}
`);
  assistant(id, [{ type: "text", text: `A ${secret} B` }]);
  result();
}

function splitSecretWithoutEnd(): void {
  const secret = process.env.ANTHROPIC_AUTH_TOKEN ?? "kein-schluessel";
  startMessage();
  const half = Math.floor(secret.length / 2);
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `C ${secret.slice(0, half)}` } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${secret.slice(half)} D` } });
  result();
}

function lateCard(): void {
  result();
  const id = startMessage();
  assistant(id, [{ type: "tool_use", id: "toolu_spaet", name: "AskUserQuestion", input: QUESTION }]);
  emit({ type: "control_request", request_id: "anfrage-spaet", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", tool_use_id: "toolu_spaet", input: QUESTION } });
}

function openAgent(): void {
  assistant(startMessage(), [{ type: "tool_use", id: "toolu_agent_offen", name: "Agent", input: { subagent_type: "Explore", description: "sucht" } }]);
  result();
}

const QUESTION = { questions: [{ question: "Rot oder Blau?", header: "Farbe", options: [{ label: "Rot", description: "" }, { label: "Blau", description: "" }], multiSelect: false }] };

function onMessage(text: string): void {
  if (text === EXIT_WORD) process.exit(EXIT_CODE);
  if (text === "!") assistant(startMessage(), [{ type: "text", text: environment() }]);
  else if (text === "frage") asked("AskUserQuestion", QUESTION, (response) => `ANTWORT ${JSON.stringify(response)}`);
  else if (text === "plan") asked("ExitPlanMode", { plan: "# Plan" }, (response) => `PLAN ${JSON.stringify(response)}`);
  else if (text === "fremdwerkzeug") asked("mcp__konto__anmelden", { url: "https://beispiel.de" }, (response) => `WERKZEUG ${JSON.stringify(response)}`);
  else if (text === "lang") longAnswer();
  else if (text === "werkzeug") toolCall();
  else if (text === "teile") splitSecret();
  else if (text === "teile_ohne_ende") splitSecretWithoutEnd();
  else if (text === "frage_spaet") lateCard();
  else if (text === "agent_offen") openAgent();
  else if (text === "steuerung?") {
    assistant(startMessage(), [{ type: "text", text: `STEUERUNG ${JSON.stringify(controls)}` }]);
    result();
  }
  else answerText(text);
}

function onLine(line: string): void {
  const value = JSON.parse(line) as Record<string, unknown>;
  if (value.type === "user") {
    const content = (value.message as { content: unknown }).content;
    onMessage(typeof content === "string" ? content : "");
    return;
  }
  const request = value.request as { subtype?: string } | undefined;
  if (value.type === "control_request" && request?.subtype === "interrupt") interrupted(String(value.request_id));
  else if (value.type === "control_request" && request !== undefined) control(String(value.request_id), request);
  if (value.type === "control_response") {
    const response = value.response as { request_id: string; response: Record<string, unknown> };
    waiting.get(response.request_id)?.(response.response);
    waiting.delete(response.request_id);
  }
}

if (process.argv.includes("--version")) {
  process.stdout.write(`9.9.9 (Ersatz)${String.fromCharCode(10)}`);
  process.exit(0);
}
const failOn = process.env.ERSATZ_SCHEITERT_BEI;
if (failOn !== undefined && process.argv.some((argument) => argument.includes(failOn))) process.exit(1);
const processFolder = process.env.ERSATZ_PROZESS_ORDNER;
if (processFolder !== undefined) writeFileSync(path.join(processFolder, String(process.pid)), "");
emit({ type: "system", subtype: "init", model: MODEL, cwd: process.cwd() });
assistant("msg_ersatz_start", [{ type: "text", text: `SITZUNG ${process.env.KOMMANDOZENTRALE_SITZUNG ?? "fehlt"}\nORDNER ${process.cwd()}\nARGUMENTE ${JSON.stringify(process.argv.slice(2))}` }], "<synthetic>");
createInterface({ input: process.stdin }).on("line", onLine).on("close", () => {
  process.exit(0);
});

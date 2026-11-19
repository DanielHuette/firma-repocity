import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReportInlet } from "../src/meldungen.ts";
import type { InletReport } from "../src/meldungen.ts";
import type { SessionInfo } from "../src/sitzungen.ts";

const REPORT_SCRIPT = fileURLToPath(new URL("../meldeskripte/melden.mjs", import.meta.url));
const STATUS_SCRIPT = fileURLToPath(new URL("../meldeskripte/statuszeile.mjs", import.meta.url));
const SECRET = "0a".repeat(32);
const ZENTRALE = "11111111-2222-4333-8444-555555555555";
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const ONE_SECOND = 1_000;
const SCRIPT_TEST_MS = 20_000;
const GOLD = "\u001b[38;2;201;169;110m";
const RESET = "\u001b[0m";
const SUGGESTIONS = [
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" },
];

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

let folder: string;
let secretFile: string;
let server: Server;
let port: number;
let inlet: ReportInlet;
let reports: InletReport[];
let stored: Pick<SessionInfo, "id" | "claudeSitzung" | "prozess">[];
let handler: (incoming: IncomingMessage, outgoing: ServerResponse) => void;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-meldeskripte-"));
  secretFile = path.join(folder, "geheimnis");
  await writeFile(secretFile, `${SECRET}\n`, { mode: 0o600 });
  reports = [];
  stored = [{ id: ZENTRALE, claudeSitzung: CLAUDE_ID, prozess: "laeuft" }];
  inlet = new ReportInlet({
    secret: SECRET,
    sessions: { list: () => stored, setClaudeSession: () => Promise.resolve() },
    onReport: (report) => reports.push(report),
    onError: () => undefined,
    newQuestionId: () => "frage-1",
  });
  handler = (incoming, outgoing) => {
    inlet.handle(incoming, outgoing);
  };
  server = createServer((incoming, outgoing) => {
    handler(incoming, outgoing);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => {
    resolve();
  }));
  await rm(folder, { recursive: true, force: true });
});

function bridgeEnvironment(sitzung: string | null = ZENTRALE): Record<string, string> {
  const environment: Record<string, string> = {
    KOMMANDOZENTRALE_MELDEPORT: String(port),
    KOMMANDOZENTRALE_GEHEIMNIS_DATEI: secretFile,
  };
  if (sitzung !== null) environment.KOMMANDOZENTRALE_SITZUNG = sitzung;
  return environment;
}

function cleanEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("KOMMANDOZENTRALE_")) environment[key] = value;
  }
  return environment;
}

function run(
  script: string,
  input: string,
  extra: Record<string, string>,
  nodeArguments: readonly string[] = [],
  scriptArguments: readonly string[] = [],
): Promise<Run> {
  const started = performance.now();
  const child = spawn(process.execPath, [...nodeArguments, script, ...scriptArguments], { env: { ...cleanEnvironment(), ...extra }, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, ms: performance.now() - started });
    });
  });
}

function startCost(): Promise<number> {
  const started = performance.now();
  const child = spawn(process.execPath, ["-e", ""], { windowsHide: true, stdio: "ignore" });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => {
      resolve(performance.now() - started);
    });
  });
}

function hookInput(name: string, rest: Record<string, unknown> = {}): string {
  return JSON.stringify({ session_id: CLAUDE_ID, hook_event_name: name, cwd: "/vault", ...rest });
}

function permissionInput(rest: Record<string, unknown> = {}): string {
  return hookInput("PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm test" }, ...rest });
}

function statusInput(percentage: number | null, model: unknown = { id: "claude-opus-5-5", display_name: "Opus" }): string {
  return JSON.stringify({ session_id: CLAUDE_ID, model, context_window: { used_percentage: percentage, current_usage: null } });
}

async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const free = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => {
    resolve();
  }));
  return free;
}

const SLOW_START_MS = 500;
const SLOW_START = [`--import=data:text/javascript,${encodeURIComponent(`const end = Date.now() + ${String(SLOW_START_MS)}; while (Date.now() < end);`)}`];

function hangForever(): void {
  handler = (incoming) => {
    incoming.resume();
  };
}

describe("melden.mjs", { timeout: SCRIPT_TEST_MS }, () => {
  it("waits for the answer to a PermissionRequest of the Kommandozentrale and prints the decision", async () => {
    const running = run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment());
    await expect.poll(() => inlet.openQuestions().length, { timeout: 5_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, ONE_SECOND + 200));
    expect(inlet.openQuestions()).toHaveLength(1);
    inlet.answer("frage-1", "ja");
    const result = await running;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  });

  it("prints deny for nein", async () => {
    const running = run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment());
    await expect.poll(() => inlet.openQuestions().length, { timeout: 5_000 }).toBe(1);
    inlet.answer("frage-1", "nein");
    expect(JSON.parse((await running).stdout)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "deny" } } });
  });

  it("prints updatedPermissions with exactly the rule that was shown for immer", async () => {
    const running = run(REPORT_SCRIPT, permissionInput({ permission_suggestions: SUGGESTIONS }), bridgeEnvironment());
    await expect.poll(() => inlet.openQuestions().length, { timeout: 5_000 }).toBe(1);
    const shown = reports.at(-1);
    if (shown?.kind !== "zentrale" || shown.ereignis?.kind !== "PermissionRequest") throw new Error("no question");
    inlet.answer("frage-1", "immer");
    expect(JSON.parse((await running).stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow", updatedPermissions: shown.ereignis.frage.regelBeiImmer },
      },
    });
    expect(shown.ereignis.frage.regelBeiImmer).toEqual(SUGGESTIONS);
  });

  it.each([
    ["PreToolUse", hookInput("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } })],
    ["SessionStart", hookInput("SessionStart", { source: "startup" })],
    ["SubagentStart", hookInput("SubagentStart", { agent_id: "a1", agent_type: "Explore" })],
    ["Stop", hookInput("Stop")],
  ])("reports %s without output and ends with 0", async (name, input) => {
    const result = await run(REPORT_SCRIPT, input, bridgeEnvironment(), [], ["--budget-ms", "2000"]);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(reports.at(-1)).toMatchObject({ kind: "zentrale", ereignisName: name });
  });

  it("never prints for PreToolUse, even when the bridge answers with a decision", async () => {
    handler = (incoming, outgoing) => {
      incoming.resume();
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }));
    };
    const result = await run(REPORT_SCRIPT, hookInput("PreToolUse", { tool_name: "Bash", tool_input: {} }), bridgeEnvironment());
    expect(result).toMatchObject({ code: 0, stdout: "" });
  });

  it("prints nothing for a PermissionRequest answer that is no PermissionRequest decision", async () => {
    handler = (incoming, outgoing) => {
      incoming.resume();
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }));
    };
    const result = await run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment());
    expect(result).toMatchObject({ code: 0, stdout: "" });
  });

  it("answers a PermissionRequest of a foreign session at once without output and reports it", async () => {
    const result = await run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment(null), [], ["--budget-ms", "2000"]);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
    expect(reports).toEqual([{ kind: "fremd", sitzung: null, ereignisName: "PermissionRequest" }]);
  });

  it("ends at once without port and secret, as in a session outside the Kommandozentrale", async () => {
    const result = await run(REPORT_SCRIPT, permissionInput(), {});
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
    expect(reports).toEqual([]);
  });

  it("ends within one second with 0 and without output when the bridge is not reachable", async () => {
    const result = await run(REPORT_SCRIPT, permissionInput(), { ...bridgeEnvironment(), KOMMANDOZENTRALE_MELDEPORT: String(await closedPort()) });
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it("ends within one second when the bridge accepts but never answers", async () => {
    hangForever();
    const result = await run(REPORT_SCRIPT, hookInput("PreToolUse", { tool_name: "Bash", tool_input: {} }), bridgeEnvironment());
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it("never waits for a PermissionRequest outside the Kommandozentrale, even when the bridge does not answer", async () => {
    hangForever();
    const result = await run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment(null));
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it.each([
    ["the secret file is missing", { KOMMANDOZENTRALE_GEHEIMNIS_DATEI: "fehlt" }],
    ["the port is no number", { KOMMANDOZENTRALE_MELDEPORT: "achtzig" }],
    ["the port is 0", { KOMMANDOZENTRALE_MELDEPORT: "0" }],
    ["the port is too large", { KOMMANDOZENTRALE_MELDEPORT: "65536" }],
  ])("ends with 0 without output when %s", async (_case, change) => {
    const result = await run(REPORT_SCRIPT, permissionInput(), { ...bridgeEnvironment(), ...change });
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
    expect(reports).toEqual([]);
  });

  it("ends with 0 without output when the secret is wrong and the bridge rejects it", async () => {
    await writeFile(secretFile, "0b".repeat(32));
    const result = await run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment());
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(reports).toEqual([]);
  });

  it("ends with 0 without output for input that is not JSON", async () => {
    const result = await run(REPORT_SCRIPT, "{kaputt", bridgeEnvironment());
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(reports).toEqual([]);
  });
});

describe("time limit counted from the start of the process, as under load", { timeout: SCRIPT_TEST_MS }, () => {
  it("melden.mjs ends within one second after a slow start when the bridge never answers", async () => {
    hangForever();
    const result = await run(REPORT_SCRIPT, hookInput("PreToolUse", { tool_name: "Bash", tool_input: {} }), bridgeEnvironment(), SLOW_START);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms).toBeGreaterThan(SLOW_START_MS);
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it("statuszeile.mjs prints the full line from stdin within one second after a slow start when the bridge never answers", async () => {
    hangForever();
    const result = await run(STATUS_SCRIPT, statusInput(7), bridgeEnvironment(), SLOW_START);
    expect(result).toMatchObject({ code: 0, stdout: `${GOLD}Opus · Kontext 7 %${RESET}
` });
    expect(result.ms).toBeGreaterThan(SLOW_START_MS);
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it("melden.mjs still waits for a question of the Kommandozentrale after a slow start", async () => {
    const running = run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment(), SLOW_START);
    await expect.poll(() => inlet.openQuestions().length, { timeout: 5_000 }).toBe(1);
    inlet.answer("frage-1", "ja");
    expect(JSON.parse((await running).stdout)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "allow" } } });
  });
});

describe("longer budget for hooks that run in the background", { timeout: SCRIPT_TEST_MS }, () => {
  it("waits up to the budget given with --budget-ms 2000 when the bridge never answers", async () => {
    hangForever();
    const result = await run(REPORT_SCRIPT, hookInput("PreToolUse", { tool_name: "Bash", tool_input: {} }), bridgeEnvironment(), [], ["--budget-ms", "2000"]);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms).toBeGreaterThan(1_500);
    expect(result.ms).toBeLessThan(2_500);
  });

  it("reports with the longer budget when the bridge answers", async () => {
    const result = await run(REPORT_SCRIPT, hookInput("Stop"), bridgeEnvironment(), [], ["--budget-ms", "2000"]);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(reports.at(-1)).toMatchObject({ kind: "zentrale", ereignisName: "Stop" });
  });

  it.each([["2001"], ["0"], ["zwei"], [""], ["1.5"]])("keeps the short budget for --budget-ms %j", async (value) => {
    hangForever();
    const result = await run(REPORT_SCRIPT, hookInput("PreToolUse", { tool_name: "Bash", tool_input: {} }), bridgeEnvironment(), [], ["--budget-ms", value]);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it("still waits for a question of the Kommandozentrale with --budget-ms", async () => {
    const running = run(REPORT_SCRIPT, permissionInput(), bridgeEnvironment(), [], ["--budget-ms", "2000"]);
    await expect.poll(() => inlet.openQuestions().length, { timeout: 5_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(inlet.openQuestions()).toHaveLength(1);
    inlet.answer("frage-1", "ja");
    expect(JSON.parse((await running).stdout)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "allow" } } });
  });
});

describe("statuszeile.mjs", { timeout: SCRIPT_TEST_MS }, () => {
  it("prints one gold line with model and context and reports the data", async () => {
    const result = await run(STATUS_SCRIPT, statusInput(42.4), bridgeEnvironment(), [], ["--budget-ms", "2000"]);
    expect(result).toMatchObject({ code: 0, stdout: `${GOLD}Opus · Kontext 42 %${RESET}\n` });
    expect(reports).toEqual([
      {
        kind: "zentrale",
        sitzung: ZENTRALE,
        ereignisName: "Statuszeile",
        ereignis: { kind: "Statuszeile", modell: "Opus", kontextProzent: 42.4, eingabeTokens: null, aufwand: null },
        aufwand: null,
      },
    ]);
  });

  it("waits up to the budget given with --budget-ms 2000 when the bridge never answers", async () => {
    hangForever();
    const result = await run(STATUS_SCRIPT, statusInput(7), bridgeEnvironment(), [], ["--budget-ms", "2000"]);
    expect(result).toMatchObject({ code: 0, stdout: `${GOLD}Opus · Kontext 7 %${RESET}\n` });
    expect(result.ms).toBeGreaterThan(1_500);
  });

  it("prints the line without a bridge", async () => {
    const result = await run(STATUS_SCRIPT, statusInput(7), {});
    expect(result).toMatchObject({ code: 0, stdout: `${GOLD}Opus · Kontext 7 %${RESET}\n` });
  });

  it("prints the line within one second when the bridge is not reachable", async () => {
    const result = await run(STATUS_SCRIPT, statusInput(7), { ...bridgeEnvironment(), KOMMANDOZENTRALE_MELDEPORT: String(await closedPort()) });
    expect(result).toMatchObject({ code: 0, stdout: `${GOLD}Opus · Kontext 7 %${RESET}\n` });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it("prints the line within one second when the bridge never answers", async () => {
    hangForever();
    const result = await run(STATUS_SCRIPT, statusInput(7), bridgeEnvironment());
    expect(result).toMatchObject({ code: 0, stdout: `${GOLD}Opus · Kontext 7 %${RESET}\n` });
    expect(result.ms - (await startCost())).toBeLessThan(ONE_SECOND);
  });

  it("says keine Daten instead of a number when the percentage is null", async () => {
    const result = await run(STATUS_SCRIPT, statusInput(null), {});
    expect(result.stdout).toBe(`${GOLD}Opus · Kontext keine Daten${RESET}\n`);
  });

  it("strips C1 control characters and DEL from the name", async () => {
    const tricky = { display_name: "O\u009b31mp\u007fus\u0085" };
    expect((await run(STATUS_SCRIPT, statusInput(3, tricky), {})).stdout).toBe(`${GOLD}O31mpus · Kontext 3 %${RESET}\n`);
  });

  it("says Modell unbekannt when the model is missing and strips control characters from the name", async () => {
    expect((await run(STATUS_SCRIPT, statusInput(3, null), {})).stdout).toBe(`${GOLD}Modell unbekannt · Kontext 3 %${RESET}\n`);
    const tricky = { display_name: "Op\u001b[31mus\u0007" };
    expect((await run(STATUS_SCRIPT, statusInput(3, tricky), {})).stdout).toBe(`${GOLD}Op[31mus · Kontext 3 %${RESET}\n`);
  });

  it("prints a line for input that is not JSON", async () => {
    const result = await run(STATUS_SCRIPT, "{kaputt", {});
    expect(result).toMatchObject({ code: 0, stdout: `${GOLD}Modell unbekannt · Kontext keine Daten${RESET}\n` });
  });
});

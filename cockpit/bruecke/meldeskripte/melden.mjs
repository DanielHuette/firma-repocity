import { readFile } from "node:fs/promises";
import { request } from "node:http";

export const DEFAULT_BUDGET_MS = 300;
const LONGEST_BUDGET_MS = 2_000;
const BUDGET_OPTION = "--budget-ms";
const BUDGET_FORMAT = /^[1-9]\d{0,3}$/;
const SESSION_VARIABLE = "KOMMANDOZENTRALE_SITZUNG";
const PORT_VARIABLE = "KOMMANDOZENTRALE_MELDEPORT";
const SECRET_FILE_VARIABLE = "KOMMANDOZENTRALE_GEHEIMNIS_DATEI";
const SECRET_HEADER = "x-kommandozentrale-geheimnis";
const REPORT_PATH = "/melden";
const BRIDGE_HOST = "127.0.0.1";
const PORT_FORMAT = /^[1-9]\d{0,4}$/;
const HIGHEST_PORT = 65_535;
const SECRET_FORMAT = /^[0-9a-f]{64}$/;
const LONGEST_ANSWER = 64 * 1024;
const PERMISSION_REQUEST = "PermissionRequest";
const ANSWERED = 200;

export function bridgeTarget(environment) {
  const port = environment[PORT_VARIABLE] ?? "";
  const secretFile = environment[SECRET_FILE_VARIABLE] ?? "";
  if (!PORT_FORMAT.test(port) || Number(port) > HIGHEST_PORT || secretFile === "") return undefined;
  const session = environment[SESSION_VARIABLE];
  return { port: Number(port), secretFile, session: session === undefined || session === "" ? null : session };
}

export function budgetFrom(argumentList) {
  const index = argumentList.indexOf(BUDGET_OPTION);
  const value = index === -1 ? undefined : argumentList[index + 1];
  if (value === undefined || !BUDGET_FORMAT.test(value) || Number(value) > LONGEST_BUDGET_MS) return DEFAULT_BUDGET_MS;
  return Number(value);
}

export function deadlineFromProcessStart(budget = DEFAULT_BUDGET_MS) {
  return AbortSignal.timeout(Math.max(0, Math.floor(budget - performance.now())));
}

export function readInput() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(undefined));
  });
}

export function parseObject(text) {
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readSecret(file, signal) {
  try {
    const secret = (await readFile(file, { encoding: "utf8", signal })).trim();
    return SECRET_FORMAT.test(secret) ? secret : undefined;
  } catch {
    return undefined;
  }
}

function post(target, secret, body, signal) {
  return new Promise((resolve) => {
    const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body), [SECRET_HEADER]: secret };
    const options = { host: BRIDGE_HOST, port: target.port, path: REPORT_PATH, method: "POST", headers };
    const outgoing = request(signal === undefined ? options : { ...options, signal }, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => {
        if (text.length < LONGEST_ANSWER) text += chunk;
      });
      incoming.on("end", () => resolve({ status: incoming.statusCode, text }));
      incoming.on("error", () => resolve(undefined));
    });
    outgoing.on("error", () => resolve(undefined));
    outgoing.end(body);
  });
}

export async function sendToBridge(target, art, daten, signal) {
  const secret = await readSecret(target.secretFile, signal);
  if (secret === undefined) return undefined;
  return post(target, secret, JSON.stringify({ sitzung: target.session, art, daten }), signal);
}

function permissionDecision(answer) {
  if (answer?.status !== ANSWERED) return undefined;
  const parsed = parseObject(answer.text);
  const output = parsed?.hookSpecificOutput;
  const behavior = output?.decision?.behavior;
  if (output?.hookEventName !== PERMISSION_REQUEST || (behavior !== "allow" && behavior !== "deny")) return undefined;
  return parsed;
}

async function main() {
  const target = bridgeTarget(process.env);
  if (target === undefined) return;
  const input = parseObject(await readInput());
  if (input === undefined) return;
  const asks = input.hook_event_name === PERMISSION_REQUEST;
  const waits = asks && target.session !== null;
  const answer = await sendToBridge(target, "hook", input, waits ? undefined : deadlineFromProcessStart(budgetFrom(process.argv.slice(2))));
  const decision = asks ? permissionDecision(answer) : undefined;
  if (decision !== undefined) process.stdout.write(`${JSON.stringify(decision)}\n`);
}

if (import.meta.main) {
  await main();
}

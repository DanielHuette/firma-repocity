import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Settings } from "../src/einstellungen.ts";
import { REPORT_PATH, SECRET_HEADER } from "../src/meldungen.ts";
import type { ServerMessage } from "../src/nachrichten.ts";
import { LOG_FILE, openLog } from "../src/protokoll.ts";
import type { Log } from "../src/protokoll.ts";
import { MAX_MESSAGE_BYTES, startBridge } from "../src/server.ts";
import type { Bridge, BridgeParts } from "../src/server.ts";

const STAND_IN = fileURLToPath(new URL("hilfen/ersatz_claude.ts", import.meta.url));
const SECRET = "0a".repeat(32);
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const INDEX = "<!doctype html><title>Cockpit</title>";
const PC = "geraet-pc-0000000001";
const HANDY = "geraet-handy-000000002";
const MIA = "geraet-mia-0000000003";
const ASSISTANT_SECRET = "b".repeat(64);
const QUIET_MS = 400;
const BRIDGE_TEST_MS = 60_000;
const VERSION = "9.9.9 (Test)";

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

interface Send {
  method?: string;
  path?: string;
  headers?: OutgoingHttpHeaders;
  body?: string;
  chunked?: boolean;
  port?: number;
  host?: string;
}

interface Client {
  socket: WebSocket;
  messages: ServerMessage[];
  closed: Promise<{ code: number; reason: string }>;
}

let root: string;
let settings: Settings;
let origin: string;
const HOOK_TIMEOUT_MS = 30_000;
let log: Log;
let bridge: Bridge | undefined;
let clients: Client[];

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => {
    resolve();
  }));
  return port;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "bruecke-server-")));
  const vault = path.join(root, "vault");
  const dist = path.join(root, "dist");
  for (const folder of [vault, dist, path.join(root, "konfig")]) await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dist, "index.html"), INDEX);
  const portOberflaeche = await freePort();
  const portMeldeeingang = await freePort();
  origin = `http://127.0.0.1:${String(portOberflaeche)}`;
  settings = {
    portOberflaeche,
    portMeldeeingang,
    vault,
    erlaubteOrdner: [vault],
    claudeBefehl: [process.execPath, STAND_IN],
    datenordner: path.join(root, "daten"),
    geheimnis: path.join(root, "konfig", "geheimnis"),
    assistenzGeheimnis: path.join(root, "konfig", "assistenz_geheimnis"),
    erlaubteHerkunft: origin,
    schwelleVerdichten: 200_000,
    claudeMem: `http://127.0.0.1:${String(await freePort())}`,
    oberflaeche: dist,
    qmdBefehl: ["gibt-es-nicht-qmd"],
    openrouterSchluessel: null,
  };
  clients = [];
  log = await openLog(settings.datenordner);
  await mkdir(path.join(root, "claude", "skills", "test-skill"), { recursive: true });
  await writeFile(path.join(root, "claude", "skills", "test-skill", "SKILL.md"), "---\nname: test-skill\n---\n");
  await writeFile(path.join(vault, "notiz.md"), "Zeile eins\nDie Kommandozentrale sucht hier\n");
  bridge = await startBridge({ settings, secret: SECRET, assistantSecret: ASSISTANT_SECRET, log, ...extraParts() });
}, HOOK_TIMEOUT_MS);

afterEach(async () => {
  for (const client of clients) client.socket.terminate();
  await bridge?.close();
  bridge = undefined;
  await log.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}, HOOK_TIMEOUT_MS);

function extraParts(): Pick<BridgeParts, "claudeOrdner" | "claudeVersion"> {
  return { claudeOrdner: path.join(root, "claude"), claudeVersion: () => Promise.resolve(VERSION) };
}

function send(options: Send = {}): Promise<Reply> {
  const port = options.port ?? settings.portOberflaeche;
  const headers = { host: `127.0.0.1:${String(port)}`, ...options.headers };
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: options.host ?? "127.0.0.1", port, path: options.path ?? "/", method: options.method ?? "GET", headers },
      (incoming) => {
        let text = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (text += chunk));
        incoming.on("end", () => {
          resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text });
        });
      },
    );
    outgoing.on("error", reject);
    if (options.chunked === true) outgoing.write(options.body ?? "");
    outgoing.end(options.chunked === true ? undefined : options.body);
  });
}

function post(route: string, body: unknown, headers: OutgoingHttpHeaders = {}): Promise<Reply> {
  return send({
    method: "POST",
    path: route,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin, "content-type": "application/json", ...headers },
  });
}

function connect(options: { origin?: string | null; host?: string; route?: string } = {}): Promise<Client> {
  const headers: OutgoingHttpHeaders = {};
  if (options.host !== undefined) headers.host = options.host;
  const chosen = options.origin === undefined ? origin : options.origin;
  const socket = new WebSocket(`ws://127.0.0.1:${String(settings.portOberflaeche)}${options.route ?? "/ws"}`, {
    headers,
    ...(chosen === null ? {} : { origin: chosen }),
  });
  const messages: ServerMessage[] = [];
  socket.on("message", (data) => {
    if (Buffer.isBuffer(data)) messages.push(JSON.parse(data.toString("utf8")) as ServerMessage);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
  return new Promise((resolve, reject) => {
    socket.on("open", () => {
      const client = { socket, messages, closed };
      clients.push(client);
      resolve(client);
    });
    socket.on("unexpected-response", (_request, response) => {
      reject(new Error(`refused with ${String(response.statusCode)}`));
    });
    socket.on("error", reject);
  });
}

async function device(id: string, modus: "arbeiten" | "zusehen" = "arbeiten"): Promise<Client> {
  const client = await connect();
  client.socket.send(JSON.stringify({ typ: "hallo", geraet: id, name: id === PC ? "PC" : "Handy", modus }));
  await expect.poll(() => lastState(client)).toBeDefined();
  return client;
}

function lastState(client: Client): Extract<ServerMessage, { typ: "zustand" }> | undefined {
  return client.messages.findLast((message) => message.typ === "zustand");
}

function output(client: Client, session: string): string {
  const texts = new Map<string, string>();
  for (const message of client.messages) {
    if (message.typ === "chat" && message.sitzung === session) for (const eintrag of message.eintraege) texts.set(eintrag.id, eintrag.text ?? "");
    if ((message.typ === "chat_neu" || message.typ === "chat_aktualisiert") && message.sitzung === session) texts.set(message.eintrag.id, message.eintrag.text ?? "");
    if (message.typ === "chat_teil" && message.sitzung === session) texts.set(message.id, `${texts.get(message.id) ?? ""}${message.text}`);
  }
  return [...texts.values()].join("\n");
}

function say(client: Client, sitzung: string, text: string): void {
  sendJson(client, { typ: "nachricht", sitzung, text });
}

function sendJson(client: Client, message: unknown): void {
  client.socket.send(JSON.stringify(message));
}

async function newSession(controller: Client): Promise<string> {
  sendJson(controller, { typ: "neu" });
  await expect.poll(() => lastState(controller)?.sitzungen.length, { timeout: 10_000 }).toBe(1);
  const id = lastState(controller)?.sitzungen[0]?.id ?? "";
  await expect.poll(() => output(controller, id), { timeout: 10_000 }).toContain("ARGUMENTE");
  return id;
}

async function quiet(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
}

function report(sitzung: string, daten: Record<string, unknown>): Promise<Reply> {
  return send({
    method: "POST",
    port: settings.portMeldeeingang,
    path: REPORT_PATH,
    body: JSON.stringify({ sitzung, art: "hook", daten }),
    headers: { "content-type": "application/json", [SECRET_HEADER]: SECRET },
  });
}

function otherAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

async function refusal(address: string, port: number): Promise<string> {
  return send({ host: address, port }).then(
    () => "answered",
    (error: unknown) => (error instanceof Error && "code" in error ? String(error.code) : "other error"),
  );
}

describe("listening", { timeout: BRIDGE_TEST_MS }, () => {
  it("answers on 127.0.0.1 and refuses ::1 and every other address of the machine, for both ports", async () => {
    expect((await send()).status).toBe(200);
    for (const port of [settings.portOberflaeche, settings.portMeldeeingang]) {
      expect(await refusal("::1", port)).not.toBe("answered");
      for (const address of otherAddresses()) expect(await refusal(address, port)).not.toBe("answered");
    }
  });
});

describe("Host check against DNS rebinding", { timeout: BRIDGE_TEST_MS }, () => {
  it.each(["evil.example", "localhost:PORT", "127.0.0.1", "127.0.0.1:1"])("rejects the Host %s with 403 for pages and API", async (host) => {
    const value = host.replace("PORT", String(settings.portOberflaeche));
    expect((await send({ headers: { host: value } })).status).toBe(403);
    expect((await post("/", {}, { host: value })).status).toBe(403);
    expect((await send({ path: "/status", headers: { host: value } })).status).toBe(403);
  });

  it("rejects a WebSocket with a foreign Host", async () => {
    await expect(connect({ host: "evil.example" })).rejects.toThrow("403");
  });

  it("rejects a foreign Host at the report inlet", async () => {
    const reply = await send({
      method: "POST",
      port: settings.portMeldeeingang,
      path: REPORT_PATH,
      body: "{}",
      headers: { host: "evil.example", "content-type": "application/json", [SECRET_HEADER]: SECRET },
    });
    expect(reply.status).toBe(403);
  });
});

describe("POST", { timeout: BRIDGE_TEST_MS }, () => {
  it.each([
    ["a foreign origin", { origin: "http://evil.example" }, 403],
    ["the origin of the report inlet", { origin: "http://127.0.0.1:1" }, 403],
    ["the allowed origin", {}, 404],
  ])("answers a POST from %s with its status, because the bridge has no POST route", async (_case, headers, status) => {
    expect((await post("/anmelden", {}, headers)).status).toBe(status);
  });

  it("rejects a POST without origin with 403", async () => {
    expect((await send({ method: "POST", path: "/anmelden", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(403);
  });
});

describe("no CORS", { timeout: BRIDGE_TEST_MS }, () => {
  it("sends no access-control header, not even for a preflight from a foreign origin", async () => {
    const preflight = await send({
      method: "OPTIONS",
      path: "/status",
      headers: { origin: "http://evil.example", "access-control-request-method": "GET" },
    });
    const page = await send({ headers: { origin: "http://evil.example" } });
    for (const reply of [preflight, page, await send({ path: "/status" })]) {
      expect(Object.keys(reply.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
    }
    expect(preflight.status).toBe(405);
  });
});

describe("GET /status", { timeout: BRIDGE_TEST_MS }, () => {
  it("says the bridge is ready, without any login, and is not stored", async () => {
    const reply = await send({ path: "/status" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ bereit: true });
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.headers["set-cookie"]).toBeUndefined();
  });

  it("answers the allowed origin and rejects a foreign origin with 403", async () => {
    expect((await send({ path: "/status", headers: { origin } })).status).toBe(200);
    expect((await send({ path: "/status", headers: { origin: "http://evil.example" } })).status).toBe(403);
  });

  it("changes nothing on POST", async () => {
    expect((await post("/status", {})).status).toBe(404);
  });
});

describe("WebSocket admission", { timeout: BRIDGE_TEST_MS }, () => {
  it("accepts a WebSocket of the allowed origin without any cookie", async () => {
    const client = await connect();
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it.each([
    ["from a foreign origin", { origin: "http://evil.example" }, "403"],
    ["from the origin of the report inlet", { origin: "http://127.0.0.1:1" }, "403"],
    ["without origin", { origin: null }, "403"],
    ["on another path", { route: "/anderes" }, "404"],
  ])("refuses a WebSocket %s", async (_case, options, status) => {
    await expect(connect(options)).rejects.toThrow(status);
  });

  it("answers a plain GET on /ws with 426", async () => {
    expect((await send({ path: "/ws" })).status).toBe(426);
  });
});

describe("messages", { timeout: BRIDGE_TEST_MS }, () => {
  it("sends the state after hallo, with the new device in control", async () => {
    const pc = await device(PC);
    expect(lastState(pc)).toEqual({ typ: "zustand", sitzungen: [], steuert: { name: "PC", du: true } });
  });

  it.each([
    ["another message before hallo", { typ: "uebernehmen" }],
    ["a hallo with a short device id", { typ: "hallo", geraet: "kurz", name: "PC", modus: "arbeiten" }],
    ["no JSON", "{kaputt"],
  ])("closes the connection for %s", async (_case, message) => {
    const client = await connect();
    client.socket.send(typeof message === "string" ? message : JSON.stringify(message));
    expect((await client.closed).code).toBe(1008);
  });

  it("drops unknown and binary messages after hallo and stays open", async () => {
    const pc = await device(PC);
    sendJson(pc, { typ: "loeschen", alles: true });
    sendJson(pc, { typ: "uebernehmen", geraet: PC });
    pc.socket.send(Buffer.from([1, 2, 3]));
    await quiet();
    expect(pc.socket.readyState).toBe(WebSocket.OPEN);
    await newSession(pc);
  });

  it("closes the connection for a message above the limit", async () => {
    const pc = await device(PC);
    sendJson(pc, { typ: "nachricht", sitzung: "x", text: "x".repeat(MAX_MESSAGE_BYTES) });
    expect((await pc.closed).code).toBe(1009);
  });

  it("accepts a message of 100000 characters", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    say(pc, session, "ä".repeat(100_000));
    await expect.poll(() => output(pc, session), { timeout: 20_000 }).toContain(`ECHO ${"ä".repeat(100_000)}`);
  });
});

describe("control by one device", { timeout: BRIDGE_TEST_MS }, () => {
  it("rejects messages of a watching device and accepts them after uebernehmen, and the other way round", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY);
    const session = await newSession(pc);
    say(handy, session, "vom handy");
    await expect.poll(() => errors(handy)).toEqual(["Dieses Gerät steuert nicht; erst übernehmen."]);
    expect(output(pc, session)).not.toContain("vom handy");
    sendJson(handy, { typ: "uebernehmen" });
    await expect.poll(() => lastState(pc)?.steuert).toEqual({ name: "Handy", du: false });
    expect(lastState(handy)?.steuert).toEqual({ name: "Handy", du: true });
    say(handy, session, "jetzt handy");
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("ECHO jetzt handy");
    say(pc, session, "vom pc");
    await quiet();
    expect(output(handy, session)).not.toContain("vom pc");
  });

  it("lets only the controlling device start, end, interrupt and answer cards", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY);
    sendJson(handy, { typ: "neu" });
    await quiet();
    expect(lastState(pc)?.sitzungen).toEqual([]);
    const session = await newSession(pc);
    for (const message of [
      { typ: "beenden", sitzung: session },
      { typ: "abbrechen", sitzung: session },
      { typ: "frage_antwort", sitzung: session, eintrag: "toolu_x", antworten: {} },
      { typ: "plan_antwort", sitzung: session, eintrag: "toolu_x", entscheidung: "ja" },
    ]) sendJson(handy, message);
    await expect.poll(() => errors(handy).length).toBe(5);
    expect(lastState(pc)?.sitzungen).toHaveLength(1);
    sendJson(pc, { typ: "beenden", sitzung: session });
    await expect.poll(() => lastState(handy)?.sitzungen).toEqual([]);
  });

  it("sends the chat so far to a device that connects later", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    say(pc, session, "vorher");
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("ECHO vorher");
    const handy = await device(HANDY);
    const history = handy.messages.find((message) => message.typ === "chat");
    expect(history).toMatchObject({ typ: "chat", sitzung: session });
    const texts = history?.typ === "chat" ? history.eintraege.map((eintrag) => eintrag.text) : [];
    expect(texts).toEqual(expect.arrayContaining(["vorher", "ECHO vorher"]));
    expect(texts.join("\n")).toContain(`SITZUNG ${session}`);
  });

  it("shows a session as working after a message and model and context from the chat stream", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    expect(lastState(pc)?.sitzungen[0]).toMatchObject({ id: session, stand: "ruht", titel: "vault" });
    say(pc, session, "los");
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.stand).toBe("arbeitet");
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.kontextProzent, { timeout: 10_000 }).toBe(1.234);
    expect(lastState(pc)?.sitzungen[0]).toMatchObject({ modell: "ersatz-modell", eingabeTokens: 1_234 });
  });

  it("answers a question card and a plan card of the controlling device", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    say(pc, session, "frage");
    await expect.poll(() => pc.messages.some((message) => message.typ === "chat_neu" && message.eintrag.art === "frage"), { timeout: 10_000 }).toBe(true);
    const card = pc.messages.flatMap((message) => (message.typ === "chat_neu" && message.eintrag.art === "frage" ? [message.eintrag.id] : []))[0] ?? "";
    sendJson(pc, { typ: "frage_antwort", sitzung: session, eintrag: card, antworten: { "Rot oder Blau?": "Blau" } });
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain('"answers":{"Rot oder Blau?":"Blau"}');
    const answered = pc.messages.findLast((message) => message.typ === "chat_aktualisiert" && message.eintrag.id === card);
    expect(answered?.typ === "chat_aktualisiert" ? answered.eintrag.frage?.beantwortet : undefined).toEqual({ "Rot oder Blau?": "Blau" });
    sendJson(pc, { typ: "frage_antwort", sitzung: session, eintrag: card, antworten: { "Rot oder Blau?": "Rot" } });
    await expect.poll(() => errors(pc)).toEqual(["Diese Frage ist schon beantwortet oder nicht mehr offen."]);
  });

  it("interrupts a running answer for the controlling device", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    say(pc, session, "lang");
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("3 ");
    sendJson(pc, { typ: "abbrechen", sitzung: session });
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("Abgebrochen.");
  });
});

describe("permission questions", { timeout: BRIDGE_TEST_MS }, () => {
  it("ends an open question without decision when the process of its session ends", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    await report(session, { session_id: CLAUDE_ID, hook_event_name: "SessionStart", source: "startup" });
    const held = report(session, { session_id: CLAUDE_ID, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" } });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.wartet.length).toBe(1);
    say(pc, session, "ende");
    expect(await held).toMatchObject({ status: 204, body: "" });
    await expect.poll(() => lastState(pc)?.sitzungen[0]).toMatchObject({ prozess: "beendet", wartet: [] });
  });

  it("leaves the permission request of a question to the card in the chat", async () => {
    const pc = await device(PC);
    const session = await boundSession(pc);
    const asked = await report(session, {
      session_id: CLAUDE_ID,
      hook_event_name: "PermissionRequest",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Welche Farbe?", header: "Farbe", options: [], multiSelect: false }] },
    });
    expect(asked).toMatchObject({ status: 204, body: "" });
    await quiet();
    expect(lastState(pc)?.sitzungen[0]?.wartet).toEqual([]);
    expect(lastState(pc)?.sitzungen[0]?.hinweise).toEqual([]);
    expect(Object.keys(lastState(pc)?.sitzungen[0] ?? {})).not.toContain("letzterStop");
    expect(Object.keys(lastState(pc)?.sitzungen[0] ?? {})).not.toContain("kontextFenster");
  });


  it("shows a question of a session and passes the answer of the controlling device to the waiting hook", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY);
    const session = await newSession(pc);
    expect((await report(session, { session_id: CLAUDE_ID, hook_event_name: "SessionStart", source: "startup" })).status).toBe(204);
    const held = report(session, {
      session_id: CLAUDE_ID,
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.wartet.length).toBe(1);
    const question = lastState(pc)?.sitzungen[0]?.wartet[0]?.id ?? "";
    sendJson(handy, { typ: "antwort", frage: question, entscheidung: "nein" });
    await quiet();
    expect(lastState(pc)?.sitzungen[0]?.wartet).toHaveLength(1);
    sendJson(pc, { typ: "antwort", frage: question, entscheidung: "ja" });
    const answer = await held;
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.wartet).toEqual([]);
  });
});

async function mia(geheimnis = ASSISTANT_SECRET): Promise<Client> {
  const client = await connect();
  sendJson(client, { typ: "hallo_assistenz", geraet: MIA, name: "Mia", geheimnis });
  return client;
}

function results(client: Client): Extract<ServerMessage, { typ: "antwort_ergebnis" }>[] {
  return client.messages.filter((message) => message.typ === "antwort_ergebnis");
}

async function waitingQuestion(pc: Client): Promise<{ session: string; question: string; held: Promise<Reply> }> {
  const session = await newSession(pc);
  expect((await report(session, { session_id: CLAUDE_ID, hook_event_name: "SessionStart", source: "startup" })).status).toBe(204);
  const held = report(session, { session_id: CLAUDE_ID, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" } });
  await expect.poll(() => lastState(pc)?.sitzungen[0]?.wartet.length).toBe(1);
  return { session, question: lastState(pc)?.sitzungen[0]?.wartet[0]?.id ?? "", held };
}

describe("the assistant Mia as sender of answers", { timeout: BRIDGE_TEST_MS }, () => {
  it("connects with its own secret, gets the state and leaves the control with the controlling device", async () => {
    const pc = await device(PC);
    const assistant = await mia();
    await expect.poll(() => lastState(assistant)).toBeDefined();
    expect(lastState(assistant)?.steuert).toEqual({ name: "PC", du: false });
    sendJson(assistant, { typ: "uebernehmen" });
    await quiet();
    expect(lastState(pc)?.steuert).toEqual({ name: "PC", du: true });
  });

  it("never takes the control, even when no device controls", async () => {
    const assistant = await mia();
    await expect.poll(() => lastState(assistant)).toBeDefined();
    expect(lastState(assistant)?.steuert).toBeNull();
  });

  it.each([["a wrong secret", "c".repeat(64)], ["the secret of the report inlet", SECRET]])("refuses %s", async (_case, geheimnis) => {
    const assistant = await mia(geheimnis);
    expect(await assistant.closed).toEqual({ code: 1008, reason: "Geheimnis der Assistenz passt nicht" });
  });

  it.each([
    ["ja", { behavior: "allow" }],
    ["nein", { behavior: "deny" }],
  ] as const)("passes %s to the waiting hook, confirms it to Mia and shows it on the page", async (entscheidung, decision) => {
    const pc = await device(PC);
    const { session, question, held } = await waitingQuestion(pc);
    const assistant = await mia();
    await expect.poll(() => lastState(assistant)?.sitzungen[0]?.wartet[0]?.id).toBe(question);
    sendJson(assistant, { typ: "antwort", frage: question, entscheidung });
    expect(JSON.parse((await held).body)).toMatchObject({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
    await expect.poll(() => results(assistant)).toEqual([{ typ: "antwort_ergebnis", frage: question, entscheidung, angenommen: true, grund: null }]);
    await expect.poll(() => lastOf(pc, "assistenz_antwort")).toEqual({ typ: "assistenz_antwort", sitzung: session, frage: question, name: "Mia", entscheidung, werkzeug: "Bash", beschreibung: "npm test" });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.wartet).toEqual([]);
    expect(lastState(pc)?.steuert).toEqual({ name: "PC", du: true });
  });

  it("refuses Immer and leaves the question open", async () => {
    const pc = await device(PC);
    const { question, held } = await waitingQuestion(pc);
    const assistant = await mia();
    await expect.poll(() => lastState(assistant)).toBeDefined();
    sendJson(assistant, { typ: "antwort", frage: question, entscheidung: "immer" });
    await expect.poll(() => results(assistant)).toEqual([
      { typ: "antwort_ergebnis", frage: question, entscheidung: "immer", angenommen: false, grund: "„Immer“ nimmt die Brücke von der Assistenz nie an." },
    ]);
    expect(lastState(pc)?.sitzungen[0]?.wartet.map((entry) => entry.id)).toEqual([question]);
    sendJson(pc, { typ: "antwort", frage: question, entscheidung: "nein" });
    expect((await held).status).toBe(200);
  });

  it("tells Mia that a second answer to the same question is refused", async () => {
    const pc = await device(PC);
    const { question, held } = await waitingQuestion(pc);
    const assistant = await mia();
    await expect.poll(() => lastState(assistant)).toBeDefined();
    sendJson(pc, { typ: "antwort", frage: question, entscheidung: "ja" });
    await held;
    sendJson(assistant, { typ: "antwort", frage: question, entscheidung: "nein" });
    await expect.poll(() => results(assistant)).toEqual([
      { typ: "antwort_ergebnis", frage: question, entscheidung: "nein", angenommen: false, grund: "Unbekannt oder schon erledigt." },
    ]);
    expect(lastOf(pc, "assistenz_antwort")).toBeUndefined();
  });

  it("refuses every other message of Mia", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    const assistant = await mia();
    await expect.poll(() => lastState(assistant)).toBeDefined();
    const blocked = [
      { typ: "nachricht", sitzung: session, text: "hallo" },
      { typ: "neu" },
      { typ: "beenden", sitzung: session },
      { typ: "uebernehmen" },
      { typ: "herunterfahren" },
      { typ: "einstellung", schwelleVerdichten: 100_000 },
      { typ: "einstellungen" },
      { typ: "bestand_holen" },
      { typ: "haken", sitzung: session, art: "skill", kennung: "test-skill", an: true },
    ];
    for (const message of blocked) sendJson(assistant, message);
    await expect.poll(() => assistant.messages.filter((message) => message.typ === "fehler").length).toBe(blocked.length);
    expect(new Set(assistant.messages.filter((message) => message.typ === "fehler").map((message) => message.text))).toEqual(
      new Set(["Für die Assistenz gesperrt; sie darf nur Fragen mit Ja oder Nein beantworten."]),
    );
    expect(lastState(pc)?.sitzungen.map((entry) => entry.prozess)).toEqual(["laeuft"]);
    expect(lastState(pc)?.steuert).toEqual({ name: "PC", du: true });
    expect(output(pc, session)).not.toContain("hallo");
  });
});

function logged(): Promise<string> {
  return readFile(path.join(settings.datenordner, LOG_FILE), "utf8");
}

describe("log", { timeout: BRIDGE_TEST_MS }, () => {
  it("never holds the secret", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    await report(session, { session_id: CLAUDE_ID, hook_event_name: "SessionStart", source: "startup" });
    pc.socket.close();
    await pc.closed;
    await expect.poll(logged).toContain(`device ${PC} disconnected`);
    expect(await logged()).not.toContain(SECRET);
  });

  it("notes a new session in a folder outside the allowed folders and starts nothing", async () => {
    const pc = await device(PC);
    sendJson(pc, { typ: "neu", ordner: root });
    await expect.poll(logged).toContain("Neue Sitzung abgelehnt: folder is outside the allowed folders");
    expect(lastState(pc)?.sitzungen).toEqual([]);
  });

  it("notes a failed save of the session list", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    const file = path.join(settings.datenordner, "zustand.json");
    await rm(file);
    await mkdir(file);
    say(pc, session, "ende");
    await expect.poll(logged, { timeout: 10_000 }).toContain("ERROR a session reported an error");
  });

  it("notes a report that claims a session of the Kommandozentrale with another Claude session", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    await report(session, { session_id: CLAUDE_ID, hook_event_name: "SessionStart", source: "startup" });
    await report(session, { session_id: "anderer-claude", hook_event_name: "Stop" });
    await expect.poll(logged, { timeout: 15_000 }).toContain(`report Stop of session ${session} does not match its Claude session`);
  });
});

describe("failures", { timeout: BRIDGE_TEST_MS }, () => {
  it("names the port and starts no session when a port is in use", async () => {
    await bridge?.close();
    bridge = undefined;
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(settings.portOberflaeche, "127.0.0.1", resolve));
    try {
      await expect(startBridge({ settings, secret: SECRET, log })).rejects.toThrow(String(settings.portOberflaeche));
      expect((await refusal("127.0.0.1", settings.portMeldeeingang))).not.toBe("answered");
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => {
        resolve();
      }));
    }
  });

  it("refuses to start without the interface folder and names it", async () => {
    await bridge?.close();
    bridge = undefined;
    const missing = path.join(root, "fehlt");
    await expect(startBridge({ settings: { ...settings, oberflaeche: missing }, secret: SECRET, log })).rejects.toThrow(missing);
  });

  it.each([
    ["PUT on a page", "PUT", "/", 405],
    ["DELETE on the API", "DELETE", "/status", 405],
    ["HEAD on /status", "HEAD", "/status", 405],
    ["POST on an unknown route", "POST", "/loeschen", 404],
  ])("answers %s with its status", async (_case, method, route, status) => {
    expect((await send({ method, path: route, headers: { origin, "content-type": "application/json" }, body: "{}" })).status).toBe(status);
  });
});

describe("shutdown", { timeout: BRIDGE_TEST_MS }, () => {
  it("closes open connections with 1001 and notes every device before it ends", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY);
    await bridge?.close();
    bridge = undefined;
    await log.close();
    expect((await pc.closed).code).toBe(1001);
    expect((await handy.closed).code).toBe(1001);
    const content = await logged();
    expect(content).toContain(`device ${PC} disconnected (1001)`);
    expect(content).toContain(`device ${HANDY} disconnected (1001)`);
    log = await openLog(settings.datenordner);
  });
});

async function restart(changes: Partial<BridgeParts> = {}): Promise<void> {
  await bridge?.close();
  bridge = undefined;
  bridge = await startBridge({ settings, secret: SECRET, assistantSecret: ASSISTANT_SECRET, log, ...extraParts(), ...changes });
}

function errors(client: Client): string[] {
  return client.messages.flatMap((message) => (message.typ === "fehler" ? [message.text] : []));
}

describe("a session whose process just ended", { timeout: BRIDGE_TEST_MS }, () => {
  it("keeps the bridge answering when messages arrive right after the end, and shows the session as ended", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    say(pc, session, "ende");
    const until = Date.now() + 1_000;
    while (Date.now() < until) {
      say(pc, session, "noch da?");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await expect.poll(() => lastState(pc)?.sitzungen[0]).toMatchObject({ id: session, prozess: "beendet", hinweis: null });
    expect((await send()).status).toBe(200);
    expect(pc.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe("error messages to the device that sent a command", { timeout: BRIDGE_TEST_MS }, () => {
  it("tells a watching device that it does not control, and only that device", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY);
    const session = await newSession(pc);
    say(handy, session, "x");
    await expect.poll(() => errors(handy)).toEqual(["Dieses Gerät steuert nicht; erst übernehmen."]);
    expect(errors(pc)).toEqual([]);
  });

  it("tells why a new session was refused: folder outside and the limit of 8", async () => {
    const pc = await device(PC);
    sendJson(pc, { typ: "neu", ordner: root });
    await expect.poll(() => errors(pc)[0]).toContain("Neue Sitzung abgelehnt: folder is outside the allowed folders");
    for (let session = 0; session < 9; session += 1) sendJson(pc, { typ: "neu" });
    await expect.poll(() => errors(pc).some((text) => text.includes("at most 8")), { timeout: 20_000 }).toBe(true);
  });

  it("tells that the command was not found", async () => {
    settings = { ...settings, claudeBefehl: ["gibt-es-nicht-kommandozentrale"] };
    await restart();
    const pc = await device(PC);
    sendJson(pc, { typ: "neu" });
    await expect.poll(() => errors(pc)[0]).toContain("gibt-es-nicht-kommandozentrale was not found");
  });
});

describe("device ids bound to the open connection", { timeout: BRIDGE_TEST_MS }, () => {
  it("refuses a device id that another open connection uses and frees it when that connection closes", async () => {
    const pc = await device(PC);
    const stranger = await connect();
    sendJson(stranger, { typ: "hallo", geraet: PC, name: "Fremd", modus: "arbeiten" });
    expect(await stranger.closed).toEqual({ code: 1008, reason: "Geraetekennung gehoert einem anderen Geraet" });
    pc.socket.close();
    await pc.closed;
    const again = await device(PC);
    expect(again.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("never sends the raw device id of the controlling device to other devices", async () => {
    await device(PC);
    const handy = await device(HANDY);
    await quiet();
    expect(JSON.stringify(handy.messages)).not.toContain(PC);
    expect(lastState(handy)?.steuert).toEqual({ name: "PC", du: false });
  });
});

describe("origin before content", { timeout: BRIDGE_TEST_MS }, () => {
  it("rejects a foreign origin before it looks at the content type", async () => {
    expect((await post("/irgendwo", "x", { origin: "http://evil.example", "content-type": "text/plain" })).status).toBe(403);
  });
});

describe("start order", { timeout: BRIDGE_TEST_MS }, () => {
  it("starts no stored session when a port is in use", async () => {
    await bridge?.close();
    bridge = undefined;
    const stored = `{\n  "sitzungen": [{"id": "11111111-2222-4333-8444-555555555555", "ordner": ${JSON.stringify(settings.vault)}, "claudeSitzung": null, "prozess": "laeuft", "exitCode": null, "hinweis": null}]\n}`;
    const file = path.join(settings.datenordner, "zustand.json");
    await writeFile(file, stored);
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(settings.portOberflaeche, "127.0.0.1", resolve));
    try {
      await expect(startBridge({ settings, secret: SECRET, log })).rejects.toThrow(String(settings.portOberflaeche));
      expect(await readFile(file, "utf8")).toBe(stored);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => {
        resolve();
      }));
    }
  });
});

describe("stop request at the report inlet", { timeout: BRIDGE_TEST_MS }, () => {
  function stop(headers: OutgoingHttpHeaders, method = "POST"): Promise<Reply> {
    return send({ method, port: settings.portMeldeeingang, path: "/stop", headers });
  }

  it.each([
    ["a wrong secret", { [SECRET_HEADER]: "0b".repeat(32) }, "POST", 401],
    ["no secret", {}, "POST", 401],
    ["GET", { [SECRET_HEADER]: SECRET }, "GET", 405],
    ["a foreign Host", { [SECRET_HEADER]: SECRET, host: "evil.example" }, "POST", 403],
  ])("refuses %s", async (_case, headers, method, status) => {
    expect((await stop(headers, method)).status).toBe(status);
  });

  it("accepts the secret and asks the bridge to stop", async () => {
    let asked = false;
    void bridge?.stopRequested.then(() => {
      asked = true;
    });
    expect((await stop({ [SECRET_HEADER]: SECRET })).status).toBe(202);
    await expect.poll(() => asked).toBe(true);
  });
});

describe("shutting the bridge down from the Kommandozentrale", { timeout: BRIDGE_TEST_MS }, () => {
  function stopAsked(): () => boolean {
    let asked = false;
    void bridge?.stopRequested.then(() => {
      asked = true;
    });
    return () => asked;
  }

  it("refuses a device that only watches and keeps running", async () => {
    await device(PC);
    const handy = await device(HANDY, "zusehen");
    const asked = stopAsked();
    sendJson(handy, { typ: "herunterfahren" });
    await expect.poll(() => errors(handy)).toEqual(["Dieses Gerät steuert nicht; erst übernehmen."]);
    await quiet();
    expect(asked()).toBe(false);
    expect(handy.messages.some((message) => message.typ === "beendet")).toBe(false);
  });

  it("tells every device that it ends and asks the bridge to stop for the controlling device", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY, "zusehen");
    const asked = stopAsked();
    sendJson(pc, { typ: "herunterfahren" });
    await expect.poll(asked).toBe(true);
    for (const client of [pc, handy]) expect(client.messages.at(-1)).toEqual({ typ: "beendet" });
  });
});

describe("devices that only watch", { timeout: BRIDGE_TEST_MS }, () => {
  it("never get control by themselves and take it with uebernehmen", async () => {
    const handy = await device(HANDY, "zusehen");
    expect(lastState(handy)?.steuert).toBeNull();
    const pc = await device(PC);
    await expect.poll(() => lastState(handy)?.steuert).toEqual({ name: "PC", du: false });
    sendJson(handy, { typ: "uebernehmen" });
    await expect.poll(() => lastState(pc)?.steuert).toEqual({ name: "Handy", du: false });
  });
});

describe("ending an ended session", { timeout: BRIDGE_TEST_MS }, () => {
  it("removes it from the list and from zustand.json", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    say(pc, session, "ende");
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.prozess, { timeout: 10_000 }).toBe("beendet");
    sendJson(pc, { typ: "beenden", sitzung: session });
    await expect.poll(() => lastState(pc)?.sitzungen).toEqual([]);
    await expect.poll(async () => JSON.parse(await readFile(path.join(settings.datenordner, "zustand.json"), "utf8")) as unknown).toEqual({ sitzungen: [] });
  });
});

function lastOf<T extends ServerMessage["typ"]>(client: Client, typ: T): Extract<ServerMessage, { typ: T }> | undefined {
  return client.messages.findLast((message): message is Extract<ServerMessage, { typ: T }> => message.typ === typ);
}

async function boundSession(controller: Client): Promise<string> {
  const session = await newSession(controller);
  await report(session, { session_id: CLAUDE_ID, hook_event_name: "SessionStart", source: "startup" });
  return session;
}

function statusLine(session: string, tokens: number): Promise<Reply> {
  return send({
    method: "POST",
    port: settings.portMeldeeingang,
    path: REPORT_PATH,
    body: JSON.stringify({
      sitzung: session,
      art: "statuszeile",
      daten: {
        session_id: CLAUDE_ID,
        model: { display_name: "Opus" },
        context_window: { used_percentage: 50, current_usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
      },
    }),
    headers: { "content-type": "application/json", [SECRET_HEADER]: SECRET },
  });
}

describe("menu", { timeout: BRIDGE_TEST_MS }, () => {
  it("sends the inventory to any device, also one that only watches", async () => {
    await device(PC);
    const handy = await device(HANDY, "zusehen");
    sendJson(handy, { typ: "bestand_holen" });
    await expect.poll(() => lastOf(handy, "bestand")?.skills.map((skill) => skill.kennung)).toContain("test-skill");
    expect(lastOf(handy, "bestand")?.favoriten).toEqual({ skills: ["caveman", "grill-me", "senior-engineering-standard"], plugins: [], konnektoren: [] });
  });

  it("sends options and projects to any device and refuses changes from a watching device", async () => {
    await device(PC);
    const handy = await device(HANDY, "zusehen");
    sendJson(handy, { typ: "optionen_holen" });
    await expect.poll(() => lastOf(handy, "optionen")?.erlaubnis).toEqual(["default", "acceptEdits", "plan", "auto"]);
    expect(lastOf(handy, "optionen")?.modelle.openrouter).toBeNull();
    sendJson(handy, { typ: "projekte_holen" });
    await expect.poll(() => lastOf(handy, "projekte")?.liste).toEqual([]);
    sendJson(handy, { typ: "favorit", art: "skill", kennung: "test-skill", an: true });
    await expect.poll(() => lastOf(handy, "fehler")?.text).toBe("Dieses Gerät steuert nicht; erst übernehmen.");
  });

  it("searches the vault and claude-mem for any device and says what was not available", async () => {
    await device(PC);
    const handy = await device(HANDY, "zusehen");
    sendJson(handy, { typ: "suche", text: "kommandozentrale" });
    await expect.poll(() => lastOf(handy, "treffer"), { timeout: 20_000 }).toBeDefined();
    const found = lastOf(handy, "treffer");
    expect(found).toMatchObject({ text: "kommandozentrale", vault: [{ pfad: "notiz.md", zeile: 2, auszug: "Die Kommandozentrale sucht hier" }], erinnerung: [] });
    expect(found?.fehler).toContain("qmd nicht verfügbar");
    expect(found?.fehler).toContain("claude-mem nicht erreichbar");
  });
});

describe("settings", { timeout: BRIDGE_TEST_MS }, () => {
  it("names threshold and Claude Code version on request", async () => {
    const pc = await device(PC);
    sendJson(pc, { typ: "einstellungen" });
    await expect.poll(() => lastOf(pc, "einstellungen")).toEqual({ typ: "einstellungen", schwelleVerdichten: 200_000, claudeVersion: VERSION });
  });

  it("lets only the controlling device change the threshold", async () => {
    await device(PC);
    const handy = await device(HANDY);
    sendJson(handy, { typ: "einstellung", schwelleVerdichten: 150_000 });
    await expect.poll(() => errors(handy)).toEqual(["Dieses Gerät steuert nicht; erst übernehmen."]);
  });

  it("applies a new threshold at once, tells every device and keeps it after a restart", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY);
    const session = await boundSession(pc);
    sendJson(pc, { typ: "einstellung", schwelleVerdichten: 150_000 });
    await expect.poll(() => lastOf(handy, "einstellungen")?.schwelleVerdichten).toBe(150_000);
    await statusLine(session, 160_000);
    await report(session, { session_id: CLAUDE_ID, hook_event_name: "Stop" });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.hinweise.map((hint) => hint.art)).toContain("verdichten");
    await restart();
    const again = await device(PC);
    sendJson(again, { typ: "einstellungen" });
    await expect.poll(() => lastOf(again, "einstellungen")?.schwelleVerdichten).toBe(150_000);
  });
});

describe("self-test on request", { timeout: BRIDGE_TEST_MS }, () => {
  it("checks again from the next message and passes once the Stop hook of the session arrives", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY);
    const session = await boundSession(pc);
    sendJson(handy, { typ: "selbsttest" });
    await expect.poll(() => errors(handy)).toEqual(["Dieses Gerät steuert nicht; erst übernehmen."]);
    await rm(path.join(settings.datenordner, "selbsttest.json"), { force: true });
    sendJson(pc, { typ: "selbsttest" });
    await quiet();
    say(pc, session, "hallo");
    await quiet();
    await report(session, { session_id: CLAUDE_ID, hook_event_name: "Stop" });
    await expect.poll(async () => JSON.parse(await readFile(path.join(settings.datenordner, "selbsttest.json"), "utf8")) as unknown).toEqual({ version: VERSION });
    expect(lastState(handy)?.sitzungen[0]?.hinweise).toEqual([]);
  });
});

describe("folders for a new session", { timeout: BRIDGE_TEST_MS }, () => {
  it("lists the allowed folders and their subfolders two levels deep, without hidden folders and node_modules", async () => {
    for (const folder of ["projekt/unter/zu-tief", ".versteckt/innen", "node_modules/paket", "zweites"]) {
      await mkdir(path.join(settings.vault, ...folder.split("/")), { recursive: true });
    }
    await device(PC);
    const handy = await device(HANDY, "zusehen");
    sendJson(handy, { typ: "ordner" });
    await expect.poll(() => lastOf(handy, "ordner")).toBeDefined();
    expect(lastOf(handy, "ordner")?.liste).toEqual([
      { pfad: settings.vault, name: "vault" },
      { pfad: path.join(settings.vault, "projekt"), name: "projekt" },
      { pfad: path.join(settings.vault, "projekt", "unter"), name: "unter" },
      { pfad: path.join(settings.vault, "zweites"), name: "zweites" },
    ]);
  });
});

describe("update of Claude Code while the bridge runs", { timeout: BRIDGE_TEST_MS }, () => {
  it("reads the version again for a new session and checks after a change", async () => {
    let version = "1.0.0 (Test)";
    await restart({ claudeVersion: () => Promise.resolve(version) });
    const pc = await device(PC);
    version = "2.0.0 (Test)";
    const session = await boundSession(pc);
    sendJson(pc, { typ: "einstellungen" });
    await expect.poll(() => lastOf(pc, "einstellungen")?.claudeVersion).toBe("2.0.0 (Test)");
    say(pc, session, "hallo");
    await quiet();
    await report(session, { session_id: CLAUDE_ID, hook_event_name: "Stop" });
    await expect.poll(async () => JSON.parse(await readFile(path.join(settings.datenordner, "selbsttest.json"), "utf8")) as unknown).toEqual({ version: "2.0.0 (Test)" });
  });
});

function startCount(client: Client, session: string): number {
  return output(client, session).split("ARGUMENTE ").length - 1;
}

describe("restart and permission questions on the hub", { timeout: BRIDGE_TEST_MS }, () => {
  it("does not restart while a permission question waits, restarts after the answer, and a question after the restart waits", async () => {
    const pc = await device(PC);
    const session = await boundSession(pc);
    const held = report(session, { session_id: CLAUDE_ID, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" } });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.wartet.length).toBe(1);
    sendJson(pc, { typ: "sitzung_einstellung", sitzung: session, schluessel: "schnell", wert: true });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.neustartAusstehend).toBe(true);
    say(pc, session, "waehrend der Frage");
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("ECHO waehrend der Frage");
    expect(startCount(pc, session)).toBe(1);
    sendJson(pc, { typ: "antwort", frage: lastState(pc)?.sitzungen[0]?.wartet[0]?.id ?? "", entscheidung: "ja" });
    expect((await held).status).toBe(200);
    say(pc, session, "nach der Frage");
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("ECHO nach der Frage");
    expect(startCount(pc, session)).toBe(2);
    expect(output(pc, session)).toContain(`"--resume","${CLAUDE_ID}"`);
    const after = report(session, { session_id: CLAUDE_ID, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "ls" } });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.wartet.length).toBe(1);
    await quiet();
    expect(lastState(pc)?.sitzungen[0]?.wartet).toHaveLength(1);
    sendJson(pc, { typ: "antwort", frage: lastState(pc)?.sitzungen[0]?.wartet[0]?.id ?? "", entscheidung: "nein" });
    expect((await after).status).toBe(200);
  });
});

describe("changing messages over the WebSocket", { timeout: BRIDGE_TEST_MS }, () => {
  it("renames a session and ticks a known skill", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    sendJson(pc, { typ: "sitzung_umbenennen", sitzung: session, titel: "Umbenannt" });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.titel).toBe("Umbenannt");
    sendJson(pc, { typ: "haken", sitzung: session, art: "skill", kennung: "test-skill", an: true });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.skills).toEqual(["test-skill"]);
    sendJson(pc, { typ: "haken", sitzung: session, art: "skill", kennung: "gibt-es-nicht", an: true });
    await expect.poll(() => errors(pc).at(-1)).toContain("gibt-es-nicht");
  });

  it("stores a favourite and sends the inventory to every device", async () => {
    const pc = await device(PC);
    const handy = await device(HANDY, "zusehen");
    sendJson(pc, { typ: "favorit", art: "skill", kennung: "test-skill", an: true });
    await expect.poll(() => lastOf(handy, "bestand")?.favoriten.skills).toContain("test-skill");
  });

  it("sets the style of a session from the list Claude Code names", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    sendJson(pc, { typ: "sitzung_einstellung", sitzung: session, schluessel: "ausgabestil", wert: "Explanatory" });
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.ausgabestil).toBe("Explanatory");
    sendJson(pc, { typ: "sitzung_einstellung", sitzung: session, schluessel: "ausgabestil", wert: "Laut" });
    await expect.poll(() => errors(pc).at(-1)).toContain("Unbekannter Ausgabestil");
  });

  it("stores defaults and starts the next session with them", async () => {
    const pc = await device(PC);
    await newSession(pc);
    const werte = { modell: "haiku", aufwand: "auto", ordner: null, ausgabestil: null, erlaubnis: "plan", skills: ["test-skill"], plugins: [], konnektoren: [] };
    sendJson(pc, { typ: "vorgaben", werte });
    await expect.poll(() => lastOf(pc, "optionen")?.vorgaben).toEqual(werte);
    sendJson(pc, { typ: "neu", ordner: null });
    await expect.poll(() => lastState(pc)?.sitzungen.length, { timeout: 10_000 }).toBe(2);
    const second = lastState(pc)?.sitzungen[1]?.id ?? "";
    await expect.poll(() => output(pc, second), { timeout: 10_000 }).toContain('"--model","haiku","--permission-mode","plan"');
    expect(lastState(pc)?.sitzungen[1]?.skills).toEqual(["test-skill"]);
  });

  it("starts a session with a chosen model and refuses an unknown one", async () => {
    const pc = await device(PC);
    sendJson(pc, { typ: "neu", ordner: null, modell: "gpt-5" });
    await expect.poll(() => errors(pc).at(-1)).toContain("Unbekanntes Modell");
    sendJson(pc, { typ: "neu", ordner: null, anbieter: "openrouter", modell: "x/y" });
    await expect.poll(() => errors(pc).at(-1)).toContain("OpenRouter ist nicht eingerichtet");
    expect(lastState(pc)?.sitzungen).toEqual([]);
  });

  it("sends a wish to build to the session and refuses a link without session", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    sendJson(pc, { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "Ein Wunsch", sitzung: session });
    await expect.poll(() => lastOf(pc, "hinzugefuegt")).toMatchObject({ ok: true, weg: "neu", einrichtung: null });
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("Ein Wunsch");
    sendJson(pc, { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "fehlt", sitzung: null });
    await expect.poll(() => lastOf(pc, "hinzugefuegt")).toMatchObject({ ok: false, weg: "bibliothek" });
  });

  it("checks a link in an own check session", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    sendJson(pc, { typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://beispiel.de/skill", sitzung: session });
    await expect.poll(() => lastState(pc)?.sitzungen.length, { timeout: 10_000 }).toBe(2);
    const check = lastState(pc)?.sitzungen[1];
    expect(check).toMatchObject({ titel: "Link-Prüfung", pruefung: true, erlaubnis: "default" });
    await expect.poll(() => output(pc, check?.id ?? ""), { timeout: 10_000 }).toContain("beispiel.de/skill");
    expect(output(pc, session)).not.toContain("beispiel.de/skill");
    await expect.poll(() => output(pc, check?.id ?? ""), { timeout: 10_000 }).toMatch(/permissions.{1,6}ask.{1,8}Bash/);
  });

  it("answers that a running session is not paused", async () => {
    const pc = await device(PC);
    const session = await newSession(pc);
    sendJson(pc, { typ: "fortsetzen", sitzung: session });
    await expect.poll(() => errors(pc).at(-1)).toBe("Diese Sitzung ist nicht pausiert.");
  });
});

const EXAMPLES = new URL("vertrag_beispiele.json", import.meta.url);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIME_FIELDS = new Set(["zeit", "seit", "zuletzt"]);
const FIXED_TIME = 1_800_000_000_000;

function stable(value: unknown): unknown {
  const ids = new Map<string, string>();
  const escapedRoot = JSON.stringify(root).slice(1, -1);
  const text = JSON.stringify(value)
    .replaceAll(escapedRoot, "/beispiel")
    .replaceAll(root, "/beispiel")
    .replaceAll("\\\\", "/")
    .replace(UUID, (id) => {
      if (id === CLAUDE_ID) return id;
      if (!ids.has(id)) ids.set(id, `kennung-${String(ids.size + 1)}`);
      return ids.get(id) ?? id;
    });
  return JSON.parse(text, (key, entry: unknown) => (TIME_FIELDS.has(key) && typeof entry === "number" ? FIXED_TIME : entry));
}
const EXAMPLE_TYPES: readonly ServerMessage["typ"][] = ["zustand", "chat_neu", "bestand", "optionen", "projekte", "hinzugefuegt", "fehler", "einstellungen", "ordner"];

describe("contract examples for the page", { timeout: BRIDGE_TEST_MS }, () => {
  it("writes one message of each kind exactly as the bridge sends it", async () => {
    const pc = await device(PC);
    const session = await boundSession(pc);
    sendJson(pc, { typ: "haken", sitzung: session, art: "skill", kennung: "test-skill", an: true });
    say(pc, session, "hallo");
    for (const typ of ["bestand_holen", "optionen_holen", "projekte_holen", "einstellungen", "ordner"]) sendJson(pc, { typ });
    sendJson(pc, { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "fehlt", sitzung: null });
    sendJson(pc, { typ: "fortsetzen", sitzung: session });
    await expect.poll(() => EXAMPLE_TYPES.filter((typ) => lastOf(pc, typ) === undefined), { timeout: 10_000 }).toEqual([]);
    await expect.poll(() => lastState(pc)?.sitzungen[0]?.skills).toEqual(["test-skill"]);
    await expect.poll(() => output(pc, session), { timeout: 10_000 }).toContain("test-skill.\n\nhallo");
    const later = await device(HANDY, "zusehen");
    await expect.poll(() => lastOf(later, "chat")).toBeDefined();
    const examples = stable({ ...Object.fromEntries(EXAMPLE_TYPES.map((typ) => [typ, lastOf(pc, typ)])), chat: lastOf(later, "chat") });
    const text = `${JSON.stringify(examples, null, 2)}\n`;
    const before = await readFile(EXAMPLES, "utf8").catch(() => "");
    if (before !== text) await writeFile(EXAMPLES, text);
    expect(await readFile(EXAMPLES, "utf8")).toBe(text);
    expect(text).not.toContain(root.replaceAll("\\", "\\\\"));
    expect(text.replaceAll(CLAUDE_ID, "")).not.toMatch(UUID);
  });
});

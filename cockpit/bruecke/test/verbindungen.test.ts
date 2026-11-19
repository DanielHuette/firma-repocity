import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { Menu } from "../src/menue.ts";
import type { MenuOptions } from "../src/menue.ts";
import type { Log } from "../src/protokoll.ts";
import type { SessionEvent, SessionInfo } from "../src/sitzungen.ts";
import { OHNE_OPTIONEN } from "../src/sitzungsoptionen.ts";
import { Hub, MAX_BUFFERED_BYTES, agentsWithDetails, streamParents, toolQuestion } from "../src/verbindungen.ts";
import type { Agent } from "../src/zustand.ts";
import type { HubOptions, HubSessions } from "../src/verbindungen.ts";
import type { InletReport } from "../src/meldungen.ts";

const DEVICE = "geraet-pc-0000000001";
const SESSIONS = 8;
const HUB_TEST_MS = 120_000;
const CHAT_BYTES = 2 * 1024 * 1024;

let server: Server;
let port: number;
let hub: Hub;
let sockets: WebSocket[];
let logged: string[];

function ansiRich(bytes: number): string {
  const piece = "\u001b[38;2;201;169;110mGold\u001b[0m \u001b[1mfett\u001b[22m äöü ";
  return piece.repeat(Math.floor(bytes / Buffer.byteLength(piece)));
}

function piece(daten: string): SessionEvent {
  return { kind: "chat", sitzung: "sitzung-0", schritt: { art: "teil", id: "e1", text: daten } };
}

const permissionAnswers: string[] = [];

function fakeSessions(histories: Map<string, string>, onHistory: () => void = () => undefined): HubSessions {
  let controller: string | null = null;
  const list = (): SessionInfo[] =>
    [...histories.keys()].map((id) => ({ id, ordner: `/vault/${id}`, claudeSitzung: null, prozess: "laeuft", exitCode: null, hinweis: null, optionen: OHNE_OPTIONEN }));
  const refused = (): { kind: "unbekannt" } => ({ kind: "unbekannt" });
  return {
    list,
    controller: () => controller,
    chat: (id) => {
      onHistory();
      const text = histories.get(id);
      return text === undefined ? undefined : [{ id: "e1", art: "claude", zeit: 1, text }];
    },
    connect: (device) => {
      controller ??= device;
    },
    disconnect: () => undefined,
    takeOver: () => ({ kind: "ok" }),
    send: refused,
    interrupt: refused,
    answerQuestion: refused,
    answerPlan: refused,
    answerPermission: (id, requestId, allow) => {
      permissionAnswers.push(`${id} ${requestId} ${String(allow)}`);
      return { kind: "ok" };
    },
    end: () => Promise.resolve({ kind: "unbekannt" }),
    options: () => ({
      titel: "t",
      skills: [],
      plugins: [],
      konnektoren: [],
      erlaubnis: "default",
      erlaubnisBestaetigt: true,
      ausgabestil: null,
      schnell: false,
      anbieter: "abo",
      modellWahl: null,
      kostenUsd: null,
      neustartAusstehend: false,
      pausiert: false,
      pruefung: false,
    }),
    resume: () => Promise.resolve({ kind: "unbekannt" }),
    clean: <T>(_id: string, value: T): T => JSON.parse(JSON.stringify(value).replaceAll("GEHEIM", "[weg]")) as T,
    isCheck: (id) => id === "sitzung-0",
    agents: () => undefined,
  };
}

function log(): Log {
  return {
    info: (message) => logged.push(message),
    error: (message) => logged.push(message),
    close: () => Promise.resolve(),
  };
}

async function startHub(histories: Map<string, string>, onHistory?: () => void, extra: Partial<HubOptions> = {}): Promise<void> {
  hub = new Hub({
    sessions: fakeSessions(histories, onHistory),
    answer: extra.answer ?? (() => ({ kind: "unbekannt" })),
    log: log(),
    now: Date.now,
    schwelleVerdichten: 200_000,
    menu: extra.menu ?? {
      search: () => Promise.resolve({ vault: [], erinnerung: [] }),
      folders: () => Promise.resolve([]),
    },
    dienst: extra.dienst ?? { handle: () => Promise.resolve([]) },
    selfTest: { version: () => null, versionSeen: () => undefined, hints: () => [], inputSent: () => undefined, observe: () => undefined, restart: () => undefined },
    storeThreshold: () => Promise.resolve(),
    shutDown: () => undefined,
    ...(extra.helloWithinMs === undefined ? {} : { helloWithinMs: extra.helloWithinMs }),
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  server = createServer();
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      hub.accept(webSocket);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
}

beforeEach(() => {
  sockets = [];
  logged = [];
});

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  await hub.closeAll();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => {
    resolve();
  }));
});

let connections = 0;

function nextDevice(): string {
  connections += 1;
  return `${DEVICE.slice(0, -3)}${String(connections).padStart(3, "0")}`;
}

function connect(stallMs = 0, autoPong = true): Promise<{ socket: WebSocket; histories: string[]; closed: Promise<number> }> {
  const device = nextDevice();
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, { maxPayload: 64 * 1024 * 1024, autoPong });
  sockets.push(socket);
  const histories: string[] = [];
  socket.on("message", (data) => {
    if (!Buffer.isBuffer(data)) return;
    const message = JSON.parse(data.toString("utf8")) as { typ: string; sitzung?: string };
    if (message.typ === "chat" && message.sitzung !== undefined) histories.push(message.sitzung);
  });
  const closed = new Promise<number>((resolve) => socket.on("close", resolve));
  return new Promise((resolve, reject) => {
    socket.on("open", () => {
      socket.send(JSON.stringify({ typ: "hallo", geraet: device, name: "PC", modus: "arbeiten" }));
      if (stallMs > 0) {
        socket.pause();
        setTimeout(() => {
          socket.resume();
        }, stallMs);
      }
      resolve({ socket, histories, closed });
    });
    socket.on("error", reject);
  });
}

describe("history at the greeting", { timeout: HUB_TEST_MS }, () => {
  it("lets a device in while eight sessions each hold a full, ANSI-rich history", async () => {
    const histories = new Map(Array.from({ length: SESSIONS }, (_, index) => [`sitzung-${String(index)}`, ansiRich(CHAT_BYTES)]));
    await startHub(histories);
    const json = [...histories.values()].reduce((sum, history) => sum + Buffer.byteLength(JSON.stringify(history)), 0);
    expect(json).toBeGreaterThan(MAX_BUFFERED_BYTES);
    const client = await connect(1_000);
    await expect.poll(() => client.histories.length, { timeout: 60_000 }).toBe(SESSIONS);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    expect(logged).not.toContain("a device reads too slowly, its connection was dropped");
  });

  it("delivers output that arrives during the greeting after the history, not before", async () => {
    const histories = new Map([["sitzung-0", ansiRich(CHAT_BYTES)]]);
    await startHub(histories, () => {
      hub.onSessionEvent(piece("neu"));
    });
    const client = await connect();
    const order: string[] = [];
    client.socket.on("message", (data) => {
      if (Buffer.isBuffer(data)) order.push((JSON.parse(data.toString("utf8")) as { typ: string }).typ);
    });
    await expect.poll(() => order.includes("chat_teil"), { timeout: 30_000 }).toBe(true);
    expect(order.indexOf("chat")).toBeLessThan(order.indexOf("chat_teil"));
  });
});

describe("limit for devices that stop reading", { timeout: HUB_TEST_MS }, () => {
  it("drops a device that stops reading once more than the limit waits for it, and keeps one that reads", async () => {
    await startHub(new Map([["sitzung-0", ""]]));
    const stalled = await connect();
    const reading = await connect();
    await expect.poll(() => stalled.histories.length + reading.histories.length).toBe(2);
    stalled.socket.pause();
    const chunk = "x".repeat(1024 * 1024);
    for (let sent = 0; sent < 64 && !logged.includes("a device reads too slowly, its connection was dropped"); sent += 1) {
      hub.onSessionEvent(piece(chunk));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(logged).toContain("a device reads too slowly, its connection was dropped");
    expect(reading.socket.readyState).toBe(WebSocket.OPEN);
  });
});

class FullSocket extends EventEmitter {
  readonly readyState = WebSocket.OPEN;
  readonly bufferedAmount = MAX_BUFFERED_BYTES + 4 * 1024 * 1024;
  readonly sent: string[] = [];
  terminated = false;

  send(text: string, done?: () => void): void {
    this.sent.push(text);
    if (done !== undefined) setImmediate(done);
  }

  terminate(): void {
    this.terminated = true;
  }

  close(): void {
    this.terminated = true;
  }
}

describe("the order of the two rules", () => {
  it("sends the whole history to a device whose send buffer is full, and drops it only for later output", async () => {
    await startHub(new Map(Array.from({ length: SESSIONS }, (_, index) => [`sitzung-${String(index)}`, "x"])));
    const socket = new FullSocket();
    hub.accept(socket as unknown as WebSocket);
    socket.emit("message", Buffer.from(JSON.stringify({ typ: "hallo", geraet: DEVICE, name: "PC", modus: "arbeiten" })), false);
    await expect.poll(() => socket.sent.length).toBe(SESSIONS + 1);
    expect(socket.terminated).toBe(false);
    hub.onSessionEvent(piece("spaeter"));
    expect(socket.terminated).toBe(true);
    socket.emit("close", 1006);
  });
});

class StalledSocket extends FullSocket {
  override readonly bufferedAmount = 0;

  override send(text: string): void {
    this.sent.push(text);
  }
}

describe("output that waits during the greeting", () => {
  it("counts toward the same limit and drops the device once it is passed", async () => {
    await startHub(new Map([["sitzung-0", "x"]]));
    const socket = new StalledSocket();
    hub.accept(socket as unknown as WebSocket);
    socket.emit("message", Buffer.from(JSON.stringify({ typ: "hallo", geraet: DEVICE, name: "PC", modus: "arbeiten" })), false);
    await expect.poll(() => socket.sent.length).toBe(1);
    const chunk = "x".repeat(1024 * 1024);
    for (let sent = 0; sent < 15; sent += 1) hub.onSessionEvent(piece(chunk));
    expect(socket.terminated).toBe(false);
    for (let sent = 0; sent < 3; sent += 1) hub.onSessionEvent(piece(chunk));
    expect(socket.terminated).toBe(true);
    socket.emit("close", 1006);
  });
});

describe("heartbeat", { timeout: HUB_TEST_MS }, () => {
  it("drops a connection that does not answer a ping until the next one and keeps one that does", async () => {
    await startHub(new Map());
    const silent = await connect(0, false);
    const answering = await connect();
    await expect.poll(() => silent.histories.length + answering.histories.length).toBe(0);
    hub.heartbeat();
    await new Promise((resolve) => setTimeout(resolve, 300));
    hub.heartbeat();
    expect(await silent.closed).toBe(1006);
    expect(answering.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe("many searches from one device", { timeout: HUB_TEST_MS }, () => {
  it("answers only the newest of 100 searches and limits the work behind them", async () => {
    let qmdSearches = 0;
    let memoryNow = 0;
    let memoryMost = 0;
    const memory = createServer((request, response) => {
      memoryNow += 1;
      memoryMost = Math.max(memoryMost, memoryNow);
      request.on("close", () => (memoryNow -= 1));
      setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end('{"observations":[]}'), 100);
    });
    await new Promise<void>((resolve) => memory.listen(0, "127.0.0.1", resolve));
    const run: MenuOptions["run"] = async (_command, args) => {
      if (args[0] === "search") qmdSearches += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { kind: "ok", stdout: "[]" };
    };
    const claudeMem = `http://127.0.0.1:${String((memory.address() as AddressInfo).port)}`;
    const menu = new Menu({ vault: "/fehlt", erlaubteOrdner: [], qmdBefehl: ["qmd"], claudeMem, now: Date.now, run });
    await startHub(new Map(), undefined, { menu });
    const client = await connect();
    const answers: string[] = [];
    client.socket.on("message", (data) => {
      const message = Buffer.isBuffer(data) ? (JSON.parse(data.toString("utf8")) as { typ: string; text?: string }) : undefined;
      if (message?.typ === "treffer") answers.push(message.text ?? "");
    });
    for (let search = 0; search < 100; search += 1) client.socket.send(JSON.stringify({ typ: "suche", text: `suche-${String(search)}` }));
    await expect.poll(() => answers, { timeout: 30_000 }).toEqual(["suche-99"]);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(answers).toEqual(["suche-99"]);
    expect(qmdSearches).toBeLessThanOrEqual(3);
    expect(memoryMost).toBeLessThanOrEqual(2);
    memory.closeAllConnections();
    memory.close();
  });
});

describe("messages a device sends wrongly", { timeout: HUB_TEST_MS }, () => {
  it("answers unreadable messages with an error, at most five times in ten seconds", async () => {
    await startHub(new Map());
    const client = await connect();
    const errors: string[] = [];
    client.socket.on("message", (data) => {
      const message = Buffer.isBuffer(data) ? (JSON.parse(data.toString("utf8")) as { typ: string; text?: string }) : undefined;
      if (message?.typ === "fehler") errors.push(message.text ?? "");
    });
    for (let index = 0; index < 10; index += 1) client.socket.send(JSON.stringify({ typ: "suche", text: "x".repeat(201) }));
    await expect.poll(() => errors.length).toBe(5);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(errors).toEqual(Array(5).fill("Nachricht nicht verstanden: unbekannte Art oder ungültige Angaben."));
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes a connection that sends no hallo within the deadline", async () => {
    await startHub(new Map(), undefined, { helloWithinMs: 200 });
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    sockets.push(socket);
    const closed = new Promise<number>((resolve) => socket.on("close", resolve));
    expect(await closed).toBe(1008);
  });
});

describe("streamParents", () => {
  const agent = (id: string, typ: string, seit: number): Agent => ({ id, eltern: "haupt", name: typ, typ, stand: "laeuft", werkzeug: null, aufrufe: 0, seit });

  it("pairs hook agents with agent calls of the stream by type and order", () => {
    const agents = [agent("haupt", "haupt", 0), agent("h2", "Explore", 2), agent("h1", "Explore", 1), agent("h3", "Plan", 3), agent("h4", "Plan", 4)];
    const stream = [{ id: "t1", typ: "Explore" }, { id: "t2", typ: "Plan" }, { id: "t3", typ: "Explore" }];
    expect([...streamParents(agents, stream)]).toEqual([["haupt", "haupt"], ["h1", "t1"], ["h2", "t3"], ["h3", "t2"]]);
  });
});

describe("agentsWithDetails", () => {
  const agent = (id: string, typ: string, seit: number): Agent => ({ id, eltern: "haupt", name: typ, typ, stand: "laeuft", werkzeug: null, aufrufe: 0, seit });
  const von = (parent: string) => ({ skills: [`skill-${parent}`], fortschritt: null });

  it("names a helper by the short description of its agent call and keeps its type", () => {
    const details = { agenten: [{ id: "t1", typ: "Explore", beschreibung: "Helfer B grill-me" }, { id: "t2", typ: "Plan", beschreibung: null }], von };
    const shown = agentsWithDetails([agent("h1", "Explore", 1), agent("h2", "Plan", 2), agent("h3", "Explore", 3)], details);
    expect(shown.map((eintrag) => [eintrag.id, eintrag.name, eintrag.typ, eintrag.skills])).toEqual([
      ["h1", "Helfer B grill-me", "Explore", ["skill-t1"]],
      ["h2", "Plan", "Plan", ["skill-t2"]],
      ["h3", "Explore", "Explore", []],
    ]);
  });

  it("keeps the names when the stream is not known", () => {
    expect(agentsWithDetails([agent("h1", "Explore", 1)], undefined)).toEqual([{ ...agent("h1", "Explore", 1), skills: [], fortschritt: null }]);
  });
});

describe("check sessions and the key in permission questions", { timeout: HUB_TEST_MS }, () => {
  function question(id: string, beschreibung: string): InletReport {
    return {
      kind: "zentrale",
      sitzung: "sitzung-0",
      ereignisName: "PermissionRequest",
      ereignis: { kind: "PermissionRequest", frage: { id, agent: "haupt", werkzeug: "Bash", beschreibung, regelBeiImmer: [{ type: "addRules", destination: "session", rules: [{ toolName: "Bash" }], behavior: "allow" }] } },
      aufwand: null,
    };
  }

  it("blacks the key out of the question shown and refuses Immer in a check session", async () => {
    const answers: string[] = [];
    await startHub(new Map([["sitzung-0", "x"]]), undefined, { answer: (frage, entscheidung) => (answers.push(`${frage} ${entscheidung}`), { kind: "ok" }) });
    const client = await connect();
    const messages: string[] = [];
    client.socket.on("message", (data) => {
      if (Buffer.isBuffer(data)) messages.push(data.toString("utf8"));
    });
    hub.onReport(question("f-1", "echo GEHEIM"));
    await expect.poll(() => messages.some((text) => text.includes("echo [weg]"))).toBe(true);
    expect(messages.join("")).not.toContain("GEHEIM");
    client.socket.send(JSON.stringify({ typ: "antwort", frage: "f-1", entscheidung: "immer" }));
    await expect.poll(() => messages.some((text) => text.includes("nur einmal"))).toBe(true);
    client.socket.send(JSON.stringify({ typ: "antwort", frage: "f-1", entscheidung: "ja" }));
    await expect.poll(() => answers).toEqual(["f-1 ja"]);
  });
});

describe("permission requests of other tools", { timeout: HUB_TEST_MS }, () => {
  const anfrage = { requestId: "r-7", werkzeug: "mcp__konto__anmelden", eingabe: { url: "https://beispiel.de" } };

  it("turns the request into a question that cannot be allowed forever", () => {
    expect(toolQuestion(anfrage)).toEqual({ id: "werkzeug-r-7", agent: "haupt", werkzeug: "mcp__konto__anmelden", beschreibung: "https://beispiel.de", regelBeiImmer: null });
  });

  it("shows the question, sends the answer to the session and removes the question when it is settled", async () => {
    permissionAnswers.length = 0;
    const answers: string[] = [];
    await startHub(new Map([["sitzung-0", "x"]]), undefined, { answer: (frage, entscheidung) => (answers.push(`${frage} ${entscheidung}`), { kind: "ok" }) });
    const client = await connect();
    const messages: string[] = [];
    client.socket.on("message", (data) => {
      if (Buffer.isBuffer(data)) messages.push(data.toString("utf8"));
    });
    hub.onSessionEvent({ kind: "erlaubnis", sitzung: "sitzung-0", anfrage });
    await expect.poll(() => messages.some((text) => text.includes("werkzeug-r-7"))).toBe(true);
    client.socket.send(JSON.stringify({ typ: "antwort", frage: "werkzeug-r-7", entscheidung: "immer" }));
    await expect.poll(() => messages.some((text) => text.includes("nur einmal"))).toBe(true);
    client.socket.send(JSON.stringify({ typ: "antwort", frage: "werkzeug-r-7", entscheidung: "nein" }));
    await expect.poll(() => permissionAnswers).toEqual(["sitzung-0 r-7 false"]);
    expect(answers).toEqual([]);
    const shown = messages.length;
    hub.onSessionEvent({ kind: "erlaubnis_weg", sitzung: "sitzung-0", requestId: "r-7" });
    await expect.poll(() => messages.slice(shown).some((text) => text.includes("\"typ\":\"zustand\"") && !text.includes("werkzeug-r-7"))).toBe(true);
  });
});

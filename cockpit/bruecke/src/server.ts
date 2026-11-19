import { createServer, STATUS_CODES } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { loadSettings, readOrCreateSecret, settingsFilePath } from "./einstellungen.ts";
import type { Settings } from "./einstellungen.ts";
import { AlreadyRunningError, claimSingleProcess } from "./einzelprozess.ts";
import { ReportInlet, reportEnvironment } from "./meldungen.ts";
import type { AnswerResult, Entscheidung } from "./meldungen.ts";
import { interfaceRoot, securityHeaders, serveInterface } from "./oberflaeche.ts";
import { openLog } from "./protokoll.ts";
import { privateFolderProblem } from "./private_datei.ts";
import type { Log } from "./protokoll.ts";
import { runHidden } from "./befehl.ts";
import { Menu } from "./menue.ts";
import { readStoredThreshold, storeThreshold } from "./schwelle.ts";
import { claudeVersion, openSelfTest } from "./selbsttest.ts";
import type { SelfTest } from "./selbsttest.ts";
import { resolveSessionFolder, Sessions } from "./sitzungen.ts";
import type { Standard } from "./sitzungen.ts";
import { defaultPermission, readBestand } from "./bestand.ts";
import type { Eingelesen } from "./bestand.ts";
import { installPlugin, linkLibrarySkill } from "./hinzufuegen.ts";
import type { Ergebnis } from "./hinzufuegen.ts";
import type { HakenArt } from "./nachrichten.ts";
import { OpenRouterModelle, readOpenRouterKey } from "./openrouter.ts";
import { INVENTORY_CACHE_MS, Optionsdienst } from "./optionsdienst.ts";
import { Projekte } from "./projekte.ts";
import { VorgabenSpeicher } from "./vorgaben.ts";
import { handleStop, STOP_PATH } from "./stopp.ts";
import { Hub } from "./verbindungen.ts";

export const MAX_MESSAGE_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
const LOOPBACK = "127.0.0.1";
const STATUS_PATH = "/status";
const WEBSOCKET_PATH = "/ws";
const NO_STORE = "no-store";

export class BridgeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BridgeError";
  }
}

export interface BridgeParts {
  readonly settings: Settings;
  readonly secret: string;
  readonly assistantSecret?: string;
  readonly log: Log;
  readonly claudeOrdner?: string;
  readonly claudeVersion?: () => Promise<string | null>;
}

export interface Bridge {
  readonly stopRequested: Promise<void>;
  close(): Promise<void>;
}

interface Late {
  context?: Context;
  inlet?: ReportInlet;
}

interface Context {
  readonly settings: Settings;
  readonly log: Log;
  readonly hub: Hub;
  readonly root: string;
  readonly hosts: ReadonlySet<string>;
  readonly headers: Readonly<Record<string, string>>;
  readonly sockets: WebSocketServer;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function fromAllowedOrigin(context: Context, request: IncomingMessage): boolean {
  return header(request, "origin") === context.settings.erlaubteHerkunft;
}

function pathnameOf(request: IncomingMessage): string | undefined {
  const url = request.url ?? "/";
  return URL.canParse(url, "http://127.0.0.1") ? new URL(url, "http://127.0.0.1").pathname : undefined;
}

function hostAllowed(context: Context, request: IncomingMessage): boolean {
  return context.hosts.has((header(request, "host") ?? "").toLowerCase());
}

function reply(context: Context, response: ServerResponse, status: number, extra: OutgoingHttpHeaders = {}, body?: unknown): void {
  const headers = { ...context.headers, "cache-control": NO_STORE, ...extra };
  if (body === undefined) {
    response.writeHead(status, headers).end();
    return;
  }
  response.writeHead(status, { ...headers, "content-type": "application/json" }).end(JSON.stringify(body));
}

function post(context: Context, request: IncomingMessage, response: ServerResponse): void {
  reply(context, response, fromAllowedOrigin(context, request) ? 404 : 403);
}

function status(context: Context, request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "GET") {
    reply(context, response, 405, { allow: "GET" });
  } else if (header(request, "origin") !== undefined && !fromAllowedOrigin(context, request)) {
    reply(context, response, 403);
  } else {
    reply(context, response, 200, {}, { bereit: true });
  }
}

async function route(context: Context, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = pathnameOf(request);
  if (!hostAllowed(context, request) || pathname === undefined) {
    reply(context, response, hostAllowed(context, request) ? 400 : 403);
    return;
  }
  if (request.method === "POST") {
    post(context, request, response);
  } else if (pathname === STATUS_PATH) {
    status(context, request, response);
  } else if (pathname === WEBSOCKET_PATH) {
    reply(context, response, 426, { upgrade: "websocket", connection: "Upgrade" });
  } else if (request.method === "GET" || request.method === "HEAD") {
    await serveInterface(context.root, request, response, context.headers);
  } else {
    reply(context, response, 405, { allow: "GET, HEAD, POST" });
  }
}

function handle(context: Context, request: IncomingMessage, response: ServerResponse): void {
  route(context, request, response).catch((error: unknown) => {
    context.log.error(`${request.method ?? "?"} ${pathnameOf(request) ?? "?"} failed`, error);
    if (response.headersSent) response.destroy();
    else reply(context, response, 500);
  });
}

function admission(context: Context, request: IncomingMessage): number | undefined {
  if (!hostAllowed(context, request)) return 403;
  if (pathnameOf(request) !== WEBSOCKET_PATH) return 404;
  return fromAllowedOrigin(context, request) ? undefined : 403;
}

function writeRefusal(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${String(status)} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => {
    socket.destroy();
  });
}

function refuse(context: Context, socket: Duplex, status: number): void {
  context.log.info(`WebSocket refused with ${String(status)}`);
  writeRefusal(socket, status);
}

function upgrade(context: Context, request: IncomingMessage, socket: Duplex, head: Buffer): void {
  socket.on("error", (error: Error) => {
    context.log.error("a connection failed during the WebSocket handshake", error);
  });
  const refusal = admission(context, request);
  if (refusal !== undefined) {
    refuse(context, socket, refusal);
    return;
  }
  context.sockets.handleUpgrade(request, socket, head, (webSocket) => {
    context.hub.accept(webSocket);
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => {
      reject(new BridgeError(`port ${String(port)} on ${LOOPBACK} cannot be used; is another program using it?`, { cause: error }));
    };
    server.once("error", failed);
    server.listen(port, LOOPBACK, () => {
      server.off("error", failed);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => {
    resolve();
  }));
}

function contextOf(parts: BridgeParts, hub: Hub, root: string): Context {
  const { settings, log } = parts;
  return {
    settings,
    log,
    hub,
    root,
    hosts: new Set([`${LOOPBACK}:${String(settings.portOberflaeche)}`, new URL(settings.erlaubteHerkunft).host]),
    headers: securityHeaders(settings.portOberflaeche),
    sockets: new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false }),
  };
}

function unavailable(response: ServerResponse): void {
  response.writeHead(503, { "retry-after": "1" }).end();
}

function bindServers(parts: BridgeParts, late: Late, onStop: () => void): { inletServer: Server; interfaceServer: Server } {
  const inletServer = createServer((request, response) => {
    if (request.url === STOP_PATH) handleStop(request, response, parts.secret, onStop);
    else if (late.inlet === undefined) unavailable(response);
    else late.inlet.handle(request, response);
  });
  const interfaceServer = createServer((request, response) => {
    if (late.context === undefined) unavailable(response);
    else handle(late.context, request, response);
  });
  interfaceServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (late.context === undefined) refuseEarly(socket);
    else upgrade(late.context, request, socket, head);
  });
  return { inletServer, interfaceServer };
}

function refuseEarly(socket: Duplex): void {
  writeRefusal(socket, 503);
}

async function listenBoth(settings: Settings, inletServer: Server, interfaceServer: Server): Promise<void> {
  await listen(inletServer, settings.portMeldeeingang);
  await listen(interfaceServer, settings.portOberflaeche).catch(async (error: unknown) => {
    await closeServer(inletServer);
    throw error;
  });
}

interface Helpers {
  readonly menu: Menu;
  readonly selfTest: SelfTest;
  readonly threshold: number;
  readonly claudeOrdner: string;
  readonly inventory: Inventory;
  readonly standard: { current: Standard };
}

interface Inventory {
  get(): Promise<Eingelesen>;
  forget(): void;
}

function inventoryOf(claudeOrdner: string, vault: string, seen: (read: Eingelesen) => void): Inventory {
  let cache: { at: number; read: Promise<Eingelesen> } | null = null;
  const claudeJson = process.env.CLAUDE_CONFIG_DIR === undefined ? path.join(homedir(), ".claude.json") : path.join(claudeOrdner, ".claude.json");
  return {
    get: () => {
      if (cache === null || Date.now() - cache.at >= INVENTORY_CACHE_MS) {
        cache = {
          at: Date.now(),
          read: readBestand({ claudeOrdner, claudeJson, vault }).then((read) => {
            seen(read);
            return read;
          }),
        };
      }
      const current = cache;
      return current.read.catch((error: unknown) => {
        if (cache === current) cache = null;
        throw error;
      });
    },
    forget: () => {
      cache = null;
    },
  };
}

function versionReader(parts: BridgeParts): () => Promise<string | null> {
  const { settings } = parts;
  return parts.claudeVersion ?? (() => claudeVersion(runHidden, settings.claudeBefehl, settings.vault));
}

async function openHelpers(parts: BridgeParts, refresh: () => void): Promise<Helpers> {
  const { settings, log } = parts;
  const version = await versionReader(parts)();
  const selfTest = await openSelfTest(settings.datenordner, version, {
    onChange: refresh,
    onProblem: (problem) => {
      log.info(problem);
    },
  });
  const claudeOrdner = parts.claudeOrdner ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");
  const { vault, erlaubteOrdner, qmdBefehl, claudeMem } = settings;
  const menu = new Menu({ vault, erlaubteOrdner, qmdBefehl, claudeMem, now: Date.now, run: runHidden });
  log.info(`Claude Code version ${version ?? "unknown"}`);
  const qmdProblem = await menu.qmdProblem();
  if (qmdProblem !== undefined) log.info(qmdProblem);
  const threshold = (await readStoredThreshold(settings.datenordner)) ?? settings.schwelleVerdichten;
  const standard = { current: { erlaubnis: await defaultPermission(claudeOrdner), plugins: [] as readonly string[] } };
  const inventory = inventoryOf(claudeOrdner, vault, (read) => {
    standard.current = { ...standard.current, plugins: read.plugins.filter((plugin) => plugin.aktivGlobal).map((plugin) => plugin.kennung) };
  });
  return { menu, selfTest, threshold, claudeOrdner, inventory, standard };
}

function adder(parts: BridgeParts, helpers: Helpers): (art: HakenArt, kennung: string, bestand: Eingelesen) => Promise<Ergebnis> {
  const orte = { claudeOrdner: helpers.claudeOrdner, vault: parts.settings.vault, claudeBefehl: parts.settings.claudeBefehl, run: runHidden, jetzt: Date.now };
  return async (art, kennung, bestand) => {
    if (art === "plugin") return installPlugin(orte, kennung);
    const source = bestand.bibliotheksOrte.get(kennung);
    return source === undefined ? { ok: false, text: `${kennung} steht nicht in der Bibliothek.` } : linkLibrarySkill(orte, kennung, source);
  };
}

function serviceOf(parts: BridgeParts, sessions: Sessions, helpers: Helpers): Optionsdienst {
  const { settings, log } = parts;
  return new Optionsdienst({
    sitzungen: sessions,
    bestand: () => helpers.inventory.get(),
    vorgaben: new VorgabenSpeicher(settings.datenordner),
    projekte: new Projekte(settings),
    openrouter: new OpenRouterModelle({ schluesselDatei: settings.openrouterSchluessel, datenordner: settings.datenordner }),
    standardErlaubnis: () => defaultPermission(helpers.claudeOrdner),
    linkGesperrt: null,
    einbinden: adder(parts, helpers),
    ordnerPruefen: (ordner) => resolveSessionFolder(settings, ordner),
    vergessen: () => {
      helpers.inventory.forget();
    },
    jetzt: Date.now,
    log: (text) => {
      log.info(text);
    },
  });
}

function hubOf(parts: BridgeParts, sessions: Sessions, inlet: ReportInlet, helpers: Helpers, shutDown: () => void): Hub {
  const { settings, log } = parts;
  return new Hub({
    sessions,
    log,
    answer: (frage: string, entscheidung: Entscheidung): AnswerResult => inlet.answer(frage, entscheidung),
    now: Date.now,
    schwelleVerdichten: helpers.threshold,
    menu: helpers.menu,
    dienst: serviceOf(parts, sessions, helpers),
    selfTest: helpers.selfTest,
    storeThreshold: (value) => storeThreshold(settings.datenordner, value),
    readVersion: versionReader(parts),
    shutDown,
    ...(parts.assistantSecret === undefined ? {} : { assistenzGeheimnis: parts.assistantSecret }),
  });
}

async function openParts(parts: BridgeParts, late: Late, shutDown: () => void): Promise<{ hub: Hub; sessions: Sessions; selfTest: SelfTest }> {
  const { settings, log } = parts;
  const hubHolder: { hub?: Hub; inlet?: ReportInlet } = {};
  const helpers = await openHelpers(parts, () => {
    hubHolder.hub?.refresh();
  });
  const sessions = await Sessions.open(settings, (event) => {
    hubHolder.hub?.onSessionEvent(event);
    if (event.kind === "geaendert") hubHolder.inlet?.sessionsChanged();
  }, {
    zusatzUmgebung: reportEnvironment(settings),
    startKontext: async () => ({ installiertePlugins: (await helpers.inventory.get()).plugins.map((plugin) => plugin.kennung) }),
    schluessel: () => readOpenRouterKey(settings.openrouterSchluessel),
    standard: () => helpers.standard.current,
  });
  const inlet = new ReportInlet({
    secret: parts.secret,
    sessions,
    onReport: (report) => hubHolder.hub?.onReport(report),
    onError: (error) => {
      log.error("a report failed", error);
    },
  });
  const hub = hubOf(parts, sessions, inlet, helpers, shutDown);
  hubHolder.hub = hub;
  hubHolder.inlet = inlet;
  late.inlet = inlet;
  return { hub, sessions, selfTest: helpers.selfTest };
}

function keepAlive(hub: Hub): () => void {
  const heartbeat = setInterval(() => {
    hub.heartbeat();
  }, HEARTBEAT_MS);
  return () => {
    clearInterval(heartbeat);
  };
}

export async function startBridge(parts: BridgeParts): Promise<Bridge> {
  const root = await interfaceRoot(parts.settings.oberflaeche);
  const late: Late = {};
  let stop = (): void => undefined;
  const stopRequested = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const { inletServer, interfaceServer } = bindServers(parts, late, () => {
    stop();
  });
  await listenBoth(parts.settings, inletServer, interfaceServer);
  try {
    const { hub, sessions, selfTest } = await openParts(parts, late, () => {
      stop();
    });
    late.context = contextOf(parts, hub, root);
    const stopHeartbeat = keepAlive(hub);
    const stopChecks = (): void => {
      stopHeartbeat();
      selfTest.close();
    };
    return { stopRequested, close: closer(stopChecks, hub, sessions, [interfaceServer, inletServer]) };
  } catch (error: unknown) {
    await Promise.all([closeServer(interfaceServer), closeServer(inletServer)]);
    throw error;
  }
}

function closer(stopChecks: () => void, hub: Hub, sessions: Sessions, servers: readonly Server[]): () => Promise<void> {
  return async () => {
    stopChecks();
    await hub.closeAll();
    await Promise.all(servers.map(closeServer));
    await sessions.close();
  };
}

function stopSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        resolve(signal);
      });
    }
  });
}

async function run(settings: Settings, log: Log): Promise<void> {
  const release = await claimSingleProcess(settings.datenordner);
  try {
    const folderProblem = await privateFolderProblem(settings.datenordner);
    if (folderProblem !== undefined) throw new BridgeError(folderProblem);
    const secret = await readOrCreateSecret(settings.geheimnis);
    const assistantSecret = await readOrCreateSecret(settings.assistenzGeheimnis);
    const bridge = await startBridge({ settings, secret, assistantSecret, log });
    const address = `listening on http://${LOOPBACK}:${String(settings.portOberflaeche)} (interface) and ${LOOPBACK}:${String(settings.portMeldeeingang)} (report inlet)`;
    log.info(address);
    process.stdout.write(`${address}\n`);
    log.info(`stopping after ${await Promise.race([stopSignal(), bridge.stopRequested.then(() => "a stop request")])}`);
    await bridge.close();
  } finally {
    await release();
  }
}

async function main(): Promise<void> {
  const settings = await loadSettings(settingsFilePath(process.argv, process.env));
  const log = await openLog(settings.datenordner);
  try {
    await run(settings, log);
  } catch (error: unknown) {
    if (error instanceof AlreadyRunningError) log.info(error.message);
    else log.error("the bridge stopped", error);
    throw error;
  } finally {
    await log.close();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

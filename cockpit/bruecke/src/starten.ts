import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { loadSettings, SettingsError, settingsFilePath } from "./einstellungen.ts";
import { writePrivateFile } from "./private_datei.ts";
import { keepOnePrevious } from "./protokoll.ts";
import { cleanStartLog, failurePage, failurePagePath, FAILURE_PAGE_FILE, readStartLog } from "./startfehler.ts";
import type { StartGrund } from "./startfehler.ts";
import type { Settings } from "./einstellungen.ts";

export const START_LOG_FILE = "start.log";
const BRIDGE_FOLDER = path.resolve(import.meta.dirname, "..");
const SERVER_SCRIPT = path.join(BRIDGE_FOLDER, "src", "server.ts");
const PAGE = "/kommandozentrale";
const HEADLESS = "--headless";
const LOOPBACK = "127.0.0.1";
const PROBE_TIMEOUT_MS = 1_000;
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 200;
const LONGEST_PROBE_ANSWER = 4 * 1024;
const OWNER_ONLY_FOLDER = 0o700;
const OWNER_ONLY_FILE = 0o600;
const SAFE_ADDRESS = /^https?:\/\/[A-Za-z0-9.:[\]-]+\/kommandozentrale$/;
const FALLBACK_FOLDER = "repocity_bruecke";

export class StartError extends Error {
  readonly grund: StartGrund;

  constructor(message: string, grund: StartGrund = "unbekannt", options?: ErrorOptions) {
    super(message, options);
    this.name = "StartError";
    this.grund = grund;
  }
}

export interface StartOptions {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly openBrowser?: (address: string) => void;
  readonly openFile?: (file: string) => void;
}

export interface StartResult {
  readonly gestartet: boolean;
  readonly adresse: string;
}

type Probe = "laeuft" | "frei" | "fremd";

function isBridgeStatus(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && "bereit" in parsed && parsed.bereit === true;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function probe(port: number): Promise<Probe> {
  return new Promise((resolve) => {
    const headers = { host: `${LOOPBACK}:${String(port)}` };
    const options = { host: LOOPBACK, port, path: "/status", headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) };
    const outgoing = request(options, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => {
        if (text.length < LONGEST_PROBE_ANSWER) text += chunk;
      });
      incoming.on("end", () => {
        resolve(isBridgeStatus(text) ? "laeuft" : "fremd");
      });
    });
    outgoing.on("error", (error: Error) => {
      resolve("code" in error && error.code === "ECONNREFUSED" ? "frei" : "fremd");
    });
    outgoing.end();
  });
}

export function bridgeCommand(
  settingsFile: string,
  env: StartOptions["env"],
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  const bridge = [SERVER_SCRIPT, "--einstellungen", settingsFile];
  if (platform !== "win32") return [process.execPath, bridge];
  return [path.win32.join(systemRootOf(env, "the hidden console host"), "System32", "conhost.exe"), [HEADLESS, process.execPath, ...bridge]];
}

function systemRootOf(env: StartOptions["env"], what: string): string {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
  if (systemRoot === undefined) throw new StartError(`SystemRoot is not set, so ${what} cannot be found`);
  return systemRoot;
}

function launch(settingsFile: string, dataFolder: string, env: StartOptions["env"]): Promise<number | null> {
  mkdirSync(dataFolder, { recursive: true, mode: OWNER_ONLY_FOLDER });
  const startLog = path.join(dataFolder, START_LOG_FILE);
  keepOnePrevious(startLog);
  const output = openSync(startLog, "a", OWNER_ONLY_FILE);
  try {
    const [command, args] = bridgeCommand(settingsFile, env);
    const child = spawn(command, args, {
      cwd: BRIDGE_FOLDER,
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, output],
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    child.unref();
    return exited;
  } finally {
    closeSync(output);
  }
}

async function waitUntilRunning(port: number, exited: Promise<number | null>, startLog: string): Promise<void> {
  const failure = exited.then((code) => {
    throw new StartError(`the bridge ended with code ${String(code)} right after the start; see ${startLog}`, "beendet");
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await Promise.race([probe(port), failure]);
    if (state === "laeuft") return;
    await Promise.race([wait(POLL_MS), failure]);
  }
  throw new StartError(`the bridge did not answer within ${String(START_TIMEOUT_MS / 1000)} s; see ${startLog}`, "keine_antwort");
}

function appBrowsers(platform: NodeJS.Platform, env: StartOptions["env"]): string[] {
  if (platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
  if (platform !== "win32") return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  const folders = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter((folder): folder is string => folder !== undefined && folder !== "");
  return [
    ...folders.map((folder) => path.win32.join(folder, "Google", "Chrome", "Application", "chrome.exe")),
    ...folders.map((folder) => path.win32.join(folder, "Microsoft", "Edge", "Application", "msedge.exe")),
  ];
}

export function appWindowCommand(
  address: string,
  platform: NodeJS.Platform = process.platform,
  env: StartOptions["env"] = process.env,
  exists: (file: string) => boolean = existsSync,
): [string, string[]] | null {
  const browser = appBrowsers(platform, env).find(exists);
  return browser === undefined ? null : [browser, [`--app=${address}`]];
}

function defaultBrowserCommand(address: string): [string, string[]] {
  return process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "start", '""', address]]
    : [process.platform === "darwin" ? "open" : "xdg-open", [address]];
}

export function openInBrowser(address: string): void {
  if (!SAFE_ADDRESS.test(address)) throw new StartError(`refusing to open the unexpected address ${address}`);
  const appWindow = appWindowCommand(address);
  const [command, args] = appWindow ?? defaultBrowserCommand(address);
  const child = spawn(command, args, { detached: true, windowsHide: true, stdio: "ignore", windowsVerbatimArguments: appWindow === null });
  child.on("error", (error) => {
    process.stderr.write(`open ${address} in your browser; starting the browser failed: ${error.message}\n`);
  });
  child.unref();
}

async function ensureRunning(settings: Settings, settingsFile: string, env: StartOptions["env"]): Promise<boolean> {
  const state = await probe(settings.portOberflaeche);
  if (state === "laeuft") return false;
  if (state === "fremd") {
    throw new StartError(
      `port ${String(settings.portOberflaeche)} on ${LOOPBACK} answers, but not as the bridge; stop that program or change portOberflaeche`,
      "port_fremd",
    );
  }
  const exited = launch(settingsFile, settings.datenordner, env);
  const startLog = path.join(settings.datenordner, START_LOG_FILE);
  try {
    await waitUntilRunning(settings.portOberflaeche, exited, startLog);
  } finally {
    await cleanStartLog(startLog);
  }
  return true;
}

export async function startAndOpen(options: StartOptions): Promise<StartResult> {
  const settingsFile = settingsFilePath(options.argv, options.env);
  const settings = await loadSettings(settingsFile);
  const gestartet = await ensureRunning(settings, settingsFile, options.env);
  const adresse = `${settings.erlaubteHerkunft}${PAGE}`;
  (options.openBrowser ?? openInBrowser)(adresse);
  return { gestartet, adresse };
}

export function openFileInBrowser(file: string): void {
  if (!path.isAbsolute(file) || path.basename(file) !== FAILURE_PAGE_FILE) throw new StartError(`refusing to open the unexpected file ${file}`);
  const [command, args] =
    process.platform === "win32"
      ? [path.win32.join(systemRootOf(process.env, "the Explorer"), "explorer.exe"), [file]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [file]];
  const child = spawn(command, args, { detached: true, windowsHide: true, stdio: "ignore" });
  child.on("error", (error) => {
    process.stderr.write(`open ${file} in your browser; starting the browser failed: ${error.message}\n`);
  });
  child.unref();
}

function reasonOf(error: unknown): StartGrund {
  if (error instanceof SettingsError) return "einstellungen";
  return error instanceof StartError ? error.grund : "unbekannt";
}

async function dataFolderOf(options: StartOptions): Promise<string | null> {
  try {
    return (await loadSettings(settingsFilePath(options.argv, options.env))).datenordner;
  } catch (error: unknown) {
    if (error instanceof SettingsError) return null;
    throw error;
  }
}

export async function showFailure(error: unknown, options: StartOptions): Promise<string> {
  const dataFolder = await dataFolderOf(options);
  const folder = dataFolder ?? path.join(tmpdir(), FALLBACK_FOLDER);
  const startprotokoll = dataFolder === null ? null : await readStartLog(path.join(dataFolder, START_LOG_FILE));
  const meldung = error instanceof Error ? error.message : String(error);
  const file = failurePagePath(folder);
  await writePrivateFile(file, failurePage({ grund: reasonOf(error), meldung, startprotokoll }));
  (options.openFile ?? openFileInBrowser)(file);
  return file;
}

export async function runStarter(options: StartOptions = { argv: process.argv, env: process.env }): Promise<void> {
  try {
    const { adresse } = await startAndOpen(options);
    process.stdout.write(`Kommandozentrale: ${adresse}\n`);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    await showFailure(error, options);
  }
}

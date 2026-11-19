import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { LOCK_FILE } from "../src/einzelprozess.ts";
import { appWindowCommand, bridgeCommand, openFileInBrowser, openInBrowser, runStarter, showFailure, START_LOG_FILE, startAndOpen, StartError } from "../src/starten.ts";
import { FAILURE_PAGE_FILE } from "../src/startfehler.ts";
import { stopBridge } from "../src/stoppen.ts";

const SERVER_SCRIPT = fileURLToPath(new URL("../src/server.ts", import.meta.url));
const STAND_IN = fileURLToPath(new URL("hilfen/ersatz_claude.ts", import.meta.url));
const PROCESS_TEST_MS = 90_000;
const STARTED_WITHIN_MS = 30_000;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

let root: string;
let settingsFile: string;
let dataFolder: string;
let port: number;
let servers: Server[];
let started: number[];

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port: free } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => {
    resolve();
  }));
  return free;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "bruecke-starten-")));
  const vault = path.join(root, "vault");
  const dist = path.join(root, "dist");
  dataFolder = path.join(root, "daten");
  for (const folder of [vault, dist, path.join(root, "konfig")]) await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dist, "index.html"), "<!doctype html>");
  port = await freePort();
  settingsFile = path.join(root, "bruecke.json");
  await writeFile(
    settingsFile,
    JSON.stringify({
      portOberflaeche: port,
      portMeldeeingang: await freePort(),
      vault,
      erlaubteOrdner: [vault],
      claudeBefehl: [process.execPath, STAND_IN],
      datenordner: dataFolder,
      geheimnis: path.join(root, "konfig", "geheimnis"),
      assistenzGeheimnis: path.join(root, "konfig", "assistenz_geheimnis"),
      erlaubteHerkunft: `http://127.0.0.1:${String(port)}`,
      oberflaeche: dist,
    }),
  );
  servers = [];
  started = [];
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  for (const server of servers) server.close();
  for (const pid of started) {
    if (isRunning(pid)) process.kill(pid);
    await expect.poll(() => isRunning(pid), { timeout: 10_000 }).toBe(false);
  }
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

async function serveOnPort(status: number, body: string): Promise<void> {
  const server = createServer((incoming, outgoing) => {
    incoming.resume();
    outgoing.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  servers.push(server);
}

async function bridgePid(): Promise<number> {
  const pid = Number(await readFile(path.join(dataFolder, LOCK_FILE), "utf8"));
  started.push(pid);
  return pid;
}

function runServer(): Promise<Run> {
  const child = spawn(process.execPath, [SERVER_SCRIPT, "--einstellungen", settingsFile], { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function statusCode(): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path: "/status", headers: { host: `127.0.0.1:${String(port)}` } }, (incoming) => {
      incoming.resume();
      resolve(incoming.statusCode ?? 0);
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("startAndOpen", { timeout: PROCESS_TEST_MS }, () => {
  it("opens the address of the Kommandozentrale without starting a second bridge when one runs", async () => {
    await serveOnPort(200, JSON.stringify({ bereit: true }));
    const opened: string[] = [];
    const result = await startAndOpen({ argv: ["--einstellungen", settingsFile], env: process.env, openBrowser: (url) => opened.push(url) });
    expect(result).toEqual({ gestartet: false, adresse: `http://127.0.0.1:${String(port)}/kommandozentrale` });
    expect(opened).toEqual([`http://127.0.0.1:${String(port)}/kommandozentrale`]);
  });

  it("refuses to open anything when another program uses the port", async () => {
    await serveOnPort(404, "<html>fremd</html>");
    const opened: string[] = [];
    const failure = startAndOpen({ argv: ["--einstellungen", settingsFile], env: process.env, openBrowser: (url) => opened.push(url) });
    await expect(failure).rejects.toThrow(StartError);
    await expect(failure).rejects.toThrow(String(port));
    expect(opened).toEqual([]);
  });

  it("starts the bridge detached with its output in the start log, waits for it and then opens the address", async () => {
    const opened: string[] = [];
    const result = await startAndOpen({ argv: [], env: { ...process.env, BRUECKE_EINSTELLUNGEN: settingsFile }, openBrowser: (url) => opened.push(url) });
    const pid = await bridgePid();
    expect(result.gestartet).toBe(true);
    expect(opened).toEqual([result.adresse]);
    expect(await statusCode()).toBe(200);
    expect(pid).not.toBe(process.pid);
    const startLog = await readFile(path.join(dataFolder, START_LOG_FILE), "utf8");
    expect(startLog).toContain("listening");
    expect(startLog).not.toContain("\x1b");
  });

  it("reports a bridge that cannot start and points to the start log", async () => {
    await rm(path.join(root, "dist"), { recursive: true });
    const failure = startAndOpen({ argv: ["--einstellungen", settingsFile], env: process.env, openBrowser: () => undefined });
    await expect(failure).rejects.toThrow(path.join(dataFolder, START_LOG_FILE));
    const startLog = await readFile(path.join(dataFolder, START_LOG_FILE), "utf8");
    expect(startLog).toContain(path.join(root, "dist"));
    expect(startLog).not.toContain("\x1b");
  });
});

describe("data folder others can read", { timeout: PROCESS_TEST_MS }, () => {
  it.skipIf(process.platform === "win32")("keeps the bridge from starting and names the folder", async () => {
    await mkdir(dataFolder, { recursive: true });
    await chmod(dataFolder, 0o755);
    const failure = startAndOpen({ argv: ["--einstellungen", settingsFile], env: process.env, openBrowser: () => undefined });
    await expect(failure).rejects.toThrow(StartError);
    expect(await readFile(path.join(dataFolder, START_LOG_FILE), "utf8")).toContain(dataFolder);
  });
});

describe("failure page for Daniel", { timeout: PROCESS_TEST_MS }, () => {
  it("opens a page in the data folder that names cause, next step and the start log, and never the browser address", async () => {
    await rm(path.join(root, "dist"), { recursive: true });
    const opened: string[] = [];
    const files: string[] = [];
    const exitCode = process.exitCode;
    try {
      await runStarter({ argv: ["--einstellungen", settingsFile], env: process.env, openBrowser: (url) => opened.push(url), openFile: (file) => files.push(file) });
    } finally {
      process.exitCode = exitCode;
    }
    expect(opened).toEqual([]);
    expect(files).toEqual([path.join(dataFolder, FAILURE_PAGE_FILE)]);
    const page = await readFile(path.join(dataFolder, FAILURE_PAGE_FILE), "utf8");
    expect(page).toContain("Die Brücke hat sich gleich nach dem Start wieder beendet.");
    expect(page).toContain("Nächster Schritt:");
    expect(page).toContain("Letzte Zeilen aus dem Startprotokoll");
    expect(page).toContain(path.join(root, "dist").replaceAll("&", "&amp;"));
    const secret = (await readFile(path.join(root, "konfig", "geheimnis"), "utf8")).trim();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(page).not.toContain(secret);
  });

  it("names a broken settings file and writes the page outside the unknown data folder", async () => {
    await writeFile(settingsFile, "{kaputt");
    const files: string[] = [];
    const file = await showFailure(new Error("x"), { argv: ["--einstellungen", settingsFile], env: process.env, openFile: (opened) => files.push(opened) });
    try {
      expect(files).toEqual([file]);
      expect(path.basename(file)).toBe(FAILURE_PAGE_FILE);
      expect(file.startsWith(dataFolder)).toBe(false);
    } finally {
      await rm(file, { force: true });
    }
  });
});

describe("only one bridge", { timeout: PROCESS_TEST_MS }, () => {
  it("does not start a second bridge on the same data folder and says so", async () => {
    await startAndOpen({ argv: ["--einstellungen", settingsFile], env: process.env, openBrowser: () => undefined });
    const pid = await bridgePid();
    const second = await runServer();
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("already running");
    expect(second.stderr).toContain(String(pid));
    expect(await statusCode()).toBe(200);
  }, STARTED_WITHIN_MS * 2);

  it.skipIf(process.platform === "win32")("shuts down cleanly on SIGTERM and removes the lock file", async () => {
    const child = spawn(process.execPath, [SERVER_SCRIPT, "--einstellungen", settingsFile], { stdio: "ignore", windowsHide: true });
    await expect.poll(statusCode, { timeout: STARTED_WITHIN_MS }).toBe(200);
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
    await expect(readFile(path.join(dataFolder, LOCK_FILE), "utf8")).rejects.toThrow();
  });
});

describe("openFileInBrowser", () => {
  it.each(["start_fehler.html", "/tmp/anderes.html", "/tmp/start_fehler.html.exe"])("refuses to open %s", (file) => {
    expect(() => {
      openFileInBrowser(file);
    }).toThrow(StartError);
  });
});

describe("appWindowCommand", () => {
  const address = "http://127.0.0.1:8787/kommandozentrale";
  const windows = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\d\\AppData\\Local" };

  it("opens the page as an app window in Chrome on Windows", () => {
    const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    expect(appWindowCommand(address, "win32", windows, (file) => file === chrome)).toEqual([chrome, [`--app=${address}`]]);
  });

  it("takes Chrome of the user before Edge", () => {
    const chrome = "C:\\Users\\d\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    expect(appWindowCommand(address, "win32", windows, (file) => file === chrome || file === edge)?.[0]).toBe(chrome);
  });

  it("falls back to Edge when Chrome is missing", () => {
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    expect(appWindowCommand(address, "win32", windows, (file) => file === edge)?.[0]).toBe(edge);
  });

  it("finds Chromium on Linux", () => {
    expect(appWindowCommand(address, "linux", {}, (file) => file === "/usr/bin/chromium")).toEqual(["/usr/bin/chromium", [`--app=${address}`]]);
  });

  it("gives no app window without a known browser, so the default browser opens the page", () => {
    expect(appWindowCommand(address, "win32", windows, () => false)).toBeNull();
    expect(appWindowCommand(address, "win32", {}, () => true)).toBeNull();
  });
});

describe("openInBrowser", () => {
  it.each([
    "http://127.0.0.1:8787/kommandozentrale&calc",
    "http://127.0.0.1:8787/kommandozentrale\" & calc",
    "http://127.0.0.1:8787/anderes",
    "file:///C:/Windows/kommandozentrale",
    "http://127.0.0.1:8787/kommandozentrale|calc",
  ])("refuses to hand %s to the shell", (address) => {
    expect(() => {
      openInBrowser(address);
    }).toThrow(StartError);
  });
});

describe("stopping", { timeout: PROCESS_TEST_MS }, () => {
  async function bridgeWithSession(): Promise<{ pid: number; standIn: number; processes: string }> {
    const processes = path.join(root, "prozesse");
    await mkdir(processes);
    await mkdir(dataFolder, { recursive: true, mode: 0o700 });
    const session = { id: "11111111-2222-4333-8444-555555555555", ordner: path.join(root, "vault"), claudeSitzung: null, prozess: "laeuft", exitCode: null, hinweis: null };
    await writeFile(path.join(dataFolder, "zustand.json"), JSON.stringify({ sitzungen: [session] }), { mode: 0o600 });
    await startAndOpen({ argv: ["--einstellungen", settingsFile], env: { ...process.env, ERSATZ_PROZESS_ORDNER: processes }, openBrowser: () => undefined });
    const pid = await bridgePid();
    await expect.poll(() => readdir(processes), { timeout: STARTED_WITHIN_MS }).toHaveLength(1);
    const standIn = Number((await readdir(processes))[0]);
    started.push(standIn);
    return { pid, standIn, processes };
  }

  it("npm run stop shuts the bridge down in order: sessions end, the lock file is gone, the process ends", async () => {
    const { pid, standIn } = await bridgeWithSession();
    expect(isRunning(standIn)).toBe(true);
    expect(await stopBridge({ argv: ["--einstellungen", settingsFile], env: process.env })).toBe("gestoppt");
    await expect(readFile(path.join(dataFolder, LOCK_FILE), "utf8")).rejects.toThrow();
    await expect.poll(() => isRunning(pid), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => isRunning(standIn), { timeout: 10_000 }).toBe(false);
    expect(await readFile(path.join(dataFolder, "bruecke.log"), "utf8")).toContain("stopping after a stop request");
  });

  it("ends the bridge with all its sessions when the controlling device asks for it in the Kommandozentrale", async () => {
    const { pid, standIn } = await bridgeWithSession();
    const origin = `http://127.0.0.1:${String(port)}`;
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, { origin });
    const messages: string[] = [];
    socket.on("message", (data) => {
      if (Buffer.isBuffer(data)) messages.push(data.toString("utf8"));
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ typ: "hallo", geraet: "geraet-pc-0000000001", name: "PC", modus: "arbeiten" }));
    await expect.poll(() => messages.some((text) => text.includes('"typ":"zustand"'))).toBe(true);
    socket.send(JSON.stringify({ typ: "herunterfahren" }));
    await expect.poll(() => messages.includes(JSON.stringify({ typ: "beendet" }))).toBe(true);
    await expect.poll(() => isRunning(pid), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => isRunning(standIn), { timeout: 15_000 }).toBe(false);
    await expect(readFile(path.join(dataFolder, LOCK_FILE), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(dataFolder, "bruecke.log"), "utf8")).toContain("stopping after a stop request");
  });

  it("says that no bridge runs when none does", async () => {
    expect(await stopBridge({ argv: ["--einstellungen", settingsFile], env: process.env })).toBe("lief_nicht");
  });

  it("ends the session processes too when the bridge is killed hard", async () => {
    const { pid, standIn } = await bridgeWithSession();
    process.kill(pid, "SIGKILL");
    await expect.poll(() => isRunning(pid), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => isRunning(standIn), { timeout: 15_000 }).toBe(false);
  });
});

describe("start log", { timeout: PROCESS_TEST_MS }, () => {
  it("keeps one predecessor when the start log has grown past 5 MB", async () => {
    await mkdir(dataFolder, { recursive: true, mode: 0o700 });
    const startLog = path.join(dataFolder, START_LOG_FILE);
    await writeFile(startLog, "a".repeat(5 * 1024 * 1024 + 1));
    await startAndOpen({ argv: ["--einstellungen", settingsFile], env: process.env, openBrowser: () => undefined });
    await bridgePid();
    expect((await readFile(`${startLog}.1`, "utf8")).length).toBe(5 * 1024 * 1024 + 1);
    expect(await readFile(startLog, "utf8")).toContain("listening");
  });
});

describe("bridgeCommand", () => {
  it("starts node directly on Linux", () => {
    expect(bridgeCommand("/srv/bruecke.json", {}, "linux")).toEqual([process.execPath, [SERVER_SCRIPT, "--einstellungen", "/srv/bruecke.json"]]);
  });

  it("starts node inside a headless console host on Windows, so no helper process gets a window", () => {
    expect(bridgeCommand("D:/b.json", { SystemRoot: "C:/Windows" }, "win32")).toEqual([
      path.win32.join("C:/Windows", "System32", "conhost.exe"),
      ["--headless", process.execPath, SERVER_SCRIPT, "--einstellungen", "D:/b.json"],
    ]);
  });

  it("refuses to guess the console host on Windows without SystemRoot", () => {
    expect(() => bridgeCommand("D:/b.json", {}, "win32")).toThrow(StartError);
  });
});

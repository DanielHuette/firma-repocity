import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatProzess } from "../src/chatprozess.ts";
import { Sessions } from "../src/sitzungen.ts";
import type { SessionEvent, SessionOptions } from "../src/sitzungen.ts";
import { OHNE_OPTIONEN } from "../src/sitzungsoptionen.ts";
import type { GespeicherteOptionen } from "../src/sitzungsoptionen.ts";

const STAND_IN = fileURLToPath(new URL("hilfen/ersatz_claude.ts", import.meta.url));
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const KEY = "sk-or-v1-geheim0123456789abcdef";
const HALF = KEY.slice(0, Math.floor(KEY.length / 2));
const WAIT_MS = 20_000;
const POLL_MS = 20;
const PROCESS_TEST_MS = 40_000;

let root: string;
let vault: string;
let dataFolder: string;
let opened: Sessions[];
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "bruecke-runde3-")));
  vault = path.join(root, "vault");
  dataFolder = path.join(root, "daten");
  await mkdir(vault, { recursive: true });
  opened = [];
  saved = { ERSATZ_CLAUDE_SITZUNG: process.env.ERSATZ_CLAUDE_SITZUNG, ERSATZ_SCHEITERT_BEI: process.env.ERSATZ_SCHEITERT_BEI, ERSATZ_STEUERUNG_SCHEITERT: process.env.ERSATZ_STEUERUNG_SCHEITERT };
  process.env.ERSATZ_CLAUDE_SITZUNG = CLAUDE_ID;
});

afterEach(async () => {
  for (const sessions of opened) await sessions.close();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

interface Harness {
  sessions: Sessions;
  events: SessionEvent[];
}

async function open(options: SessionOptions = {}): Promise<Harness> {
  const events: SessionEvent[] = [];
  const settings = { vault, erlaubteOrdner: [vault], claudeBefehl: [process.execPath, STAND_IN], datenordner: dataFolder };
  const sessions = await Sessions.open(settings, (event) => events.push(event), { startKontext: () => Promise.resolve({ installiertePlugins: ["a@m", "b@m"] }), ...options });
  opened.push(sessions);
  return { sessions, events };
}

function texts(events: readonly SessionEvent[], id: string): string[] {
  const shown = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "chat" || event.sitzung !== id) continue;
    const { schritt } = event;
    if (schritt.art === "teil") shown.set(schritt.id, `${shown.get(schritt.id) ?? ""}${schritt.text}`);
    else shown.set(schritt.eintrag.id, schritt.eintrag.text ?? "");
  }
  return [...shown.values()];
}

function output(events: readonly SessionEvent[], id: string): string {
  return texts(events, id).join("\n");
}

function starts(events: readonly SessionEvent[], id: string): string[][] {
  return texts(events, id).flatMap((text) => {
    const found = /ARGUMENTE (.*)$/m.exec(text);
    return found?.[1] === undefined ? [] : [JSON.parse(found[1]) as string[]];
  });
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const end = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function running(harness: Harness, wahl: Partial<GespeicherteOptionen> = {}): Promise<string> {
  const { id } = await harness.sessions.create(undefined, wahl);
  await waitFor(() => harness.sessions.list().find((entry) => entry.id === id)?.claudeSitzung === CLAUDE_ID && starts(harness.events, id).length === 1, "the start");
  return id;
}

async function turn(harness: Harness, id: string, text: string, answer = `ECHO ${text}`): Promise<void> {
  expect(harness.sessions.send(id, text)).toEqual({ kind: "ok" });
  await waitFor(() => output(harness.events, id).includes(answer), answer);
}

describe("a broken start context", { timeout: PROCESS_TEST_MS }, () => {
  it("does not stop a new session and says so", async () => {
    const harness = await open({ startKontext: () => Promise.reject(new Error("EPERM bestand")) });
    const id = await running(harness);
    expect(harness.sessions.list()).toHaveLength(1);
    expect(harness.events.some((event) => event.kind === "stoerung" && event.text.includes("EPERM bestand"))).toBe(true);
    await turn(harness, id, "geht");
  });

  it("does not stop the bridge from opening with a stored running session", async () => {
    await mkdir(dataFolder, { recursive: true });
    const old = { id: SESSION_ID, ordner: vault, claudeSitzung: CLAUDE_ID, prozess: "laeuft", exitCode: null, hinweis: null, optionen: OHNE_OPTIONEN };
    await writeFile(path.join(dataFolder, "zustand.json"), JSON.stringify({ sitzungen: [old] }));
    const harness = await open({ startKontext: () => Promise.reject(new Error("EPERM bestand")) });
    await waitFor(() => starts(harness.events, SESSION_ID).length === 1, "the restart");
    expect(harness.sessions.list()[0]?.prozess).toBe("laeuft");
  });
});

describe("open turns", { timeout: PROCESS_TEST_MS }, () => {
  it("recover after a message without result once Claude Code reports no queued turn", async () => {
    const harness = await open();
    const id = await running(harness);
    await turn(harness, id, "!", "ENV KOMMANDOZENTRALE_SITZUNG");
    await turn(harness, id, "eins");
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "zwei");
    expect(starts(harness.events, id)).toHaveLength(2);
  });

  it("count a turn that is still queued, so no restart happens before it ends", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "lang");
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "zwei");
    await turn(harness, id, "drei");
    expect(starts(harness.events, id)).toHaveLength(1);
    harness.sessions.interrupt(id);
  });
});

describe("permission mode", { timeout: PROCESS_TEST_MS }, () => {
  it("ends confirmed on the last of two quick changes", async () => {
    const harness = await open();
    const id = await running(harness);
    void harness.sessions.setSetting(id, "erlaubnis", "plan");
    await harness.sessions.setSetting(id, "erlaubnis", "acceptEdits");
    await waitFor(() => harness.sessions.options(id)?.erlaubnisBestaetigt === true && harness.sessions.options(id)?.erlaubnis === "acceptEdits", "the confirmation");
  });

  it("shows the old mode, not the wanted one, before the confirmation", async () => {
    process.env.ERSATZ_STEUERUNG_SCHEITERT = "set_permission_mode";
    const harness = await open({ standard: () => ({ erlaubnis: "auto", plugins: [] }) });
    const id = await running(harness);
    await harness.sessions.setSetting(id, "erlaubnis", "plan");
    await waitFor(() => output(harness.events, id).includes("Erlaubnismodus nicht übernommen"), "the note");
    expect(harness.sessions.options(id)).toMatchObject({ erlaubnis: "auto", erlaubnisBestaetigt: false });
  });

  it("is not left unconfirmed on an ended session", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "ende");
    await waitFor(() => harness.sessions.list()[0]?.prozess === "beendet", "the end");
    await harness.sessions.setSetting(id, "erlaubnis", "plan");
    expect(harness.sessions.options(id)?.erlaubnisBestaetigt).toBe(true);
  });

  it("cannot be changed in a check session", async () => {
    const harness = await open();
    const id = await running(harness, { pruefung: true, erlaubnis: "default" });
    expect(await harness.sessions.setSetting(id, "erlaubnis", "auto")).toEqual({ kind: "gesperrt" });
    expect(harness.sessions.options(id)).toMatchObject({ pruefung: true, erlaubnis: "default" });
    expect(harness.sessions.isCheck(id)).toBe(true);
  });
});

describe("second attempt after a failed restart", { timeout: PROCESS_TEST_MS }, () => {
  it("goes back to every option that ran before, not only the fast mode", async () => {
    process.env.ERSATZ_SCHEITERT_BEI = '"fastMode":true';
    process.env.ERSATZ_STEUERUNG_SCHEITERT = "apply_flag_settings";
    const harness = await open();
    const id = await running(harness, { plugins: ["a@m"] });
    await harness.sessions.tick(id, "plugin", "b@m", true, []);
    await waitFor(() => harness.sessions.options(id)?.neustartAusstehend === true, "the fallback");
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "weiter");
    const last = starts(harness.events, id).at(-1) ?? [];
    expect(JSON.parse(last[last.indexOf("--settings") + 1] ?? "")).toEqual({ enabledPlugins: { "a@m": true, "b@m": false } });
    expect(harness.sessions.list()[0]?.optionen).toMatchObject({ plugins: ["a@m"], schnell: false });
  });
});

describe("blacking out the OpenRouter key", { timeout: PROCESS_TEST_MS }, () => {
  it("never sends even half of a key that is split over two pieces", async () => {
    const harness = await open({ schluessel: () => Promise.resolve(KEY) });
    const id = await running(harness, { anbieter: "openrouter" });
    await turn(harness, id, "teile", "A [geschwärzt] B");
    expect(JSON.stringify(harness.events)).not.toContain(HALF);
  });

  it("keeps the key out of history, log and compaction when the answer never completes", async () => {
    const harness = await open({ schluessel: () => Promise.resolve(KEY), protokollGrenze: 700 });
    const id = await running(harness, { anbieter: "openrouter" });
    harness.sessions.send(id, "teile_ohne_ende");
    await waitFor(() => output(harness.events, id).includes("C [geschwärzt] D"), "the answer");
    expect(JSON.stringify(harness.sessions.chat(id))).not.toContain(HALF);
    await harness.sessions.close();
    const log = await readFile(path.join(dataFolder, "chat", `${id}.ndjson`), "utf8");
    expect(log).toContain("[geschwärzt]");
    expect(log).not.toContain(HALF);
  });

  it("blacks the key out of a raw line before it is read", async () => {
    const lines: unknown[] = [];
    const umgebung = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const claude = await ChatProzess.starten(
      { befehl: [process.execPath, STAND_IN], ordner: vault, umgebung, fortsetzen: null, schwaerzen: (text) => text.replaceAll("ersatz-modell", "[weg]") },
      { zeile: (wert) => lines.push(wert), stoerung: () => undefined, ende: () => undefined },
    );
    await waitFor(() => lines.length > 0, "the first line");
    expect(JSON.stringify(lines[0])).toContain("[weg]");
    expect(JSON.stringify(lines)).not.toContain("ersatz-modell");
    await claude.beenden();
  });
});

describe("the chat log without compaction", { timeout: PROCESS_TEST_MS }, () => {
  it("never holds the key of an answer that never completes", async () => {
    const harness = await open({ schluessel: () => Promise.resolve(KEY) });
    const id = await running(harness, { anbieter: "openrouter" });
    harness.sessions.send(id, "teile_ohne_ende");
    await waitFor(() => output(harness.events, id).includes("C [geschwärzt] D"), "the answer");
    await harness.sessions.close();
    const log = await readFile(path.join(dataFolder, "chat", `${id}.ndjson`), "utf8");
    expect(log).toContain("C [geschwärzt] D");
    expect(log).not.toContain(HALF);
  });
});

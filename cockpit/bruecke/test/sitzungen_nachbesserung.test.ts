import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REDACTED } from "../src/openrouter.ts";
import { RESTART_FAILED, Sessions } from "../src/sitzungen.ts";
import type { SessionEvent, SessionOptions } from "../src/sitzungen.ts";
import { OHNE_OPTIONEN } from "../src/sitzungsoptionen.ts";
import type { GespeicherteOptionen } from "../src/sitzungsoptionen.ts";

const STAND_IN = fileURLToPath(new URL("hilfen/ersatz_claude.ts", import.meta.url));
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const KEY = "sk-or-v1-geheim0123456789abcdef";
const WAIT_MS = 20_000;
const POLL_MS = 20;
const PROCESS_TEST_MS = 30_000;

let root: string;
let vault: string;
let dataFolder: string;
let opened: Sessions[];
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "bruecke-nachbesserung-")));
  vault = path.join(root, "vault");
  dataFolder = path.join(root, "daten");
  await mkdir(vault, { recursive: true });
  opened = [];
  saved = { ERSATZ_CLAUDE_SITZUNG: process.env.ERSATZ_CLAUDE_SITZUNG, ERSATZ_SCHEITERT_BEI: process.env.ERSATZ_SCHEITERT_BEI };
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

async function controls(harness: Harness, id: string): Promise<Record<string, unknown>[]> {
  const lists = (): string[] => texts(harness.events, id).filter((text) => text.startsWith("STEUERUNG "));
  const before = lists().length;
  harness.sessions.send(id, "steuerung?");
  await waitFor(() => lists().length > before, "the list of control requests");
  return JSON.parse((lists().at(-1) ?? "STEUERUNG []").slice("STEUERUNG ".length)) as Record<string, unknown>[];
}

async function storeOld(optionen: GespeicherteOptionen): Promise<void> {
  await mkdir(dataFolder, { recursive: true });
  const old = { id: SESSION_ID, ordner: vault, claudeSitzung: CLAUDE_ID, prozess: "laeuft", exitCode: null, hinweis: null, optionen };
  await writeFile(path.join(dataFolder, "zustand.json"), JSON.stringify({ sitzungen: [old] }));
}

describe("permission mode", { timeout: PROCESS_TEST_MS }, () => {
  it("is sent at once, also during a turn, and confirmed only after the answer", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "lang");
    await harness.sessions.setSetting(id, "erlaubnis", "plan");
    await waitFor(() => harness.sessions.options(id)?.erlaubnisBestaetigt === true, "the confirmation");
    expect(harness.sessions.options(id)).toMatchObject({ erlaubnis: "plan", erlaubnisBestaetigt: true });
    harness.sessions.interrupt(id);
  });

  it("shows the old mode as long as the new one is not confirmed", async () => {
    process.env.ERSATZ_STEUERUNG_SCHEITERT = "set_permission_mode";
    try {
      const harness = await open({ standard: () => ({ erlaubnis: "auto", plugins: [] }) });
      const id = await running(harness);
      await harness.sessions.setSetting(id, "erlaubnis", "plan");
      await waitFor(() => output(harness.events, id).includes("Erlaubnismodus nicht übernommen"), "the note");
      expect(harness.sessions.options(id)).toMatchObject({ erlaubnisBestaetigt: false, neustartAusstehend: true });
    } finally {
      Reflect.deleteProperty(process.env, "ERSATZ_STEUERUNG_SCHEITERT");
    }
  });
});

describe("restoring after a restart of the bridge", { timeout: PROCESS_TEST_MS }, () => {
  it("never restores the fast mode", async () => {
    await storeOld({ ...OHNE_OPTIONEN, schnell: true });
    const harness = await open();
    await waitFor(() => starts(harness.events, SESSION_ID).length === 1, "the restart");
    expect(starts(harness.events, SESSION_ID)[0]?.join(" ")).not.toContain("fastMode");
    expect(harness.sessions.options(SESSION_ID)?.schnell).toBe(false);
  });

  it("pauses an OpenRouter session, shows the defaults before init, and goes on only when asked", async () => {
    await storeOld({ ...OHNE_OPTIONEN, anbieter: "openrouter", modell: "x/y" });
    const harness = await open({ schluessel: () => Promise.resolve(KEY), standard: () => ({ erlaubnis: "auto", plugins: ["a@m"] }) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(starts(harness.events, SESSION_ID)).toHaveLength(0);
    expect(harness.sessions.options(SESSION_ID)).toMatchObject({ pausiert: true, erlaubnis: "auto", plugins: ["a@m"], konnektoren: null, modellWahl: "x/y" });
    expect(harness.sessions.send(SESSION_ID, "x")).toEqual({ kind: "beendet" });
    expect(await harness.sessions.resume(SESSION_ID)).toEqual({ kind: "ok" });
    await waitFor(() => starts(harness.events, SESSION_ID).length === 1, "the start");
    expect(harness.sessions.options(SESSION_ID)?.pausiert).toBe(false);
    expect(await harness.sessions.resume(SESSION_ID)).toEqual({ kind: "nicht_pausiert" });
    expect(await harness.sessions.resume("fremd")).toEqual({ kind: "unbekannt" });
  });
});

describe("failed restart", { timeout: PROCESS_TEST_MS }, () => {
  it("starts again with all options from before", async () => {
    process.env.ERSATZ_SCHEITERT_BEI = '"fastMode":true';
    const harness = await open();
    const id = await running(harness, { plugins: ["a@m"], erlaubnis: "acceptEdits" });
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "trotzdem");
    expect(output(harness.events, id)).toContain(RESTART_FAILED);
    const last = starts(harness.events, id).at(-1) ?? [];
    expect(last).toEqual(expect.arrayContaining(["--resume", CLAUDE_ID, "--permission-mode", "acceptEdits"]));
    expect(JSON.parse(last[last.indexOf("--settings") + 1] ?? "")).toEqual({ enabledPlugins: { "a@m": true, "b@m": false } });
    expect(harness.sessions.list()[0]?.optionen).toMatchObject({ schnell: false, plugins: ["a@m"], erlaubnis: "acceptEdits" });
  });
});

describe("no restart while something is open", { timeout: PROCESS_TEST_MS }, () => {
  it("waits while a question card is open after the turn ended", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "frage_spaet");
    await waitFor(() => harness.events.some((event) => event.kind === "chat" && event.schritt.art === "neu" && event.schritt.eintrag.id === "toolu_spaet"), "the late card");
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "danach");
    expect(starts(harness.events, id)).toHaveLength(1);
  });

  it("waits while an agent still runs after the turn ended", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "agent_offen");
    await waitFor(() => harness.events.some((event) => event.kind === "daten" && event.daten.zugEnde === true) && harness.sessions.agents(id)?.agenten.length === 1, "the open agent");
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "danach");
    expect(starts(harness.events, id)).toHaveLength(1);
  });
});

describe("model and agents", { timeout: PROCESS_TEST_MS }, () => {
  it("names the chosen short model name", async () => {
    const harness = await open();
    const id = await running(harness, { modell: "opusplan" });
    expect(harness.sessions.options(id)?.modellWahl).toBe("opusplan");
    harness.sessions.send(id, "/model haiku");
    await waitFor(() => harness.sessions.options(id)?.modellWahl === "haiku", "the new model");
  });

  it("forgets the agents of the old conversation after /clear", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "agent_offen");
    await waitFor(() => harness.events.some((event) => event.kind === "daten" && event.daten.zugEnde === true) && harness.sessions.agents(id)?.agenten.length === 1, "the open agent");
    expect(harness.sessions.agents(id)?.agenten).toEqual([{ id: "toolu_agent_offen", typ: "Explore", beschreibung: "sucht" }]);
    await turn(harness, id, "/clear");
    expect(harness.sessions.agents(id)?.agenten).toEqual([]);
  });

  it("starts a check session with ask rules for every changing tool", async () => {
    const harness = await open();
    const id = await running(harness, { pruefung: true, erlaubnis: "default" });
    const args = starts(harness.events, id)[0] ?? [];
    expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "")).toEqual({ permissions: { ask: ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"] } });
    expect(await controls(harness, id)).toEqual(expect.arrayContaining([{ subtype: "initialize" }]));
  });
});

describe("blacking out the OpenRouter key", { timeout: PROCESS_TEST_MS }, () => {
  it("never shows a key split over two pieces, nor in history, log file or stderr", async () => {
    const harness = await open({ schluessel: () => Promise.resolve(KEY) });
    const id = await running(harness, { anbieter: "openrouter" });
    await turn(harness, id, "teile", `A ${REDACTED} B`);
    await waitFor(() => harness.events.some((event) => event.kind === "stoerung" && event.text.startsWith("stderr")), "stderr");
    expect(JSON.stringify(harness.events)).not.toContain(KEY);
    const pieces = harness.events.flatMap((event) => (event.kind === "chat" && event.schritt.art === "teil" ? [event.schritt.text] : []));
    expect(pieces.join("")).not.toContain(KEY.slice(0, KEY.length - 1));
    expect(JSON.stringify(harness.sessions.chat(id))).not.toContain(KEY);
    expect(harness.events.find((event) => event.kind === "stoerung" && event.text.startsWith("stderr"))).toMatchObject({ text: `stderr ${REDACTED}` });
    await harness.sessions.close();
    expect(await readFile(path.join(dataFolder, "chat", `${id}.ndjson`), "utf8")).not.toContain(KEY);
  });
});

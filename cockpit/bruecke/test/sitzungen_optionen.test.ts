import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REDACTED } from "../src/openrouter.ts";
import { RESTART_FAILED, SessionError, Sessions } from "../src/sitzungen.ts";
import type { SessionEvent, SessionOptions } from "../src/sitzungen.ts";
import { OHNE_OPTIONEN } from "../src/sitzungsoptionen.ts";
import type { GespeicherteOptionen, StartKontext } from "../src/sitzungsoptionen.ts";

const STAND_IN = fileURLToPath(new URL("hilfen/ersatz_claude.ts", import.meta.url));
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const KEY = "sk-or-v1-geheim0123456789abcdef";
const WAIT_MS = 20_000;
const PROCESS_TEST_MS = 30_000;
const POLL_MS = 20;
const LINE = "Für diese Sitzung gilt zusätzlich: lade mit dem Skill-Werkzeug den Skill grill-me.";

let root: string;
let vault: string;
let dataFolder: string;
let opened: Sessions[];
let savedEnvironment: Record<string, string | undefined>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "bruecke-optionen-")));
  vault = path.join(root, "vault");
  dataFolder = path.join(root, "daten");
  await mkdir(vault, { recursive: true });
  opened = [];
  savedEnvironment = { ERSATZ_CLAUDE_SITZUNG: process.env.ERSATZ_CLAUDE_SITZUNG, ERSATZ_SCHEITERT_BEI: process.env.ERSATZ_SCHEITERT_BEI, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  process.env.ERSATZ_CLAUDE_SITZUNG = CLAUDE_ID;
});

afterEach(async () => {
  for (const sessions of opened) await sessions.close();
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

interface Harness {
  sessions: Sessions;
  events: SessionEvent[];
}

function context(optionen: GespeicherteOptionen): Promise<StartKontext> {
  return Promise.resolve({ installiertePlugins: optionen.anbieter === "abo" ? ["a@m", "b@m"] : [] });
}

async function open(options: SessionOptions = {}): Promise<Harness> {
  const events: SessionEvent[] = [];
  const settings = { vault, erlaubteOrdner: [vault], claudeBefehl: [process.execPath, STAND_IN], datenordner: dataFolder };
  const sessions = await Sessions.open(settings, (event) => events.push(event), { startKontext: context, ...options });
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
  await waitFor(() => harness.sessions.list()[0]?.claudeSitzung === CLAUDE_ID && starts(harness.events, id).length === 1, "the start");
  return id;
}

async function turn(harness: Harness, id: string, text: string, answer = `ECHO ${text}`): Promise<void> {
  expect(harness.sessions.send(id, text)).toEqual({ kind: "ok" });
  await waitFor(() => output(harness.events, id).includes(answer), answer);
}

describe("an older session file", { timeout: PROCESS_TEST_MS }, () => {
  it("alter zustand.json ohne neue Felder lädt: the session resumes without choices", async () => {
    await mkdir(dataFolder, { recursive: true });
    const old = { id: SESSION_ID, ordner: vault, claudeSitzung: CLAUDE_ID, prozess: "laeuft", exitCode: null, hinweis: null };
    await writeFile(path.join(dataFolder, "zustand.json"), JSON.stringify({ sitzungen: [old] }));
    const harness = await open();
    expect(harness.sessions.list()).toEqual([{ ...old, optionen: OHNE_OPTIONEN }]);
    await waitFor(() => starts(harness.events, SESSION_ID).length === 1, "the restart");
    expect(starts(harness.events, SESSION_ID)[0]).toEqual(expect.arrayContaining(["--resume", CLAUDE_ID]));
    expect(harness.sessions.options(SESSION_ID)).toMatchObject({ titel: "vault", skills: [], schnell: false, anbieter: "abo", kostenUsd: null, neustartAusstehend: false });
  });

  it("refuses a stored session with damaged options", async () => {
    await mkdir(dataFolder, { recursive: true });
    const damaged = { id: SESSION_ID, ordner: vault, claudeSitzung: null, prozess: "beendet", exitCode: null, hinweis: null, optionen: { erlaubnis: "bypassPermissions" } };
    await writeFile(path.join(dataFolder, "zustand.json"), JSON.stringify({ sitzungen: [damaged] }));
    await expect(open()).rejects.toThrow(SessionError);
  });
});

describe("options of a new session", { timeout: PROCESS_TEST_MS }, () => {
  it("starts with the chosen model, permission mode, plugins and style", async () => {
    const harness = await open();
    const id = await running(harness, { modell: "sonnet", erlaubnis: "plan", plugins: ["a@m"], ausgabestil: "Explanatory" });
    const [args = []] = starts(harness.events, id);
    expect(args).toEqual(expect.arrayContaining(["--model", "sonnet", "--permission-mode", "plan", "--settings"]));
    expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "")).toEqual({ enabledPlugins: { "a@m": true, "b@m": false }, outputStyle: "Explanatory" });
  });

  it("keeps title, ticks and settings across a restart of the bridge", async () => {
    const first = await open();
    const id = await running(first);
    await first.sessions.rename(id, "Brücke bauen");
    await first.sessions.tick(id, "skill", "grill-me", true, []);
    await first.sessions.tick(id, "plugin", "a@m", false, ["a@m", "b@m"]);
    await first.sessions.tick(id, "konnektor", "github", false, []);
    await first.sessions.setSetting(id, "schnell", true);
    await first.sessions.close();
    const stored = JSON.parse(await readFile(path.join(dataFolder, "zustand.json"), "utf8")) as { sitzungen: { optionen: GespeicherteOptionen }[] };
    expect(stored.sitzungen[0]?.optionen).toEqual({ ...OHNE_OPTIONEN, titel: "Brücke bauen", skills: ["grill-me"], plugins: ["b@m"], konnektorenAus: ["github"], schnell: true });
    const second = await open();
    expect(second.sessions.options(id)).toMatchObject({ titel: "Brücke bauen", skills: ["grill-me"], plugins: ["b@m"], schnell: false });
  });

  it("answers unknown for a session it does not know", async () => {
    const harness = await open();
    expect(await harness.sessions.rename("fremd", "x")).toEqual({ kind: "unbekannt" });
    expect(await harness.sessions.tick("fremd", "skill", "x", true, [])).toEqual({ kind: "unbekannt" });
    expect(await harness.sessions.setSetting("fremd", "schnell", true)).toEqual({ kind: "unbekannt" });
    expect(harness.sessions.options("fremd")).toBeUndefined();
  });

  it("shows the settings the running Claude reports and the cost only for OpenRouter", async () => {
    const harness = await open();
    const id = await running(harness);
    await turn(harness, id, "hallo");
    await waitFor(() => harness.events.some((event) => event.kind === "daten" && event.daten.kostenUsd !== undefined), "the cost");
    expect(harness.sessions.options(id)).toMatchObject({ erlaubnis: "default", kostenUsd: null });
  });
});

async function controls(harness: Harness, id: string): Promise<Record<string, unknown>[]> {
  const shownLists = (): string[] => texts(harness.events, id).filter((text) => text.startsWith("STEUERUNG "));
  const before = shownLists().length;
  harness.sessions.send(id, "steuerung?");
  await waitFor(() => shownLists().length > before, "the list of control requests");
  const last = shownLists().at(-1) ?? "STEUERUNG []";
  return JSON.parse(last.slice("STEUERUNG ".length)) as Record<string, unknown>[];
}

async function settled(harness: Harness, id: string, subtype: string): Promise<Record<string, unknown>[]> {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const list = await controls(harness, id);
    if (list.some((entry) => entry.subtype === subtype)) return list;
    if (Date.now() > end) throw new Error(`timed out waiting for ${subtype}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

describe("changes without restart", { timeout: PROCESS_TEST_MS }, () => {
  it("asks for models and styles when it starts", async () => {
    const harness = await open();
    await running(harness);
    await waitFor(() => harness.sessions.capabilities() !== null, "the capabilities");
    expect(harness.sessions.capabilities()).toEqual({ modelle: [{ wert: "default", text: "Default" }, { wert: "haiku", text: "Haiku" }], ausgabestile: ["default", "Explanatory"] });
  });

  it("switches plugins and the style with the flag settings and reloads the plugins", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.tick(id, "plugin", "b@m", false, ["a@m", "b@m"]);
    await harness.sessions.setSetting(id, "ausgabestil", "Learning");
    const list = await settled(harness, id, "reload_plugins");
    expect(list).toContainEqual({ subtype: "apply_flag_settings", settings: { enabledPlugins: { "a@m": true, "b@m": false }, outputStyle: "Learning" } });
    expect(list).toContainEqual({ subtype: "reload_plugins", refuse_if_busy: true });
    expect(starts(harness.events, id)).toHaveLength(1);
    expect(harness.sessions.options(id)?.neustartAusstehend).toBe(false);
  });

  it("sets the permission mode, the title and connectors on the running session", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.setSetting(id, "erlaubnis", "plan");
    await harness.sessions.rename(id, "Neuer Titel");
    await harness.sessions.tick(id, "konnektor", "claude.ai Gmail", false, []);
    const list = await settled(harness, id, "mcp_toggle");
    expect(list).toEqual(
      expect.arrayContaining([
        { subtype: "set_permission_mode", mode: "plan" },
        { subtype: "rename_session", title: "Neuer Titel", source: "host" },
        { subtype: "mcp_toggle", serverName: "claude.ai Gmail", enabled: false },
      ]),
    );
    expect(starts(harness.events, id)).toHaveLength(1);
  });

  it("switches the model with set_model instead of sending /model and measures the context", async () => {
    const harness = await open();
    const id = await running(harness);
    expect(harness.sessions.send(id, "/model sonnet")).toEqual({ kind: "ok" });
    await waitFor(() => output(harness.events, id).includes("Modell: aufgeloest-sonnet"), "the model note");
    await waitFor(() => harness.events.some((event) => event.kind === "daten" && event.daten.kontextFenster === 100_000), "the context");
    expect(output(harness.events, id)).not.toContain("ECHO /model");
    expect(harness.sessions.list()[0]?.optionen.modell).toBe("sonnet");
  });

  it("names a refused model", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "/model unbekannt");
    await waitFor(() => output(harness.events, id).includes("Modellwechsel auf unbekannt abgelehnt: Model 'unbekannt' not found"), "the refusal");
  });

  it("measures the context after each turn", async () => {
    const harness = await open();
    const id = await running(harness);
    await turn(harness, id, "hallo");
    await waitFor(() => harness.events.some((event) => event.kind === "daten" && event.daten.eingabeTokens === 1_234 && event.daten.kontextFenster === 100_000), "the context");
  });
});

describe("restart between turns", { timeout: PROCESS_TEST_MS }, () => {
  it("restarts with --resume and the fast mode before the next message", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.setSetting(id, "schnell", true);
    expect(harness.sessions.options(id)?.neustartAusstehend).toBe(true);
    await turn(harness, id, "nach dem Neustart");
    const all = starts(harness.events, id);
    expect(all).toHaveLength(2);
    const args = all[1] ?? [];
    expect(args).toEqual(expect.arrayContaining(["--resume", CLAUDE_ID]));
    expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "")).toEqual({ fastMode: true });
    expect(harness.sessions.options(id)?.neustartAusstehend).toBe(false);
    expect(harness.sessions.list()[0]?.prozess).toBe("laeuft");
  });

  it("gives switches set by wire again after a restart", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.tick(id, "konnektor", "playwright", false, []);
    await harness.sessions.setSetting(id, "erlaubnis", "plan");
    await settled(harness, id, "mcp_toggle");
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "weiter");
    expect(starts(harness.events, id).at(-1)).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
    const list = await settled(harness, id, "mcp_toggle");
    expect(list).toContainEqual({ subtype: "mcp_toggle", serverName: "playwright", enabled: false });
  });

  it("falls back to a restart when the running session refuses a switch", async () => {
    process.env.ERSATZ_STEUERUNG_SCHEITERT = "set_permission_mode";
    try {
      const harness = await open();
      const id = await running(harness);
      await harness.sessions.setSetting(id, "erlaubnis", "plan");
      await waitFor(() => output(harness.events, id).includes("Erlaubnismodus nicht übernommen (abgelehnt)"), "the note");
      expect(harness.sessions.options(id)?.neustartAusstehend).toBe(true);
      await turn(harness, id, "danach");
      expect(starts(harness.events, id).at(-1)).toEqual(expect.arrayContaining(["--resume", CLAUDE_ID, "--permission-mode", "plan"]));
    } finally {
      Reflect.deleteProperty(process.env, "ERSATZ_STEUERUNG_SCHEITERT");
    }
  });

  it("does not restart while a turn is still running", async () => {
    const harness = await open();
    const id = await running(harness);
    expect(harness.sessions.send(id, "lang")).toEqual({ kind: "ok" });
    await harness.sessions.setSetting(id, "schnell", true);
    expect(harness.sessions.send(id, "zwischendurch")).toEqual({ kind: "ok" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(starts(harness.events, id)).toHaveLength(1);
    expect(harness.sessions.options(id)?.neustartAusstehend).toBe(true);
  });

  it("does not restart while a question card waits for an answer", async () => {
    const harness = await open();
    const id = await running(harness);
    harness.sessions.send(id, "frage");
    await waitFor(() => harness.events.some((event) => event.kind === "chat" && event.schritt.art === "neu" && event.schritt.eintrag.art === "frage"), "the question card");
    await harness.sessions.setSetting(id, "schnell", true);
    harness.sessions.send(id, "noch etwas", true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(starts(harness.events, id)).toHaveLength(1);
  });

  it("does not restart when the caller forbids it, for instance while a permission question waits", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.setSetting(id, "schnell", true);
    expect(harness.sessions.send(id, "warte", false)).toEqual({ kind: "ok" });
    await waitFor(() => output(harness.events, id).includes("ECHO warte"), "the echo");
    expect(starts(harness.events, id)).toHaveLength(1);
  });

  it("keeps the old settings and says so when the restart fails", async () => {
    process.env.ERSATZ_SCHEITERT_BEI = "--settings";
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.setSetting(id, "schnell", true);
    await turn(harness, id, "trotzdem");
    expect(output(harness.events, id)).toContain(RESTART_FAILED);
    expect(harness.sessions.list()[0]).toMatchObject({ prozess: "laeuft", optionen: { schnell: false } });
    expect(harness.sessions.options(id)?.neustartAusstehend).toBe(false);
    expect(starts(harness.events, id).at(-1)).not.toContain("--settings");
  });

  it("delivers messages sent during a restart after it, in order", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.setSetting(id, "schnell", true);
    harness.sessions.send(id, "eins");
    harness.sessions.send(id, "zwei");
    await waitFor(() => output(harness.events, id).includes("ECHO zwei"), "the second echo");
    const shown = output(harness.events, id);
    expect(shown.indexOf("ECHO eins")).toBeLessThan(shown.indexOf("ECHO zwei"));
    expect(starts(harness.events, id)).toHaveLength(2);
  });
});

describe("skill line", { timeout: PROCESS_TEST_MS }, () => {
  it("sends the line once with the next message, while the chat shows only the message", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.tick(id, "skill", "grill-me", true, []);
    await turn(harness, id, "hallo", `ECHO ${LINE}`);
    expect(texts(harness.events, id)).toContain("hallo");
    await turn(harness, id, "weiter");
    expect(output(harness.events, id).split(LINE)).toHaveLength(2);
  });

  it("never puts the line before a slash command and repeats it after /compact", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.tick(id, "skill", "grill-me", true, []);
    await turn(harness, id, "/compact");
    expect(output(harness.events, id)).not.toContain(LINE);
    await turn(harness, id, "a", `ECHO ${LINE}`);
    await turn(harness, id, "/clear");
    await turn(harness, id, "b", `ECHO ${LINE}\n\nb`);
  });

  it("tells Claude to stop using a skill that was unticked", async () => {
    const harness = await open();
    const id = await running(harness);
    await harness.sessions.tick(id, "skill", "grill-me", true, []);
    await turn(harness, id, "a", `ECHO ${LINE}`);
    await harness.sessions.tick(id, "skill", "grill-me", false, []);
    await turn(harness, id, "b", "wende den Skill grill-me nicht mehr an (Hinweis an Claude).");
  });
});

describe("OpenRouter", { timeout: PROCESS_TEST_MS }, () => {
  it("starts with the OpenRouter address and key, and blacks the key out of chat and log", async () => {
    const harness = await open({ schluessel: () => Promise.resolve(KEY) });
    const id = await running(harness, { anbieter: "openrouter", modell: "anthropic/claude-sonnet-4.5" });
    await turn(harness, id, "!", "ENV ANTHROPIC_BASE_URL=https://openrouter.ai/api");
    const shown = output(harness.events, id);
    expect(shown).toContain(`ENV ANTHROPIC_AUTH_TOKEN=${REDACTED}`);
    expect(shown).toContain("ENV ANTHROPIC_API_KEY=\n");
    expect(JSON.stringify(harness.events)).not.toContain(KEY);
    await harness.sessions.close();
    expect(await readFile(path.join(dataFolder, "chat", `${id}.ndjson`), "utf8")).not.toContain(KEY);
  });

  it("removes the provider variables from subscription sessions", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-nicht-weitergeben";
    const harness = await open();
    const id = await running(harness);
    await turn(harness, id, "!", "ENV ANTHROPIC_API_KEY=fehlt");
  });

  it("refuses an OpenRouter session without key", async () => {
    const harness = await open();
    await expect(harness.sessions.create(undefined, { anbieter: "openrouter" })).rejects.toThrow("OpenRouter ist nicht eingerichtet");
    expect(harness.sessions.list()).toEqual([]);
  });

  it("shows the cost of an OpenRouter session", async () => {
    const harness = await open({ schluessel: () => Promise.resolve(KEY) });
    const id = await running(harness, { anbieter: "openrouter" });
    await turn(harness, id, "hallo");
    await waitFor(() => harness.sessions.options(id)?.kostenUsd === 0.25, "the cost");
  });
});

import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHAT_ARGUMENTS } from "../src/chatprozess.ts";
import { resolveSessionFolder, SessionError, Sessions } from "../src/sitzungen.ts";
import type { SessionEvent, SessionInfo, SessionSettings } from "../src/sitzungen.ts";
import { PORT_VARIABLE, reportEnvironment, SECRET_FILE_VARIABLE } from "../src/meldungen.ts";
import { OHNE_OPTIONEN } from "../src/sitzungsoptionen.ts";

const STAND_IN = fileURLToPath(new URL("hilfen/ersatz_claude.ts", import.meta.url));
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const WAIT_MS = 20_000;
const POLL_MS = 20;
const PROCESS_TEST_MS = 30_000;

let root: string;
let allowed: string;
let vault: string;
let second: string;
let outside: string;
let dataFolder: string;
let opened: Sessions[];

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "bruecke-sitzungen-")));
  allowed = path.join(root, "erlaubt");
  vault = path.join(allowed, "vault");
  second = path.join(root, "zweiter");
  outside = path.join(root, "draussen");
  dataFolder = path.join(root, "daten");
  for (const folder of [vault, path.join(vault, "projekt"), second, outside]) await mkdir(folder, { recursive: true });
  opened = [];
});

afterEach(async () => {
  for (const sessions of opened) await sessions.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function settings(): SessionSettings {
  return { vault, erlaubteOrdner: [allowed, second], claudeBefehl: [process.execPath, STAND_IN], datenordner: dataFolder };
}

interface Harness {
  sessions: Sessions;
  events: SessionEvent[];
}

async function open(changed: Partial<SessionSettings> = {}): Promise<Harness> {
  const events: SessionEvent[] = [];
  const sessions = await Sessions.open({ ...settings(), ...changed }, (event) => events.push(event));
  opened.push(sessions);
  return { sessions, events };
}

function outputOf(events: readonly SessionEvent[], id: string): string {
  const texts = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "chat" || event.sitzung !== id) continue;
    const { schritt } = event;
    if (schritt.art === "teil") texts.set(schritt.id, `${texts.get(schritt.id) ?? ""}${schritt.text}`);
    else texts.set(schritt.eintrag.id, schritt.eintrag.text ?? "");
  }
  return [...texts.values()].join("\n");
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const end = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function started(harness: Harness, folder?: string): Promise<SessionInfo> {
  const created = await harness.sessions.create(folder);
  await waitFor(() => outputOf(harness.events, created.id).includes("ARGUMENTE"), "the stand-in to start");
  return created;
}

async function storedState(): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dataFolder, "zustand.json"), "utf8"));
}

function rejectionOf(promise: Promise<unknown>): Promise<SessionError> {
  return promise.then(
    () => {
      throw new Error("the promise was fulfilled");
    },
    (error: unknown) => {
      if (error instanceof SessionError) return error;
      throw error;
    },
  );
}

describe("resolveSessionFolder", () => {
  it("starts in the vault when no folder is given", async () => {
    expect(await resolveSessionFolder(settings(), undefined)).toBe(vault);
  });

  it.each([
    ["a folder inside an allowed folder", () => path.join(vault, "projekt")],
    ["an allowed folder itself", () => allowed],
    ["the second allowed folder", () => second],
  ])("accepts %s", async (_case, folder) => {
    expect(await resolveSessionFolder(settings(), folder())).toBe(folder());
  });

  it.each([
    ["a folder outside", () => outside, "outside"],
    ["a path with .. leading outside", () => [allowed, "..", "draussen"].join(path.sep), '".."'],
    ["a path with .. staying inside", () => [vault, "projekt", "..", "projekt"].join(path.sep), '".."'],
    ["a path with .. after a forward slash", () => `${vault}/../draussen`, '".."'],
    ["a relative path", () => path.join("erlaubt", "vault"), "absolute"],
    ["a missing folder", () => path.join(vault, "fehlt"), "does not exist"],
  ])("rejects %s", async (_case, folder, reason) => {
    const error = await rejectionOf(resolveSessionFolder(settings(), folder()));
    expect(error.message).toContain(reason);
  });

  it("rejects a file", async () => {
    const file = path.join(vault, "datei.txt");
    await writeFile(file, "text");
    expect((await rejectionOf(resolveSessionFolder(settings(), file))).message).toContain("not a folder");
  });

  it("rejects a link inside an allowed folder that points outside", async () => {
    const link = path.join(vault, "nach-draussen");
    await symlink(outside, link, "junction");
    expect((await rejectionOf(resolveSessionFolder(settings(), link))).message).toContain("outside");
  });

  it("accepts a link inside an allowed folder that points inside and gives the real path", async () => {
    const link = path.join(vault, "verweis");
    await symlink(path.join(vault, "projekt"), link, "junction");
    expect(await resolveSessionFolder(settings(), link)).toBe(path.join(vault, "projekt"));
  });

  it("rejects the vault when it lies outside the allowed folders", async () => {
    const error = await rejectionOf(resolveSessionFolder({ ...settings(), erlaubteOrdner: [second] }, undefined));
    expect(error.message).toContain("outside");
  });

  it("ignores an allowed folder that does not exist", async () => {
    const withMissing = { ...settings(), erlaubteOrdner: [path.join(root, "fehlt"), allowed] };
    expect(await resolveSessionFolder(withMissing, undefined)).toBe(vault);
  });
});

describe("Sessions", { timeout: PROCESS_TEST_MS }, () => {
  it("starts the command in the folder with its session id and without --resume", async () => {
    const harness = await open();
    const created = await started(harness, path.join(vault, "projekt"));
    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      ordner: path.join(vault, "projekt"),
      claudeSitzung: null,
      prozess: "laeuft",
      exitCode: null,
      hinweis: null,
      optionen: OHNE_OPTIONEN,
    });
    const output = outputOf(harness.events, created.id);
    expect(output).toContain(`SITZUNG ${created.id}`);
    expect(output).toContain(`ORDNER ${path.join(vault, "projekt")}`);
    expect(output).toContain(`ARGUMENTE ${JSON.stringify(CHAT_ARGUMENTS)}`);
    expect(harness.sessions.list()).toEqual([created]);
  });

  it("starts in the vault by default", async () => {
    const harness = await open();
    const created = await started(harness);
    expect(created.ordner).toBe(vault);
    expect(outputOf(harness.events, created.id)).toContain(`ORDNER ${vault}`);
  });

  it("starts nothing in a folder outside", async () => {
    const harness = await open();
    await expect(harness.sessions.create(outside)).rejects.toThrow(SessionError);
    expect(harness.sessions.list()).toEqual([]);
  });

  it("keeps the chat as history", async () => {
    const harness = await open();
    const created = await started(harness);
    expect(harness.sessions.chat(created.id)?.map((eintrag) => eintrag.text).join("\n")).toContain(`SITZUNG ${created.id}`);
    expect(harness.sessions.chat("unbekannt")).toBeUndefined();
  });

  it("writes the session list to zustand.json in the data folder", async () => {
    const harness = await open();
    const created = await started(harness);
    expect(await storedState()).toEqual({ sitzungen: [created] });
  });

  it("sends a message as one line of stream-json, shows it as an own entry and streams the answer", async () => {
    const harness = await open();
    const created = await started(harness);
    expect(harness.sessions.send(created.id, "äöüß\nzweite Zeile")).toEqual({ kind: "ok" });
    await waitFor(() => outputOf(harness.events, created.id).includes("ECHO äöüß\nzweite Zeile"), "the echo");
    const own = harness.sessions.chat(created.id)?.find((eintrag) => eintrag.art === "du");
    expect(own).toMatchObject({ art: "du", text: "äöüß\nzweite Zeile" });
    expect(harness.events.some((event) => event.kind === "chat" && event.schritt.art === "teil" && event.schritt.text === "ECHO ")).toBe(true);
  });

  it("reports model, input tokens and context window of a turn", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.send(created.id, "hallo");
    await waitFor(() => harness.events.some((event) => event.kind === "daten" && event.daten.zugEnde === true), "the end of the turn");
    const daten = harness.events.flatMap((event) => (event.kind === "daten" && event.sitzung === created.id ? [event.daten] : []));
    expect(daten).toEqual(expect.arrayContaining([expect.objectContaining({ modell: "ersatz-modell" }), { eingabeTokens: 60 }, { zugEnde: true, kontextFenster: 200_000, kostenUsd: 0.25, wartendeZuege: 0 }]));
  });

  it("makes the first connecting device the controller", async () => {
    const harness = await open();
    expect(harness.sessions.controller()).toBeNull();
    harness.sessions.connect("pc");
    harness.sessions.connect("handy");
    expect(harness.sessions.controller()).toBe("pc");
  });

  it("hands control over to the device that takes over", async () => {
    const harness = await open();
    harness.sessions.connect("pc");
    harness.sessions.connect("handy");
    expect(harness.sessions.takeOver("handy")).toEqual({ kind: "ok" });
    expect(harness.sessions.controller()).toBe("handy");
  });

  it("does not give control to a device that connects only to watch", async () => {
    const harness = await open();
    harness.sessions.connect("handy", false);
    expect(harness.sessions.controller()).toBeNull();
    harness.sessions.connect("pc");
    expect(harness.sessions.controller()).toBe("pc");
    expect(harness.sessions.takeOver("handy")).toEqual({ kind: "ok" });
    expect(harness.sessions.controller()).toBe("handy");
  });

  it("lets only a connected device take over", async () => {
    const harness = await open();
    harness.sessions.connect("pc");
    expect(harness.sessions.takeOver("fremd")).toEqual({ kind: "nicht_verbunden" });
    expect(harness.sessions.controller()).toBe("pc");
  });

  it("reports a change of the controller", async () => {
    const harness = await open();
    harness.sessions.connect("pc");
    harness.sessions.connect("handy");
    harness.sessions.takeOver("handy");
    harness.sessions.disconnect("handy");
    expect(harness.events.filter((event) => event.kind === "geaendert")).toHaveLength(3);
  });

  it("frees control when the controlling device leaves, and the next connecting device controls", async () => {
    const harness = await open();
    harness.sessions.connect("pc");
    harness.sessions.connect("handy");
    harness.sessions.disconnect("pc");
    expect(harness.sessions.controller()).toBeNull();
    harness.sessions.connect("pc");
    expect(harness.sessions.controller()).toBe("pc");
  });

  it("keeps control while the controlling device has another connection open", async () => {
    const harness = await open();
    harness.sessions.connect("pc");
    harness.sessions.connect("pc");
    harness.sessions.disconnect("pc");
    expect(harness.sessions.controller()).toBe("pc");
  });

  it("keeps the session running without any device", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.connect("pc");
    harness.sessions.disconnect("pc");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.sessions.list()[0]?.prozess).toBe("laeuft");
    harness.sessions.connect("handy");
    harness.sessions.send(created.id, "noch da");
    await waitFor(() => outputOf(harness.events, created.id).includes("ECHO noch da"), "the echo");
  });

  it("answers an unknown session as unknown", async () => {
    const harness = await open();
    expect(harness.sessions.send("unbekannt", "x")).toEqual({ kind: "unbekannt" });
    expect(harness.sessions.interrupt("unbekannt")).toEqual({ kind: "unbekannt" });
    expect(harness.sessions.answerQuestion("unbekannt", "e", {})).toEqual({ kind: "unbekannt" });
    expect(harness.sessions.answerPlan("unbekannt", "e", "ja")).toEqual({ kind: "unbekannt" });
  });

  it("shows a session whose process died as ended instead of dropping it", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.connect("pc");
    harness.sessions.send(created.id, "ende");
    await waitFor(() => harness.sessions.list()[0]?.prozess === "beendet", "the session to end");
    const ended = { ...created, prozess: "beendet", exitCode: 3 };
    expect(harness.sessions.list()).toEqual([ended]);
    expect(harness.events.at(-1)).toEqual({ kind: "geaendert" });
    expect(harness.sessions.send(created.id, "x")).toEqual({ kind: "beendet" });
    expect(harness.sessions.interrupt(created.id)).toEqual({ kind: "beendet" });
    await expect.poll(storedState, { timeout: WAIT_MS }).toEqual({ sitzungen: [ended] });
  });

  it("ends a session on request and forgets it", async () => {
    const harness = await open();
    const kept = await started(harness);
    const ended = await started(harness);
    expect(await harness.sessions.end(ended.id)).toEqual({ kind: "ok" });
    expect(harness.sessions.list()).toEqual([kept]);
    expect(await storedState()).toEqual({ sitzungen: [kept] });
    expect(await harness.sessions.end(ended.id)).toEqual({ kind: "unbekannt" });
  });

  it("ends a session whose process already died", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.connect("pc");
    harness.sessions.send(created.id, "ende");
    await waitFor(() => harness.sessions.list()[0]?.prozess === "beendet", "the session to end");
    expect(await harness.sessions.end(created.id)).toEqual({ kind: "ok" });
    expect(harness.sessions.list()).toEqual([]);
  });

  it("stores the Claude session id", async () => {
    const harness = await open();
    const created = await started(harness);
    await harness.sessions.setClaudeSession(created.id, CLAUDE_ID);
    expect(harness.sessions.list()[0]?.claudeSitzung).toBe(CLAUDE_ID);
    expect(await storedState()).toEqual({ sitzungen: [{ ...created, claudeSitzung: CLAUDE_ID }] });
  });

  it.each(["", "-x", "--resume", "mit leerzeichen", "a/b", "a".repeat(129)])(
    "rejects the Claude session id %j",
    async (claudeSession) => {
      const harness = await open();
      const created = await started(harness);
      await expect(harness.sessions.setClaudeSession(created.id, claudeSession)).rejects.toThrow(SessionError);
      expect(harness.sessions.list()[0]?.claudeSitzung).toBeNull();
    },
  );

  it("accepts a Claude session id of 128 characters", async () => {
    const harness = await open();
    const created = await started(harness);
    await harness.sessions.setClaudeSession(created.id, "a".repeat(128));
    expect(harness.sessions.list()[0]?.claudeSitzung).toBe("a".repeat(128));
  });

  it("rejects a Claude session id for an unknown session", async () => {
    const harness = await open();
    await expect(harness.sessions.setClaudeSession("unbekannt", CLAUDE_ID)).rejects.toThrow(SessionError);
  });
});

describe("restart of the bridge", { timeout: PROCESS_TEST_MS }, () => {
  it("resumes a running session with --resume and the same session id", async () => {
    const first = await open();
    const created = await started(first);
    await first.sessions.setClaudeSession(created.id, CLAUDE_ID);
    await first.sessions.close();
    const restarted = await open();
    expect(restarted.sessions.list()).toEqual([{ ...created, claudeSitzung: CLAUDE_ID }]);
    await waitFor(() => outputOf(restarted.events, created.id).includes("ARGUMENTE"), "the resumed stand-in");
    const output = outputOf(restarted.events, created.id);
    expect(output).toContain(`ARGUMENTE ${JSON.stringify([...CHAT_ARGUMENTS, "--resume", CLAUDE_ID])}`);
    expect(output).toContain(`SITZUNG ${created.id}`);
    expect(output).toContain(`ORDNER ${vault}`);
  });

  it("starts a session without Claude session id again without --resume", async () => {
    const first = await open();
    const created = await started(first);
    await first.sessions.close();
    const restarted = await open();
    await waitFor(() => outputOf(restarted.events, created.id).includes("ARGUMENTE"), "the restarted stand-in");
    expect(outputOf(restarted.events, created.id)).toContain(`ARGUMENTE ${JSON.stringify(CHAT_ARGUMENTS)}`);
    expect(restarted.sessions.list()[0]?.hinweis).toBe("neues Gespräch, altes nicht wiederherstellbar");
  });

  it("keeps an ended session ended and does not start it", async () => {
    const first = await open();
    const created = await started(first);
    first.sessions.connect("pc");
    first.sessions.send(created.id, "ende");
    await waitFor(() => first.sessions.list()[0]?.prozess === "beendet", "the session to end");
    await first.sessions.close();
    const restarted = await open();
    expect(restarted.sessions.list()).toEqual([{ ...created, prozess: "beendet", exitCode: 3 }]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(outputOf(restarted.events, created.id)).toBe("");
  });

  it("marks a session as ended when its folder is no longer allowed", async () => {
    const first = await open();
    const created = await started(first, second);
    await first.sessions.close();
    const events: SessionEvent[] = [];
    const restarted = await Sessions.open({ ...settings(), erlaubteOrdner: [allowed] }, (event) => events.push(event));
    opened.push(restarted);
    const ended = { ...created, prozess: "beendet", exitCode: null, hinweis: expect.stringContaining(second) as unknown };
    expect(restarted.list()).toEqual([ended]);
    expect(await storedState()).toEqual({ sitzungen: [ended] });
  });

  it("opens with an empty list when zustand.json does not exist", async () => {
    expect((await open()).sessions.list()).toEqual([]);
  });

  it.each(["{kaputt", "[]", '{"sitzungen":[{"id":"x"}]}', '{"sitzungen":"nein"}'])(
    "refuses to open with zustand.json %s and names the file",
    async (content) => {
      await mkdir(dataFolder, { recursive: true });
      const file = path.join(dataFolder, "zustand.json");
      await writeFile(file, content);
      const error = await rejectionOf(Sessions.open(settings(), () => undefined));
      expect(error.message).toContain(file);
    },
  );

  it.each([
    ["an id that is no UUID", { id: "x" }],
    ["a relative folder", { ordner: "relativ" }],
    ["an unknown process state", { prozess: "schlaeft" }],
    ["a Claude session id starting with -", { claudeSitzung: "-x" }],
    ["a fractional exit code", { exitCode: 1.5 }],
    ["a note that is no text", { hinweis: 5 }],
    ["a missing note", { hinweis: undefined }],
  ])("refuses to open with a stored session holding %s", async (_case, change) => {
    const valid = { id: CLAUDE_ID, ordner: vault, claudeSitzung: null, prozess: "beendet", exitCode: null, hinweis: null };
    await mkdir(dataFolder, { recursive: true });
    const file = path.join(dataFolder, "zustand.json");
    await writeFile(file, JSON.stringify({ sitzungen: [valid] }));
    expect((await Sessions.open(settings(), () => undefined)).list()).toEqual([{ ...valid, optionen: OHNE_OPTIONEN }]);
    await writeFile(file, JSON.stringify({ sitzungen: [{ ...valid, ...change }] }));
    expect((await rejectionOf(Sessions.open(settings(), () => undefined))).message).toContain(file);
  });

  it("reports a failed save after a process died", async () => {
    const harness = await open();
    const created = await started(harness);
    const file = path.join(dataFolder, "zustand.json");
    await rm(file);
    await mkdir(file);
    harness.sessions.connect("pc");
    harness.sessions.send(created.id, "ende");
    await waitFor(() => harness.events.some((event) => event.kind === "fehler"), "the error event");
  });

  it("refuses to open without a command", async () => {
    await expect(Sessions.open({ ...settings(), claudeBefehl: [] }, () => undefined)).rejects.toThrow(SessionError);
  });
});

describe("start problems", { timeout: PROCESS_TEST_MS }, () => {
  const MISSING = "gibt-es-nicht-kommandozentrale";

  it("rejects a new session with a command that does not exist and names the command", async () => {
    const harness = await open({ claudeBefehl: [MISSING, "--weiter"] });
    const error = await rejectionOf(harness.sessions.create());
    expect(error.message).toContain(MISSING);
    expect(harness.sessions.list()).toEqual([]);
  });

  it("opens anyway when a stored session cannot be started and shows it as ended with the reason", async () => {
    const first = await open();
    const created = await started(first);
    await first.sessions.close();
    const restarted = await open({ claudeBefehl: [MISSING] });
    expect(restarted.sessions.list()).toEqual([
      { ...created, prozess: "beendet", exitCode: null, hinweis: expect.stringContaining(MISSING) as unknown },
    ]);
  });

  it("ends the new process again when the session list cannot be saved", async () => {
    const harness = await open();
    const file = path.join(dataFolder, "zustand.json");
    await rm(file);
    await mkdir(file);
    await expect(harness.sessions.create()).rejects.toThrow();
    expect(harness.sessions.list()).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "opens and reports an error when the session list cannot be saved, so running sessions stay endable",
    async () => {
      const first = await open();
      const created = await started(first);
      await first.sessions.close();
      await chmod(dataFolder, 0o500);
      try {
        const restarted = await open();
        expect(restarted.events.some((event) => event.kind === "fehler")).toBe(true);
        expect(restarted.sessions.list()[0]?.prozess).toBe("laeuft");
        await expect(restarted.sessions.end(created.id)).rejects.toThrow();
        expect(restarted.sessions.list()).toEqual([]);
      } finally {
        await chmod(dataFolder, 0o700);
      }
    },
  );

  it("runs at most 8 sessions at the same time", async () => {
    const harness = await open();
    const running = await Promise.all(Array.from({ length: 8 }, () => harness.sessions.create()));
    expect(running).toHaveLength(8);
    const error = await rejectionOf(harness.sessions.create());
    expect(error.message).toContain("8");
    await harness.sessions.end(running[0]?.id ?? "");
    await expect(harness.sessions.create()).resolves.toBeDefined();
  });

  it("does not count ended sessions against the limit", async () => {
    const harness = await open();
    const running = await Promise.all(Array.from({ length: 8 }, () => harness.sessions.create()));
    const first = running[0]?.id ?? "";
    await waitFor(() => outputOf(harness.events, first).includes("ARGUMENTE"), "the stand-in to start");
    harness.sessions.connect("pc");
    harness.sessions.send(first, "ende");
    await waitFor(
      () => harness.sessions.list().find((session) => session.id === first)?.prozess === "beendet",
      "the session to end",
    );
    await expect(harness.sessions.create()).resolves.toBeDefined();
  });
});

describe("environment of the session", { timeout: PROCESS_TEST_MS }, () => {
  const changed = {
    CLAUDECODE: "1",
    CLAUDE_CODE_CHILD_SESSION: "1",
    INIT_CWD: "x",
    npm_config_ersatz: "x",
  };
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const bridgeBin = path.resolve(import.meta.dirname, "..", "node_modules", ".bin");
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries([...Object.keys(changed), pathKey].map((key) => [key, process.env[key]]));
    Object.assign(process.env, changed);
    process.env[pathKey] = [bridgeBin, process.env[pathKey] ?? ""].join(path.delimiter);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it("starts the command without npm and Claude Code variables and without the bin folder of the bridge", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.connect("pc");
    harness.sessions.send(created.id, "!");
    await waitFor(() => outputOf(harness.events, created.id).includes("BIN "), "the environment");
    const output = outputOf(harness.events, created.id);
    expect(output).toContain(`ENV KOMMANDOZENTRALE_SITZUNG=${created.id}`);
    for (const name of Object.keys(changed)) expect(output).toContain(`ENV ${name}=fehlt`);
    expect(output).toContain("BIN nein");
  });
});

describe("report variables for the hooks of the session", { timeout: PROCESS_TEST_MS }, () => {
  it("passes port and secret file of the report inlet to the command without changing the environment of the bridge", async () => {
    const secretFile = path.join(root, "konfig", "geheimnis");
    const events: SessionEvent[] = [];
    const sessions = await Sessions.open(settings(), (event) => events.push(event), {
      zusatzUmgebung: reportEnvironment({ portMeldeeingang: 8788, geheimnis: secretFile }),
    });
    opened.push(sessions);
    const created = await started({ sessions, events });
    sessions.connect("pc");
    sessions.send(created.id, "!");
    await waitFor(() => outputOf(events, created.id).includes("BIN "), "the environment");
    const output = outputOf(events, created.id);
    expect(output).toContain(`ENV ${PORT_VARIABLE}=8788`);
    expect(output).toContain(`ENV ${SECRET_FILE_VARIABLE}=${secretFile}`);
    expect(output).toContain(`ENV KOMMANDOZENTRALE_SITZUNG=${created.id}`);
    expect(process.env[PORT_VARIABLE]).toBeUndefined();
    expect(process.env[SECRET_FILE_VARIABLE]).toBeUndefined();
  });

  it("passes no report variables without the option", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.connect("pc");
    harness.sessions.send(created.id, "!");
    await waitFor(() => outputOf(harness.events, created.id).includes("BIN "), "the environment");
    expect(outputOf(harness.events, created.id)).toContain(`ENV ${PORT_VARIABLE}=fehlt`);
  });
});

describe("more checks", { timeout: PROCESS_TEST_MS }, () => {
  it("accepts folders below an allowed folder that is a link", async () => {
    const link = path.join(root, "verknuepfung");
    await symlink(allowed, link, "junction");
    const linked = { ...settings(), erlaubteOrdner: [link] };
    expect(await resolveSessionFolder(linked, path.join(vault, "projekt"))).toBe(path.join(vault, "projekt"));
    expect(await resolveSessionFolder(linked, path.join(link, "vault"))).toBe(vault);
  });

  it("stores the latest state after creations and Claude session ids at the same time", async () => {
    const harness = await open();
    const created = await Promise.all([harness.sessions.create(), harness.sessions.create(), harness.sessions.create()]);
    await Promise.all(created.map((session, index) => harness.sessions.setClaudeSession(session.id, `claude-${String(index)}`)));
    expect(await storedState()).toEqual({ sitzungen: harness.sessions.list() });
    const byId = new Map(harness.sessions.list().map((session) => [session.id, session.claudeSitzung]));
    expect(created.map((session) => byId.get(session.id))).toEqual(["claude-0", "claude-1", "claude-2"]);
  });
});

describe("chat cards and interruption", { timeout: PROCESS_TEST_MS }, () => {
  function card(harness: Harness, id: string, art: "frage" | "plan"): string {
    return harness.sessions.chat(id)?.find((eintrag) => eintrag.art === art)?.id ?? "";
  }

  it("answers a question card through the host and marks it answered", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.send(created.id, "frage");
    await waitFor(() => card(harness, created.id, "frage") !== "", "the question card");
    const entry = card(harness, created.id, "frage");
    expect(harness.sessions.answerQuestion(created.id, entry, { "Rot oder Blau?": ["Blau"] })).toEqual({ kind: "ungueltig" });
    expect(harness.sessions.answerQuestion(created.id, entry, { "Rot oder Blau?": "Blau" })).toEqual({ kind: "ok" });
    await waitFor(() => outputOf(harness.events, created.id).includes("ANTWORT"), "the answer of the stand-in");
    expect(outputOf(harness.events, created.id)).toContain(
      `ANTWORT ${JSON.stringify({ behavior: "allow", updatedInput: { questions: [{ question: "Rot oder Blau?", header: "Farbe", options: [{ label: "Rot", description: "" }, { label: "Blau", description: "" }], multiSelect: false }], answers: { "Rot oder Blau?": "Blau" } } })}`,
    );
    expect(harness.sessions.chat(created.id)?.find((eintrag) => eintrag.id === entry)?.frage?.beantwortet).toEqual({ "Rot oder Blau?": "Blau" });
    expect(harness.sessions.answerQuestion(created.id, entry, { "Rot oder Blau?": "Rot" })).toEqual({ kind: "keine_frage" });
  });

  it.each([
    ["ja", { behavior: "allow", updatedInput: { plan: "# Plan" } }],
    ["nein", { behavior: "deny", message: "Plan in der Kommandozentrale abgelehnt." }],
  ] as const)("answers a plan card with %s", async (entscheidung, antwort) => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.send(created.id, "plan");
    await waitFor(() => card(harness, created.id, "plan") !== "", "the plan card");
    const entry = card(harness, created.id, "plan");
    expect(harness.sessions.answerQuestion(created.id, entry, {})).toEqual({ kind: "keine_frage" });
    expect(harness.sessions.answerPlan(created.id, entry, entscheidung)).toEqual({ kind: "ok" });
    await waitFor(() => outputOf(harness.events, created.id).includes("PLAN "), "the answer of the stand-in");
    expect(outputOf(harness.events, created.id)).toContain(`PLAN ${JSON.stringify(antwort)}`);
    expect(harness.sessions.chat(created.id)?.find((eintrag) => eintrag.id === entry)?.plan?.entschieden).toBe(entscheidung);
  });

  it.each([
    [true, { behavior: "allow", updatedInput: { url: "https://beispiel.de" } }],
    [false, { behavior: "deny", message: "In der Kommandozentrale abgelehnt." }],
  ] as const)("answers the permission request of another tool with allow %s", async (erlauben, antwort) => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.send(created.id, "fremdwerkzeug");
    await waitFor(() => harness.events.some((event) => event.kind === "erlaubnis"), "the permission request");
    const event = harness.events.find((eintrag) => eintrag.kind === "erlaubnis");
    expect(event).toMatchObject({ sitzung: created.id, anfrage: { werkzeug: "mcp__konto__anmelden", eingabe: { url: "https://beispiel.de" } } });
    const requestId = event?.kind === "erlaubnis" ? event.anfrage.requestId : "";
    expect(harness.sessions.answerPermission(created.id, "fremd", erlauben)).toEqual({ kind: "keine_frage" });
    expect(harness.sessions.answerPermission(created.id, requestId, erlauben)).toEqual({ kind: "ok" });
    expect(harness.events).toContainEqual({ kind: "erlaubnis_weg", sitzung: created.id, requestId });
    await waitFor(() => outputOf(harness.events, created.id).includes("WERKZEUG "), "the answer of the stand-in");
    expect(outputOf(harness.events, created.id)).toContain(`WERKZEUG ${JSON.stringify(antwort)}`);
    expect(harness.sessions.answerPermission(created.id, requestId, erlauben)).toEqual({ kind: "keine_frage" });
    expect(harness.sessions.answerPermission("unbekannt", requestId, erlauben)).toEqual({ kind: "unbekannt" });
  });

  it("interrupts a running answer over the control protocol", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.send(created.id, "lang");
    await waitFor(() => outputOf(harness.events, created.id).includes("3 "), "the long answer");
    expect(harness.sessions.interrupt(created.id)).toEqual({ kind: "ok" });
    await waitFor(() => outputOf(harness.events, created.id).includes("Abgebrochen."), "the interruption");
    expect(harness.sessions.list()[0]?.prozess).toBe("laeuft");
  });
});

describe("chat log and Claude session from the stream", { timeout: PROCESS_TEST_MS }, () => {
  it("keeps the chat over a restart of the bridge, also a streamed answer", async () => {
    const first = await open();
    const created = await started(first);
    first.sessions.send(created.id, "merken");
    await waitFor(() => outputOf(first.events, created.id).includes("ECHO merken"), "the echo");
    await first.sessions.close();
    opened.splice(opened.indexOf(first.sessions), 1);
    const restarted = await open();
    const texts = restarted.sessions.chat(created.id)?.map((eintrag) => eintrag.text);
    expect(texts).toEqual(expect.arrayContaining(["merken", "ECHO merken"]));
  });

  it("forgets the chat log of an ended session", async () => {
    const harness = await open();
    const created = await started(harness);
    harness.sessions.send(created.id, "x");
    await waitFor(() => outputOf(harness.events, created.id).includes("ECHO x"), "the echo");
    await harness.sessions.end(created.id);
    await expect(readFile(path.join(dataFolder, "chat", `${created.id}.ndjson`))).rejects.toThrow();
  });

  it("takes the Claude session id from the start of the stream when no hook gave one", async () => {
    const saved = process.env.ERSATZ_CLAUDE_SITZUNG;
    process.env.ERSATZ_CLAUDE_SITZUNG = CLAUDE_ID;
    try {
      const harness = await open();
      const created = await harness.sessions.create();
      await waitFor(() => harness.sessions.list()[0]?.claudeSitzung === CLAUDE_ID, "the Claude session id");
      expect(created.claudeSitzung).toBeNull();
    } finally {
      if (saved === undefined) Reflect.deleteProperty(process.env, "ERSATZ_CLAUDE_SITZUNG");
      else process.env.ERSATZ_CLAUDE_SITZUNG = saved;
    }
  });
});

import { createServer, request } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_REPORT_BYTES, REPORT_PATH, ReportInlet, reportEnvironment, SECRET_HEADER, senderAllowed } from "../src/meldungen.ts";
import type { InletReport, ReportSessions } from "../src/meldungen.ts";
import { SessionError } from "../src/sitzungen.ts";
import type { SessionInfo } from "../src/sitzungen.ts";

const SECRET = "0a".repeat(32);
const ZENTRALE = "11111111-2222-4333-8444-555555555555";
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const OTHER_CLAUDE_ID = "9f9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const HOLD_MS = 300;
const TAKEOVER_MS = 60_000;
const SUGGESTIONS = [
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" },
];

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let port: number;
let inlet: ReportInlet;
let reports: InletReport[];
let stored: Pick<SessionInfo, "id" | "claudeSitzung" | "prozess">[];
let errors: unknown[];
let now: number;

function fakeSessions(): ReportSessions {
  return {
    list: () => stored,
    setClaudeSession: (id: string, claudeSession: string): Promise<void> => {
      if (claudeSession.startsWith("-")) return Promise.reject(new SessionError("invalid"));
      stored = stored.map((entry) => (entry.id === id ? { ...entry, claudeSitzung: claudeSession } : entry));
      return Promise.resolve();
    },
  };
}

function useInlet(holdUnknownMs: number): void {
  let counter = 0;
  inlet = new ReportInlet({
    secret: SECRET,
    sessions: fakeSessions(),
    onReport: (report) => reports.push(report),
    onError: (error) => errors.push(error),
    newQuestionId: () => `frage-${String((counter += 1))}`,
    now: () => now,
    holdUnknownMs,
  });
}

beforeEach(async () => {
  reports = [];
  errors = [];
  stored = [{ id: ZENTRALE, claudeSitzung: null, prozess: "laeuft" }];
  now = 1_000_000;
  useInlet(HOLD_MS);
  server = createServer((incoming, outgoing) => {
    inlet.handle(incoming, outgoing);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => {
    resolve();
  }));
});

interface Send {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
}

function send(options: Send = {}): Promise<Reply> {
  const body = options.body ?? "";
  const headers = { "content-type": "application/json", [SECRET_HEADER]: SECRET, ...options.headers };
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path: options.path ?? REPORT_PATH, method: options.method ?? "POST", headers },
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
    outgoing.end(body);
  });
}

function report(sitzung: string | null, daten: Record<string, unknown>, art = "hook"): Promise<Reply> {
  return send({ body: JSON.stringify({ sitzung, art, daten }) });
}

function hook(name: string, rest: Record<string, unknown> = {}, sessionId = CLAUDE_ID): Record<string, unknown> {
  return { session_id: sessionId, hook_event_name: name, ...rest };
}

function permission(rest: Record<string, unknown> = {}, sessionId = CLAUDE_ID): Record<string, unknown> {
  return hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm test" }, ...rest }, sessionId);
}

async function bound(): Promise<void> {
  expect((await report(ZENTRALE, hook("SessionStart", { source: "startup" }))).status).toBe(204);
}

async function waitForQuestion(count = 1): Promise<void> {
  await expect.poll(() => inlet.openQuestions().length).toBe(count);
}

describe("reportEnvironment", () => {
  it("names port and secret file for the child process", () => {
    expect(reportEnvironment({ portMeldeeingang: 8788, geheimnis: "/home/r/.config/repocity_bruecke/geheimnis" })).toEqual({
      KOMMANDOZENTRALE_MELDEPORT: "8788",
      KOMMANDOZENTRALE_GEHEIMNIS_DATEI: "/home/r/.config/repocity_bruecke/geheimnis",
    });
  });
});

describe("senderAllowed", () => {
  it.each([
    ["127.0.0.1", 8788, "127.0.0.1:8788", true],
    ["::ffff:127.0.0.1", 8788, "127.0.0.1:8788", true],
    ["10.0.0.5", 8788, "127.0.0.1:8788", false],
    ["::1", 8788, "127.0.0.1:8788", false],
    [undefined, 8788, "127.0.0.1:8788", false],
    ["127.0.0.1", undefined, "127.0.0.1:8788", false],
    ["127.0.0.1", 8788, "localhost:8788", false],
    ["127.0.0.1", 8788, undefined, false],
  ])("decides the sender %s on port %s with Host %s as %s", (remote, local, host, allowed) => {
    expect(senderAllowed(remote, local, host)).toBe(allowed);
  });
});

describe("guard", () => {
  it.each([
    ["a wrong secret", { [SECRET_HEADER]: "0b".repeat(32) }],
    ["a secret of other length", { [SECRET_HEADER]: "0a" }],
    ["an empty secret", { [SECRET_HEADER]: "" }],
  ])("rejects %s with 401 and reports nothing", async (_case, headers) => {
    const reply = await send({ body: JSON.stringify({ sitzung: ZENTRALE, art: "hook", daten: hook("SessionStart") }), headers });
    expect(reply.status).toBe(401);
    expect(reports).toEqual([]);
    expect(stored[0]?.claudeSitzung).toBeNull();
  });

  it("rejects a request without secret with 401", async () => {
    const reply = await new Promise<number>((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port, path: REPORT_PATH, method: "POST" }, (incoming) => {
        incoming.resume();
        resolve(incoming.statusCode ?? 0);
      });
      outgoing.on("error", reject);
      outgoing.end("{}");
    });
    expect(reply).toBe(401);
  });

  it("ignores the cookie and needs the secret even with a cookie", async () => {
    const reply = await send({ body: "{}", headers: { [SECRET_HEADER]: "", cookie: "kommandozentrale=abc" } });
    expect(reply.status).toBe(401);
  });

  it.each([["localhost"], ["evil.example"], ["127.0.0.1"], ["127.0.0.1:1"]])("rejects the Host %s with 403", async (host) => {
    expect((await send({ body: "{}", headers: { host } })).status).toBe(403);
  });

  it("rejects another method with 405", async () => {
    expect((await send({ method: "GET" })).status).toBe(405);
  });

  it("rejects another path with 404", async () => {
    expect((await send({ path: "/anderes", body: "{}" })).status).toBe(404);
  });

  it("rejects a body that is not JSON by content type with 415", async () => {
    expect((await send({ body: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
  });

  it("accepts a charset in the content type", async () => {
    const body = JSON.stringify({ sitzung: null, art: "hook", daten: hook("Stop") });
    expect((await send({ body, headers: { "content-type": "application/json; charset=utf-8" } })).status).toBe(204);
  });

  it("rejects a body above the limit with 413 and accepts one at the limit", async () => {
    const frame = JSON.stringify({ sitzung: null, art: "hook", daten: hook("Stop", { fill: "" }) });
    const fill = "x".repeat(MAX_REPORT_BYTES - Buffer.byteLength(frame));
    const atLimit = JSON.stringify({ sitzung: null, art: "hook", daten: hook("Stop", { fill }) });
    expect(Buffer.byteLength(atLimit)).toBe(MAX_REPORT_BYTES);
    expect((await send({ body: atLimit })).status).toBe(204);
    expect((await send({ body: `${atLimit} ` })).status).toBe(413);
  });

  it.each([
    ["no JSON", "{kaputt"],
    ["no object", "[]"],
    ["an unknown kind", JSON.stringify({ sitzung: null, art: "anderes", daten: {} })],
    ["a session that is no text", JSON.stringify({ sitzung: 5, art: "hook", daten: {} })],
    ["data without session_id", JSON.stringify({ sitzung: null, art: "hook", daten: { hook_event_name: "Stop" } })],
  ])("rejects %s with 400", async (_case, body) => {
    expect((await send({ body })).status).toBe(400);
    expect(reports).toEqual([]);
  });
});

describe("sessions of the Kommandozentrale", () => {
  it("remembers the session_id of the first SessionStart in the session list", async () => {
    await bound();
    expect(stored[0]?.claudeSitzung).toBe(CLAUDE_ID);
    expect(reports).toEqual([
      { kind: "zentrale", sitzung: ZENTRALE, ereignisName: "SessionStart", ereignis: { kind: "SessionStart", sessionId: CLAUDE_ID, quelle: "startup" }, aufwand: null },
    ]);
  });

  it("passes later events of the same session on", async () => {
    await bound();
    expect((await report(ZENTRALE, hook("Stop"))).status).toBe(204);
    expect(reports.at(-1)).toEqual({ kind: "zentrale", sitzung: ZENTRALE, ereignisName: "Stop", ereignis: { kind: "Stop", prompt: null }, aufwand: null });
  });

  it("passes the status line on", async () => {
    await bound();
    const daten = { session_id: CLAUDE_ID, model: { display_name: "Opus" }, context_window: { used_percentage: 3, current_usage: null } };
    expect((await report(ZENTRALE, daten, "statuszeile")).status).toBe(204);
    expect(reports.at(-1)).toMatchObject({ kind: "zentrale", ereignisName: "Statuszeile" });
  });

  it("reports events the state ignores with their name and no state event", async () => {
    await bound();
    await report(ZENTRALE, hook("PostToolUse", { tool_name: "Bash" }));
    expect(reports.at(-1)).toEqual({ kind: "zentrale", sitzung: ZENTRALE, ereignisName: "PostToolUse", ereignis: null, aufwand: null });
  });
});

describe("foreign sessions only report and never wait", () => {
  it.each([
    ["no session of the Kommandozentrale", null],
    ["an unknown session", "99999999-2222-4333-8444-555555555555"],
  ])("answers a PermissionRequest from %s at once without output", async (_case, sitzung) => {
    const reply = await report(sitzung, permission());
    expect(reply).toMatchObject({ status: 204, body: "" });
    expect(inlet.openQuestions()).toEqual([]);
    expect(reports).toEqual([{ kind: "fremd", sitzung, ereignisName: "PermissionRequest" }]);
  });

  it("treats a differing session_id as foreign, such as another claude started by the session", async () => {
    await bound();
    const reply = await report(ZENTRALE, permission({}, OTHER_CLAUDE_ID));
    expect(reply.status).toBe(204);
    expect(inlet.openQuestions()).toEqual([]);
    expect(reports.at(-1)).toEqual({ kind: "fremd", sitzung: ZENTRALE, ereignisName: "PermissionRequest" });
  });

  it.each([["startup"], [undefined]])("keeps the session_id when a SessionStart with source %s and another id arrives", async (source) => {
    await bound();
    await report(ZENTRALE, hook("SessionStart", source === undefined ? {} : { source }, OTHER_CLAUDE_ID));
    expect(stored[0]?.claudeSitzung).toBe(CLAUDE_ID);
    expect(reports.at(-1)).toEqual({ kind: "fremd", sitzung: ZENTRALE, ereignisName: "SessionStart" });
  });

  it("treats a SessionStart with source clear from an unknown session as foreign", async () => {
    const unknown = "99999999-2222-4333-8444-555555555555";
    await report(unknown, hook("SessionStart", { source: "clear" }, OTHER_CLAUDE_ID));
    expect(reports).toEqual([{ kind: "fremd", sitzung: unknown, ereignisName: "SessionStart" }]);
    expect(stored[0]?.claudeSitzung).toBeNull();
  });

  it("treats events before the first SessionStart as foreign", async () => {
    const reply = await report(ZENTRALE, permission());
    expect(reply.status).toBe(204);
    expect(reports).toEqual([{ kind: "fremd", sitzung: ZENTRALE, ereignisName: "PermissionRequest" }]);
  });

  it("treats a SessionStart with an invalid session_id as foreign", async () => {
    inlet = new ReportInlet({
      secret: SECRET,
      sessions: { list: () => stored, setClaudeSession: () => Promise.reject(new SessionError("invalid")) },
      onReport: (entry) => reports.push(entry),
      onError: (error) => errors.push(error),
    });
    expect((await report(ZENTRALE, hook("SessionStart", {}, "-x"))).status).toBe(204);
    expect(reports).toEqual([{ kind: "fremd", sitzung: ZENTRALE, ereignisName: "SessionStart" }]);
  });
});

describe("new session_id of the same session, Daniel 18.11.2026", () => {
  it.each([["clear"], ["compact"], ["resume"], ["fork"]])(
    "takes over the session_id of a SessionStart with source %s and keeps the session in the Kommandozentrale",
    async (source) => {
      await bound();
      expect((await report(ZENTRALE, hook("SessionStart", { source }, OTHER_CLAUDE_ID))).status).toBe(204);
      expect(stored[0]?.claudeSitzung).toBe(OTHER_CLAUDE_ID);
      expect(reports.at(-1)).toEqual({
        kind: "zentrale",
        sitzung: ZENTRALE,
        ereignisName: "SessionStart",
        ereignis: { kind: "SessionStart", sessionId: OTHER_CLAUDE_ID, quelle: source },
        aufwand: null,
      });
      const pending = report(ZENTRALE, permission({}, OTHER_CLAUDE_ID));
      await waitForQuestion();
      inlet.answer("frage-1", "ja");
      expect((await pending).status).toBe(200);
    },
  );

  it("treats a rejected new session_id as foreign and keeps the old one", async () => {
    await bound();
    expect((await report(ZENTRALE, hook("SessionStart", { source: "clear" }, "-x"))).status).toBe(204);
    expect(stored[0]?.claudeSitzung).toBe(CLAUDE_ID);
    expect(reports.at(-1)).toEqual({ kind: "fremd", sitzung: ZENTRALE, ereignisName: "SessionStart" });
  });
});

describe("takeover by an inner claude is withdrawn when the old session reports again", () => {
  it.each([["resume"], ["fork"], ["clear"], ["compact"]])(
    "sets the old session_id back after %s, ends the waiting questions of the new one without decision and keeps it foreign",
    async (source) => {
      await bound();
      await report(ZENTRALE, hook("SessionStart", { source }, OTHER_CLAUDE_ID));
      expect(stored[0]?.claudeSitzung).toBe(OTHER_CLAUDE_ID);
      const inner = report(ZENTRALE, permission({}, OTHER_CLAUDE_ID));
      await waitForQuestion();
      const reply = await report(ZENTRALE, hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, CLAUDE_ID));
      expect(reply.status).toBe(204);
      expect(stored[0]?.claudeSitzung).toBe(CLAUDE_ID);
      expect(await inner).toMatchObject({ status: 204, body: "" });
      expect(inlet.openQuestions()).toEqual([]);
      const names = reports.map((entry) => entry.ereignisName);
      expect(names.slice(-3)).toEqual(["Ruecknahme", "Antwort", "PreToolUse"]);
      expect(reports.at(-3)).toEqual({
        kind: "zentrale",
        sitzung: ZENTRALE,
        ereignisName: "Ruecknahme",
        ereignis: { kind: "Ruecknahme", sessionId: CLAUDE_ID },
        aufwand: null,
      });
      expect((await report(ZENTRALE, permission({}, OTHER_CLAUDE_ID))).status).toBe(204);
      expect(reports.at(-1)).toEqual({ kind: "fremd", sitzung: ZENTRALE, ereignisName: "PermissionRequest" });
      await report(ZENTRALE, hook("SessionStart", { source: "resume" }, OTHER_CLAUDE_ID));
      expect(stored[0]?.claudeSitzung).toBe(CLAUDE_ID);
      expect(reports.at(-1)?.kind).toBe("fremd");
    },
  );

  it("keeps the takeover after a real /clear, when the old session never reports again", async () => {
    await bound();
    await report(ZENTRALE, hook("SessionStart", { source: "clear" }, OTHER_CLAUDE_ID));
    for (const name of ["PreToolUse", "Stop"]) {
      expect((await report(ZENTRALE, hook(name, {}, OTHER_CLAUDE_ID))).status).toBe(204);
      expect(reports.at(-1)?.kind).toBe("zentrale");
    }
    expect(stored[0]?.claudeSitzung).toBe(OTHER_CLAUDE_ID);
  });

  it("does not withdraw the takeover for a late status line of the old session", async () => {
    await bound();
    await report(ZENTRALE, hook("SessionStart", { source: "clear" }, OTHER_CLAUDE_ID));
    const late = { session_id: CLAUDE_ID, model: { display_name: "Opus" }, context_window: { used_percentage: 3, current_usage: null } };
    await report(ZENTRALE, late, "statuszeile");
    expect(stored[0]?.claudeSitzung).toBe(OTHER_CLAUDE_ID);
    expect(reports.at(-1)).toEqual({ kind: "fremd", sitzung: ZENTRALE, ereignisName: "Statuszeile" });
  });
});

describe("unexpected errors", () => {
  it("answers 500 without details and hands the error to onError", async () => {
    const failure = new Error("disk full");
    inlet = new ReportInlet({
      secret: SECRET,
      sessions: { list: () => stored, setClaudeSession: () => Promise.reject(failure) },
      onReport: (entry) => reports.push(entry),
      onError: (error) => errors.push(error),
    });
    const reply = await report(ZENTRALE, hook("SessionStart"));
    expect(reply).toMatchObject({ status: 500, body: "" });
    expect(errors).toEqual([failure]);
    expect(reports).toEqual([]);
  });
});

describe("permission questions of the Kommandozentrale", () => {
  async function asked(rest: Record<string, unknown> = {}): Promise<{ reply: Promise<Reply> }> {
    await bound();
    const reply = report(ZENTRALE, permission(rest));
    await waitForQuestion();
    return { reply };
  }

  it("holds the question open and reports it with the rule for Immer", async () => {
    const { reply: pending } = await asked({ permission_suggestions: SUGGESTIONS });
    expect(inlet.openQuestions()).toEqual([{ frage: "frage-1", sitzung: ZENTRALE }]);
    expect(reports.at(-1)).toEqual({
      kind: "zentrale",
      sitzung: ZENTRALE,
      ereignisName: "PermissionRequest",
      ereignis: {
        kind: "PermissionRequest",
        frage: { id: "frage-1", agent: "haupt", werkzeug: "Bash", beschreibung: "npm test", regelBeiImmer: SUGGESTIONS },
      },
      aufwand: null,
    });
    const settled = await Promise.race([pending.then(() => "beantwortet"), new Promise((resolve) => setTimeout(resolve, 300, "offen"))]);
    expect(settled).toBe("offen");
    inlet.answer("frage-1", "nein");
    await pending;
  });

  it("answers ja with allow", async () => {
    const { reply: pending } = await asked();
    expect(inlet.answer("frage-1", "ja")).toEqual({ kind: "ok" });
    const reply = await pending;
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(reply.body)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  });

  it("answers nein with deny and a message for Claude", async () => {
    const { reply: pending } = await asked();
    inlet.answer("frage-1", "nein");
    expect(JSON.parse((await pending).body)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: "Denied in the Kommandozentrale." },
      },
    });
  });

  it("answers immer with updatedPermissions holding exactly the rule that was shown", async () => {
    const { reply: pending } = await asked({ permission_suggestions: SUGGESTIONS });
    const shown = reports.at(-1);
    if (shown?.kind !== "zentrale" || shown.ereignis?.kind !== "PermissionRequest") throw new Error("no question reported");
    expect(inlet.answer("frage-1", "immer")).toEqual({ kind: "ok" });
    expect(JSON.parse((await pending).body)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow", updatedPermissions: shown.ereignis.frage.regelBeiImmer },
      },
    });
  });

  it("refuses immer without a rule and keeps the question open", async () => {
    const { reply: pending } = await asked();
    expect(inlet.answer("frage-1", "immer")).toEqual({ kind: "keine_regel" });
    expect(inlet.openQuestions()).toHaveLength(1);
    inlet.answer("frage-1", "ja");
    await pending;
  });

  it("reports the answer so the state removes the question", async () => {
    const { reply: pending } = await asked();
    inlet.answer("frage-1", "ja");
    await pending;
    expect(reports.at(-1)).toEqual({
      kind: "zentrale",
      sitzung: ZENTRALE,
      ereignisName: "Antwort",
      ereignis: { kind: "Antwort", frage: "frage-1" },
      aufwand: null,
    });
    expect(inlet.openQuestions()).toEqual([]);
  });

  it("answers an unknown or already answered question as unknown", async () => {
    const { reply: pending } = await asked();
    inlet.answer("frage-1", "ja");
    await pending;
    expect(inlet.answer("frage-1", "ja")).toEqual({ kind: "unbekannt" });
    expect(inlet.answer("gibt-es-nicht", "nein")).toEqual({ kind: "unbekannt" });
  });

  it("keeps several questions apart", async () => {
    await bound();
    const first = report(ZENTRALE, permission());
    const second = report(ZENTRALE, permission({ tool_input: { command: "ls" } }));
    await waitForQuestion(2);
    const idOf = (command: string): string => {
      for (const entry of reports) {
        if (entry.kind === "zentrale" && entry.ereignis?.kind === "PermissionRequest" && entry.ereignis.frage.beschreibung === command) {
          return entry.ereignis.frage.id;
        }
      }
      throw new Error(`no question for ${command}`);
    };
    inlet.answer(idOf("ls"), "nein");
    expect(JSON.parse((await second).body)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "deny" } } });
    expect(inlet.openQuestions()).toEqual([{ frage: idOf("npm test"), sitzung: ZENTRALE }]);
    inlet.answer(idOf("npm test"), "ja");
    expect(JSON.parse((await first).body)).toMatchObject({ hookSpecificOutput: { decision: { behavior: "allow" } } });
  });

  it("drops the question when the hook process goes away before the answer", async () => {
    await bound();
    const outgoing = request({
      host: "127.0.0.1",
      port,
      path: REPORT_PATH,
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: SECRET },
    });
    outgoing.on("error", () => undefined);
    outgoing.end(JSON.stringify({ sitzung: ZENTRALE, art: "hook", daten: permission() }));
    await waitForQuestion();
    outgoing.destroy();
    await expect.poll(() => inlet.openQuestions()).toEqual([]);
    expect(reports.at(-1)).toMatchObject({ ereignis: { kind: "Antwort", frage: "frage-1" } });
    expect(inlet.answer("frage-1", "ja")).toEqual({ kind: "unbekannt" });
  });
});

describe("questions and plans answered in the chat", () => {
  it.each([
    ["AskUserQuestion", { questions: [{ question: "Welche Farbe?", header: "Farbe", options: [], multiSelect: false }] }],
    ["ExitPlanMode", { plan: "Plan" }],
  ])("answers a PermissionRequest of %s at once without decision, so the card in the chat decides", async (tool, input) => {
    await bound();
    const reply = await report(ZENTRALE, permission({ tool_name: tool, tool_input: input }));
    expect(reply).toMatchObject({ status: 204, body: "" });
    expect(inlet.openQuestions()).toEqual([]);
    expect(reports.at(-1)).toEqual({ kind: "zentrale", sitzung: ZENTRALE, ereignisName: "PermissionRequest", ereignis: null, aufwand: null });
  });

  it("passes the effort of the hook input on", async () => {
    await bound();
    await report(ZENTRALE, hook("Stop", { effort: { level: "low" } }));
    expect(reports.at(-1)).toMatchObject({ ereignisName: "Stop", aufwand: "low" });
  });
});

describe("open questions of a session that ended", () => {
  const SECOND = "22222222-2222-4333-8444-555555555555";

  it.each([
    ["ended", (): void => {
      stored = stored.map((entry) => (entry.id === ZENTRALE ? { ...entry, prozess: "beendet" } : entry));
    }],
    ["removed", (): void => {
      stored = stored.filter((entry) => entry.id !== ZENTRALE);
    }],
  ])("are ended without decision when the session was %s, and those of other sessions stay", async (_case, change) => {
    stored = [...stored, { id: SECOND, claudeSitzung: null, prozess: "laeuft" }];
    await bound();
    await report(SECOND, hook("SessionStart", { source: "startup" }, OTHER_CLAUDE_ID));
    const ended = report(ZENTRALE, permission());
    const other = report(SECOND, permission({}, OTHER_CLAUDE_ID));
    await waitForQuestion(2);
    change();
    inlet.sessionsChanged();
    expect(await ended).toMatchObject({ status: 204, body: "" });
    expect(inlet.openQuestions()).toEqual([{ frage: "frage-2", sitzung: SECOND }]);
    expect(reports.at(-1)).toEqual({ kind: "zentrale", sitzung: ZENTRALE, ereignisName: "Antwort", ereignis: { kind: "Antwort", frage: "frage-1" }, aufwand: null });
    inlet.answer("frage-2", "ja");
    expect((await other).status).toBe(200);
  });
});

describe("the remembered takeover after /clear", () => {
  it.each([
    [TAKEOVER_MS, CLAUDE_ID],
    [TAKEOVER_MS + 1, OTHER_CLAUDE_ID],
  ])("lets the old session_id withdraw it %d ms later only within 60 s", async (later, expected) => {
    await bound();
    await report(ZENTRALE, hook("SessionStart", { source: "clear" }, OTHER_CLAUDE_ID));
    now += later;
    await report(ZENTRALE, hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, CLAUDE_ID));
    expect(stored[0]?.claudeSitzung).toBe(expected);
  });
});

describe("events of a new session_id that arrive before its SessionStart", () => {
  it("are held until the SessionStart of /clear binds the new session_id and then count for the session", async () => {
    useInlet(20_000);
    await bound();
    const early = report(ZENTRALE, hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, OTHER_CLAUDE_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await report(ZENTRALE, hook("SessionStart", { source: "clear" }, OTHER_CLAUDE_ID));
    expect((await early).status).toBe(204);
    expect(reports.map((entry) => `${entry.kind} ${entry.ereignisName}`)).toEqual(["zentrale SessionStart", "zentrale SessionStart", "zentrale PreToolUse"]);
  });

  it("count as foreign when no SessionStart binds them within the holding time", async () => {
    await bound();
    const started = Date.now();
    expect((await report(ZENTRALE, hook("Stop", {}, OTHER_CLAUDE_ID))).status).toBe(204);
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS - 20);
    expect(reports.at(-1)).toEqual({ kind: "fremd", sitzung: ZENTRALE, ereignisName: "Stop" });
  });

  it("are not held for a session that is not one of the Kommandozentrale", async () => {
    useInlet(20_000);
    const started = Date.now();
    await report("99999999-2222-4333-8444-555555555555", hook("Stop"));
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

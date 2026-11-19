import { describe, expect, it } from "vitest";
import { displayed, MAIN_AGENT, newSessionState, nextState, readReport } from "../src/zustand.ts";
import type { Ereignis, Frage, SitzungsZustand } from "../src/zustand.ts";

const START = 1_000;
const LATER = 5_000;
const THRESHOLD = 200_000;
const CLAUDE_ID = "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c";
const ENVIRONMENT = { jetzt: LATER, schwelleVerdichten: THRESHOLD };

function fresh(): SitzungsZustand {
  return newSessionState({ id: "s1", ordner: "/vault", titel: "vault", claudeSitzung: null }, START);
}

function apply(state: SitzungsZustand, ...events: Ereignis[]): SitzungsZustand {
  return events.reduce((current, event) => nextState(current, event, ENVIRONMENT), state);
}

function hook(daten: Record<string, unknown>): Ereignis {
  const report = readReport("hook", { session_id: CLAUDE_ID, ...daten }, () => "frage-1");
  if (report?.ereignis == null) throw new Error(`no event for ${JSON.stringify(daten)}`);
  return report.ereignis;
}

function statusLine(daten: Record<string, unknown>): Ereignis {
  const report = readReport("statuszeile", { session_id: CLAUDE_ID, ...daten }, () => "unbenutzt");
  if (report?.ereignis == null) throw new Error("no status line event");
  return report.ereignis;
}

function usage(input: number, creation: number, read: number, output = 7): Record<string, unknown> {
  return { input_tokens: input, cache_creation_input_tokens: creation, cache_read_input_tokens: read, output_tokens: output };
}

function contextOf(percentage: number | null, current: Record<string, unknown> | null): Record<string, unknown> {
  return {
    model: { id: "claude-opus-5-5", display_name: "Opus" },
    context_window: { used_percentage: percentage, current_usage: current },
  };
}

function question(rest: Record<string, unknown> = {}): Ereignis {
  return hook({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" }, ...rest });
}

const ALLOW_NPM_TEST = [
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" },
];

describe("newSessionState", () => {
  it("starts resting with the main agent and without data", () => {
    expect(fresh()).toEqual({
      id: "s1",
      ordner: "/vault",
      titel: "vault",
      claudeSitzung: null,
      stand: "ruht",
      modell: null,
      kontextProzent: null,
      kontextVeraltet: false,
      eingabeTokens: null,
      schwelleUeberschritten: false,
      agenten: [
        { id: MAIN_AGENT, eltern: null, name: "Hauptsitzung", typ: "haupt", stand: "fertig", werkzeug: null, aufrufe: 0, seit: START },
      ],
      wartet: [],
      hinweise: [],
      aufwand: null,
      letzterStop: null,
      kontextFenster: null,
    });
  });
});

describe("readReport", () => {
  it.each([null, [], "text", {}, { session_id: 5 }, { session_id: "" }])("rejects %j without session_id", (daten) => {
    expect(readReport("hook", daten, () => "f")).toBeUndefined();
  });

  it("names the hook event and gives no state event for events the state ignores", () => {
    expect(readReport("hook", { session_id: CLAUDE_ID, hook_event_name: "PostToolUse", tool_name: "Bash" }, () => "f")).toEqual({
      sessionId: CLAUDE_ID,
      ereignisName: "PostToolUse",
      ereignis: null,
      aufwand: null,
    });
    expect(readReport("hook", { session_id: CLAUDE_ID, hook_event_name: "PreCompact" }, () => "f")?.ereignis).toBeNull();
  });

  it("rejects a hook without hook_event_name", () => {
    expect(readReport("hook", { session_id: CLAUDE_ID }, () => "f")).toBeUndefined();
  });

  it("names the status line as Statuszeile", () => {
    expect(readReport("statuszeile", { session_id: CLAUDE_ID, ...contextOf(8, usage(1, 2, 3)) }, () => "f")?.ereignisName).toBe(
      "Statuszeile",
    );
  });
});

describe("SessionStart", () => {
  it("remembers the session_id", () => {
    expect(apply(fresh(), hook({ hook_event_name: "SessionStart", source: "startup" })).claudeSitzung).toBe(CLAUDE_ID);
  });

  it("reads the source of the start", () => {
    expect(hook({ hook_event_name: "SessionStart", source: "clear" })).toEqual({ kind: "SessionStart", sessionId: CLAUDE_ID, quelle: "clear" });
    expect(hook({ hook_event_name: "SessionStart" })).toEqual({ kind: "SessionStart", sessionId: CLAUDE_ID, quelle: null });
  });

  it("takes the session_id of a later SessionStart the inlet accepted, such as after /clear", () => {
    const started = apply(fresh(), hook({ hook_event_name: "SessionStart", source: "startup" }));
    const other = readReport("hook", { session_id: "anders", hook_event_name: "SessionStart", source: "clear" }, () => "f");
    if (other?.ereignis == null) throw new Error("no event");
    expect(apply(started, other.ereignis).claudeSitzung).toBe("anders");
  });
});

describe("subagents", () => {
  it("SubagentStart adds a running agent below the main agent", () => {
    const state = apply(fresh(), hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" }));
    expect(state.agenten[1]).toEqual({
      id: "a1",
      eltern: MAIN_AGENT,
      name: "Explore",
      typ: "Explore",
      stand: "laeuft",
      werkzeug: null,
      aufrufe: 0,
      seit: LATER,
    });
    expect(state.stand).toBe("arbeitet");
  });

  it("SubagentStop sets the agent to fertig", () => {
    const state = apply(
      fresh(),
      hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" }),
      hook({ hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "Explore" }),
    );
    expect(state.agenten[1]?.stand).toBe("fertig");
  });

  it("ignores a SubagentStop of an agent it never saw, such as an internal agent", () => {
    const state = apply(fresh(), hook({ hook_event_name: "SubagentStop", agent_id: "intern", agent_type: "" }));
    expect(state.agenten).toHaveLength(1);
  });

  it("sets a resumed subagent running again without a second entry", () => {
    const start = hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" });
    const state = apply(fresh(), start, hook({ hook_event_name: "SubagentStop", agent_id: "a1" }), start);
    expect(state.agenten.map((agent) => [agent.id, agent.stand])).toEqual([
      [MAIN_AGENT, "laeuft"],
      ["a1", "laeuft"],
    ]);
  });
});

describe("PreToolUse", () => {
  it("counts a call with agent_id at the subagent and not at the main agent", () => {
    const state = apply(
      fresh(),
      hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" }),
      hook({ hook_event_name: "PreToolUse", agent_id: "a1", agent_type: "Explore", tool_name: "Grep", tool_input: {} }),
      hook({ hook_event_name: "PreToolUse", agent_id: "a1", agent_type: "Explore", tool_name: "Read", tool_input: {} }),
    );
    expect(state.agenten[1]).toMatchObject({ aufrufe: 2, werkzeug: "Read" });
    expect(state.agenten[0]).toMatchObject({ aufrufe: 0, werkzeug: null });
  });

  it("counts a call without agent_id at the main agent", () => {
    const state = apply(fresh(), hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }));
    expect(state.agenten[0]).toMatchObject({ aufrufe: 1, werkzeug: "Bash", stand: "laeuft" });
    expect(state.stand).toBe("arbeitet");
  });

  it("adds an agent it has not seen start", () => {
    const state = apply(
      fresh(),
      hook({ hook_event_name: "PreToolUse", agent_id: "t1", agent_type: "researcher", tool_name: "Read", tool_input: {} }),
    );
    expect(state.agenten[1]).toMatchObject({ id: "t1", eltern: MAIN_AGENT, typ: "researcher", aufrufe: 1, stand: "laeuft" });
  });

  it("shows the skill name from tool_input for the Skill tool", () => {
    const state = apply(fresh(), hook({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill: "taste-skill" } }));
    expect(state.agenten[0]?.werkzeug).toBe("taste-skill");
  });

  it("shows Skill when the Skill tool names no skill", () => {
    const state = apply(fresh(), hook({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: {} }));
    expect(state.agenten[0]?.werkzeug).toBe("Skill");
  });
});

describe("status line", () => {
  it("sets kontextProzent, eingabeTokens from the input fields of current_usage, and modell", () => {
    const state = apply(fresh(), statusLine(contextOf(42, usage(1_000, 2_000, 80_000))));
    expect(state).toMatchObject({ kontextProzent: 42, eingabeTokens: 83_000, modell: "Opus", kontextVeraltet: false });
  });

  it("keeps kontextProzent and marks it as outdated when current_usage is null", () => {
    const state = apply(fresh(), statusLine(contextOf(42, usage(1, 2, 3))), statusLine(contextOf(null, null)));
    expect(state).toMatchObject({ kontextProzent: 42, eingabeTokens: 6, kontextVeraltet: true });
  });

  it("clears the outdated mark with the next current_usage", () => {
    const state = apply(fresh(), statusLine(contextOf(42, null)), statusLine(contextOf(50, usage(1, 2, 3))));
    expect(state).toMatchObject({ kontextProzent: 50, kontextVeraltet: false });
  });

  it("gives null instead of a number that is missing early in the session", () => {
    const state = apply(fresh(), statusLine(contextOf(null, usage(1, 2, 3))));
    expect(state.kontextProzent).toBeNull();
  });

  it.each([
    ["a negative token count", usage(-1, 2, 3)],
    ["a fractional token count", usage(1.5, 2, 3)],
    ["a missing token field", { input_tokens: 1, cache_read_input_tokens: 3 }],
  ])("treats %s as outdated instead of guessing", (_case, current) => {
    const state = apply(fresh(), statusLine(contextOf(10, usage(1, 2, 3))), statusLine(contextOf(11, current)));
    expect(state).toMatchObject({ kontextProzent: 10, eingabeTokens: 6, kontextVeraltet: true });
  });

  it.each(["low", "medium", "high", "xhigh", "max"])("takes the effort %s from effort.level", (level) => {
    expect(apply(fresh(), statusLine({ ...contextOf(1, usage(1, 1, 1)), effort: { level } })).aufwand).toBe(level);
  });

  it("forgets the effort when the status line has none, as for a model without effort", () => {
    const state = apply(fresh(), statusLine({ ...contextOf(1, usage(1, 1, 1)), effort: { level: "high" } }), statusLine(contextOf(1, usage(1, 1, 1))));
    expect(state.aufwand).toBeNull();
  });

  it("keeps the model when the status line has none", () => {
    const state = apply(fresh(), statusLine(contextOf(1, usage(1, 1, 1))), statusLine({ context_window: {} }));
    expect(state.modell).toBe("Opus");
  });
});

describe("PermissionRequest", () => {
  it("adds a waiting question with the command, the rule for Immer and the waiting agent", () => {
    const state = apply(fresh(), question({ permission_suggestions: ALLOW_NPM_TEST }));
    expect(state.wartet).toEqual<Frage[]>([
      { id: "frage-1", agent: MAIN_AGENT, werkzeug: "Bash", beschreibung: "npm test", regelBeiImmer: ALLOW_NPM_TEST },
    ]);
    expect(state.stand).toBe("wartet");
    expect(state.agenten[0]?.stand).toBe("wartet");
  });

  it("keeps every suggestion as the rule for Immer", () => {
    const suggestions = [
      ...ALLOW_NPM_TEST,
      { type: "addDirectories", directories: ["/srv/daten"], destination: "session" },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
      { type: "addRules", rules: [{ toolName: "mcp__github__get_issue" }], behavior: "allow", destination: "userSettings" },
    ];
    expect(apply(fresh(), question({ permission_suggestions: suggestions })).wartet[0]?.regelBeiImmer).toEqual(suggestions);
  });

  it.each([
    ["no suggestions", {}],
    ["an empty list", { permission_suggestions: [] }],
    ["an unknown type", { permission_suggestions: [{ type: "allesErlauben", destination: "session" }] }],
    ["an unknown destination", { permission_suggestions: [{ ...ALLOW_NPM_TEST[0], destination: "irgendwo" }] }],
    ["a rule without toolName", { permission_suggestions: [{ ...ALLOW_NPM_TEST[0], rules: [{ ruleContent: "x" }] }] }],
    ["an unknown mode", { permission_suggestions: [{ type: "setMode", mode: "alles", destination: "session" }] }],
    ["one bad entry among good ones", { permission_suggestions: [...ALLOW_NPM_TEST, { type: "setMode", destination: "session" }] }],
  ])("offers no rule for Immer with %s", (_case, rest) => {
    expect(apply(fresh(), question(rest)).wartet[0]?.regelBeiImmer).toBeNull();
  });

  it.each([
    ["the command first", { command: "rm -rf build", description: "Clean" }, "rm -rf build"],
    ["the file path", { file_path: "/vault/a.md", content: "x" }, "/vault/a.md"],
    ["the address", { url: "https://example.com", prompt: "lies" }, "https://example.com"],
    ["the description without anything better", { description: "Etwas tun" }, "Etwas tun"],
    ["the input as JSON otherwise", { a: 1 }, '{"a":1}'],
  ])("describes the question with %s", (_case, input, description) => {
    expect(apply(fresh(), question({ tool_input: input })).wartet[0]?.beschreibung).toBe(description);
  });

  it("marks the subagent that asks as waiting", () => {
    const state = apply(
      fresh(),
      hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" }),
      question({ agent_id: "a1", agent_type: "Explore" }),
    );
    expect(state.wartet[0]?.agent).toBe("a1");
    expect(state.agenten[1]?.stand).toBe("wartet");
  });

  it("removes the question with the answer and lets the session work on", () => {
    const state = apply(fresh(), question(), { kind: "Antwort", frage: "frage-1" });
    expect(state.wartet).toEqual([]);
    expect(state.stand).toBe("arbeitet");
    expect(state.agenten[0]?.stand).toBe("laeuft");
  });

  it("keeps waiting while another question is open", () => {
    const second = readReport(
      "hook",
      { session_id: CLAUDE_ID, hook_event_name: "PermissionRequest", tool_name: "Write", tool_input: { file_path: "/x" } },
      () => "frage-2",
    );
    if (second?.ereignis == null) throw new Error("no event");
    const state = apply(fresh(), question(), second.ereignis, { kind: "Antwort", frage: "frage-1" });
    expect(state.wartet.map((entry) => entry.id)).toEqual(["frage-2"]);
    expect(state.stand).toBe("wartet");
    expect(state.agenten[0]?.stand).toBe("wartet");
  });

  it("ignores an answer to an unknown question", () => {
    const state = apply(fresh(), question());
    expect(apply(state, { kind: "Antwort", frage: "fremd" })).toEqual(state);
  });
});

describe("resting", () => {
  it("Notification idle_prompt sets the session to ruht", () => {
    const state = apply(fresh(), { kind: "Nachricht" }, hook({ hook_event_name: "Notification", notification_type: "idle_prompt" }));
    expect(state.stand).toBe("ruht");
  });

  it("ignores other notifications", () => {
    const state = apply(fresh(), { kind: "Nachricht" }, hook({ hook_event_name: "Notification", notification_type: "auth_success" }));
    expect(state.stand).toBe("arbeitet");
  });

  it("Stop sets the session to ruht and the main agent to fertig", () => {
    const state = apply(fresh(), { kind: "Nachricht" }, hook({ hook_event_name: "Stop" }));
    expect(state.stand).toBe("ruht");
    expect(state.agenten[0]?.stand).toBe("fertig");
  });

  it("stays waiting on Stop while a question is open", () => {
    expect(apply(fresh(), question(), hook({ hook_event_name: "Stop" })).stand).toBe("wartet");
  });

  it("works after a message of Daniel", () => {
    expect(apply(fresh(), { kind: "Nachricht" }).stand).toBe("arbeitet");
  });
});

describe("compaction hint", () => {
  function atTokens(tokens: number): SitzungsZustand {
    return apply(fresh(), statusLine(contextOf(80, usage(tokens, 0, 0))));
  }

  it("gives no hint one token below the threshold", () => {
    expect(apply(atTokens(THRESHOLD - 1), hook({ hook_event_name: "Stop" })).hinweise).toEqual([]);
  });

  it("gives the hint exactly at the threshold", () => {
    expect(apply(atTokens(THRESHOLD), hook({ hook_event_name: "Stop" })).hinweise).toEqual([
      { art: "verdichten", anzeige: "Kontext bei 200.000 Tokens – Verdichten empfohlen" },
    ]);
  });

  it("uses the threshold from the settings", () => {
    const state = nextState(atTokens(150_000), hook({ hook_event_name: "Stop" }), { jetzt: LATER, schwelleVerdichten: 150_000 });
    expect(state.hinweise).toHaveLength(1);
  });

  it("gives the hint once per crossing, also after it was dismissed", () => {
    const once = apply(atTokens(THRESHOLD), hook({ hook_event_name: "Stop" }), hook({ hook_event_name: "Stop" }));
    expect(once.hinweise).toHaveLength(1);
    const dismissed = { ...once, hinweise: [] };
    expect(apply(dismissed, hook({ hook_event_name: "Stop" })).hinweise).toEqual([]);
  });

  it("gives the hint again after the tokens fell below the threshold and crossed it again", () => {
    const state = apply(
      atTokens(THRESHOLD),
      hook({ hook_event_name: "Stop" }),
      statusLine(contextOf(10, usage(1_000, 0, 0))),
      statusLine(contextOf(90, usage(THRESHOLD + 5, 0, 0))),
      hook({ hook_event_name: "Stop" }),
    );
    expect(state.hinweise).toEqual([
      { art: "verdichten", anzeige: "Kontext bei 200.005 Tokens – Verdichten empfohlen" },
    ]);
  });

  it("keeps the crossing when the status line shows exactly the threshold between two Stops", () => {
    const first = apply(atTokens(THRESHOLD), hook({ hook_event_name: "Stop" }));
    const dismissed = { ...first, hinweise: [] };
    const state = apply(dismissed, statusLine(contextOf(80, usage(THRESHOLD, 0, 0))), hook({ hook_event_name: "Stop" }));
    expect(state.hinweise).toEqual([]);
  });

  it("gives no hint without token data", () => {
    expect(apply(fresh(), hook({ hook_event_name: "Stop" })).hinweise).toEqual([]);
  });

  it("PostCompact removes the hint and the outdated token count", () => {
    const state = apply(atTokens(THRESHOLD), hook({ hook_event_name: "Stop" }), hook({ hook_event_name: "PostCompact", trigger: "manual" }));
    expect(state.hinweise).toEqual([]);
    expect(state).toMatchObject({ eingabeTokens: null, kontextVeraltet: true, schwelleUeberschritten: false });
    expect(apply(state, hook({ hook_event_name: "Stop" })).hinweise).toEqual([]);
  });
});

describe("open questions win over other events", () => {
  it("keeps the main agent waiting on Stop while it asks", () => {
    const state = apply(fresh(), question(), hook({ hook_event_name: "Stop" }));
    expect(state.agenten[0]?.stand).toBe("wartet");
  });

  it("keeps session and main agent waiting after input with Enter", () => {
    const state = apply(fresh(), question(), { kind: "Nachricht" });
    expect(state.stand).toBe("wartet");
    expect(state.agenten[0]?.stand).toBe("wartet");
  });

  it("keeps an asking subagent waiting when it calls a tool", () => {
    const state = apply(
      fresh(),
      question({ agent_id: "a1", agent_type: "Explore" }),
      hook({ hook_event_name: "PreToolUse", agent_id: "a1", agent_type: "Explore", tool_name: "Read", tool_input: {} }),
    );
    expect(state.agenten[1]).toMatchObject({ id: "a1", stand: "wartet", aufrufe: 1 });
  });

  it("keeps an asking subagent waiting when it is resumed", () => {
    const state = apply(fresh(), question({ agent_id: "a1" }), hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" }));
    expect(state.agenten[1]?.stand).toBe("wartet");
  });

  it("adds the same question only once", () => {
    const asked = question();
    expect(apply(fresh(), asked, asked).wartet).toHaveLength(1);
  });
});

describe("length of the description", () => {
  it.each([
    ["exactly 1000 characters", "a".repeat(1000), "a".repeat(1000)],
    ["1001 characters", "b".repeat(1001), "b".repeat(1000)],
  ])("keeps a command of %s at most 1000 characters long", (_case, command, shown) => {
    expect(apply(fresh(), question({ tool_input: { command } })).wartet[0]?.beschreibung).toBe(shown);
  });

  it("cuts the JSON of an input without known fields to 1000 characters", () => {
    const shown = apply(fresh(), question({ tool_input: { a: "x".repeat(2000) } })).wartet[0]?.beschreibung;
    expect(shown).toBe(JSON.stringify({ a: "x".repeat(2000) }).slice(0, 1000));
  });
});

describe("start of a new conversation in the same session", () => {
  function busy(): SitzungsZustand {
    return apply(
      fresh(),
      hook({ hook_event_name: "SessionStart", source: "startup" }),
      hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" }),
      statusLine(contextOf(90, usage(THRESHOLD, 0, 0))),
      hook({ hook_event_name: "Stop" }),
      question(),
    );
  }

  function startedWith(source: string, sessionId: string): Ereignis {
    const report = readReport("hook", { session_id: sessionId, hook_event_name: "SessionStart", source }, () => "f");
    if (report?.ereignis == null) throw new Error("no event");
    return report.ereignis;
  }

  it.each([["clear"], ["resume"], ["fork"]])("resets the run data on %s with a new session_id and keeps the questions", (source) => {
    const before = busy();
    const state = apply(before, startedWith(source, "neu"));
    expect(state.claudeSitzung).toBe("neu");
    expect(state.agenten.map((agent) => agent.id)).toEqual([MAIN_AGENT]);
    expect(state).toMatchObject({ eingabeTokens: null, schwelleUeberschritten: false });
    expect(state.hinweise).toEqual([]);
    expect(state.wartet).toEqual(before.wartet);
  });

  it("keeps the run data on resume with the same session_id", () => {
    const before = busy();
    expect(apply(before, startedWith("resume", CLAUDE_ID))).toEqual(before);
  });

  it("removes only the compaction hint and the crossing on compact", () => {
    const before = busy();
    const state = apply(before, startedWith("compact", "neu"));
    expect(state.agenten).toEqual(before.agenten);
    expect(state.eingabeTokens).toBe(THRESHOLD);
    expect(state.schwelleUeberschritten).toBe(false);
    expect(state.hinweise).toEqual([]);
  });

  it("sets the session_id back on a withdrawn takeover and keeps everything else", () => {
    const moved = apply(busy(), startedWith("resume", "neu"));
    expect(apply(moved, { kind: "Ruecknahme", sessionId: CLAUDE_ID })).toEqual({ ...moved, claudeSitzung: CLAUDE_ID });
  });
});

describe("purity", () => {
  it("does not change the state it gets", () => {
    const state = fresh();
    const copy = structuredClone(state);
    apply(state, question(), hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }), hook({ hook_event_name: "Stop" }));
    expect(state).toEqual(copy);
  });
});

describe("tool calls that arrive after Stop, hooks run in the background and come in any order", () => {
  const FIRST = "prompt-0001";
  const SECOND = "prompt-0002";

  function tool(prompt?: string, name = "Bash"): Ereignis {
    return hook({ hook_event_name: "PreToolUse", tool_name: name, tool_input: { command: "ls" }, ...(prompt === undefined ? {} : { prompt_id: prompt }) });
  }

  function stop(prompt?: string): Ereignis {
    return hook({ hook_event_name: "Stop", ...(prompt === undefined ? {} : { prompt_id: prompt }) });
  }

  it("keeps the session resting for a late call of the finished prompt and only counts it", () => {
    const state = apply(fresh(), { kind: "Nachricht" }, tool(FIRST), stop(FIRST), tool(FIRST, "Read"));
    expect(state.stand).toBe("ruht");
    expect(state.agenten[0]).toMatchObject({ stand: "fertig", aufrufe: 2, werkzeug: "Bash" });
  });

  it("keeps the session resting for a late call without prompt_id", () => {
    const state = apply(fresh(), { kind: "Nachricht" }, stop(FIRST), tool());
    expect(state.stand).toBe("ruht");
    expect(state.agenten[0]?.aufrufe).toBe(1);
  });

  it("works again for a call of a new prompt", () => {
    expect(apply(fresh(), stop(FIRST), tool(SECOND)).stand).toBe("arbeitet");
  });

  it("works again after input with Enter, also for later calls without prompt_id", () => {
    const state = apply(fresh(), stop(FIRST), { kind: "Nachricht" }, stop(), tool(), { kind: "Nachricht" }, tool());
    expect(state.stand).toBe("arbeitet");
    expect(state.agenten[0]?.stand).toBe("laeuft");
  });

  it("works as before when no Stop came yet", () => {
    expect(apply(fresh(), tool()).stand).toBe("arbeitet");
  });

  it("keeps a late subagent start of the finished prompt from setting the session to work", () => {
    const late = hook({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore", prompt_id: FIRST });
    const state = apply(fresh(), stop(FIRST), late);
    expect(state.stand).toBe("ruht");
    expect(state.agenten[1]).toMatchObject({ id: "a1", stand: "laeuft" });
  });
});

describe("displayed", () => {
  it("shows every field of the state except the internal mark of the last Stop", () => {
    const state = apply(fresh(), hook({ hook_event_name: "Stop", prompt_id: "prompt-0001" }));
    const { letzterStop, kontextFenster, ...rest } = state;
    expect(letzterStop).toEqual({ prompt: "prompt-0001" });
    expect(kontextFenster).toBeNull();
    expect(displayed(state)).toEqual(rest);
    expect(Object.keys(displayed(state))).not.toContain("letzterStop");
    expect(Object.keys(displayed(state))).not.toContain("kontextFenster");
  });
});


describe("cards of the chat", () => {
  it.each(["AskUserQuestion", "ExitPlanMode"])("leaves the permission request of %s to the chat card and gives no state event", (tool) => {
    expect(readReport("hook", { session_id: CLAUDE_ID, hook_event_name: "PermissionRequest", tool_name: tool, tool_input: {} }, () => "f")?.ereignis).toBeNull();
  });
});

describe("data of the chat stream", () => {
  it("takes model, input tokens and context window and computes the share of the context", () => {
    const state = apply(fresh(), { kind: "Chatdaten", modell: "claude-haiku-5-5" }, { kind: "Chatdaten", eingabeTokens: 50_000 }, { kind: "Chatdaten", kontextFenster: 200_000 });
    expect(state).toMatchObject({ modell: "claude-haiku-5-5", eingabeTokens: 50_000, kontextFenster: 200_000, kontextProzent: 25, kontextVeraltet: false });
  });

  it("shows no data after a model switch until the window of the new model is known", () => {
    const before = apply(fresh(), { kind: "Chatdaten", modell: "claude-haiku-5-5" }, { kind: "Chatdaten", eingabeTokens: 50_000 }, { kind: "Chatdaten", kontextFenster: 200_000 });
    const switched = apply(before, { kind: "Chatdaten", modell: "claude-sonnet-5", eingabeTokens: 60_000 });
    expect(switched).toMatchObject({ modell: "claude-sonnet-5", kontextProzent: null, kontextFenster: null, eingabeTokens: 60_000 });
    expect(apply(switched, { kind: "Chatdaten", kontextFenster: 1_000_000 }).kontextProzent).toBe(6);
  });

  it("keeps the share when the same model is named again", () => {
    const before = apply(fresh(), { kind: "Chatdaten", modell: "claude-haiku-5-5" }, { kind: "Chatdaten", eingabeTokens: 50_000 }, { kind: "Chatdaten", kontextFenster: 200_000 });
    expect(apply(before, { kind: "Chatdaten", modell: "claude-haiku-5-5" }).kontextProzent).toBe(25);
  });

  it("keeps the share unknown until the context window is known", () => {
    expect(apply(fresh(), { kind: "Chatdaten", eingabeTokens: 50_000 }).kontextProzent).toBeNull();
  });

  it("updates the share with new tokens of a later turn", () => {
    const state = apply(fresh(), { kind: "Chatdaten", kontextFenster: 1_000_000 }, { kind: "Chatdaten", eingabeTokens: 125_000 }, { kind: "Chatdaten", eingabeTokens: 250_000 });
    expect(state.kontextProzent).toBe(25);
  });

  it("gives the compaction hint at Stop from the tokens of the chat", () => {
    const state = apply(fresh(), { kind: "Chatdaten", eingabeTokens: THRESHOLD }, hook({ hook_event_name: "Stop" }));
    expect(state.hinweise.map((hint) => hint.art)).toEqual(["verdichten"]);
  });

  it("drops the crossing once the chat shows fewer tokens than the threshold", () => {
    const crossed = apply(fresh(), { kind: "Chatdaten", eingabeTokens: THRESHOLD }, hook({ hook_event_name: "Stop" }));
    expect(apply(crossed, { kind: "Chatdaten", eingabeTokens: THRESHOLD - 1 }).schwelleUeberschritten).toBe(false);
    expect(apply(crossed, { kind: "Chatdaten", eingabeTokens: THRESHOLD }).schwelleUeberschritten).toBe(true);
  });

  it("takes the effort the hooks report", () => {
    expect(apply(fresh(), { kind: "Aufwand", aufwand: "low" }).aufwand).toBe("low");
  });

  it("reads the effort from the hook input", () => {
    expect(readReport("hook", { session_id: CLAUDE_ID, hook_event_name: "Stop", effort: { level: "xhigh" } }, () => "f")?.aufwand).toBe("xhigh");
    expect(readReport("hook", { session_id: CLAUDE_ID, hook_event_name: "Stop" }, () => "f")?.aufwand).toBeNull();
  });
});

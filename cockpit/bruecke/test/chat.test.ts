import { describe, expect, it } from "vitest";
import { Chatverlauf, LONGEST_ANSWER, LONGEST_INPUT, LONGEST_RESULT, MOST_ENTRIES, antwortenPruefen, type ChatSchritt, type Gelesen } from "../src/chat.ts";

const ZEIT = 1_000;
const MODELL = "claude-haiku-5-5";

function verlauf(): Chatverlauf {
  let zaehler = 0;
  return new Chatverlauf(() => ZEIT, () => `id-${String((zaehler += 1))}`);
}

function lesen(chat: Chatverlauf, ...zeilen: unknown[]): Gelesen[] {
  return zeilen.map((zeile) => chat.lesen(zeile));
}

function schritte(gelesen: readonly Gelesen[]): ChatSchritt[] {
  return gelesen.flatMap((eintrag) => eintrag.schritte);
}

function strom(event: Record<string, unknown>, eltern: string | null = null): Record<string, unknown> {
  return { type: "stream_event", event, parent_tool_use_id: eltern, session_id: "s" };
}

function antwort(id: string, content: unknown[], eltern: string | null = null, model = MODELL): Record<string, unknown> {
  return { type: "assistant", message: { id, model, content }, parent_tool_use_id: eltern };
}

function rueck(content: unknown, eltern: string | null = null): Record<string, unknown> {
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: eltern };
}

const START = strom({ type: "message_start", message: { id: "msg_1", model: MODELL, usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 } } });

describe("session data", () => {
  it("takes model and Claude session from init", () => {
    expect(verlauf().lesen({ type: "system", subtype: "init", model: MODELL, session_id: "c-1" }).daten).toEqual({
      modell: MODELL,
      claudeSitzung: "c-1",
      einstellungen: { erlaubnis: null, ausgabestil: null, plugins: [], konnektoren: [], schnell: false },
    });
  });

  it("takes the settings that apply to the session from init", () => {
    const init = {
      type: "system",
      subtype: "init",
      model: MODELL,
      session_id: "c-1",
      permissionMode: "auto",
      output_style: "Explanatory",
      plugins: [{ name: "caveman", source: "caveman@caveman" }, { name: "kaputt" }],
      mcp_servers: [{ name: "playwright", status: "connected" }, { name: "plugin:p:s", status: "failed" }, { name: "aus", status: "disabled" }],
      fast_mode_state: "on",
    };
    expect(verlauf().lesen(init).daten.einstellungen).toEqual({ erlaubnis: "auto", ausgabestil: "Explanatory", plugins: ["caveman@caveman"], konnektoren: ["playwright", "plugin:p:s"], schnell: true });
  });

  it.each([["off", false], ["cooldown", false], [undefined, false]])("reads the fast mode state %s as %s", (state, schnell) => {
    expect(verlauf().lesen({ type: "system", subtype: "init", fast_mode_state: state }).daten.einstellungen?.schnell).toBe(schnell);
  });

  it("takes the number of queued turns from the result", () => {
    expect(verlauf().lesen({ type: "result", subtype: "success", is_error: false, queued_turn_count: 2 }).daten).toEqual({ zugEnde: true, wartendeZuege: 2 });
  });

  it.each([[-1], ["1"], [1.5]])("ignores a queued turn count of %s", (count) => {
    expect(verlauf().lesen({ type: "result", subtype: "success", is_error: false, queued_turn_count: count }).daten).toEqual({ zugEnde: true });
  });

  it("takes the cost of the session from the result", () => {
    expect(verlauf().lesen({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.0944793 }).daten).toEqual({ zugEnde: true, kostenUsd: 0.0944793 });
  });

  it.each([[-1], ["0.1"], [Number.NaN]])("ignores a cost of %s", (cost) => {
    expect(verlauf().lesen({ type: "result", subtype: "success", is_error: false, total_cost_usd: cost }).daten).toEqual({ zugEnde: true });
  });

  it("reports the model of a new answer when it changed after /model", () => {
    const chat = verlauf();
    chat.lesen({ type: "system", subtype: "init", model: MODELL, session_id: "c-1" });
    expect(chat.lesen(START).daten).toEqual({ eingabeTokens: 152 });
    const neu = strom({ type: "message_start", message: { id: "msg_2", model: "claude-sonnet-5", usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
    expect(chat.lesen(neu).daten).toEqual({ eingabeTokens: 1, modell: "claude-sonnet-5" });
    const ende = chat.lesen({ type: "result", subtype: "success", is_error: false, modelUsage: { [MODELL]: { contextWindow: 1_000_000 }, "claude-sonnet-5": { contextWindow: 200_000 } } });
    expect(ende.daten.kontextFenster).toBe(200_000);
  });

  it("adds input, cache creation and cache read tokens of a message and names its model when none was known", () => {
    expect(verlauf().lesen(START).daten).toEqual({ eingabeTokens: 152, modell: MODELL });
  });

  it("takes the context window of the current model from the result", () => {
    const chat = verlauf();
    chat.lesen({ type: "system", subtype: "init", model: MODELL, session_id: "c-1" });
    const ende = chat.lesen({ type: "result", subtype: "success", is_error: false, modelUsage: { [MODELL]: { contextWindow: 1_000_000 }, andere: { contextWindow: 5 } } });
    expect(ende.daten).toEqual({ zugEnde: true, kontextFenster: 1_000_000 });
    expect(ende.schritte).toEqual([]);
  });
});

describe("streamed text", () => {
  it("opens an empty answer, passes each piece on and settles on the full text", () => {
    const chat = verlauf();
    const gelesen = lesen(
      chat,
      START,
      strom({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      strom({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hal" } }),
      strom({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }),
      antwort("msg_1", [{ type: "text", text: "Hallo!" }]),
    );
    expect(schritte(gelesen)).toEqual([
      { art: "neu", eintrag: { id: "msg_1:0", art: "claude", zeit: ZEIT, text: "" } },
      { art: "teil", id: "msg_1:0", text: "Hal" },
      { art: "teil", id: "msg_1:0", text: "lo" },
      { art: "aktualisiert", eintrag: { id: "msg_1:0", art: "claude", zeit: ZEIT, text: "Hallo!" } },
    ]);
  });

  it("sends no update when the streamed pieces already make the full text", () => {
    const chat = verlauf();
    const gelesen = lesen(
      chat,
      START,
      strom({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
      strom({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "OK" } }),
      antwort("msg_1", [{ type: "text", text: "OK" }]),
    );
    expect(schritte(gelesen).map((schritt) => schritt.art)).toEqual(["neu", "teil"]);
    expect(chat.alle()).toEqual([{ id: "msg_1:1", art: "claude", zeit: ZEIT, text: "OK" }]);
  });

  it("ignores thinking and the deltas of tool input", () => {
    const chat = verlauf();
    const gelesen = lesen(
      chat,
      START,
      strom({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
      strom({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{" } }),
      antwort("msg_1", [{ type: "thinking", thinking: "geheim" }]),
    );
    expect(schritte(gelesen)).toEqual([]);
  });
});

describe("tools", () => {
  it("shows a call with a short description and fills in the result", () => {
    const chat = verlauf();
    const gelesen = lesen(
      chat,
      antwort("msg_2", [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm test", description: "Tests" } }]),
      rueck([{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "grün" }] }]),
    );
    expect(schritte(gelesen)).toEqual([
      { art: "neu", eintrag: { id: "toolu_1", art: "werkzeug", zeit: ZEIT, werkzeug: { name: "Bash", kurz: "npm test", eingabe: '{"command":"npm test","description":"Tests"}', status: "laeuft" } } },
      { art: "aktualisiert", eintrag: { id: "toolu_1", art: "werkzeug", zeit: ZEIT, werkzeug: { name: "Bash", kurz: "npm test", eingabe: '{"command":"npm test","description":"Tests"}', status: "ok", ergebnis: "grün" } } },
    ]);
  });

  it("marks a failed call and shortens a long result and input", () => {
    const chat = verlauf();
    chat.lesen(antwort("msg_2", [{ type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "/a", content: "x".repeat(LONGEST_INPUT) } }]));
    const [schritt] = chat.lesen(rueck([{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: "y".repeat(LONGEST_RESULT + 1) }])).schritte;
    const werkzeug = schritt?.art === "aktualisiert" ? schritt.eintrag.werkzeug : undefined;
    expect(werkzeug?.status).toBe("fehler");
    expect(werkzeug?.kurz).toBe("/a");
    expect(werkzeug?.ergebnis).toBe(`${"y".repeat(LONGEST_RESULT)} …`);
    expect(werkzeug?.eingabe.length).toBe(LONGEST_INPUT + 2);
  });

  it("keeps a result of exactly the limit whole", () => {
    const chat = verlauf();
    chat.lesen(antwort("msg_2", [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }]));
    const [schritt] = chat.lesen(rueck([{ type: "tool_result", tool_use_id: "toolu_1", content: "y".repeat(LONGEST_RESULT) }])).schritte;
    expect(schritt?.art === "aktualisiert" ? schritt.eintrag.werkzeug?.ergebnis : undefined).toBe("y".repeat(LONGEST_RESULT));
  });

  it("shows a subagent and puts its calls below it", () => {
    const chat = verlauf();
    const gelesen = lesen(
      chat,
      antwort("msg_3", [{ type: "tool_use", id: "toolu_a", name: "Agent", input: { description: "Suche", prompt: "p", subagent_type: "Explore" } }]),
      antwort("msg_4", [{ type: "tool_use", id: "toolu_b", name: "Grep", input: { pattern: "x" } }], "toolu_a"),
      antwort("msg_5", [{ type: "text", text: "Zwischenstand" }], "toolu_a"),
      rueck([{ type: "tool_result", tool_use_id: "toolu_a", content: "fertig" }]),
    );
    expect(schritte(gelesen)).toEqual([
      { art: "neu", eintrag: { id: "toolu_a", art: "agent", zeit: ZEIT, agent: { typ: "Explore", beschreibung: "Suche", status: "laeuft" } } },
      { art: "neu", eintrag: { id: "toolu_b", art: "werkzeug", zeit: ZEIT, eltern: "toolu_a", werkzeug: { name: "Grep", kurz: "x", eingabe: '{"pattern":"x"}', status: "laeuft" } } },
      { art: "neu", eintrag: { id: "msg_5:0", art: "claude", zeit: ZEIT, text: "Zwischenstand", eltern: "toolu_a" } },
      { art: "aktualisiert", eintrag: { id: "toolu_a", art: "agent", zeit: ZEIT, agent: { typ: "Explore", beschreibung: "Suche", status: "ok" } } },
    ]);
  });

  it("ignores a result of a call it never saw", () => {
    expect(verlauf().lesen(rueck([{ type: "tool_result", tool_use_id: "fremd", content: "x" }])).schritte).toEqual([]);
  });
});

const FRAGE = { question: "Rot oder Blau?", header: "Farbe", options: [{ label: "Rot", description: "warm" }, { label: "Blau" }], multiSelect: false };

describe("questions and plans", () => {
  it("shows a question card and keeps the open request of the host", () => {
    const chat = verlauf();
    const gelesen = lesen(
      chat,
      antwort("msg_6", [{ type: "tool_use", id: "toolu_f", name: "AskUserQuestion", input: { questions: [FRAGE] } }]),
      { type: "control_request", request_id: "r-1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", tool_use_id: "toolu_f", input: { questions: [FRAGE] } } },
    );
    expect(schritte(gelesen)).toEqual([
      { art: "neu", eintrag: { id: "toolu_f", art: "frage", zeit: ZEIT, frage: { fragen: [{ frage: "Rot oder Blau?", kopf: "Farbe", optionen: [{ label: "Rot", beschreibung: "warm" }, { label: "Blau", beschreibung: "" }], mehrfach: false }] } } },
    ]);
    expect(gelesen[1]?.anfrage).toEqual({ requestId: "r-1", eintrag: "toolu_f", eingabe: { questions: [FRAGE] } });
    expect(chat.anfrage("toolu_f")?.requestId).toBe("r-1");
  });

  it("creates the card from the request when the call itself was not seen", () => {
    const chat = verlauf();
    const gelesen = chat.lesen({ type: "control_request", request_id: "r-2", request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", tool_use_id: "toolu_p", input: { plan: "# Plan" } } });
    expect(gelesen.schritte).toEqual([{ art: "neu", eintrag: { id: "toolu_p", art: "plan", zeit: ZEIT, plan: { text: "# Plan" } } }]);
  });

  it("passes on permission requests of other tools and waits for them", () => {
    const chat = verlauf();
    const gelesen = chat.lesen({ type: "control_request", request_id: "r-3", request: { subtype: "can_use_tool", tool_name: "mcp__konto__anmelden", tool_use_id: "toolu_x", input: { url: "https://x" } } });
    expect(gelesen).toEqual({ schritte: [], daten: {}, erlaubnis: { requestId: "r-3", werkzeug: "mcp__konto__anmelden", eingabe: { url: "https://x" } } });
    expect(chat.erlaubnis("r-3")).toEqual(gelesen.erlaubnis);
    expect(chat.wartetAufAntwort()).toBe(true);
    chat.erlaubnisErledigt("r-3");
    expect(chat.erlaubnis("r-3")).toBeUndefined();
    expect(chat.wartetAufAntwort()).toBe(false);
  });

  it("names an unnamed tool and passes on a request without tool use", () => {
    const gelesen = verlauf().lesen({ type: "control_request", request_id: "r-4", request: { subtype: "can_use_tool" } });
    expect(gelesen.erlaubnis).toEqual({ requestId: "r-4", werkzeug: "unbekanntes Werkzeug", eingabe: {} });
  });

  it("ignores card requests without tool use and other control requests", () => {
    expect(verlauf().lesen({ type: "control_request", request_id: "r-5", request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", input: {} } })).toEqual({ schritte: [], daten: {} });
    expect(verlauf().lesen({ type: "control_request", request_id: "r-6", request: { subtype: "mcp_message" } })).toEqual({ schritte: [], daten: {} });
  });

  it("forgets a permission request that Claude Code withdraws", () => {
    const chat = verlauf();
    chat.lesen({ type: "control_request", request_id: "r-3", request: { subtype: "can_use_tool", tool_name: "mcp__konto__anmelden", input: {} } });
    expect(chat.lesen({ type: "control_cancel_request", request_id: "r-3" })).toEqual({ schritte: [], daten: {}, zurueckgezogen: "r-3" });
    expect(chat.erlaubnis("r-3")).toBeUndefined();
    expect(chat.lesen({ type: "control_cancel_request", request_id: "r-3" })).toEqual({ schritte: [], daten: {} });
  });

  it("forgets a request that Claude Code withdraws", () => {
    const chat = verlauf();
    chat.lesen({ type: "control_request", request_id: "r-2", request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", tool_use_id: "toolu_p", input: { plan: "x" } } });
    expect(chat.lesen({ type: "control_cancel_request", request_id: "r-2" }).abgebrochen).toBe("toolu_p");
    expect(chat.anfrage("toolu_p")).toBeUndefined();
  });

  it("marks an answered card and forgets its request", () => {
    const chat = verlauf();
    chat.lesen({ type: "control_request", request_id: "r-2", request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", tool_use_id: "toolu_p", input: { plan: "x" } } });
    const schritt = chat.beantwortet("toolu_p", (eintrag) => ({ ...eintrag, plan: { text: "x", entschieden: "ja" } }));
    expect(schritt).toEqual({ art: "aktualisiert", eintrag: { id: "toolu_p", art: "plan", zeit: ZEIT, plan: { text: "x", entschieden: "ja" } } });
    expect(chat.anfrage("toolu_p")).toBeUndefined();
  });
});

describe("notes of Claude Code", () => {
  it.each([
    ["the answer to /effort", antwort("msg_x", [{ type: "text", text: "Set effort level to low (this session only)" }], null, "<synthetic>"), "Set effort level to low (this session only)"],
    ["a local command", rueck("<local-command-stdout>Compacted</local-command-stdout>"), "Compacted"],
    ["an interruption", rueck([{ type: "text", text: "[Request interrupted by user]" }]), "Abgebrochen."],
    ["a compaction", { type: "system", subtype: "compact_boundary", compact_metadata: { pre_tokens: 126489, post_tokens: 39231 } }, "Kontext verdichtet (126489 → 39231 Tokens)"],
    ["a failed turn", { type: "result", subtype: "error_during_execution", is_error: true, errors: ["kaputt"] }, "Fehler: kaputt"],
  ])("shows %s as a system note", (_fall, zeile, text) => {
    expect(verlauf().lesen(zeile).schritte).toEqual([{ art: "neu", eintrag: { id: "id-1", art: "system", zeit: ZEIT, text } }]);
  });

  it("ignores the summary that continues a compacted conversation", () => {
    expect(verlauf().lesen(rueck("This session is being continued from a previous conversation")).schritte).toEqual([]);
  });

  it.each([null, "text", [], { type: "rate_limit_event" }, { type: "system", subtype: "hook_started" }])("ignores %j", (zeile) => {
    expect(verlauf().lesen(zeile)).toEqual({ schritte: [], daten: {} });
  });
});

describe("own messages and stored entries", () => {
  it("adds a message of Daniel", () => {
    expect(verlauf().eigeneNachricht("Hallo")).toEqual({ art: "neu", eintrag: { id: "id-1", art: "du", zeit: ZEIT, text: "Hallo" } });
  });

  it("starts from stored entries and does not show a call twice", () => {
    const gespeichert = [{ id: "toolu_1", art: "werkzeug" as const, zeit: 5, werkzeug: { name: "Bash", kurz: "ls", eingabe: "{}", status: "ok" as const } }];
    const chat = new Chatverlauf(() => ZEIT, () => "neu", gespeichert);
    expect(chat.lesen(antwort("msg_2", [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }])).schritte).toEqual([]);
    expect(chat.alle()).toEqual(gespeichert);
  });
});

describe("size of the chat in memory", () => {
  it("keeps the newest entries up to the limit and drops the oldest", () => {
    const chat = verlauf();
    for (let nummer = 0; nummer < MOST_ENTRIES; nummer += 1) chat.eigeneNachricht("x");
    expect(chat.alle()).toHaveLength(MOST_ENTRIES);
    expect(chat.alle()[0]?.id).toBe("id-1");
    chat.eigeneNachricht("y");
    expect(chat.alle()).toHaveLength(MOST_ENTRIES);
    expect(chat.alle()[0]?.id).toBe("id-2");
  });
});

describe("antwortenPruefen", () => {
  const EINZELN = { frage: "Rot oder Blau?", kopf: "Farbe", optionen: [{ label: "Rot", beschreibung: "" }], mehrfach: false };
  const MEHRERE = { frage: "Welche Teile?", kopf: "Teile", optionen: [{ label: "A", beschreibung: "" }, { label: "B", beschreibung: "" }], mehrfach: true };

  it("joins the labels of a question with several answers with comma and space", () => {
    expect(antwortenPruefen([EINZELN, MEHRERE], { "Rot oder Blau?": "Rot", "Welche Teile?": ["A", "B"] })).toEqual({ "Rot oder Blau?": "Rot", "Welche Teile?": "A, B" });
  });

  it("takes free text as the answer", () => {
    expect(antwortenPruefen([EINZELN], { "Rot oder Blau?": "Grün" })).toEqual({ "Rot oder Blau?": "Grün" });
  });

  it("accepts an answer of exactly the longest length", () => {
    expect(antwortenPruefen([EINZELN], { "Rot oder Blau?": "x".repeat(LONGEST_ANSWER) })).toBeDefined();
  });

  it.each([
    ["no object", "Rot"],
    ["a missing answer", {}],
    ["an unknown question", { "Rot oder Blau?": "Rot", "Wer?": "ich" }],
    ["an empty answer", { "Rot oder Blau?": "  " }],
    ["a list for a question with one answer", { "Rot oder Blau?": ["Rot"] }],
    ["an answer one sign too long", { "Rot oder Blau?": "x".repeat(LONGEST_ANSWER + 1) }],
    ["a number", { "Rot oder Blau?": 1 }],
  ])("refuses %s", (_fall, antworten) => {
    expect(antwortenPruefen([EINZELN], antworten)).toBeUndefined();
  });

  it.each([[[]], [["A", ""]], [["A", 2]]])("refuses the list %j for a question with several answers", (liste) => {
    expect(antwortenPruefen([MEHRERE], { "Welche Teile?": liste })).toBeUndefined();
  });
});

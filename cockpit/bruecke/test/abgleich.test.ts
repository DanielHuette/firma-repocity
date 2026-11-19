import { describe, expect, it } from "vitest";
import { abgleichen } from "../src/abgleich.ts";
import type { Steuerbar } from "../src/abgleich.ts";
import { CLAUDE_ENDED, type Steuerantwort } from "../src/chatprozess.ts";
import { Agentenfortschritt, MAIN_PARENT } from "../src/agentenfortschritt.ts";
import { OHNE_OPTIONEN } from "../src/sitzungsoptionen.ts";

function claude(refused: readonly string[] = []): Steuerbar & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    steuern(subtype: string, felder: Readonly<Record<string, unknown>> = {}): Promise<Steuerantwort> {
      calls.push({ subtype, ...felder });
      return Promise.resolve(refused.includes(subtype) ? { kind: "fehler", grund: "nein" } : { kind: "ok", antwort: {} });
    },
  };
}

describe("abgleichen", () => {
  it("keeps the wish for a connector when Claude Code ends before it answers", async () => {
    const ended: Steuerbar = { steuern: () => Promise.resolve({ kind: "fehler", grund: CLAUDE_ENDED }) };
    const result = await abgleichen(ended, OHNE_OPTIONEN, { ...OHNE_OPTIONEN, konnektorenAus: ["github"] }, []);
    expect(result).toEqual({ laufend: OHNE_OPTIONEN, abgelehnt: [], hinweise: [], neustart: false });
  });

  it("sends nothing when nothing differs", async () => {
    const fake = claude();
    const result = await abgleichen(fake, OHNE_OPTIONEN, OHNE_OPTIONEN, []);
    expect(fake.calls).toEqual([]);
    expect(result).toEqual({ laufend: OHNE_OPTIONEN, abgelehnt: [], hinweise: [], neustart: false });
  });

  it("applies title, permission mode, flags with reload and connectors in this order", async () => {
    const fake = claude();
    const wanted = { ...OHNE_OPTIONEN, titel: "T", erlaubnis: "acceptEdits" as const, plugins: ["a@m"], ausgabestil: "Concise", konnektorenAus: ["github"] };
    const result = await abgleichen(fake, { ...OHNE_OPTIONEN, konnektorenAus: ["alt"] }, wanted, ["a@m", "b@m"]);
    expect(fake.calls).toEqual([
      { subtype: "rename_session", title: "T", source: "host" },
      { subtype: "set_permission_mode", mode: "acceptEdits" },
      { subtype: "apply_flag_settings", settings: { enabledPlugins: { "a@m": true, "b@m": false }, outputStyle: "Concise" } },
      { subtype: "reload_plugins", refuse_if_busy: true },
      { subtype: "mcp_toggle", serverName: "github", enabled: false },
      { subtype: "mcp_toggle", serverName: "alt", enabled: true },
    ]);
    expect(result.laufend).toEqual(wanted);
  });

  it("does not reload plugins when only the style changed", async () => {
    const fake = claude();
    await abgleichen(fake, OHNE_OPTIONEN, { ...OHNE_OPTIONEN, ausgabestil: "Learning" }, []);
    expect(fake.calls.map((call) => call.subtype)).toEqual(["apply_flag_settings"]);
  });

  it("keeps a running fast mode in the flag settings", async () => {
    const fake = claude();
    await abgleichen(fake, { ...OHNE_OPTIONEN, schnell: true }, { ...OHNE_OPTIONEN, schnell: true, ausgabestil: "Learning" }, []);
    expect(fake.calls[0]).toEqual({ subtype: "apply_flag_settings", settings: { fastMode: true, outputStyle: "Learning" } });
  });

  it.each(["set_permission_mode", "apply_flag_settings", "reload_plugins"])("asks for a restart when %s is refused", async (subtype) => {
    const result = await abgleichen(claude([subtype]), OHNE_OPTIONEN, { ...OHNE_OPTIONEN, erlaubnis: "plan", plugins: [] }, ["a@m"]);
    expect(result.neustart).toBe(true);
    expect(result.hinweise.join(" ")).toContain("neu");
  });

  it("reports a refused connector without restart", async () => {
    const result = await abgleichen(claude(["mcp_toggle"]), OHNE_OPTIONEN, { ...OHNE_OPTIONEN, konnektorenAus: ["github"] }, []);
    expect(result).toMatchObject({ abgelehnt: [{ name: "github", enabled: false }], neustart: false, laufend: { konnektorenAus: [] } });
    expect(result.hinweise).toEqual(["Konnektor github aus nicht übernommen (nein)."]);
  });

  it("keeps the title shown even when Claude Code refuses it", async () => {
    const result = await abgleichen(claude(["rename_session"]), OHNE_OPTIONEN, { ...OHNE_OPTIONEN, titel: "T" }, []);
    expect(result).toMatchObject({ laufend: { titel: "T" }, neustart: false });
  });
});

function toolUse(id: string, name: string, input: Record<string, unknown>, parent: string | null = null): Record<string, unknown> {
  return { type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "tool_use", id, name, input }] } };
}

const TASKS = "mcp__plugin_claude-mem_mcp-search__work_state_write";

describe("Agentenfortschritt", () => {
  it("lists agents, their skills and their progress from the task list tool", () => {
    const progress = new Agentenfortschritt();
    progress.lesen(toolUse("toolu_a", "Agent", { subagent_type: "Explore" }));
    progress.lesen(toolUse("t1", "Skill", { skill: "grill-me" }, "toolu_a"));
    progress.lesen(toolUse("t2", "Skill", { skill: "grill-me" }, "toolu_a"));
    for (const [task, status] of [["A", "todo"], ["B", "todo"], ["C", "todo"], ["A", "done"], ["C", "dropped"]]) {
      progress.lesen(toolUse(`w${task ?? ""}${status ?? ""}`, TASKS, { list: "l", fields: { task, status } }, "toolu_a"));
    }
    expect(progress.agenten()).toEqual([{ id: "toolu_a", typ: "Explore", beschreibung: null }]);
    expect(progress.von("toolu_a")).toEqual({ skills: ["grill-me"], fortschritt: { erledigt: 1, gesamt: 2 } });
  });

  it.each([
    ["the short description", { description: "  Helfer B grill-me ", subagent_type: "Explore" }, { id: "t", typ: "Explore", beschreibung: "Helfer B grill-me" }],
    ["no description when it is missing", { subagent_type: "Plan" }, { id: "t", typ: "Plan", beschreibung: null }],
    ["no description when it is blank", { description: "   " }, { id: "t", typ: "general-purpose", beschreibung: null }],
  ])("keeps %s of an agent call", (_case, input, erwartet) => {
    const progress = new Agentenfortschritt();
    progress.lesen(toolUse("t", "Agent", input));
    expect(progress.agenten()).toEqual([erwartet]);
  });

  it("shows no number without a task list", () => {
    const progress = new Agentenfortschritt();
    progress.lesen(toolUse("s", "Skill", { skill: "caveman" }));
    expect(progress.von(MAIN_PARENT)).toEqual({ skills: ["caveman"], fortschritt: null });
  });

  it.each([
    ["a line that is no answer", { type: "user", message: { content: [] } }],
    ["a task without status", toolUse("w", TASKS, { list: "l", fields: { task: "A" } })],
    ["another tool", toolUse("x", "Bash", { command: "ls" })],
  ])("ignores %s", (_case, line) => {
    const progress = new Agentenfortschritt();
    progress.lesen(line);
    expect(progress.von(MAIN_PARENT)).toEqual({ skills: [], fortschritt: null });
  });
});

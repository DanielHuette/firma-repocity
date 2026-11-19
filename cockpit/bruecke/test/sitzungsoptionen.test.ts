import { describe, expect, it } from "vitest";
import { differences, flagSettings, isSettled, OHNE_OPTIONEN, parseStoredOptions, skillLine, startArguments, withSkillLine } from "../src/sitzungsoptionen.ts";
import type { GespeicherteOptionen } from "../src/sitzungsoptionen.ts";

const VOLL: GespeicherteOptionen = {
  titel: "Brücke",
  skills: ["grill-me"],
  plugins: ["caveman@caveman"],
  konnektorenAus: ["playwright"],
  erlaubnis: "plan",
  ausgabestil: "Explanatory",
  schnell: true,
  anbieter: "openrouter",
  modell: "anthropic/claude-sonnet-4.5",
  pruefung: false,
};

describe("parseStoredOptions", () => {
  it("reads a session of an older bridge without options as one without choices", () => {
    expect(parseStoredOptions(undefined)).toEqual(OHNE_OPTIONEN);
  });

  it("fills missing options of an older bridge with the defaults", () => {
    expect(parseStoredOptions({ titel: "Alt" })).toEqual({ ...OHNE_OPTIONEN, titel: "Alt" });
  });

  it("reads every option", () => {
    expect(parseStoredOptions(VOLL)).toEqual(VOLL);
  });

  it.each([
    ["an unknown option", { ...VOLL, farbe: "rot" }],
    ["a title of 61 characters", { ...VOLL, titel: "t".repeat(61) }],
    ["a skill chosen twice", { ...VOLL, skills: ["a", "a"] }],
    ["plugins that are no list", { ...VOLL, plugins: "caveman" }],
    ["switched-off connectors that are null", { ...VOLL, konnektorenAus: null }],
    ["a bypassing permission mode", { ...VOLL, erlaubnis: "bypassPermissions" }],
    ["a fast mode that is no boolean", { ...VOLL, schnell: "ja" }],
    ["an unknown provider", { ...VOLL, anbieter: "openai" }],
    ["a model with a space", { ...VOLL, modell: "a b" }],
    ["a check flag that is no boolean", { ...VOLL, pruefung: "ja" }],
    ["a list", [VOLL]],
    ["null", null],
  ])("refuses %s", (_case, value) => {
    expect(parseStoredOptions(value)).toBeUndefined();
  });
});

describe("startArguments", () => {
  it("adds nothing for a session without choices", () => {
    expect(startArguments(OHNE_OPTIONEN, { installiertePlugins: ["a@m"] })).toEqual([]);
  });

  it("sets model, permission mode, plugins, fast mode and style, but never --strict-mcp-config", () => {
    const args = startArguments(VOLL, { installiertePlugins: ["caveman@caveman", "kurator@k"] });
    expect(args.slice(0, 4)).toEqual(["--model", "anthropic/claude-sonnet-4.5", "--permission-mode", "plan"]);
    expect(args[4]).toBe("--settings");
    expect(JSON.parse(args[5] ?? "")).toEqual({ enabledPlugins: { "caveman@caveman": true, "kurator@k": false }, fastMode: true, outputStyle: "Explanatory" });
    expect(args).toHaveLength(6);
  });

  it("gives no --model for the model default", () => {
    expect(startArguments({ ...OHNE_OPTIONEN, modell: "default" }, { installiertePlugins: [] })).toEqual([]);
  });

  it("asks for every changing tool in a check session", () => {
    expect(flagSettings({ ...OHNE_OPTIONEN, pruefung: true }, [])).toEqual({ permissions: { ask: ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"] } });
  });

  it("switches every installed plugin off when none is chosen", () => {
    expect(flagSettings({ ...OHNE_OPTIONEN, plugins: [] }, ["a@m"])).toEqual({ enabledPlugins: { "a@m": false } });
  });
});

describe("differences", () => {
  it("finds nothing when nothing changed, whatever the order of the lists", () => {
    expect(isSettled(differences({ ...VOLL, plugins: ["a", "b"] }, { ...VOLL, plugins: ["b", "a"] }))).toBe(true);
  });

  it.each([
    ["titel", { titel: "Neu" }],
    ["erlaubnis", { erlaubnis: "default" }],
    ["flags", { ausgabestil: null }],
    ["plugins", { plugins: ["b"] }],
    ["schnell", { schnell: false }],
  ] as const)("finds a change of %s", (key, change) => {
    const found = differences(VOLL, { ...VOLL, ...change });
    expect(found[key]).toBe(true);
    expect(isSettled(found)).toBe(false);
  });

  it("names the connectors to switch off and on", () => {
    expect(differences(VOLL, { ...VOLL, konnektorenAus: ["github"] }).konnektoren).toEqual({ aus: ["github"], an: ["playwright"] });
  });

  it("finds no change of skills, provider or model", () => {
    expect(isSettled(differences(VOLL, { ...VOLL, skills: [], anbieter: "abo", modell: "opus" }))).toBe(true);
  });
});

describe("skillLine", () => {
  it.each([
    [["a"], [], "Für diese Sitzung gilt zusätzlich: lade mit dem Skill-Werkzeug den Skill a."],
    [["a", "b"], [], "Für diese Sitzung gilt zusätzlich: lade mit dem Skill-Werkzeug die Skills a und b."],
    [["a", "b", "c"], [], "Für diese Sitzung gilt zusätzlich: lade mit dem Skill-Werkzeug die Skills a, b und c."],
    [[], ["x"], "Für diese Sitzung gilt zusätzlich: wende den Skill x nicht mehr an (Hinweis an Claude)."],
    [["a"], ["x", "y"], "Für diese Sitzung gilt zusätzlich: lade mit dem Skill-Werkzeug den Skill a; wende die Skills x und y nicht mehr an (Hinweis an Claude)."],
  ])("writes the line for added %j and removed %j", (added, removed, line) => {
    expect(skillLine(added, removed)).toBe(line);
  });

  it("writes no line without change", () => {
    expect(skillLine([], [])).toBeNull();
  });
});

describe("withSkillLine", () => {
  it("puts the line before the message", () => {
    expect(withSkillLine("Hallo", "Zeile")).toBe("Zeile\n\nHallo");
  });

  it("never puts the line before a slash command", () => {
    expect(withSkillLine("/compact", "Zeile")).toBe("/compact");
  });

  it("leaves the message alone without line", () => {
    expect(withSkillLine("Hallo", null)).toBe("Hallo");
  });
});

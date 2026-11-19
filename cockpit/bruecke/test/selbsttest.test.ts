import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../src/befehl.ts";
import { ANSWER_WAIT_MS, claudeVersion, openSelfTest, SELF_TEST_FILE, SelfTest } from "../src/selbsttest.ts";

const OLD = "2.1.322 (Claude Code)";
const NEW = "2.2.0 (Claude Code)";

let folder: string;
let changes: number;
let passed: string[];

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "bruecke-selbsttest-"));
  changes = 0;
  passed = [];
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(folder, { recursive: true, force: true });
});

function checking(): SelfTest {
  return new SelfTest({
    version: NEW,
    checking: true,
    onChange: () => (changes += 1),
    onPassed: (version) => passed.push(version),
  });
}

describe("after an update", () => {
  it("passes when status line and hooks came after the first answer, and remembers the version", () => {
    const test = checking();
    test.inputSent("s1");
    test.observe("s1", "PreToolUse");
    test.observe("s1", "Statuszeile");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(passed).toEqual([NEW]);
  });

  it("passes on Stop alone, because the status line does not run in print mode", () => {
    const test = checking();
    test.inputSent("s1");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(passed).toEqual([NEW]);
  });

  it.each([
    ["a tool call that still runs", ["PreToolUse"]],
    ["a question that waits", ["PermissionRequest", "Statuszeile"]],
    ["a notification", ["Notification"]],
  ])("gives no verdict and no alarm without a Stop when a hook reported, as after %s", (_case, events) => {
    const test = checking();
    test.inputSent("s1");
    for (const event of events) test.observe("s1", event);
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    expect(test.hints("s1")).toEqual([]);
    expect(changes).toBe(0);
    expect(passed).toEqual([]);
  });

  it.each([
    ["nothing at all", []],
    ["only the status line", ["Statuszeile"]],
  ])("marks agents and questions when %s came within the waiting time and no hook reported", (_case, events) => {
    const test = checking();
    test.inputSent("s1");
    for (const event of events) test.observe("s1", event);
    vi.advanceTimersByTime(ANSWER_WAIT_MS - 1);
    expect(test.hints("s1")).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(test.hints("s1")).toEqual([
      expect.objectContaining({ art: "selbsttest", text: expect.stringContaining("Hooks") as unknown, auftrag: expect.stringContaining("hooks.md") as unknown }),
      { art: "keine_daten", anzeige: "agenten" },
      { art: "keine_daten", anzeige: "fragen" },
    ]);
    expect(changes).toBe(1);
    expect(passed).toEqual([]);
  });

  it("watches afresh from the next input once the waiting time ran out", () => {
    const test = checking();
    test.inputSent("s1");
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    expect(test.hints("s1").length).toBeGreaterThan(0);
    test.inputSent("s1");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(passed).toEqual([NEW]);
  });

  it("clears the marks of every session once a check passes", () => {
    const test = checking();
    test.inputSent("s1");
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    expect(test.hints("s1").length).toBeGreaterThan(0);
    test.inputSent("s2");
    test.observe("s2", "Statuszeile");
    test.observe("s2", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(test.hints("s2")).toEqual([]);
  });

  it("gives a prepared repair task that names the missing ways and the docs, without Enter", () => {
    const test = checking();
    test.inputSent("s1");
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    const hint = test.hints("s1")[0];
    const task = hint?.art === "selbsttest" ? hint.auftrag : "";
    expect(task).toContain(NEW);
    expect(task).toContain("https://code.claude.com/docs/en/hooks.md");
    expect(task).toContain("https://code.claude.com/docs/en/headless.md");
    expect(task).toContain("bruecke/meldeskripte");
    expect(task).not.toMatch(/[\r\n]/);
  });

  it("ignores events of sessions without input and events before any input", () => {
    const test = checking();
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(changes).toBe(0);
  });

  it("checks again at the next input after a failed check and clears the marks when it passes", () => {
    const test = checking();
    test.inputSent("s1");
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    test.inputSent("s1");
    test.observe("s1", "Statuszeile");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(passed).toEqual([NEW]);
  });
});

describe("without an update", () => {
  it("checks nothing", () => {
    const test = new SelfTest({ version: OLD, checking: false, onChange: () => (changes += 1), onPassed: (version) => passed.push(version) });
    test.inputSent("s1");
    test.observe("s1", "Stop");
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    expect(test.hints("s1")).toEqual([]);
    expect(changes).toBe(0);
  });

  it("starts a check when a new or resumed session reports another version", () => {
    const test = new SelfTest({ version: OLD, checking: false, onChange: () => (changes += 1), onPassed: (version) => passed.push(version) });
    test.versionSeen(null);
    test.versionSeen(OLD);
    test.inputSent("s1");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    test.versionSeen(NEW);
    expect(test.version()).toBe(NEW);
    test.inputSent("s1");
    test.observe("s1", "Statuszeile");
    test.observe("s1", "Stop");
    expect(passed).toEqual([NEW]);
  });

  it("checks the running sessions again on request, starting at their next input", () => {
    const test = new SelfTest({ version: OLD, checking: false, onChange: () => (changes += 1), onPassed: (version) => passed.push(version) });
    test.restart();
    test.inputSent("s1");
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    expect(test.hints("s1").length).toBeGreaterThan(0);
  });
});

describe("version of Claude Code", () => {
  function answering(result: CommandResult): Parameters<typeof claudeVersion>[0] {
    return () => Promise.resolve(result);
  }

  it.each([
    ["the first line", { kind: "ok", stdout: `${NEW}\nmehr\n` }, NEW],
    ["nothing for empty output", { kind: "ok", stdout: "\n" }, null],
    ["nothing when the command fails", { kind: "fehler", grund: "ended with code 1" }, null],
    ["nothing when the command is missing", { kind: "fehlt", grund: "claude was not found" }, null],
    ["nothing for control characters", { kind: "ok", stdout: "2.2.0\u001b[31m" }, null],
  ] as const)("reads %s", async (_case, result, version) => {
    expect(await claudeVersion(answering(result), ["claude"], folder)).toBe(version);
  });

  it("asks the command with --version", async () => {
    const calls: unknown[] = [];
    await claudeVersion((command, args) => {
      calls.push([command, args]);
      return Promise.resolve({ kind: "ok", stdout: NEW });
    }, ["node", "ersatz.js"], folder);
    expect(calls).toEqual([[["node", "ersatz.js"], ["--version"]]]);
  });
});

describe("openSelfTest", () => {
  const problems: string[] = [];
  const callbacks = { onChange: () => undefined, onProblem: (problem: string) => problems.push(problem) };

  it("remembers the version on the first start without checking", async () => {
    const test = await openSelfTest(folder, NEW, callbacks);
    test.inputSent("s1");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(JSON.parse(await readFile(path.join(folder, SELF_TEST_FILE), "utf8"))).toEqual({ version: NEW });
  });

  it("checks after a change of the version and stores the new one only once the check passed", async () => {
    await writeFile(path.join(folder, SELF_TEST_FILE), JSON.stringify({ version: OLD }));
    const test = await openSelfTest(folder, NEW, callbacks);
    test.inputSent("s1");
    vi.advanceTimersByTime(ANSWER_WAIT_MS);
    expect(test.hints("s1").length).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(path.join(folder, SELF_TEST_FILE), "utf8"))).toEqual({ version: OLD });
    test.inputSent("s1");
    test.observe("s1", "Statuszeile");
    test.observe("s1", "Stop");
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(path.join(folder, SELF_TEST_FILE), "utf8"))).toEqual({ version: NEW });
    });
  });

  it("checks nothing when the version is unknown", async () => {
    await writeFile(path.join(folder, SELF_TEST_FILE), JSON.stringify({ version: OLD }));
    const test = await openSelfTest(folder, null, callbacks);
    test.inputSent("s1");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(test.version()).toBeNull();
  });

  it("treats a damaged file as a first start", async () => {
    await writeFile(path.join(folder, SELF_TEST_FILE), "{kaputt");
    const test = await openSelfTest(folder, NEW, callbacks);
    test.inputSent("s1");
    test.observe("s1", "Stop");
    expect(test.hints("s1")).toEqual([]);
    expect(problems.at(-1)).toContain(SELF_TEST_FILE);
  });
});

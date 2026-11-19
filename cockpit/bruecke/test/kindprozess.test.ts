import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childEnvironment, findCommand } from "../src/kindprozess.ts";

const onWindows = process.platform === "win32";
const PATH_KEY = onWindows ? "Path" : "PATH";
const BRIDGE = path.resolve(import.meta.dirname, "..");
const BRIDGE_BIN = path.join(BRIDGE, "node_modules", ".bin");
const PARENT_BIN = path.join(path.dirname(BRIDGE), "node_modules", ".bin");
const OTHER = path.join(tmpdir(), "werkzeuge");

describe("childEnvironment", () => {
  it("removes exactly the session-bound variables of Claude Code and keeps its user settings", () => {
    const sessionBound = [
      "CLAUDECODE",
      "CLAUDE_CODE_ENTRYPOINT",
      "CLAUDE_CODE_SSE_PORT",
      "CLAUDE_CODE_CHILD_SESSION",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_CODE_BRIDGE_SESSION_ID",
      "CLAUDE_CODE_MESSAGING_SOCKET",
      "CLAUDE_CODE_MESSAGING_TOKEN",
      "CLAUDE_JOB_DIR",
      "CLAUDE_PID",
      "CLAUDE_EFFORT",
      "CLAUDE_CODE_REMOTE",
      "CLAUDE_CODE_REMOTE_SESSION_ID",
      "TRACEPARENT",
    ];
    const kept = {
      CLAUDE_CODE_GIT_BASH_PATH: "C:/Git/bin/bash.exe",
      CLAUDE_CODE_SUBAGENT_MODEL: "sonnet",
      CLAUDE_CODE_USE_POWERSHELL_TOOL: "1",
      CLAUDE_ENV_FILE: "/home/r/env.sh",
    };
    const result = childEnvironment({ ...Object.fromEntries(sessionBound.map((name) => [name, "x"])), ...kept }, "s");
    expect(result).toEqual({ ...kept, KOMMANDOZENTRALE_SITZUNG: "s", TERM: "xterm-256color", COLORTERM: "truecolor" });
  });

  it("removes npm, Claude Code and INIT_CWD variables and keeps the rest", () => {
    const result = childEnvironment(
      {
        npm_config_cache: "x",
        npm_lifecycle_event: "test",
        INIT_CWD: "x",
        CLAUDECODE: "1",
        CLAUDE_CODE_CHILD_SESSION: "1",
        CLAUDE_CODE_ENTRYPOINT: "cli",
        CLAUDE_CONFIG_DIR: "behalten",
        MEIN_npm_WERT: "behalten",
        HOME: "behalten",
        LEER: undefined,
      },
      "sitzung-1",
    );
    expect(result).toEqual({
      CLAUDE_CONFIG_DIR: "behalten",
      MEIN_npm_WERT: "behalten",
      HOME: "behalten",
      KOMMANDOZENTRALE_SITZUNG: "sitzung-1",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });
  });

  it("overrides an inherited session id, TERM and COLORTERM", () => {
    const result = childEnvironment({ KOMMANDOZENTRALE_SITZUNG: "alt", TERM: "dumb", COLORTERM: "nein" }, "neu");
    expect(result).toEqual({ KOMMANDOZENTRALE_SITZUNG: "neu", TERM: "xterm-256color", COLORTERM: "truecolor" });
  });

  it("adds the extra variables of the bridge, such as the report port and secret file", () => {
    const extra = { KOMMANDOZENTRALE_MELDEPORT: "8788", KOMMANDOZENTRALE_GEHEIMNIS_DATEI: "/home/r/geheimnis" };
    expect(childEnvironment({ HOME: "h", KOMMANDOZENTRALE_MELDEPORT: "1" }, "s", extra)).toEqual({
      HOME: "h",
      KOMMANDOZENTRALE_MELDEPORT: "8788",
      KOMMANDOZENTRALE_GEHEIMNIS_DATEI: "/home/r/geheimnis",
      KOMMANDOZENTRALE_SITZUNG: "s",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });
  });

  it("does not let extra variables replace the session id, TERM or COLORTERM", () => {
    const extra = { KOMMANDOZENTRALE_SITZUNG: "fremd", TERM: "dumb", COLORTERM: "nein" };
    expect(childEnvironment({}, "s", extra)).toEqual({ KOMMANDOZENTRALE_SITZUNG: "s", TERM: "xterm-256color", COLORTERM: "truecolor" });
  });

  it("removes the node_modules/.bin folders of the bridge and its parents from the search path", () => {
    const searchPath = [BRIDGE_BIN, OTHER, PARENT_BIN, "", path.join(OTHER, "zwei")].join(path.delimiter);
    const result = childEnvironment({ [PATH_KEY]: searchPath }, "s");
    expect(result[PATH_KEY]).toBe([OTHER, "", path.join(OTHER, "zwei")].join(path.delimiter));
  });

  it("keeps a node_modules/.bin folder of another project", () => {
    const foreign = path.join(OTHER, "projekt", "node_modules", ".bin");
    expect(childEnvironment({ [PATH_KEY]: foreign }, "s")[PATH_KEY]).toBe(foreign);
  });

  it.runIf(onWindows)("compares names and folders without case on Windows", () => {
    const result = childEnvironment({ claudecode: "1", NPM_CONFIG_X: "1", PATH: BRIDGE_BIN.toUpperCase() }, "s");
    expect(result).toEqual({ PATH: "", KOMMANDOZENTRALE_SITZUNG: "s", TERM: "xterm-256color", COLORTERM: "truecolor" });
  });
});

describe("findCommand", () => {
  let folder: string;
  const name = "werkzeug";
  const fileName = onWindows ? `${name}.exe` : name;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), "bruecke-befehl-"));
    await mkdir(path.join(folder, "leer"));
    await writeFile(path.join(folder, fileName), "");
    await chmod(path.join(folder, fileName), 0o755);
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  function searchIn(...folders: string[]): Record<string, string> {
    return { [PATH_KEY]: folders.join(path.delimiter), PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  }

  it("finds a command on the search path", async () => {
    expect(await findCommand(name, searchIn(path.join(folder, "leer"), folder))).toBe(path.join(folder, fileName));
  });

  it("takes a command given with its path", async () => {
    expect(await findCommand(path.join(folder, fileName), searchIn())).toBe(path.join(folder, fileName));
  });

  it.each([
    ["a missing command", () => "gibt-es-nicht"],
    ["a missing path", () => path.join(folder, "gibt-es-nicht")],
    ["a folder", () => path.join(folder, "leer")],
  ])("finds nothing for %s", async (_case, command) => {
    expect(await findCommand(command(), searchIn(folder))).toBeNull();
  });

  it.skipIf(onWindows)("skips a file that may not be run", async () => {
    await chmod(path.join(folder, fileName), 0o644);
    expect(await findCommand(name, searchIn(folder))).toBeNull();
  });

  it.runIf(onWindows)("prefers the program over a file without extension and accepts a given extension", async () => {
    await writeFile(path.join(folder, name), "#!/bin/sh");
    expect(await findCommand(name, searchIn(folder))).toBe(path.join(folder, fileName));
    expect(await findCommand(fileName, searchIn(folder))).toBe(path.join(folder, fileName));
  });
});

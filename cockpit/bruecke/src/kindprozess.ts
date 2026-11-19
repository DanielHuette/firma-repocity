import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { hasErrorCode } from "./private_datei.ts";

export type Environment = Readonly<Record<string, string | undefined>>;

export const SESSION_VARIABLE = "KOMMANDOZENTRALE_SITZUNG";
export const TERMINAL_NAME = "xterm-256color";
const COLOR_DEPTH = "truecolor";
const REMOVED_NAMES = [
  "INIT_CWD",
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
const REMOVED_PREFIXES = ["npm_"];
const DEFAULT_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";
const ON_WINDOWS = process.platform === "win32";
const BRIDGE_FOLDER = path.resolve(import.meta.dirname, "..");

function comparable(text: string): string {
  return ON_WINDOWS ? text.toUpperCase() : text;
}

function isRemoved(name: string): boolean {
  const key = comparable(name);
  return (
    REMOVED_NAMES.some((removed) => comparable(removed) === key) ||
    REMOVED_PREFIXES.some((prefix) => key.startsWith(comparable(prefix)))
  );
}

function isSearchPathName(name: string): boolean {
  return comparable(name) === "PATH";
}

function npmBinFolders(): Set<string> {
  const folders = new Set<string>();
  for (let folder = BRIDGE_FOLDER; ; folder = path.dirname(folder)) {
    folders.add(comparable(path.join(folder, "node_modules", ".bin")));
    if (path.dirname(folder) === folder) return folders;
  }
}

const NPM_BIN_FOLDERS = npmBinFolders();

function withoutNpmBins(searchPath: string): string {
  return searchPath
    .split(path.delimiter)
    .filter((entry) => entry === "" || !NPM_BIN_FOLDERS.has(comparable(path.resolve(entry))))
    .join(path.delimiter);
}

export function childEnvironment(
  env: Environment,
  sessionId: string,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || isRemoved(name)) continue;
    result[name] = isSearchPathName(name) ? withoutNpmBins(value) : value;
  }
  return { ...result, ...extra, [SESSION_VARIABLE]: sessionId, TERM: TERMINAL_NAME, COLORTERM: COLOR_DEPTH };
}

function valueOf(env: Environment, matches: (name: string) => boolean): string {
  const name = Object.keys(env).find(matches);
  return (name === undefined ? undefined : env[name]) ?? "";
}

function extensionsFor(command: string, env: Environment): string[] {
  if (!ON_WINDOWS) return [""];
  const listed = (valueOf(env, (name) => comparable(name) === "PATHEXT") || DEFAULT_EXTENSIONS)
    .toLowerCase()
    .split(";")
    .filter((extension) => extension !== "");
  return listed.includes(path.extname(command).toLowerCase()) ? [""] : listed;
}

async function isRunnable(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, constants.X_OK);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "EACCES") || hasErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

function candidates(command: string, env: Environment): string[] {
  const extensions = extensionsFor(command, env);
  if (command.includes("/") || command.includes(path.sep)) {
    return extensions.map((extension) => path.resolve(command + extension));
  }
  const folders = valueOf(env, isSearchPathName)
    .split(path.delimiter)
    .filter((folder) => folder !== "");
  return folders.flatMap((folder) => extensions.map((extension) => path.join(folder, command + extension)));
}

export async function findCommand(command: string, env: Environment): Promise<string | null> {
  for (const candidate of candidates(command, env)) {
    if (await isRunnable(candidate)) return candidate;
  }
  return null;
}

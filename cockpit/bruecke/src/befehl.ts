import { execFile } from "node:child_process";
import path from "node:path";
import { findCommand } from "./kindprozess.ts";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MILLISECONDS_PER_SECOND = 1000;
const BATCH_EXTENSIONS = new Set([".cmd", ".bat"]);
const OUTPUT_TOO_LARGE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

export type CommandResult = { kind: "ok"; stdout: string } | { kind: "fehlt"; grund: string } | { kind: "fehler"; grund: string };

export interface RunOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
}

export type Runner = (commandLine: readonly string[], args: readonly string[], options: RunOptions) => Promise<CommandResult>;

function failure(error: Error & { code?: unknown; killed?: boolean }, timeoutMs: number): CommandResult {
  if (error.code === OUTPUT_TOO_LARGE) return { kind: "fehler", grund: `output larger than ${String(MAX_OUTPUT_BYTES / BYTES_PER_MEGABYTE)} MB` };
  if (error.killed === true) return { kind: "fehler", grund: `no answer within ${String(timeoutMs / MILLISECONDS_PER_SECOND)} s` };
  if (typeof error.code === "number") return { kind: "fehler", grund: `ended with code ${String(error.code)}` };
  return { kind: "fehler", grund: `could not run: ${typeof error.code === "string" ? error.code : error.name}` };
}

export async function batchFileOf(commandLine: readonly string[]): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  const executable = await findCommand(commandLine[0] ?? "", process.env);
  return executable !== null && BATCH_EXTENSIONS.has(path.extname(executable).toLowerCase()) ? executable : undefined;
}

export const runHidden: Runner = async (commandLine, args, options) => {
  const [command = "", ...fixed] = commandLine;
  const executable = await findCommand(command, process.env);
  if (executable === null) return { kind: "fehlt", grund: `${command} was not found` };
  if (await batchFileOf([executable])) {
    return {
      kind: "fehlt",
      grund: `${executable} is a Windows batch file and cannot run without a shell; name the program behind it instead, such as [node, <script>]`,
    };
  }
  return new Promise((resolve) => {
    execFile(
      executable,
      [...fixed, ...args],
      { cwd: options.cwd, timeout: options.timeoutMs, windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
      (error, stdout) => {
        resolve(error === null ? { kind: "ok", stdout } : failure(error, options.timeoutMs));
      },
    );
  });
};

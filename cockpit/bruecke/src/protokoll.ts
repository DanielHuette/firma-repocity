import { closeSync, fstatSync, openSync, renameSync, statSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";
import { hasErrorCode } from "./private_datei.ts";

export const LOG_FILE = "bruecke.log";
export const LOG_LIMIT_BYTES = 5 * 1024 * 1024;
export const REPEAT_WINDOW_MS = 10_000;
const PREVIOUS_SUFFIX = ".1";
const OWNER_ONLY_FOLDER = 0o700;
const OWNER_ONLY_FILE = 0o600;
const CONTROL_CHARACTER = /\p{Cc}/gu;
const HEX = 16;
const ESCAPE_DIGITS = 4;
const CONTINUATION = "    ";

export interface Log {
  info(message: string): void;
  error(message: string, error: unknown): void;
  close(): Promise<void>;
}

export interface LogLimits {
  readonly maxBytes?: number;
  readonly repeatWindowMs?: number;
}

function escaped(text: string): string {
  return text.replace(CONTROL_CHARACTER, (character) => `\\u${character.charCodeAt(0).toString(HEX).padStart(ESCAPE_DIGITS, "0")}`);
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : inspect(value, { breakLength: Infinity });
}

function errorLines(error: unknown): string[] {
  if (!(error instanceof Error)) return [describe(error)];
  const own = (error.stack ?? `${error.name}: ${error.message}`).split("\n").map((line) => line.trim());
  if (error.cause === undefined) return own;
  const [first = "", ...rest] = errorLines(error.cause);
  return [...own, `caused by: ${first}`, ...rest];
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return 0;
    throw error;
  }
}

export function keepOnePrevious(file: string, maxBytes: number = LOG_LIMIT_BYTES): void {
  if (sizeOf(file) > maxBytes) renameSync(file, file + PREVIOUS_SUFFIX);
}

class FileLog implements Log {
  readonly #file: string;
  readonly #now: () => Date;
  readonly #maxBytes: number;
  readonly #repeatWindowMs: number;
  #descriptor: number | null;
  #size: number;
  #last: { text: string; at: number } | null = null;
  #repeats = 0;
  #rotationFailed = false;

  constructor(file: string, now: () => Date, limits: LogLimits) {
    this.#file = file;
    this.#now = now;
    this.#maxBytes = limits.maxBytes ?? LOG_LIMIT_BYTES;
    this.#repeatWindowMs = limits.repeatWindowMs ?? REPEAT_WINDOW_MS;
    this.#descriptor = openSync(file, "a", OWNER_ONLY_FILE);
    this.#size = fstatSync(this.#descriptor).size;
  }

  info(message: string): void {
    this.#write("INFO", [message]);
  }

  error(message: string, error: unknown): void {
    const [first = "", ...rest] = errorLines(error);
    this.#write("ERROR", [`${message}: ${first}`, ...rest]);
  }

  close(): Promise<void> {
    this.#flushRepeats();
    if (this.#descriptor !== null) closeSync(this.#descriptor);
    this.#descriptor = null;
    return Promise.resolve();
  }

  #write(level: string, lines: readonly string[]): void {
    const [first = "", ...rest] = lines.map(escaped);
    const text = [`${level} ${first}`, ...rest.map((line) => CONTINUATION + line)].join("\n");
    const at = this.#now().getTime();
    if (this.#last?.text === text && at - this.#last.at < this.#repeatWindowMs) {
      this.#repeats += 1;
      this.#last.at = at;
      return;
    }
    this.#flushRepeats();
    this.#append(text);
    this.#last = { text, at };
  }

  #flushRepeats(): void {
    if (this.#repeats === 0) return;
    const count = this.#repeats;
    this.#repeats = 0;
    this.#append(`INFO the previous message came ${String(count)} more times`);
  }

  #append(text: string): void {
    const line = `${this.#now().toISOString()} ${text}\n`;
    if (this.#descriptor === null) {
      process.stderr.write(`the log ${this.#file} is closed: ${line}`);
      return;
    }
    const full = this.#size > 0 && this.#size + Buffer.byteLength(line) > this.#maxBytes;
    try {
      const descriptor = full ? this.#rotate(this.#descriptor) : this.#descriptor;
      this.#size += writeSync(descriptor, line);
    } catch (error: unknown) {
      process.stderr.write(`the log ${this.#file} cannot be written (${describe(error)}): ${line}`);
    }
  }

  #rotate(descriptor: number): number {
    closeSync(descriptor);
    this.#descriptor = null;
    let problem: string | null = null;
    try {
      renameSync(this.#file, this.#file + PREVIOUS_SUFFIX);
    } catch (error: unknown) {
      problem = describe(error instanceof Error ? error.message : error);
    }
    const reopened = openSync(this.#file, "a", OWNER_ONLY_FILE);
    this.#descriptor = reopened;
    this.#size = problem === null ? 0 : fstatSync(reopened).size;
    if (problem !== null && !this.#rotationFailed) {
      const note = `${this.#now().toISOString()} INFO the log cannot be moved to ${PREVIOUS_SUFFIX} (${escaped(problem)}); it keeps growing until that works\n`;
      this.#size += writeSync(reopened, note);
    }
    this.#rotationFailed = problem !== null;
    return reopened;
  }
}

export async function openLog(dataFolder: string, now: () => Date = () => new Date(), limits: LogLimits = {}): Promise<Log> {
  await mkdir(dataFolder, { recursive: true, mode: OWNER_ONLY_FOLDER });
  return new FileLog(path.join(dataFolder, LOG_FILE), now, limits);
}

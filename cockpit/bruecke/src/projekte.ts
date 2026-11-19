import { open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Phase, Projekt, ProjektStatus } from "./nachrichten.ts";
import { isInside } from "./pfade.ts";
import { hasErrorCode, writePrivateFile } from "./private_datei.ts";

export const PROJECTS_FILE = "projekte.json";
export const STATUS_FILE = "PROJEKT-STATUS.md";
export const MOST_PROJECTS = 4;
export const MOST_REMEMBERED = 50;
export const LARGEST_STATUS_BYTES = 64 * 1024;
export const LONGEST_DECISION = 400;
const MISSING_CODES = ["ENOENT", "ENOTDIR", "EISDIR"];
const DECISIONS_HEADING = /^##\s+Entscheidungen\s*$/;
const ANY_HEADING = /^#{1,6}\s/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const TABLE_RULE = /^\|?\s*:?-{2,}/;

export interface ProjekteOrte {
  readonly datenordner: string;
  readonly erlaubteOrdner: readonly string[];
}

interface Gemerkt {
  readonly ordner: string;
  readonly zuletzt: number;
}

function isMissing(error: unknown): boolean {
  return MISSING_CODES.some((code) => hasErrorCode(error, code));
}

function isRemembered(value: unknown): value is Gemerkt {
  if (typeof value !== "object" || value === null) return false;
  const { ordner, zuletzt } = value as Record<string, unknown>;
  return typeof ordner === "string" && path.isAbsolute(ordner) && typeof zuletzt === "number" && Number.isSafeInteger(zuletzt) && zuletzt >= 0;
}

export class ProjectsFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectsFileError";
  }
}

async function readRemembered(file: string): Promise<Gemerkt[]> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new ProjectsFileError(`${file} is not valid JSON; delete it to start a new list`, { cause: error });
  }
  const list = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).liste : undefined;
  if (!Array.isArray(list) || !list.every(isRemembered)) throw new ProjectsFileError(`${file} must hold {"liste": [{ordner, zuletzt}]}; delete it to start a new list`);
  return list;
}

function cell(text: string): string[] {
  return text.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((part) => part.trim());
}

export function phasesOf(lines: readonly string[]): Phase[] {
  const start = lines.findIndex((line) => {
    const head = cell(line).map((part) => part.toLowerCase());
    return line.trim().startsWith("|") && head[0] === "phase" && head[1] === "status" && head[2] === "datum";
  });
  if (start === -1 || !TABLE_RULE.test(lines[start + 1] ?? "")) return [];
  const rows: Phase[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith("|")) break;
    const [phase = "", status = "", datum = ""] = cell(line);
    if (phase !== "") rows.push({ phase, status, datum });
  }
  return rows;
}

function shortened(text: string): string {
  return text.length <= LONGEST_DECISION ? text : `${text.slice(0, LONGEST_DECISION - 1)}…`;
}

export function lastDecisionOf(lines: readonly string[]): string | null {
  const start = lines.findIndex((line) => DECISIONS_HEADING.test(line));
  if (start === -1) return null;
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => ANY_HEADING.test(line));
  const bullets = (end === -1 ? section : section.slice(0, end)).flatMap((line) => {
    const found = BULLET.exec(line)?.[1]?.trim();
    return found === undefined || found === "" ? [] : [found];
  });
  const last = bullets.at(-1);
  return last === undefined ? null : shortened(last);
}

export function readStatus(text: string): ProjektStatus | null {
  const lines = text.split(/\r?\n/);
  const phasen = phasesOf(lines);
  const letzteEntscheidung = lastDecisionOf(lines);
  return phasen.length === 0 && letzteEntscheidung === null ? null : { phasen, letzteEntscheidung };
}

async function realOrNull(entry: string): Promise<string | null> {
  try {
    return await realpath(entry);
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function limitedText(file: string): Promise<string | null> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(LARGEST_STATUS_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead > LARGEST_STATUS_BYTES ? null : buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export class Projekte {
  readonly #file: string;
  readonly #allowed: readonly string[];
  #writing: Promise<void> = Promise.resolve();

  constructor(orte: ProjekteOrte) {
    this.#file = path.join(orte.datenordner, PROJECTS_FILE);
    this.#allowed = orte.erlaubteOrdner;
  }

  remember(ordner: string, zuletzt: number): Promise<void> {
    const write = this.#writing.then(async () => {
      const known = (await readRemembered(this.#file)).filter((entry) => entry.ordner !== ordner);
      const liste = [{ ordner, zuletzt }, ...known].slice(0, MOST_REMEMBERED);
      await writePrivateFile(this.#file, JSON.stringify({ liste }));
    });
    this.#writing = write.catch(() => undefined);
    return write;
  }

  async list(): Promise<Projekt[]> {
    await this.#writing;
    const newest = (await readRemembered(this.#file)).toSorted((a, b) => b.zuletzt - a.zuletzt).slice(0, MOST_PROJECTS);
    return Promise.all(newest.map(async ({ ordner, zuletzt }) => ({ ordner, name: path.basename(ordner), zuletzt, status: await this.#status(ordner) })));
  }

  async #status(ordner: string): Promise<ProjektStatus | null> {
    const file = await realOrNull(path.join(ordner, STATUS_FILE));
    if (file === null || !(await this.#isAllowed(file))) return null;
    let text: string | null;
    try {
      text = await limitedText(file);
    } catch (error: unknown) {
      if (isMissing(error)) return null;
      throw error;
    }
    return text === null ? null : readStatus(text);
  }

  async #isAllowed(file: string): Promise<boolean> {
    const allowed = await Promise.all(this.#allowed.map(realOrNull));
    return allowed.some((folder) => folder !== null && isInside(folder, file));
  }
}

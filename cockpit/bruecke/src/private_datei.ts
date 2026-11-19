import { randomBytes } from "node:crypto";
import { link, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const OWNER_ONLY_FOLDER = 0o700;
const OWNER_ONLY_FILE = 0o600;
const GROUP_AND_OTHERS = 0o077;
const TEMPORARY_NAME_BYTES = 8;
export const RENAME_ATTEMPTS = 25;
const FIRST_RENAME_WAIT_MS = 5;
const LONGEST_RENAME_WAIT_MS = 100;
const FILE_IN_USE_CODES = ["EPERM", "EACCES", "EBUSY"];

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function writeTemporary(file: string, content: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true, mode: OWNER_ONLY_FOLDER });
  const temporary = `${file}.${randomBytes(TEMPORARY_NAME_BYTES).toString("hex")}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: OWNER_ONLY_FILE });
  return temporary;
}

function isFileInUse(error: unknown): boolean {
  return FILE_IN_USE_CODES.some((code) => hasErrorCode(error, code));
}

async function replaceWith(temporary: string, file: string, attempts: number): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, file);
      return;
    } catch (error: unknown) {
      if (attempt >= attempts || !isFileInUse(error)) throw error;
      await wait(Math.min(FIRST_RENAME_WAIT_MS * 2 ** (attempt - 1), LONGEST_RENAME_WAIT_MS));
    }
  }
}

export async function writePrivateFile(
  file: string,
  content: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const temporary = await writeTemporary(file, content);
  try {
    await replaceWith(temporary, file, platform === "win32" ? RENAME_ATTEMPTS : 1);
  } catch (error: unknown) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function createPrivateFile(file: string, content: string): Promise<boolean> {
  const temporary = await writeTemporary(file, content);
  try {
    await link(temporary, file);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, "EEXIST")) return false;
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

function openFolderProblem(folder: string, mode: number): string | undefined {
  if ((mode & GROUP_AND_OTHERS) === 0) return undefined;
  return `${folder} is open to group or others; restrict it with: chmod 700 "${folder}"`;
}

export async function privacyProblem(file: string): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;
  if (((await stat(file)).mode & GROUP_AND_OTHERS) !== 0) {
    return `${file} is open to group or others; restrict it with: chmod 600 "${file}"`;
  }
  const folder = path.dirname(file);
  return openFolderProblem(folder, (await stat(folder)).mode);
}

export async function privateFolderProblem(folder: string): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;
  try {
    return openFolderProblem(folder, (await stat(folder)).mode);
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

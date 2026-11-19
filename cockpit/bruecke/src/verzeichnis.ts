import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { hasErrorCode } from "./private_datei.ts";

const FOLDER_DEPTH = 2;
const MOST_FOLDERS = 500;
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);
const MISSING_CODES = ["ENOENT", "ENOTDIR", "EISDIR"];

export interface Ordner {
  readonly pfad: string;
  readonly name: string;
}

function isMissing(error: unknown): boolean {
  return MISSING_CODES.some((code) => hasErrorCode(error, code));
}

function unreadable(subject: string, error: unknown, problems: string[]): void {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown error";
  problems.push(`${subject} cannot be read (${code})`);
}

async function entriesOf(folder: string, problems: string[]): Promise<Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error: unknown) {
    if (!isMissing(error)) unreadable(folder, error, problems);
    return [];
  }
}

async function isFolder(entry: string, problems: string[]): Promise<boolean> {
  try {
    return (await stat(entry)).isDirectory();
  } catch (error: unknown) {
    if (!isMissing(error)) unreadable(entry, error, problems);
    return false;
  }
}

async function foldersBelow(folder: string, depth: number): Promise<Ordner[]> {
  if (depth >= FOLDER_DEPTH) return [];
  const children = (await entriesOf(folder, [])).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_FOLDERS.has(entry.name),
  );
  const nested = await Promise.all(
    children.map(async (entry) => {
      const child = path.join(folder, entry.name);
      return [{ pfad: child, name: entry.name }, ...(await foldersBelow(child, depth + 1))];
    }),
  );
  return nested.flat();
}

export async function listFolders(allowed: readonly string[]): Promise<Ordner[]> {
  const found = await Promise.all(
    allowed.map(async (folder) => ((await isFolder(folder, [])) ? [{ pfad: folder, name: path.basename(folder) }, ...(await foldersBelow(folder, 0))] : [])),
  );
  return found
    .flat()
    .sort((a, b) => a.pfad.localeCompare(b.pfad, "de"))
    .slice(0, MOST_FOLDERS);
}

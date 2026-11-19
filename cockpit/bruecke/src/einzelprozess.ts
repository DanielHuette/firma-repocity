import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createPrivateFile, hasErrorCode } from "./private_datei.ts";

export const LOCK_FILE = "bruecke.sperre";
const PROCESS_ID_FORMAT = /^[1-9]\d{0,9}$/;

export class AlreadyRunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyRunningError";
  }
}

function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, "ESRCH")) return false;
    if (hasErrorCode(error, "EPERM")) return true;
    throw error;
  }
}

async function holder(file: string): Promise<number | null> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  const text = content.trim();
  return PROCESS_ID_FORMAT.test(text) ? Number(text) : null;
}

function alreadyRunning(file: string, processId: number): AlreadyRunningError {
  return new AlreadyRunningError(
    `a bridge is already running as process ${String(processId)}; if that is wrong, delete ${file} and start again`,
  );
}

export async function claimSingleProcess(dataFolder: string, processId: number = process.pid): Promise<() => Promise<void>> {
  const file = path.join(dataFolder, LOCK_FILE);
  const release = async (): Promise<void> => {
    if ((await holder(file)) === processId) await rm(file, { force: true });
  };
  if (await createPrivateFile(file, String(processId))) return release;
  const other = await holder(file);
  if (other !== null && isRunning(other)) throw alreadyRunning(file, other);
  await rm(file, { force: true });
  if (await createPrivateFile(file, String(processId))) return release;
  throw new AlreadyRunningError(`another bridge took ${file} at the same moment; it is already running`);
}

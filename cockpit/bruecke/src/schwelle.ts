import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasErrorCode, writePrivateFile } from "./private_datei.ts";

export const THRESHOLD_FILE = "einstellungen.json";
export const LOWEST_THRESHOLD = 10_000;
export const HIGHEST_THRESHOLD = 1_000_000;

export class ThresholdError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThresholdError";
  }
}

export function isThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= LOWEST_THRESHOLD && value <= HIGHEST_THRESHOLD;
}

export async function readStoredThreshold(dataFolder: string): Promise<number | undefined> {
  const file = path.join(dataFolder, THRESHOLD_FILE);
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const damaged = `${file} must hold {"schwelleVerdichten": <whole number from 10000 to 1000000>}; delete it to use the value of bruecke.json`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new ThresholdError(damaged, { cause: error });
  }
  const value = typeof parsed === "object" && parsed !== null && "schwelleVerdichten" in parsed ? parsed.schwelleVerdichten : undefined;
  if (!isThreshold(value)) throw new ThresholdError(damaged);
  return value;
}

export async function storeThreshold(dataFolder: string, value: number): Promise<void> {
  await writePrivateFile(path.join(dataFolder, THRESHOLD_FILE), JSON.stringify({ schwelleVerdichten: value }));
}

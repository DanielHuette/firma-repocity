import { readFile } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { loadSettings, settingsFilePath } from "./einstellungen.ts";
import { LOCK_FILE } from "./einzelprozess.ts";
import { SECRET_HEADER } from "./meldungen.ts";
import { hasErrorCode } from "./private_datei.ts";
import { STOP_PATH } from "./stopp.ts";

const LOOPBACK = "127.0.0.1";
const REQUEST_TIMEOUT_MS = 2_000;
const STOP_TIMEOUT_MS = 30_000;
const POLL_MS = 100;
const ACCEPTED = 202;

export class StopError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StopError";
  }
}

export type StopResult = "gestoppt" | "lief_nicht";

export interface StopOptions {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

async function readSecret(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function postStop(port: number, secret: string): Promise<number | "frei"> {
  return new Promise((resolve, reject) => {
    const headers = { host: `${LOOPBACK}:${String(port)}`, [SECRET_HEADER]: secret, "content-length": 0 };
    const options = { host: LOOPBACK, port, path: STOP_PATH, method: "POST", headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
    const outgoing = request(options, (incoming) => {
      incoming.resume();
      resolve(incoming.statusCode ?? 0);
    });
    outgoing.on("error", (error: Error) => {
      if (hasErrorCode(error, "ECONNREFUSED")) resolve("frei");
      else reject(new StopError(`the bridge did not answer the stop request on port ${String(port)}`, { cause: error }));
    });
    outgoing.end();
  });
}

async function lockReleased(file: string): Promise<boolean> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await readSecret(file)) === undefined) return true;
    await wait(POLL_MS);
  }
  return false;
}

export async function stopBridge(options: StopOptions): Promise<StopResult> {
  const settings = await loadSettings(settingsFilePath(options.argv, options.env));
  const secret = await readSecret(settings.geheimnis);
  if (secret === undefined) return "lief_nicht";
  const status = await postStop(settings.portMeldeeingang, secret);
  if (status === "frei") return "lief_nicht";
  if (status !== ACCEPTED) throw new StopError(`the bridge refused the stop request with ${String(status)}`);
  const lockFile = path.join(settings.datenordner, LOCK_FILE);
  if (!(await lockReleased(lockFile))) {
    throw new StopError(`the bridge accepted the stop request but still holds ${lockFile} after ${String(STOP_TIMEOUT_MS / 1000)} s`);
  }
  return "gestoppt";
}

if (import.meta.main) {
  try {
    const result = await stopBridge({ argv: process.argv, env: process.env });
    process.stdout.write(result === "gestoppt" ? "The bridge has stopped.\n" : "No bridge is running.\n");
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

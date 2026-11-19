import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isInside } from "./pfade.ts";
import { HIGHEST_THRESHOLD, isThreshold, LOWEST_THRESHOLD } from "./schwelle.ts";
import { createPrivateFile, hasErrorCode, privacyProblem } from "./private_datei.ts";

const FIELDS = [
  "portOberflaeche",
  "portMeldeeingang",
  "vault",
  "erlaubteOrdner",
  "claudeBefehl",
  "datenordner",
  "geheimnis",
  "assistenzGeheimnis",
  "erlaubteHerkunft",
  "schwelleVerdichten",
  "claudeMem",
  "oberflaeche",
  "qmdBefehl",
  "openrouterSchluessel",
] as const;

type Field = (typeof FIELDS)[number];
type RawSettings = Readonly<Record<string, unknown>>;

export interface Settings {
  portOberflaeche: number;
  portMeldeeingang: number;
  vault: string;
  erlaubteOrdner: readonly string[];
  claudeBefehl: readonly string[];
  datenordner: string;
  geheimnis: string;
  assistenzGeheimnis: string;
  erlaubteHerkunft: string;
  schwelleVerdichten: number;
  claudeMem: string;
  oberflaeche: string;
  qmdBefehl: readonly string[];
  openrouterSchluessel: string | null;
}

const SETTINGS_ARGUMENT = "--einstellungen";
const SETTINGS_VARIABLE = "BRUECKE_EINSTELLUNGEN";
const DEFAULT_COMPACT_THRESHOLD_TOKENS = 200_000;
const DEFAULT_CLAUDE_MEM = "http://127.0.0.1:37777";
const LOWEST_PORT = 1;
const HIGHEST_PORT = 65_535;
const SECRET_BYTES = 32;
const SECRET_FORMAT = /^[0-9a-f]{64}$/;
const SETTINGS_FILE = "bruecke.json";
const EXAMPLE_FILE = "bruecke.beispiel.json";
const PROGRAM_FOLDER = path.resolve(import.meta.dirname, "..");
const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const DEFAULT_QMD_COMMAND = ["qmd"];
const DEFAULT_INTERFACE_FOLDER = path.resolve(PROGRAM_FOLDER, "..", "app", "dist");

export class SettingsError extends Error {
  readonly field: Field | null;

  constructor(message: string, field: Field | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "SettingsError";
    this.field = field;
  }
}

function invalid(field: Field, expected: string): SettingsError {
  return new SettingsError(`bruecke.json: "${field}" must be ${expected}`, field);
}

function inConfigFolder(name: string): string {
  return path.join(homedir(), ".config", "repocity_bruecke", name);
}

export function defaultSecretPath(): string {
  return inConfigFolder("geheimnis");
}

export function defaultAssistantSecretPath(): string {
  return inConfigFolder("assistenz_geheimnis");
}

export function defaultSettingsPath(): string {
  return path.join(PROGRAM_FOLDER, SETTINGS_FILE);
}

export function settingsFilePath(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string {
  const index = argv.indexOf(SETTINGS_ARGUMENT);
  if (index !== -1) {
    const value = argv[index + 1];
    if (value === undefined || value === "") {
      throw new SettingsError(
        `${SETTINGS_ARGUMENT} needs the path of ${SETTINGS_FILE}, for example: npm start -- ${SETTINGS_ARGUMENT} "${defaultSettingsPath()}"`,
      );
    }
    return path.resolve(value);
  }
  const fromEnvironment = env[SETTINGS_VARIABLE];
  if (fromEnvironment === undefined) return defaultSettingsPath();
  if (fromEnvironment === "") {
    throw new SettingsError(`${SETTINGS_VARIABLE} is empty; remove it to use ${defaultSettingsPath()}`);
  }
  return path.resolve(fromEnvironment);
}

function required(raw: RawSettings, field: Field): unknown {
  const value = raw[field];
  if (value === undefined) throw new SettingsError(`bruecke.json: "${field}" is missing`, field);
  return value;
}

function withDefault(raw: RawSettings, field: Field, fallback: unknown): unknown {
  return raw[field] === undefined ? fallback : raw[field];
}

function port(field: Field, value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= LOWEST_PORT && value <= HIGHEST_PORT) return value;
  throw invalid(field, `an integer from ${String(LOWEST_PORT)} to ${String(HIGHEST_PORT)}`);
}

function absolutePath(field: Field, value: unknown): string {
  if (typeof value === "string" && path.isAbsolute(value)) return path.resolve(value);
  throw invalid(field, "an absolute path");
}

function absolutePaths(field: Field, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid(field, "a non-empty list of absolute paths");
  return value.map((entry: unknown) => absolutePath(field, entry));
}

function commandLine(field: Field, value: unknown): string[] {
  if (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === "string" && part !== "")) {
    return value as string[];
  }
  throw invalid(field, "a non-empty list of non-empty strings: the command and its arguments");
}

function webAddress(field: Field, value: unknown): string {
  if (typeof value === "string" && URL.canParse(value) && WEB_PROTOCOLS.has(new URL(value).protocol)) return value;
  throw invalid(field, "an http or https address");
}

function origin(field: Field, value: unknown): string {
  if (typeof value === "string" && URL.canParse(value)) {
    const url = new URL(value);
    if (WEB_PROTOCOLS.has(url.protocol) && url.origin === value) return value;
  }
  throw invalid(field, "an origin such as http://127.0.0.1:8787, without path or trailing slash");
}

function threshold(field: Field, value: unknown): number {
  if (isThreshold(value)) return value;
  throw invalid(field, `a whole number from ${String(LOWEST_THRESHOLD)} to ${String(HIGHEST_THRESHOLD)}`);
}

function objectOf(input: unknown): RawSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SettingsError("bruecke.json must contain one JSON object");
  }
  const known: readonly string[] = FIELDS;
  const unknown = Object.keys(input).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw new SettingsError(`bruecke.json: unknown field "${unknown.join('", "')}"; remove it or correct its name`);
  return input as RawSettings;
}

export function parseSettings(input: unknown): Settings {
  const raw = objectOf(input);
  const settings: Settings = {
    portOberflaeche: port("portOberflaeche", required(raw, "portOberflaeche")),
    portMeldeeingang: port("portMeldeeingang", required(raw, "portMeldeeingang")),
    vault: absolutePath("vault", required(raw, "vault")),
    erlaubteOrdner: absolutePaths("erlaubteOrdner", required(raw, "erlaubteOrdner")),
    claudeBefehl: commandLine("claudeBefehl", required(raw, "claudeBefehl")),
    datenordner: absolutePath("datenordner", required(raw, "datenordner")),
    geheimnis: absolutePath("geheimnis", withDefault(raw, "geheimnis", defaultSecretPath())),
    assistenzGeheimnis: absolutePath("assistenzGeheimnis", withDefault(raw, "assistenzGeheimnis", defaultAssistantSecretPath())),
    erlaubteHerkunft: origin("erlaubteHerkunft", required(raw, "erlaubteHerkunft")),
    schwelleVerdichten: threshold("schwelleVerdichten", withDefault(raw, "schwelleVerdichten", DEFAULT_COMPACT_THRESHOLD_TOKENS)),
    claudeMem: webAddress("claudeMem", withDefault(raw, "claudeMem", DEFAULT_CLAUDE_MEM)),
    oberflaeche: absolutePath("oberflaeche", withDefault(raw, "oberflaeche", DEFAULT_INTERFACE_FOLDER)),
    qmdBefehl: commandLine("qmdBefehl", withDefault(raw, "qmdBefehl", DEFAULT_QMD_COMMAND)),
    openrouterSchluessel: raw.openrouterSchluessel === undefined ? null : absolutePath("openrouterSchluessel", raw.openrouterSchluessel),
  };
  if (settings.portMeldeeingang === settings.portOberflaeche) {
    throw invalid("portMeldeeingang", "a different port than portOberflaeche");
  }
  for (const field of ["geheimnis", "assistenzGeheimnis", "datenordner"] as const) {
    if (isInside(settings.vault, settings[field])) throw invalid(field, "a path outside the vault");
  }
  return settings;
}

export async function loadSettings(file: string): Promise<Settings> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    throw new SettingsError(
      `settings file ${file} cannot be read; create it as a copy of ${path.join(PROGRAM_FOLDER, EXAMPLE_FILE)} with your paths`,
      null,
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new SettingsError(`settings file ${file} is not valid JSON`, null, { cause: error });
  }
  return parseSettings(parsed);
}

async function readSecret(file: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw new SettingsError(`secret ${file} cannot be read`, "geheimnis", { cause: error });
  }
  const secret = content.trim();
  if (!SECRET_FORMAT.test(secret)) {
    throw new SettingsError(
      `secret ${file} must hold 64 hexadecimal characters; delete it and the bridge creates a new one`,
      "geheimnis",
    );
  }
  return secret;
}

async function createSecret(file: string): Promise<string> {
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  let created: boolean;
  try {
    created = await createPrivateFile(file, secret);
  } catch (error: unknown) {
    throw new SettingsError(`secret ${file} cannot be created`, "geheimnis", { cause: error });
  }
  if (created) return secret;
  const existing = await readSecret(file);
  if (existing === undefined) throw new SettingsError(`secret ${file} disappeared while it was created`, "geheimnis");
  return existing;
}

export async function readOrCreateSecret(file: string): Promise<string> {
  const secret = (await readSecret(file)) ?? (await createSecret(file));
  const problem = await privacyProblem(file);
  if (problem !== undefined) throw new SettingsError(problem, "geheimnis");
  return secret;
}

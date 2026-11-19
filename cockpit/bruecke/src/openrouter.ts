import { readFile } from "node:fs/promises";
import path from "node:path";
import { isModelName } from "./nachrichten.ts";
import type { Anbieter, OpenRouterModell } from "./nachrichten.ts";
import { hasErrorCode, privacyProblem, writePrivateFile } from "./private_datei.ts";
import { isFields } from "./felder.ts";

export const OPENROUTER_MODELS_ADDRESS = "https://openrouter.ai/api/v1/models?supported_parameters=tools";
export const OPENROUTER_BASE = "https://openrouter.ai/api";
export const MODELS_CACHE_FILE = "openrouter_modelle.json";
export const REFRESH_MS = 24 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 15_000;
export const LARGEST_ANSWER_BYTES = 8 * 1024 * 1024;
export const NOT_SET_UP = "OpenRouter ist nicht eingerichtet";
export const FAILURE_PAUSE_MS = 10 * 60 * 1000;
export const REDACTED = "[geschwärzt]";
const KEY_FORMAT = /^[A-Za-z0-9_-]{16,256}$/;
export const KEY_VARIABLE = "OPENROUTER_API_KEY";
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
const QUOTED = /^(["'])(.*)\1$/;
const PRICE_FORMAT = /^\d{1,6}(?:\.\d{1,20})?$/;
const LONGEST_NAME = 200;
const TOKENS_PER_MILLION = 1_000_000;
const PRICE_DIGITS = 6;
const PROVIDER_VARIABLES = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;

export class OpenRouterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OpenRouterError";
  }
}

export interface ModellListe {
  readonly openrouter: readonly OpenRouterModell[] | null;
  readonly openrouterGrund: string | null;
}

export interface OpenRouterOptions {
  readonly schluesselDatei: string | null;
  readonly datenordner: string;
  readonly adresse?: string;
  readonly jetzt?: () => number;
}

export function keyIn(content: string): string | null {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  const assignments = lines.map((line) => ENV_LINE.exec(line)).filter((match) => match !== null);
  if (assignments.length === 0) return content.trim();
  const value = assignments.findLast((match) => match[1] === KEY_VARIABLE)?.[2];
  if (value === undefined) return null;
  return QUOTED.exec(value)?.[2] ?? value;
}

export async function readOpenRouterKey(file: string | null): Promise<string> {
  if (file === null) throw new OpenRouterError(NOT_SET_UP);
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) throw new OpenRouterError(`${NOT_SET_UP}: die Schlüsseldatei ${file} fehlt`, { cause: error });
    throw new OpenRouterError(`${NOT_SET_UP}: die Schlüsseldatei ${file} ist nicht lesbar`, { cause: error });
  }
  const key = keyIn(content);
  if (key === null) throw new OpenRouterError(`${NOT_SET_UP}: in ${file} fehlt die Zeile ${KEY_VARIABLE}=<Schlüssel>`);
  if (!KEY_FORMAT.test(key)) throw new OpenRouterError(`${NOT_SET_UP}: die Schlüsseldatei ${file} enthält keinen gültigen Schlüssel`);
  const problem = await privacyProblem(file);
  if (problem !== undefined) throw new OpenRouterError(problem);
  return key;
}

function sameName(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toUpperCase() === b.toUpperCase() : a === b;
}

export function withProvider(environment: Readonly<Record<string, string>>, anbieter: Anbieter, key: string | null): Record<string, string> {
  const result = Object.fromEntries(Object.entries(environment).filter(([name]) => !PROVIDER_VARIABLES.some((removed) => sameName(removed, name))));
  if (anbieter === "abo") return result;
  if (key === null) throw new OpenRouterError(NOT_SET_UP);
  return { ...result, ANTHROPIC_BASE_URL: OPENROUTER_BASE, ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: "" };
}

export function redact(text: string, key: string | null): string {
  return key === null || key === "" ? text : text.replaceAll(key, REDACTED);
}

function pricePerMillion(value: unknown): number | null {
  if (typeof value !== "string" || !PRICE_FORMAT.test(value)) return null;
  return Number((Number(value) * TOKENS_PER_MILLION).toFixed(PRICE_DIGITS));
}

function modelOf(entry: unknown): OpenRouterModell[] {
  if (!isFields(entry) || !isModelName(entry.id) || typeof entry.name !== "string" || entry.name === "" || entry.name.length > LONGEST_NAME) return [];
  const pricing = isFields(entry.pricing) ? entry.pricing : {};
  const preisEinProMio = pricePerMillion(pricing.prompt);
  const preisAusProMio = pricePerMillion(pricing.completion);
  if (preisEinProMio === null || preisAusProMio === null) return [];
  const length = entry.context_length;
  const kontextFenster = typeof length === "number" && Number.isSafeInteger(length) && length > 0 ? length : null;
  return [{ id: entry.id, name: entry.name, preisEinProMio, preisAusProMio, kontextFenster }];
}

export function modelsOf(body: unknown): OpenRouterModell[] {
  const data: unknown[] = isFields(body) && Array.isArray(body.data) ? body.data : [];
  const unique = new Map(data.flatMap(modelOf).toReversed().map((model) => [model.id, model]));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function limitedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new OpenRouterError("OpenRouter sent no answer");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) throw new OpenRouterError("OpenRouter sent a body that is not bytes");
    size += chunk.length;
    if (size > LARGEST_ANSWER_BYTES) {
      await reader.cancel();
      throw new OpenRouterError(`the answer of OpenRouter is larger than ${String(LARGEST_ANSWER_BYTES)} bytes`);
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function reasonOf(error: unknown): string {
  if (error instanceof OpenRouterError || error instanceof SyntaxError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return `keine Antwort binnen ${String(FETCH_TIMEOUT_MS / 1000)} s`;
  return error instanceof Error ? error.name : "unbekannter Fehler";
}

function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCachedModel(entry: unknown): entry is OpenRouterModell {
  if (!isFields(entry) || !isModelName(entry.id) || typeof entry.name !== "string" || !isPrice(entry.preisEinProMio) || !isPrice(entry.preisAusProMio)) return false;
  const { kontextFenster } = entry;
  return kontextFenster === null || (typeof kontextFenster === "number" && Number.isSafeInteger(kontextFenster) && kontextFenster > 0);
}

interface Zwischenspeicher {
  readonly abgerufen: number;
  readonly liste: readonly OpenRouterModell[];
}

export class OpenRouterModelle {
  readonly #options: OpenRouterOptions;
  readonly #file: string;
  #loading: Promise<ModellListe> | null = null;
  #letzte: Zwischenspeicher | null = null;
  #failure: { readonly at: number; readonly grund: string } | null = null;

  constructor(options: OpenRouterOptions) {
    this.#options = options;
    this.#file = path.join(options.datenordner, MODELS_CACHE_FILE);
  }

  list(): Promise<ModellListe> {
    if (this.#options.schluesselDatei === null) return Promise.resolve({ openrouter: null, openrouterGrund: NOT_SET_UP });
    this.#loading ??= this.#load().finally(() => {
      this.#loading = null;
    });
    return this.#loading;
  }

  async #load(): Promise<ModellListe> {
    const now = (this.#options.jetzt ?? Date.now)();
    const cached = (await this.#cached()) ?? this.#letzte;
    if (cached !== null && now - cached.abgerufen < REFRESH_MS && now >= cached.abgerufen) return { openrouter: cached.liste, openrouterGrund: null };
    if (this.#failure !== null && now - this.#failure.at < FAILURE_PAUSE_MS && now >= this.#failure.at) return { openrouter: cached?.liste ?? null, openrouterGrund: this.#failure.grund };
    let liste: OpenRouterModell[];
    try {
      liste = await this.#fetch();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      const grund = `Abruf der OpenRouter-Modelle gescheitert: ${reasonOf(error)}${cached === null ? "" : "; es gilt die letzte Liste"}`;
      this.#failure = { at: now, grund };
      return { openrouter: cached?.liste ?? null, openrouterGrund: grund };
    }
    this.#failure = null;
    this.#letzte = { abgerufen: now, liste };
    try {
      await writePrivateFile(this.#file, JSON.stringify(this.#letzte));
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return { openrouter: liste, openrouterGrund: `Liste geholt, aber nicht zwischengespeichert: ${reasonOf(error)}` };
    }
    return { openrouter: liste, openrouterGrund: null };
  }

  async #fetch(): Promise<OpenRouterModell[]> {
    const response = await fetch(this.#options.adresse ?? OPENROUTER_MODELS_ADDRESS, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
    if (!response.ok) throw new OpenRouterError(`OpenRouter antwortet mit ${String(response.status)}`);
    const liste = modelsOf(await limitedJson(response));
    if (liste.length === 0) throw new OpenRouterError("OpenRouter nannte kein Modell mit Werkzeugen");
    return liste;
  }

  async #cached(): Promise<Zwischenspeicher | null> {
    let content: string;
    try {
      content = await readFile(this.#file, "utf8");
    } catch (error: unknown) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(content);
      if (!isFields(parsed) || typeof parsed.abgerufen !== "number") return null;
      const liste: unknown = parsed.liste;
      return Array.isArray(liste) && liste.every(isCachedModel) ? { abgerufen: parsed.abgerufen, liste } : null;
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
}

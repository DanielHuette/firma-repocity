import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { batchFileOf } from "./befehl.ts";
import type { Runner } from "./befehl.ts";
import { isInside } from "./pfade.ts";
import { hasErrorCode } from "./private_datei.ts";
import { isFields } from "./felder.ts";
import { listFolders } from "./verzeichnis.ts";
import type { Ordner } from "./verzeichnis.ts";

export type { Ordner } from "./verzeichnis.ts";

const QMD_TIMEOUT_MS = 20_000;
const MEMORY_TIMEOUT_MS = 5_000;
const OWN_SEARCH_MS = 10_000;
const OWN_SEARCH_FILES = 20_000;
const MOST_VAULT_SEARCHES = 5;
const MOST_MEMORY_REQUESTS = 2;
const LARGEST_MEMORY_ANSWER = 1024 * 1024;
const QMD_RESULTS = "20";
const MEMORY_RESULTS = "20";
const OWN_SEARCH_LIMIT = 50;
const LONGEST_EXCERPT = 300;
const LARGEST_SEARCHED_FILE = 1024 * 1024;
const MILLISECONDS_PER_SECOND = 1000;
const SNIPPET_HEADER = /^\d+: @@ /;
const LINE_NUMBER = /^\d+: ?/;
const UNTITLED = "(ohne Titel)";
const QMD_SCRIPT = ["node_modules", "@tobilu", "qmd", "bin", "qmd"];

export interface VaultTreffer {
  readonly pfad: string;
  readonly zeile: number;
  readonly auszug: string;
}

export interface Erinnerung {
  readonly id: number | string;
  readonly titel: string;
  readonly datum: string;
}

export interface Suchergebnis {
  readonly vault: readonly VaultTreffer[];
  readonly erinnerung: readonly Erinnerung[];
  readonly fehler?: string;
}

export interface MenuLimits {
  readonly ownSearchMs?: number;
  readonly ownSearchFiles?: number;
  readonly memoryTimeoutMs?: number;
}

export interface MenuOptions {
  readonly vault: string;
  readonly erlaubteOrdner: readonly string[];
  readonly qmdBefehl: readonly string[];
  readonly claudeMem: string;
  readonly now: () => number;
  readonly run: Runner;
  readonly limits?: MenuLimits;
}

interface Part<T> {
  readonly hits: T[];
  readonly notes: string[];
}

class AnswerTooLarge extends Error {
  constructor() {
    super(`answer larger than ${String(LARGEST_MEMORY_ANSWER)} bytes`);
    this.name = "AnswerTooLarge";
  }
}

function excerpt(snippet: string): string {
  const lines = snippet.split("\n").filter((line) => !SNIPPET_HEADER.test(line));
  return lines.map((line) => line.replace(LINE_NUMBER, "").trim()).filter((line) => line !== "").join(" ").slice(0, LONGEST_EXCERPT);
}

function shownPath(vault: string, file: string): string {
  const absolute = path.resolve(file);
  return isInside(vault, absolute) ? path.relative(vault, absolute).split(path.sep).join("/") : absolute;
}

function qmdHits(vault: string, stdout: string): VaultTreffer[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!Array.isArray(parsed)) return undefined;
  return parsed.flatMap((hit: unknown) => {
    if (!isFields(hit) || typeof hit.file !== "string" || typeof hit.line !== "number") return [];
    return [{ pfad: shownPath(vault, hit.file), zeile: hit.line, auszug: excerpt(typeof hit.snippet === "string" ? hit.snippet : "") }];
  });
}

async function markdownFiles(folder: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR") || hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM")) return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
      const child = path.join(folder, entry.name);
      if (entry.isDirectory()) return markdownFiles(child);
      return entry.isFile() && entry.name.endsWith(".md") ? [child] : [];
    }),
  );
  return nested.flat();
}

async function searchableText(file: string): Promise<string | undefined> {
  try {
    if ((await stat(file)).size > LARGEST_SEARCHED_FILE) return undefined;
    return await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function linesMatching(vault: string, file: string, text: string, wanted: string, hits: VaultTreffer[]): void {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (hits.length >= OWN_SEARCH_LIMIT) return;
    if (line.toLocaleLowerCase("de").includes(wanted)) hits.push({ pfad: shownPath(vault, file), zeile: index + 1, auszug: line.trim().slice(0, LONGEST_EXCERPT) });
  }
}

async function ownSearch(vault: string, text: string, limits: Required<MenuLimits>, now: () => number): Promise<Part<VaultTreffer>> {
  const wanted = text.toLocaleLowerCase("de");
  const deadline = now() + limits.ownSearchMs;
  const hits: VaultTreffer[] = [];
  const files = (await markdownFiles(vault)).sort();
  for (const [count, file] of files.entries()) {
    if (hits.length >= OWN_SEARCH_LIMIT) break;
    if (count >= limits.ownSearchFiles) return { hits, notes: [`einfache Suche nach ${String(limits.ownSearchFiles)} Dateien abgebrochen`] };
    if (now() >= deadline) return { hits, notes: [`einfache Suche nach ${String(limits.ownSearchMs / MILLISECONDS_PER_SECOND)} s abgebrochen`] };
    const content = await searchableText(file);
    if (content !== undefined) linesMatching(vault, file, content, wanted, hits);
  }
  return { hits, notes: [] };
}

function memoriesOf(body: unknown): Erinnerung[] {
  const observations = isFields(body) && Array.isArray(body.observations) ? (body.observations as unknown[]) : [];
  return observations.flatMap((entry) => {
    if (!isFields(entry) || !isMemoryId(entry.id) || typeof entry.created_at !== "string") return [];
    return [{ id: entry.id, titel: typeof entry.title === "string" && entry.title !== "" ? entry.title : UNTITLED, datum: entry.created_at }];
  });
}

function isMemoryId(value: unknown): value is number | string {
  return (typeof value === "number" && Number.isSafeInteger(value)) || (typeof value === "string" && value !== "");
}

async function limitedText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length") ?? "0") > LARGEST_MEMORY_ANSWER) throw new AnswerTooLarge();
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) throw new TypeError("claude-mem sent a body that is not bytes");
    size += chunk.length;
    if (size > LARGEST_MEMORY_ANSWER) {
      await reader.cancel();
      throw new AnswerTooLarge();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

class Slots {
  readonly #most: number;
  #used = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(most: number) {
    this.#most = most;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#used >= this.#most) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#used += 1;
    try {
      return await work();
    } finally {
      this.#used -= 1;
      this.#waiting.shift()?.();
    }
  }
}

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return "Fehler";
  const { cause } = error;
  if (!(cause instanceof Error)) return error.name;
  return "code" in cause && typeof cause.code === "string" ? cause.code : cause.message;
}

export class Menu {
  readonly #options: MenuOptions;
  readonly #limits: Required<MenuLimits>;
  readonly #memorySlots = new Slots(MOST_MEMORY_REQUESTS);
  #vaultQueue: Promise<unknown> = Promise.resolve();
  #vaultSearches = 0;

  constructor(options: MenuOptions) {
    this.#options = options;
    this.#limits = {
      ownSearchMs: options.limits?.ownSearchMs ?? OWN_SEARCH_MS,
      ownSearchFiles: options.limits?.ownSearchFiles ?? OWN_SEARCH_FILES,
      memoryTimeoutMs: options.limits?.memoryTimeoutMs ?? MEMORY_TIMEOUT_MS,
    };
  }

  folders(): Promise<Ordner[]> {
    return listFolders(this.#options.erlaubteOrdner);
  }

  async qmdProblem(): Promise<string | undefined> {
    const batch = await batchFileOf(this.#options.qmdBefehl);
    if (batch === undefined) return undefined;
    const replacement = JSON.stringify(["node", path.join(path.dirname(batch), ...QMD_SCRIPT)]);
    return `qmd ${batch} is a Windows batch file and is not started; the vault search falls back to a simple search. Set "qmdBefehl": ${replacement} in bruecke.json`;
  }

  async search(text: string, signal?: AbortSignal): Promise<Suchergebnis> {
    signal?.throwIfAborted();
    const [vault, memory] = await Promise.all([this.#vaultPart(text, signal), this.#memoryPart(text, signal)]);
    signal?.throwIfAborted();
    const notes = [...vault.notes, ...memory.notes];
    const result = { vault: vault.hits, erinnerung: memory.hits };
    return notes.length === 0 ? result : { ...result, fehler: notes.join("; ") };
  }

  #vaultPart(text: string, signal: AbortSignal | undefined): Promise<Part<VaultTreffer>> {
    if (this.#vaultSearches >= MOST_VAULT_SEARCHES) return Promise.resolve({ hits: [], notes: ["Vault-Suche ausgelastet, bitte gleich noch einmal"] });
    this.#vaultSearches += 1;
    let counted = true;
    const release = (): void => {
      if (counted) this.#vaultSearches -= 1;
      counted = false;
    };
    signal?.addEventListener("abort", release, { once: true });
    const run = this.#vaultQueue.then(() => {
      signal?.throwIfAborted();
      return this.#searchVault(text);
    });
    this.#vaultQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      signal?.removeEventListener("abort", release);
      release();
    });
  }

  async #searchVault(text: string): Promise<Part<VaultTreffer>> {
    const { vault, qmdBefehl, run, now } = this.#options;
    const timing = { cwd: vault, timeoutMs: QMD_TIMEOUT_MS };
    const notes: string[] = [];
    const update = await run(qmdBefehl, ["update"], timing);
    if (update.kind === "fehler") notes.push(`Vault-Index nicht aktualisiert (${update.grund})`);
    const args = ["search", "--line-numbers", "--full-path", "--format", "json", "-n", QMD_RESULTS, "--", text];
    const search = update.kind === "fehlt" ? update : await run(qmdBefehl, args, timing);
    const hits = search.kind === "ok" ? qmdHits(vault, search.stdout) : undefined;
    if (hits !== undefined) return { hits, notes };
    const reason = search.kind === "ok" ? "Antwort von qmd nicht lesbar; einfache Suche" : `qmd nicht verfügbar (${search.grund}); einfache Suche`;
    const own = await ownSearch(vault, text, this.#limits, now);
    return { hits: own.hits, notes: [...notes, reason, ...own.notes] };
  }

  #memoryPart(text: string, signal: AbortSignal | undefined): Promise<Part<Erinnerung>> {
    return this.#memorySlots.run(async () => {
      signal?.throwIfAborted();
      const query = new URLSearchParams({ query: text, format: "json", type: "observations", limit: MEMORY_RESULTS });
      const address = `${this.#options.claudeMem.replace(/\/+$/, "")}/api/search?${query.toString()}`;
      const timeout = AbortSignal.timeout(this.#limits.memoryTimeoutMs);
      const combined = signal === undefined ? timeout : AbortSignal.any([timeout, signal]);
      return this.#askMemory(address, combined, signal);
    });
  }

  async #askMemory(address: string, combined: AbortSignal, caller: AbortSignal | undefined): Promise<Part<Erinnerung>> {
    let response: Response;
    try {
      response = await fetch(address, { signal: combined, redirect: "error" });
    } catch (error: unknown) {
      caller?.throwIfAborted();
      return { hits: [], notes: [`claude-mem nicht erreichbar (${reasonOf(error)})`] };
    }
    if (!response.ok) return { hits: [], notes: [`claude-mem antwortet mit ${String(response.status)}`] };
    try {
      return { hits: memoriesOf(JSON.parse(await limitedText(response))), notes: [] };
    } catch (error: unknown) {
      caller?.throwIfAborted();
      if (error instanceof AnswerTooLarge) return { hits: [], notes: ["Antwort von claude-mem zu groß"] };
      return { hits: [], notes: [`Antwort von claude-mem nicht lesbar (${reasonOf(error)})`] };
    }
  }
}

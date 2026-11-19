import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Runner } from "./befehl.ts";
import { hasErrorCode, writePrivateFile } from "./private_datei.ts";

export const SELF_TEST_FILE = "selbsttest.json";
export const ANSWER_WAIT_MS = 180_000;
const VERSION_TIMEOUT_MS = 10_000;
const LONGEST_VERSION = 100;
const STATUS_LINE = "Statuszeile";
const STOP = "Stop";
const PRINTABLE_VERSION = /^[^\p{Cc}]+$/u;
const HOOK_AREAS = ["agenten", "fragen"] as const;

type Anzeige = (typeof HOOK_AREAS)[number];

export type SelbsttestHinweis =
  | { readonly art: "selbsttest"; readonly text: string; readonly auftrag: string }
  | { readonly art: "keine_daten"; readonly anzeige: Anzeige };

export interface SelfTestOptions {
  readonly version: string | null;
  readonly checking: boolean;
  readonly onChange: () => void;
  readonly onPassed: (version: string) => void;
}

interface Watch {
  hookSeen: boolean;
  readonly timer: NodeJS.Timeout;
}

function repairTask(version: string, missing: string): string {
  return (
    `Nach dem Update von Claude Code auf ${version} kommen in der Kommandozentrale keine Daten mehr von ${missing}. ` +
    "Prüfe die aktuellen Formate unter https://code.claude.com/docs/en/hooks.md und https://code.claude.com/docs/en/headless.md, " +
    "vergleiche sie mit bruecke/meldeskripte, bruecke/src/zustand.ts und bruecke/src/chat.ts und passe die Brücke an. " +
    "Ändere ~/.claude/settings.json nur nach Rückfrage; die geschützten Hooks bleiben unverändert."
  );
}

function hookHints(version: string): SelbsttestHinweis[] {
  return [
    {
      art: "selbsttest",
      text: `Selbsttest nach dem Update auf Claude Code ${version}: keine Meldungen der Hooks`,
      auftrag: repairTask(version, "den Hooks"),
    },
    ...HOOK_AREAS.map((anzeige) => ({ art: "keine_daten", anzeige }) as const),
  ];
}

export class SelfTest {
  readonly #options: SelfTestOptions;
  readonly #watches = new Map<string, Watch>();
  readonly #hints = new Map<string, SelbsttestHinweis[]>();
  #checking: boolean;
  #version: string | null;

  constructor(options: SelfTestOptions) {
    this.#options = options;
    this.#checking = options.checking;
    this.#version = options.version;
  }

  version(): string | null {
    return this.#version;
  }

  hints(session: string): readonly SelbsttestHinweis[] {
    return this.#hints.get(session) ?? [];
  }

  versionSeen(version: string | null): void {
    if (version === null || version === this.#version) return;
    this.#version = version;
    this.#stopWatching();
    this.#checking = true;
    this.#options.onChange();
  }

  inputSent(session: string): void {
    if (!this.#checking || this.#watches.has(session)) return;
    const timer = setTimeout(() => {
      this.#timedOut(session);
    }, ANSWER_WAIT_MS);
    this.#watches.set(session, { hookSeen: false, timer });
  }

  observe(session: string, eventName: string): void {
    const watch = this.#watches.get(session);
    if (watch === undefined) return;
    if (eventName !== STATUS_LINE) watch.hookSeen = true;
    if (eventName === STOP) this.#evaluate(watch);
  }

  restart(): void {
    this.#stopWatching();
    this.#hints.clear();
    this.#checking = true;
    this.#options.onChange();
  }

  close(): void {
    this.#stopWatching();
  }

  #stopWatching(): void {
    for (const watch of this.#watches.values()) clearTimeout(watch.timer);
    this.#watches.clear();
  }

  #evaluate(watch: Watch): void {
    clearTimeout(watch.timer);
    this.#passed();
  }

  #timedOut(session: string): void {
    const watch = this.#watches.get(session);
    this.#watches.delete(session);
    if (watch === undefined || watch.hookSeen) return;
    this.#mark(session, hookHints(this.#versionName()));
  }

  #versionName(): string {
    return this.#version ?? "eine neue Fassung";
  }

  #mark(session: string, hints: SelbsttestHinweis[]): void {
    this.#hints.set(session, hints);
    this.#options.onChange();
  }

  #passed(): void {
    const hadHints = this.#hints.size > 0;
    this.#hints.clear();
    this.#checking = false;
    this.#stopWatching();
    if (this.#version !== null) this.#options.onPassed(this.#version);
    if (hadHints) this.#options.onChange();
  }
}

export async function claudeVersion(run: Runner, claudeBefehl: readonly string[], cwd: string): Promise<string | null> {
  const result = await run(claudeBefehl, ["--version"], { cwd, timeoutMs: VERSION_TIMEOUT_MS });
  if (result.kind !== "ok") return null;
  const first = result.stdout.split(/\r?\n/)[0]?.trim() ?? "";
  return first !== "" && first.length <= LONGEST_VERSION && PRINTABLE_VERSION.test(first) ? first : null;
}

async function storedVersion(file: string, onProblem: (problem: string) => void): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") return parsed.version;
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  onProblem(`${file} holds no stored version; it is written anew`);
  return null;
}

export interface SelfTestCallbacks {
  readonly onChange: () => void;
  readonly onProblem: (problem: string) => void;
}

export async function openSelfTest(dataFolder: string, version: string | null, callbacks: SelfTestCallbacks): Promise<SelfTest> {
  const file = path.join(dataFolder, SELF_TEST_FILE);
  const previous = await storedVersion(file, callbacks.onProblem);
  const remember = (current: string): void => {
    writePrivateFile(file, JSON.stringify({ version: current })).catch((error: unknown) => {
      callbacks.onProblem(`${file} cannot be written: ${error instanceof Error ? error.message : "unknown error"}`);
    });
  };
  if (previous === null && version !== null) await writePrivateFile(file, JSON.stringify({ version }));
  const checking = previous !== null && version !== null && previous !== version;
  return new SelfTest({ version, checking, onChange: callbacks.onChange, onPassed: remember });
}

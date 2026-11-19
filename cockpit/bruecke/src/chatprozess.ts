import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { batchFileOf } from "./befehl.ts";
import { findCommand, type Environment } from "./kindprozess.ts";
import { ZeilenLeser } from "./zeilen.ts";

export const CLAUDE_ENDED = "Claude Code ist beendet";

export const CHAT_ARGUMENTS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--permission-prompt-tool",
  "stdio",
] as const;
export const LONGEST_LINE_BYTES = 64 * 1024 * 1024;
export const LONGEST_ERROR_LINE_BYTES = 64 * 1024;
export const STOP_GRACE_MS = 3_000;
export const CONTROL_ANSWER_MS = 15_000;
const RESUME_OPTION = "--resume";
const SHOWN_ERROR_LENGTH = 2_000;

export class ChatStartFehler extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatStartFehler";
  }
}

export interface ChatStart {
  readonly befehl: readonly string[];
  readonly ordner: string;
  readonly umgebung: Record<string, string>;
  readonly fortsetzen: string | null;
  readonly optionen?: readonly string[];
  readonly gnadenfrist?: number;
  readonly schwaerzen?: (text: string) => string;
}

export interface ChatRueckrufe {
  readonly zeile: (wert: unknown) => void;
  readonly stoerung: (text: string) => void;
  readonly ende: (code: number | null) => void;
}

export type Steuerantwort = { readonly kind: "ok"; readonly antwort: Readonly<Record<string, unknown>> } | { readonly kind: "fehler"; readonly grund: string };

export type Antwort =
  | { readonly behavior: "allow"; readonly updatedInput: Readonly<Record<string, unknown>> }
  | { readonly behavior: "deny"; readonly message: string };

function jsonOderNichts(text: string): { wert: unknown } | undefined {
  try {
    return { wert: JSON.parse(text) };
  } catch (fehler: unknown) {
    if (fehler instanceof SyntaxError) return undefined;
    throw fehler;
  }
}

async function ausfuehrbar(befehl: string, umgebung: Environment): Promise<string> {
  const datei = await findCommand(befehl, umgebung);
  if (datei === null) throw new ChatStartFehler(`command ${befehl} was not found or cannot be run`);
  if ((await batchFileOf([datei])) !== undefined) {
    throw new ChatStartFehler(`${datei} is a Windows batch file and cannot run without a shell; name the program behind it instead`);
  }
  return datei;
}

export class ChatProzess {
  readonly #kind: ChildProcessWithoutNullStreams;
  readonly #gnadenfrist: number;
  readonly #beendet: Promise<void>;
  readonly #bereit: Promise<boolean>;
  #meldetSich: (antwortet: boolean) => void = () => undefined;
  readonly #offen = new Map<string, (antwort: Steuerantwort) => void>();
  #laeuft = true;

  private constructor(kind: ChildProcessWithoutNullStreams, rueckrufe: ChatRueckrufe, gnadenfrist: number, schwaerzen: (text: string) => string) {
    this.#kind = kind;
    this.#gnadenfrist = gnadenfrist;
    this.#bereit = new Promise((antwort) => {
      this.#meldetSich = antwort;
    });
    this.#beendet = new Promise((fertig) => {
      kind.once("close", (code) => {
        this.#laeuft = false;
        this.#meldetSich(false);
        for (const fertig of this.#offen.values()) fertig({ kind: "fehler", grund: CLAUDE_ENDED });
        this.#offen.clear();
        rueckrufe.ende(code);
        fertig();
      });
    });
    this.#lesen(rueckrufe, schwaerzen);
  }

  static async starten(start: ChatStart, rueckrufe: ChatRueckrufe): Promise<ChatProzess> {
    const [befehl = "", ...feste] = start.befehl;
    const datei = await ausfuehrbar(befehl, start.umgebung);
    const fortsetzen = start.fortsetzen === null ? [] : [RESUME_OPTION, start.fortsetzen];
    const argumente = [...feste, ...CHAT_ARGUMENTS, ...fortsetzen, ...(start.optionen ?? [])];
    const kind = spawn(datei, argumente, { cwd: start.ordner, env: start.umgebung, windowsHide: true, stdio: "pipe" });
    await new Promise<void>((bereit, scheitern) => {
      kind.once("spawn", bereit);
      kind.once("error", (fehler) => {
        scheitern(new ChatStartFehler(`command ${befehl} cannot be started`, { cause: fehler }));
      });
    });
    return new ChatProzess(kind, rueckrufe, start.gnadenfrist ?? STOP_GRACE_MS, start.schwaerzen ?? ((text) => text));
  }

  laeuft(): boolean {
    return this.#laeuft;
  }

  bereit(): Promise<boolean> {
    return this.#bereit;
  }

  nachricht(text: string): boolean {
    return this.#senden({ type: "user", message: { role: "user", content: text } });
  }

  steuern(subtype: string, felder: Readonly<Record<string, unknown>> = {}, binnen = CONTROL_ANSWER_MS): Promise<Steuerantwort> {
    const requestId = randomUUID();
    return new Promise((fertig) => {
      const frist = setTimeout(() => {
        this.#offen.delete(requestId);
        fertig({ kind: "fehler", grund: `keine Antwort auf ${subtype} binnen ${String(binnen / 1000)} s` });
      }, binnen);
      this.#offen.set(requestId, (antwort) => {
        clearTimeout(frist);
        this.#offen.delete(requestId);
        fertig(antwort);
      });
      if (!this.#senden({ type: "control_request", request_id: requestId, request: { ...felder, subtype } })) this.#offen.get(requestId)?.({ kind: "fehler", grund: CLAUDE_ENDED });
    });
  }

  #steuerantwort(wert: unknown): void {
    if (typeof wert !== "object" || wert === null) return;
    const { type, response } = wert as Record<string, unknown>;
    if (type !== "control_response" || typeof response !== "object" || response === null) return;
    const { request_id: requestId, subtype, response: inhalt, error } = response as Record<string, unknown>;
    const fertig = typeof requestId === "string" ? this.#offen.get(requestId) : undefined;
    if (fertig === undefined) return;
    if (subtype === "success") fertig({ kind: "ok", antwort: typeof inhalt === "object" && inhalt !== null ? (inhalt as Record<string, unknown>) : {} });
    else fertig({ kind: "fehler", grund: typeof error === "string" ? error : "Claude Code lehnte ab" });
  }

  unterbrechen(): boolean {
    return this.#senden({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
  }

  antworten(requestId: string, antwort: Antwort): boolean {
    return this.#senden({ type: "control_response", response: { subtype: "success", request_id: requestId, response: antwort } });
  }

  async beenden(): Promise<void> {
    if (this.#laeuft) {
      this.unterbrechen();
      this.#kind.stdin.end();
      const frist = setTimeout(() => {
        this.#kind.kill();
      }, this.#gnadenfrist);
      await this.#beendet;
      clearTimeout(frist);
    }
  }

  #senden(wert: unknown): boolean {
    if (!this.#laeuft || this.#kind.stdin.writableEnded) return false;
    this.#kind.stdin.write(`${JSON.stringify(wert)}\n`);
    return true;
  }

  #lesen(rueckrufe: ChatRueckrufe, schwaerzen: (text: string) => string): void {
    const ausgabe = new ZeilenLeser(LONGEST_LINE_BYTES, {
      zeile: (roh) => {
        this.#meldetSich(true);
        const text = schwaerzen(roh);
        const gelesen = jsonOderNichts(text);
        if (gelesen === undefined) {
          rueckrufe.stoerung(`unreadable line from Claude Code: ${text.slice(0, SHOWN_ERROR_LENGTH)}`);
          return;
        }
        this.#steuerantwort(gelesen.wert);
        rueckrufe.zeile(gelesen.wert);
      },
      zuLang: (bytes) => { rueckrufe.stoerung(`a line of ${String(bytes)} bytes from Claude Code was dropped`); },
    });
    const fehler = new ZeilenLeser(LONGEST_ERROR_LINE_BYTES, {
      zeile: (text) => { rueckrufe.stoerung(schwaerzen(text).slice(0, SHOWN_ERROR_LENGTH)); },
      zuLang: (bytes) => { rueckrufe.stoerung(`a line of ${String(bytes)} bytes on stderr was dropped`); },
    });
    this.#kind.stdout.on("data", (stueck: Buffer) => { ausgabe.schreiben(stueck); });
    this.#kind.stdout.on("end", () => { ausgabe.ende(); });
    this.#kind.stderr.on("data", (stueck: Buffer) => { fehler.schreiben(stueck); });
    this.#kind.stdin.on("error", (grund: Error) => { rueckrufe.stoerung(`writing to Claude Code failed: ${grund.message}`); });
  }
}

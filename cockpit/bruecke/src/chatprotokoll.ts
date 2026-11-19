import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Eintrag } from "./chat.ts";
import { isFields } from "./felder.ts";
import { hasErrorCode, writePrivateFile } from "./private_datei.ts";

export const CHAT_FOLDER = "chat";
export const LARGEST_CHAT_LOG = 4 * 1024 * 1024;
const OWNER_ONLY_FOLDER = 0o700;
const OWNER_ONLY_FILE = 0o600;
const ARTEN = new Set(["du", "claude", "werkzeug", "agent", "frage", "plan", "system"]);

export interface Geladen {
  readonly eintraege: Eintrag[];
  readonly kaputt: number;
}

function istEintrag(wert: unknown): wert is Eintrag {
  return isFields(wert) && typeof wert.id === "string" && typeof wert.art === "string" && ARTEN.has(wert.art) && typeof wert.zeit === "number";
}

function zeileLesen(zeile: string): Eintrag | undefined {
  try {
    const wert: unknown = JSON.parse(zeile);
    return istEintrag(wert) ? wert : undefined;
  } catch (fehler: unknown) {
    if (fehler instanceof SyntaxError) return undefined;
    throw fehler;
  }
}

export function chatDatei(datenordner: string, sitzung: string): string {
  return path.join(datenordner, CHAT_FOLDER, `${sitzung}.ndjson`);
}

export async function chatLaden(datei: string): Promise<Geladen> {
  let inhalt: string;
  try {
    inhalt = await readFile(datei, "utf8");
  } catch (fehler: unknown) {
    if (hasErrorCode(fehler, "ENOENT")) return { eintraege: [], kaputt: 0 };
    throw fehler;
  }
  const eintraege = new Map<string, Eintrag>();
  let kaputt = 0;
  for (const zeile of inhalt.split("\n")) {
    if (zeile.trim() === "") continue;
    const eintrag = zeileLesen(zeile);
    if (eintrag === undefined) kaputt += 1;
    else eintraege.set(eintrag.id, eintrag);
  }
  return { eintraege: [...eintraege.values()], kaputt };
}

export class ChatProtokoll {
  readonly #datei: string;
  readonly #grenze: number;
  #warteschlange: Promise<void> = Promise.resolve();

  constructor(datei: string, grenze: number = LARGEST_CHAT_LOG) {
    this.#datei = datei;
    this.#grenze = grenze;
  }

  schreiben(eintraege: readonly Eintrag[], alle: () => readonly Eintrag[]): Promise<void> {
    const text = eintraege.map((eintrag) => `${JSON.stringify(eintrag)}\n`).join("");
    return this.#nacheinander(async () => {
      await mkdir(path.dirname(this.#datei), { recursive: true, mode: OWNER_ONLY_FOLDER });
      await appendFile(this.#datei, text, { mode: OWNER_ONLY_FILE });
      if ((await stat(this.#datei)).size > this.#grenze) await this.#verdichten(alle());
    });
  }

  loeschen(): Promise<void> {
    return this.#nacheinander(() => rm(this.#datei, { force: true }));
  }

  fertig(): Promise<void> {
    return this.#warteschlange;
  }

  async #verdichten(eintraege: readonly Eintrag[]): Promise<void> {
    const zeilen = eintraege.map((eintrag) => `${JSON.stringify(eintrag)}\n`);
    let bytes = 0;
    let anfang = zeilen.length;
    while (anfang > 0 && bytes + Buffer.byteLength(zeilen[anfang - 1] ?? "") <= this.#grenze / 2) {
      anfang -= 1;
      bytes += Buffer.byteLength(zeilen[anfang] ?? "");
    }
    await writePrivateFile(this.#datei, zeilen.slice(anfang).join(""));
  }

  #nacheinander(arbeit: () => Promise<void>): Promise<void> {
    const lauf = this.#warteschlange.then(arbeit);
    this.#warteschlange = lauf.catch(() => undefined);
    return lauf;
  }
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ALWAYS_ACTIVE_SKILLS } from "./bestand.ts";
import { isKennung, parseVorgaben } from "./nachrichten.ts";
import type { HakenArt, JeArt, Vorgaben } from "./nachrichten.ts";
import { hasErrorCode, writePrivateFile } from "./private_datei.ts";

export const DEFAULTS_FILE = "vorgaben.json";
export const MOST_FAVOURITES = 500;
const LIST_OF: Readonly<Record<HakenArt, keyof JeArt<string>>> = { skill: "skills", plugin: "plugins", konnektor: "konnektoren" };

export interface Gespeichert {
  readonly vorgaben: Vorgaben | null;
  readonly favoriten: JeArt<string>;
}

export const FIRST_FAVOURITES: JeArt<string> = { skills: ALWAYS_ACTIVE_SKILLS, plugins: [], konnektoren: [] };

export class DefaultsFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DefaultsFileError";
  }
}

function isFavourites(value: unknown): value is JeArt<string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const lists = Object.values(LIST_OF).map((key) => (value as Record<string, unknown>)[key]);
  return Object.keys(value).length === lists.length && lists.every((list) => Array.isArray(list) && list.length <= MOST_FAVOURITES && list.every(isKennung));
}

function storedOf(parsed: unknown, file: string): Gespeichert {
  const damaged = new DefaultsFileError(`${file} must hold {"vorgaben": <defaults or null>, "favoriten": {"skills": [], "plugins": [], "konnektoren": []}}; delete it to start anew`);
  if (typeof parsed !== "object" || parsed === null) throw damaged;
  const { vorgaben, favoriten } = parsed as Record<string, unknown>;
  const read = vorgaben === null ? null : parseVorgaben(vorgaben);
  if (read === undefined || !isFavourites(favoriten)) throw damaged;
  return { vorgaben: read, favoriten };
}

export class VorgabenSpeicher {
  readonly #file: string;
  #writing: Promise<void> = Promise.resolve();

  constructor(datenordner: string) {
    this.#file = path.join(datenordner, DEFAULTS_FILE);
  }

  async read(): Promise<Gespeichert> {
    await this.#writing;
    return this.#load();
  }

  async #load(): Promise<Gespeichert> {
    let content: string;
    try {
      content = await readFile(this.#file, "utf8");
    } catch (error: unknown) {
      if (hasErrorCode(error, "ENOENT")) return { vorgaben: null, favoriten: FIRST_FAVOURITES };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error: unknown) {
      throw new DefaultsFileError(`${this.#file} is not valid JSON; delete it to start anew`, { cause: error });
    }
    return storedOf(parsed, this.#file);
  }

  setDefaults(vorgaben: Vorgaben): Promise<void> {
    return this.#change((stored) => ({ ...stored, vorgaben }));
  }

  setFavourite(art: HakenArt, kennung: string, an: boolean): Promise<void> {
    const key = LIST_OF[art];
    return this.#change((stored) => {
      const without = stored.favoriten[key].filter((entry) => entry !== kennung);
      const list = an ? [...without, kennung].slice(-MOST_FAVOURITES) : without;
      return { ...stored, favoriten: { ...stored.favoriten, [key]: list } };
    });
  }

  #change(change: (stored: Gespeichert) => Gespeichert): Promise<void> {
    const write = this.#writing.then(async () => {
      const stored = await this.#load();
      await writePrivateFile(this.#file, JSON.stringify(change(stored)));
    });
    this.#writing = write.catch(() => undefined);
    return write;
  }
}

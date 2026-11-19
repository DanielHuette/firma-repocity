import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vorgaben } from "../src/nachrichten.ts";
import { DEFAULTS_FILE, DefaultsFileError, FIRST_FAVOURITES, MOST_FAVOURITES, VorgabenSpeicher } from "../src/vorgaben.ts";

let daten: string;

const VORGABEN: Vorgaben = { modell: "sonnet", aufwand: "high", ordner: null, ausgabestil: null, erlaubnis: "plan", skills: ["grill-me"], plugins: [], konnektoren: ["playwright"] };

beforeEach(async () => {
  daten = await mkdtemp(path.join(tmpdir(), "vorgaben-"));
});

afterEach(async () => {
  await rm(daten, { recursive: true, force: true });
});

describe("VorgabenSpeicher", () => {
  it("starts without defaults and with caveman, grill-me and senior-engineering-standard as favourite skills", async () => {
    expect(await new VorgabenSpeicher(daten).read()).toEqual({ vorgaben: null, favoriten: { skills: ["caveman", "grill-me", "senior-engineering-standard"], plugins: [], konnektoren: [] } });
    expect(FIRST_FAVOURITES.konnektoren).toEqual([]);
  });

  it("keeps defaults across a restart", async () => {
    await new VorgabenSpeicher(daten).setDefaults(VORGABEN);
    expect((await new VorgabenSpeicher(daten).read()).vorgaben).toEqual(VORGABEN);
  });

  it("adds and removes favourites per kind, each only once", async () => {
    const speicher = new VorgabenSpeicher(daten);
    await Promise.all([speicher.setFavourite("plugin", "a@m", true), speicher.setFavourite("plugin", "a@m", true), speicher.setFavourite("skill", "grill-me", false), speicher.setFavourite("konnektor", "github", true)]);
    expect((await speicher.read()).favoriten).toEqual({ skills: ["caveman", "senior-engineering-standard"], plugins: ["a@m"], konnektoren: ["github"] });
  });

  it("keeps at most 500 favourites per kind, dropping the oldest", async () => {
    const speicher = new VorgabenSpeicher(daten);
    for (let index = 0; index <= MOST_FAVOURITES; index += 1) await speicher.setFavourite("konnektor", `k${String(index)}`, true);
    const { konnektoren } = (await speicher.read()).favoriten;
    expect(konnektoren).toHaveLength(MOST_FAVOURITES);
    expect(konnektoren[0]).toBe("k1");
  });

  it.each([
    ["no JSON", "{kaputt"],
    ["damaged defaults", JSON.stringify({ vorgaben: { ...VORGABEN, erlaubnis: "bypassPermissions" }, favoriten: FIRST_FAVOURITES })],
    ["missing favourites", JSON.stringify({ vorgaben: null })],
    ["favourites with an extra kind", JSON.stringify({ vorgaben: null, favoriten: { ...FIRST_FAVOURITES, modelle: [] } })],
    ["a favourite that is no id", JSON.stringify({ vorgaben: null, favoriten: { ...FIRST_FAVOURITES, skills: [""] } })],
  ])("refuses a file with %s", async (_case, content) => {
    await mkdir(daten, { recursive: true });
    await writeFile(path.join(daten, DEFAULTS_FILE), content);
    await expect(new VorgabenSpeicher(daten).read()).rejects.toThrow(DefaultsFileError);
  });
});

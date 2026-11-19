import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LARGEST_STATUS_BYTES,
  LONGEST_DECISION,
  MOST_REMEMBERED,
  PROJECTS_FILE,
  Projekte,
  ProjectsFileError,
  STATUS_FILE,
  lastDecisionOf,
  phasesOf,
  readStatus,
} from "../src/projekte.ts";

let root: string;
let erlaubt: string;
let daten: string;

const STATUS = [
  "# Projekt-Status",
  "",
  "| Phase | Status | Datum | Speicherpunkt (Commit) |",
  "|---|---|---|---|",
  "| geplant | fertig | 2026-11-18 | abc |",
  "| Aufgaben | laeuft | 2026-11-19 | |",
  "",
  "## Entscheidungen",
  "- 2026-11-18: Erste.",
  "- 2026-11-19: Letzte Entscheidung.",
  "",
  "## Danach",
  "- gehört nicht dazu",
].join("\n");

async function folder(name: string, status?: string): Promise<string> {
  const ordner = path.join(erlaubt, name);
  await mkdir(ordner, { recursive: true });
  if (status !== undefined) await writeFile(path.join(ordner, STATUS_FILE), status);
  return ordner;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "projekte-"));
  erlaubt = path.join(root, "vault");
  daten = path.join(root, "daten");
  await mkdir(erlaubt, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readStatus", () => {
  it("reads the phase table and the last decision", () => {
    expect(readStatus(STATUS)).toEqual({
      phasen: [
        { phase: "geplant", status: "fertig", datum: "2026-11-18" },
        { phase: "Aufgaben", status: "laeuft", datum: "2026-11-19" },
      ],
      letzteEntscheidung: "2026-11-19: Letzte Entscheidung.",
    });
  });

  it("reads no status from a file without table and decisions", () => {
    expect(readStatus("# nur Text\n")).toBeNull();
  });

  it("reads a table without the separator line as no table", () => {
    expect(phasesOf(["| Phase | Status | Datum |", "| a | b | c |"])).toEqual([]);
  });

  it("reads no table whose head does not start with Phase, Status, Datum", () => {
    expect(phasesOf(["| Status | Phase | Datum |", "|---|---|---|", "| a | b | c |"])).toEqual([]);
  });

  it("keeps a decision of 400 characters", () => {
    const text = "e".repeat(LONGEST_DECISION);
    expect(lastDecisionOf(["## Entscheidungen", `- ${text}`])).toBe(text);
  });

  it("shortens a decision of 401 characters to 400", () => {
    const shown = lastDecisionOf(["## Entscheidungen", `- ${"e".repeat(LONGEST_DECISION + 1)}`]);
    expect(shown).toHaveLength(LONGEST_DECISION);
  });

  it("reads no decision from an empty section", () => {
    expect(lastDecisionOf(["## Entscheidungen", "", "## Weiter", "- x"])).toBeNull();
  });
});

describe("Projekte", () => {
  it("lists the four newest folders, newest first, with status", async () => {
    const projekte = new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] });
    const namen = ["a", "b", "c", "d", "e"];
    for (const [index, name] of namen.entries()) await projekte.remember(await folder(name, name === "e" ? STATUS : undefined), 1000 + index);
    const liste = await projekte.list();
    expect(liste.map(({ name, zuletzt }) => [name, zuletzt])).toEqual([["e", 1004], ["d", 1003], ["c", 1002], ["b", 1001]]);
    expect(liste[0]?.status?.letzteEntscheidung).toBe("2026-11-19: Letzte Entscheidung.");
    expect(liste[1]?.status).toBeNull();
  });

  it("keeps a folder only once and moves it to the front when it is used again", async () => {
    const projekte = new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] });
    const a = await folder("a");
    await projekte.remember(a, 1);
    await projekte.remember(await folder("b"), 2);
    await projekte.remember(a, 3);
    expect((await projekte.list()).map(({ name }) => name)).toEqual(["a", "b"]);
  });

  it("remembers at most 50 folders", async () => {
    const projekte = new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] });
    for (let index = 0; index <= MOST_REMEMBERED; index += 1) await projekte.remember(path.join(erlaubt, `p${String(index)}`), index);
    const stored = JSON.parse(await readFile(path.join(daten, PROJECTS_FILE), "utf8")) as { liste: unknown[] };
    expect(stored.liste).toHaveLength(MOST_REMEMBERED);
  });

  it("reads no status outside the allowed folders, even through a link", async () => {
    const draussen = path.join(root, "draussen");
    await mkdir(draussen, { recursive: true });
    await writeFile(path.join(draussen, STATUS_FILE), STATUS);
    const ordner = await folder("verweis");
    await rm(ordner, { recursive: true });
    await symlink(draussen, ordner, "junction");
    const projekte = new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] });
    await projekte.remember(ordner, 1);
    expect((await projekte.list())[0]?.status).toBeNull();
  });

  it("reads a status file of 64 KB", async () => {
    const text = `${STATUS}\n${" ".repeat(LARGEST_STATUS_BYTES - Buffer.byteLength(STATUS) - 1)}`;
    expect(Buffer.byteLength(text)).toBe(LARGEST_STATUS_BYTES);
    const projekte = new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] });
    await projekte.remember(await folder("gross", text), 1);
    expect((await projekte.list())[0]?.status).not.toBeNull();
  });

  it("reads no status from a file of 64 KB and one byte", async () => {
    const text = `${STATUS}\n${" ".repeat(LARGEST_STATUS_BYTES - Buffer.byteLength(STATUS))}`;
    const projekte = new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] });
    await projekte.remember(await folder("zu_gross", text), 1);
    expect((await projekte.list())[0]?.status).toBeNull();
  });

  it("lists nothing before a folder was used", async () => {
    expect(await new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] }).list()).toEqual([]);
  });

  it("refuses a damaged list with a hint", async () => {
    await mkdir(daten, { recursive: true });
    await writeFile(path.join(daten, PROJECTS_FILE), JSON.stringify({ liste: [{ ordner: "relativ", zuletzt: 1 }] }));
    await expect(new Projekte({ datenordner: daten, erlaubteOrdner: [erlaubt] }).list()).rejects.toThrow(ProjectsFileError);
  });
});

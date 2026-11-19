import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { areasOf, LONGEST_DESCRIPTION, LONGEST_SETUP_TEXT, readBestand, readSteckbrief, setupText } from "../src/bestand.ts";
import type { BestandsOrte } from "../src/bestand.ts";

let root: string;
let orte: BestandsOrte;

async function write(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function skillText(name: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: Beschreibung von ${name}\n${extra}---\n\n# ${name}\n`;
}

async function skill(folder: string, name: string, extra = ""): Promise<string> {
  await write(path.join(folder, "SKILL.md"), skillText(name, extra));
  return folder;
}

async function link(target: string, at: string): Promise<void> {
  await mkdir(path.dirname(at), { recursive: true });
  await symlink(target, at, "junction");
}

function library(...parts: string[]): string {
  return path.join(orte.vault, "10_Bibliothek", "11_Skills", ...parts);
}

async function plugin(name: string, market: string, skills: readonly string[], manifest: Record<string, unknown> = {}): Promise<string> {
  const folder = path.join(root, "cache", market, name);
  await write(path.join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name, description: `Plugin ${name}`, ...manifest }));
  for (const entry of skills) await skill(path.join(folder, "skills", entry), entry);
  return folder;
}

async function installed(records: Record<string, string>, enabled: Record<string, boolean>): Promise<void> {
  const plugins = Object.fromEntries(Object.entries(records).map(([key, installPath]) => [key, [{ scope: "user", installPath }]]));
  await write(path.join(orte.claudeOrdner, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
  await write(path.join(orte.claudeOrdner, "settings.json"), JSON.stringify({ enabledPlugins: enabled }));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bestand-"));
  orte = { claudeOrdner: path.join(root, "claude"), claudeJson: path.join(root, "claude.json"), vault: path.join(root, "vault") };
  await mkdir(orte.claudeOrdner, { recursive: true });
  await mkdir(orte.vault, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readSteckbrief", () => {
  it("reads name, description and areas from the front matter", () => {
    expect(readSteckbrief("---\nname: a\ndescription: Tut etwas.\nEinsatz: [Web, Software]\n---\n")).toEqual({ name: "a", beschreibung: "Tut etwas.", bereiche: ["Web", "Software"] });
  });

  it("reads a folded description", () => {
    expect(readSteckbrief("---\nname: a\ndescription: >\n  erste Zeile\n  zweite Zeile\nEinsatz: [Web]\n---\n").beschreibung).toBe("erste Zeile zweite Zeile");
  });

  it("reads a quoted description", () => {
    expect(readSteckbrief("---\nname: a\ndescription: \"in Anführung: ja\"\n---\n").beschreibung).toBe("in Anführung: ja");
  });

  it("falls back to the purpose line", () => {
    expect(readSteckbrief("---\nArt: Konnektor\nZweck: Dateien im Netz\n---\n").beschreibung).toBe("Dateien im Netz");
  });

  it("keeps a description of 300 characters", () => {
    const text = "d".repeat(LONGEST_DESCRIPTION);
    expect(readSteckbrief(`---\ndescription: ${text}\n---\n`).beschreibung).toBe(text);
  });

  it("shortens a description of 301 characters to 300", () => {
    const shown = readSteckbrief(`---\ndescription: ${"d".repeat(LONGEST_DESCRIPTION + 1)}\n---\n`).beschreibung;
    expect(shown).toHaveLength(LONGEST_DESCRIPTION);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("reads no name without front matter", () => {
    expect(readSteckbrief("# nur Text\nname: x\n").name).toBeNull();
  });
});

describe("areasOf", () => {
  it.each([
    ["a list", "[Web, Zahlen]", ["Web", "Zahlen"]],
    ["everywhere", "[Überall]", ["Überall"]],
    ["a value without brackets", "Medien", ["Medien"]],
    ["unknown areas", "[Garten, Web]", ["Web"]],
    ["only unknown areas", "[Garten]", ["ohne Bereich"]],
    ["an area twice", "[Web, Web]", ["Web"]],
    ["no line", null, ["ohne Bereich"]],
    ["an empty list", "[]", ["ohne Bereich"]],
  ])("reads %s", (_case, value, expected) => {
    expect(areasOf(value)).toEqual(expected);
  });
});

describe("readBestand skills", () => {
  it("lists personal skills that are loaded directly, with areas", async () => {
    await skill(path.join(orte.claudeOrdner, "skills", "eigen"), "eigen", "Einsatz: [Zahlen]\n");
    const { skills } = await readBestand(orte);
    expect(skills).toEqual([{ kennung: "eigen", name: "eigen", beschreibung: "Beschreibung von eigen", bereiche: ["Zahlen"], sammlung: null, quelle: "persoenlich", immerAktiv: false }]);
  });

  it("leaves out nested skills and the bin", async () => {
    await skill(path.join(orte.claudeOrdner, "skills", "gruppe", "innen"), "innen");
    await skill(path.join(orte.claudeOrdner, "skills", ".trash", "alt"), "alt");
    expect((await readBestand(orte)).skills).toEqual([]);
  });

  it("names the collection of a linked skill that sits in a collection folder of the library", async () => {
    await link(await skill(library("03_video_ton", "hyperframes", "slideshow"), "slideshow"), path.join(orte.claudeOrdner, "skills", "slideshow"));
    await link(await skill(library("05_programmierung", "openrouter"), "openrouter"), path.join(orte.claudeOrdner, "skills", "openrouter"));
    const skills = (await readBestand(orte)).skills.map(({ name, sammlung }) => ({ name, sammlung }));
    expect(skills).toEqual([{ name: "openrouter", sammlung: null }, { name: "slideshow", sammlung: "hyperframes" }]);
  });

  it("lists a skill of the skillbase once, even when it is also linked personally", async () => {
    const base = await skill(path.join(orte.vault, "03_Skillbase", "grill-me"), "grill-me");
    await link(base, path.join(orte.claudeOrdner, "skills", "grill-me"));
    await skill(path.join(orte.vault, "03_Skillbase", "skill-creator", "innen"), "innen");
    const { skills } = await readBestand(orte);
    expect(skills.map(({ kennung, quelle, immerAktiv }) => ({ kennung, quelle, immerAktiv }))).toEqual([{ kennung: "grill-me", quelle: "skillbase", immerAktiv: true }]);
  });

  it("marks only caveman, grill-me and senior-engineering-standard as always active", async () => {
    for (const name of ["caveman", "senior-engineering-standard", "wissen-abfragen"]) await skill(path.join(orte.vault, "03_Skillbase", name), name);
    const active = (await readBestand(orte)).skills.map(({ name, immerAktiv }) => [name, immerAktiv]);
    expect(active).toEqual([["caveman", true], ["senior-engineering-standard", true], ["wissen-abfragen", false]]);
  });

  it("skips a skill whose name is not allowed and reports it", async () => {
    await skill(path.join(orte.claudeOrdner, "skills", "boese"), "<script>");
    const read = await readBestand(orte);
    expect(read.skills).toEqual([]);
    expect(read.probleme).toEqual([expect.stringContaining("has no usable name")]);
  });
});

describe("readBestand plugins", () => {
  it("takes the areas of a plugin from its connector entry when there is no plugin plan", async () => {
    const anschluss = await plugin("cli-anything", "markt", []);
    const doppelt = await plugin("beides", "markt", []);
    await installed({ "cli-anything@markt": anschluss, "beides@markt": doppelt }, { "cli-anything@markt": true, "beides@markt": true });
    await write(path.join(orte.vault, "10_Bibliothek", "18_Konnektoren", "cli_anything.md"), "---\nArt: Konnektor\nEinsatz: [Software, Agenten]\n---\n");
    await write(path.join(orte.vault, "10_Bibliothek", "18_Konnektoren", "beides.md"), "---\nArt: Konnektor\nEinsatz: [Agenten]\n---\n");
    await write(path.join(orte.vault, "10_Bibliothek", "14_Baukaesten", "_Plugins", "beides.md"), "---\nArt: Plugin\nEinsatz: [Web]\n---\n");
    const read = await readBestand(orte);
    expect(read.plugins.map(({ kennung, bereiche }) => [kennung, bereiche])).toEqual([["beides@markt", ["Web"]], ["cli-anything@markt", ["Software", "Agenten"]]]);
  });

  it("lists installed plugins with their skills, collection and global state", async () => {
    const zwei = await plugin("werkzeug-kiste", "markt", ["eins", "zwei"]);
    const eins = await plugin("solo", "markt", ["einzig"]);
    await installed({ "werkzeug-kiste@markt": zwei, "solo@markt": eins }, { "werkzeug-kiste@markt": true, "solo@markt": false });
    await write(path.join(orte.vault, "10_Bibliothek", "14_Baukaesten", "_Plugins", "werkzeug_kiste.md"), "---\nArt: Plugin\nEinsatz: [Software]\n---\n");
    const read = await readBestand(orte);
    expect(read.plugins).toEqual([
      { kennung: "solo@markt", name: "solo", marktplatz: "markt", beschreibung: "Plugin solo", bereiche: ["ohne Bereich"], aktivGlobal: false, skills: ["solo:einzig"] },
      { kennung: "werkzeug-kiste@markt", name: "werkzeug-kiste", marktplatz: "markt", beschreibung: "Plugin werkzeug-kiste", bereiche: ["Software"], aktivGlobal: true, skills: ["werkzeug-kiste:eins", "werkzeug-kiste:zwei"] },
    ]);
    expect(read.skills.map(({ kennung, sammlung, quelle }) => ({ kennung, sammlung, quelle }))).toEqual([
      { kennung: "werkzeug-kiste:eins", sammlung: "werkzeug-kiste", quelle: "plugin" },
      { kennung: "solo:einzig", sammlung: null, quelle: "plugin" },
      { kennung: "werkzeug-kiste:zwei", sammlung: "werkzeug-kiste", quelle: "plugin" },
    ]);
  });

  it("reports an unreadable plugin list and goes on", async () => {
    await write(path.join(orte.claudeOrdner, "plugins", "installed_plugins.json"), "{kaputt");
    const read = await readBestand(orte);
    expect(read.plugins).toEqual([]);
    expect(read.probleme).toEqual([expect.stringContaining("is not valid JSON")]);
  });

  it("ignores installed plugins with unsafe names", async () => {
    await installed({ "../weg@markt": path.join(root, "x"), "ok@markt": await plugin("ok", "markt", []) }, {});
    expect((await readBestand(orte)).plugins.map((entry) => entry.kennung)).toEqual(["ok@markt"]);
  });
});

describe("readBestand connectors", () => {
  it("lists own MCP servers, servers of active plugins and claude.ai connectors", async () => {
    const aktiv = await plugin("mit-server", "markt", [], { mcpServers: { suche: { command: "x" } } });
    const ruhend = await plugin("still", "markt", []);
    await write(path.join(ruhend, ".mcp.json"), JSON.stringify({ mcpServers: { leise: { command: "y" } } }));
    await installed({ "mit-server@markt": aktiv, "still@markt": ruhend }, { "mit-server@markt": true });
    await write(orte.claudeJson, JSON.stringify({ mcpServers: { playwright: { command: "npx" } }, claudeAiMcpEverConnected: ["claude.ai Gmail"] }));
    await write(path.join(orte.vault, "10_Bibliothek", "18_Konnektoren", "playwright.md"), "---\nArt: Konnektor\nZweck: Browser\nEinsatz: [Web]\n---\n");
    const { konnektoren } = await readBestand(orte);
    expect(konnektoren).toEqual([
      { kennung: "claude.ai Gmail", name: "claude.ai Gmail", art: "claudeai", bereiche: ["ohne Bereich"], jeSitzungSchaltbar: false },
      { kennung: "playwright", name: "playwright", art: "mcp", bereiche: ["Web"], jeSitzungSchaltbar: true },
      { kennung: "plugin:mit-server:suche", name: "suche", art: "plugin", bereiche: ["ohne Bereich"], jeSitzungSchaltbar: false },
    ]);
  });
});

describe("readBestand library", () => {
  it("offers library skills that are not yet loaded", async () => {
    await link(await skill(library("05_programmierung", "eingebunden"), "eingebunden"), path.join(orte.claudeOrdner, "skills", "eingebunden"));
    await skill(library("05_programmierung", "neu"), "neu", "Einsatz: [Software]\n");
    await skill(library("05_programmierung", "eigen-kopie"), "eigen");
    await skill(path.join(orte.claudeOrdner, "skills", "eigen"), "eigen");
    const read = await readBestand(orte);
    expect(read.bibliothek.skills).toEqual([{ kennung: "neu", name: "neu", beschreibung: "Beschreibung von neu", bereiche: ["Software"], braeuchteGeheimnis: false }]);
    expect(read.bibliotheksOrte.get("neu")).toMatch(/neu$/);
  });

  it("offers marketplace plugins that are not installed", async () => {
    const market = path.join(root, "markets", "markt");
    await write(path.join(market, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ name: "da" }, { name: "fehlt", description: "Fehlt noch" }, { name: "../x" }] }));
    await write(path.join(orte.claudeOrdner, "plugins", "known_marketplaces.json"), JSON.stringify({ markt: { installLocation: market } }));
    await installed({ "da@markt": await plugin("da", "markt", []) }, {});
    expect((await readBestand(orte)).bibliothek.plugins).toEqual([{ kennung: "fehlt@markt", name: "fehlt", beschreibung: "Fehlt noch", bereiche: ["ohne Bereich"], braeuchteGeheimnis: false }]);
  });

  it("offers connector entries with areas that are not configured, and flags those that need a secret", async () => {
    const folder = path.join(orte.vault, "10_Bibliothek", "18_Konnektoren");
    await write(path.join(folder, "playwright.md"), "---\nZweck: Browser\nEinsatz: [Web]\n---\n");
    await write(path.join(folder, "github.md"), "---\nZweck: Repositories\nEinsatz: [Software]\n---\nangemeldet über GH_TOKEN\n");
    await write(path.join(folder, "ollama.md"), "---\nZweck: Modelle lokal\nEinsatz: [Agenten]\n---\n");
    await write(path.join(folder, "entwurf.md"), "---\nZweck: ohne Einsatz\n---\n");
    await write(orte.claudeJson, JSON.stringify({ mcpServers: { playwright: {} } }));
    expect((await readBestand(orte)).bibliothek.konnektoren).toEqual([
      { kennung: "github", name: "github", beschreibung: "Repositories", bereiche: ["Software"], braeuchteGeheimnis: true },
      { kennung: "ollama", name: "ollama", beschreibung: "Modelle lokal", bereiche: ["Agenten"], braeuchteGeheimnis: false },
    ]);
  });
});

describe("setupText", () => {
  it("gives the text of a connector entry without front matter", () => {
    expect(setupText("---\nArt: Konnektor\n---\n\n# GitHub\n\n## Wege\ngh\n")).toBe("# GitHub\n\n## Wege\ngh");
  });

  it("shortens a long entry to 4000 characters", () => {
    expect(setupText(`---\nArt: K\n---\n${"x".repeat(LONGEST_SETUP_TEXT + 1)}`)).toHaveLength(LONGEST_SETUP_TEXT);
  });

  it("keeps an entry of 4000 characters", () => {
    expect(setupText(`---\nArt: K\n---\n${"x".repeat(LONGEST_SETUP_TEXT)}`)).toHaveLength(LONGEST_SETUP_TEXT);
  });
});

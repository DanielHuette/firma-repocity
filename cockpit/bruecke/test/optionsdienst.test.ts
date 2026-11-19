import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Eingelesen } from "../src/bestand.ts";
import type { CommandResult } from "../src/befehl.ts";
import { BACKUP_PREFIX, buildAssignment, installPlugin, linkAssignment, linkLibrarySkill, protectedEntries } from "../src/hinzufuegen.ts";
import type { Vorgaben } from "../src/nachrichten.ts";
import { CHECK_TITLE, FALLBACK_MODELS, FALLBACK_STYLES, NOT_SET_UP, Optionsdienst, OptionsFehler } from "../src/optionsdienst.ts";
import type { DienstTeile } from "../src/optionsdienst.ts";
import type { GespeicherteOptionen } from "../src/sitzungsoptionen.ts";
import { FIRST_FAVOURITES } from "../src/vorgaben.ts";

const BESTAND: Eingelesen = {
  skills: [{ kennung: "grill-me", name: "grill-me", beschreibung: "", bereiche: ["Überall"], sammlung: null, quelle: "skillbase", immerAktiv: true }],
  plugins: [
    { kennung: "a@m", name: "a", marktplatz: "m", beschreibung: "", bereiche: ["ohne Bereich"], aktivGlobal: true, skills: [] },
    { kennung: "b@m", name: "b", marktplatz: "m", beschreibung: "", bereiche: ["ohne Bereich"], aktivGlobal: false, skills: [] },
  ],
  konnektoren: [
    { kennung: "playwright", name: "playwright", art: "mcp", bereiche: ["Web"], jeSitzungSchaltbar: true },
    { kennung: "claude.ai Gmail", name: "claude.ai Gmail", art: "claudeai", bereiche: ["ohne Bereich"], jeSitzungSchaltbar: false },
  ],
  bibliothek: { skills: [{ kennung: "pdf", name: "pdf", beschreibung: "", bereiche: ["Dokumente"], braeuchteGeheimnis: false }], plugins: [], konnektoren: [{ kennung: "github", name: "github", beschreibung: "", bereiche: ["Software"], braeuchteGeheimnis: true }] },
  bibliotheksOrte: new Map([["pdf", "/vault/10_Bibliothek/11_Skills/x/pdf"]]),
  konnektorTexte: new Map([["github", "## Wege\nKommandozeile gh"]]),
  probleme: [],
};

const VORGABEN: Vorgaben = { modell: "haiku", aufwand: "high", ordner: null, ausgabestil: "Learning", erlaubnis: "plan", skills: ["grill-me"], plugins: ["b@m"], konnektoren: [] };

interface Spur {
  created: { folder: string | undefined; wahl: Partial<GespeicherteOptionen> | undefined }[];
  sent: { id: string; text: string }[];
  calls: string[];
  stored: Vorgaben | null;
}

function teile(spur: Spur, change: Partial<DienstTeile> = {}): DienstTeile {
  return {
    sitzungen: {
      list: () => [{ id: "s1", ordner: "/vault/projekt", claudeSitzung: null, prozess: "laeuft", exitCode: null, hinweis: null, optionen: {} as GespeicherteOptionen }],
      create: (folder, wahl) => {
        spur.created.push({ folder, wahl });
        return Promise.resolve({ id: `neu-${String(spur.created.length)}`, ordner: "/vault", claudeSitzung: null, prozess: "laeuft", exitCode: null, hinweis: null, optionen: {} as GespeicherteOptionen });
      },
      send: (id, text) => {
        spur.sent.push({ id, text });
        return { kind: "ok" };
      },
      rename: (id) => Promise.resolve({ kind: id === "s1" ? "ok" : "unbekannt" }),
      tick: (_id, art, kennung, an, basis) => {
        spur.calls.push(`tick ${art} ${kennung} ${String(an)} ${basis.join(",")}`);
        return Promise.resolve({ kind: "ok" });
      },
      setSetting: (_id, schluessel, wert) => {
        spur.calls.push(`setze ${schluessel} ${String(wert)}`);
        return Promise.resolve({ kind: "ok" });
      },
      capabilities: () => null,
    },
    bestand: () => Promise.resolve(BESTAND),
    vorgaben: {
      read: () => Promise.resolve({ vorgaben: spur.stored, favoriten: FIRST_FAVOURITES }),
      setDefaults: (werte) => {
        spur.stored = werte;
        return Promise.resolve();
      },
      setFavourite: (art, kennung) => {
        spur.calls.push(`favorit ${art} ${kennung}`);
        return Promise.resolve();
      },
    },
    projekte: { list: () => Promise.resolve([]), remember: (ordner) => Promise.resolve(void spur.calls.push(`merke ${ordner}`)) },
    openrouter: { list: () => Promise.resolve({ openrouter: null, openrouterGrund: NOT_SET_UP }) },
    standardErlaubnis: () => Promise.resolve("auto"),
    linkGesperrt: null,
    einbinden: (art, kennung) => Promise.resolve({ ok: true, text: `${art} ${kennung}` }),
    ordnerPruefen: (ordner) => Promise.resolve(ordner),
    vergessen: () => {
      spur.calls.push("vergessen");
    },
    jetzt: () => 5,
    log: () => undefined,
    ...change,
  };
}

function spur(): Spur {
  return { created: [], sent: [], calls: [], stored: null };
}

describe("Optionsdienst", () => {
  it("sends the inventory with the favourites", async () => {
    const [answer] = await new Optionsdienst(teile(spur())).handle({ typ: "bestand_holen" });
    expect(answer).toEqual({ an: "geraet", nachricht: { typ: "bestand", skills: BESTAND.skills, plugins: BESTAND.plugins, konnektoren: BESTAND.konnektoren, bibliothek: BESTAND.bibliothek, favoriten: FIRST_FAVOURITES } });
  });

  it("offers fallback models and styles and first defaults taken from the settings", async () => {
    const [answer] = await new Optionsdienst(teile(spur())).handle({ typ: "optionen_holen" });
    expect(answer?.nachricht).toEqual({
      typ: "optionen",
      erlaubnis: ["default", "acceptEdits", "plan", "auto"],
      ausgabestile: FALLBACK_STYLES,
      modelle: { claude: FALLBACK_MODELS, openrouter: null, openrouterGrund: NOT_SET_UP },
      vorgaben: { modell: "default", aufwand: "auto", ordner: null, ausgabestil: null, erlaubnis: "auto", skills: [], plugins: ["a@m"], konnektoren: ["playwright"] },
      linkGesperrt: null,
    });
  });

  it("stores checked defaults and sends the options to every device", async () => {
    const trace = spur();
    const answers = await new Optionsdienst(teile(trace)).handle({ typ: "vorgaben", werte: VORGABEN });
    expect(trace.stored).toEqual(VORGABEN);
    expect(answers[0]?.an).toBe("alle");
  });

  it.each([
    ["an unknown model", { ...VORGABEN, modell: "gpt" }],
    ["an unknown style", { ...VORGABEN, ausgabestil: "Laut" }],
    ["an unknown skill", { ...VORGABEN, skills: ["fehlt"] }],
    ["an unknown plugin", { ...VORGABEN, plugins: ["c@m"] }],
    ["an unknown connector", { ...VORGABEN, konnektoren: ["github"] }],
    ["a connector that cannot be switched per session", { ...VORGABEN, konnektoren: ["claude.ai Gmail"] }],
  ])("refuses defaults with %s", async (_case, werte) => {
    await expect(new Optionsdienst(teile(spur())).handle({ typ: "vorgaben", werte })).rejects.toThrow(OptionsFehler);
  });

  it("remembers the folder of every running session before it lists the recent projects", async () => {
    const trace = spur();
    const sitzungen = { ...teile(trace).sitzungen, list: () => [
      { id: "s1", ordner: "/vault/a", claudeSitzung: null, prozess: "laeuft" as const, exitCode: null, hinweis: null, optionen: {} as GespeicherteOptionen },
      { id: "s2", ordner: "/vault/a", claudeSitzung: null, prozess: "laeuft" as const, exitCode: null, hinweis: null, optionen: {} as GespeicherteOptionen },
      { id: "s3", ordner: "/vault/b", claudeSitzung: null, prozess: "beendet" as const, exitCode: 0, hinweis: null, optionen: {} as GespeicherteOptionen },
    ] };
    const projekte = { list: () => Promise.resolve(void trace.calls.push("liste")).then(() => []), remember: (ordner: string) => Promise.resolve(void trace.calls.push(`merke ${ordner}`)) };
    const [answer] = await new Optionsdienst(teile(trace, { sitzungen, projekte })).handle({ typ: "projekte_holen" });
    expect(trace.calls).toEqual(["merke /vault/a", "liste"]);
    expect(answer).toEqual({ an: "geraet", nachricht: { typ: "projekte", liste: [] } });
  });

  it("still lists the recent projects when a running folder cannot be remembered", async () => {
    const projekte = { list: () => Promise.resolve([]), remember: () => Promise.reject(new Error("voll")) };
    const [answer] = await new Optionsdienst(teile(spur(), { projekte })).handle({ typ: "projekte_holen" });
    expect(answer?.nachricht).toEqual({ typ: "projekte", liste: [] });
  });

  it("starts a new session with the defaults, remembers its folder and sets the effort", async () => {
    const trace = { ...spur(), stored: VORGABEN };
    await new Optionsdienst(teile(trace)).handle({ typ: "neu", ordner: null });
    expect(trace.created).toEqual([{ folder: undefined, wahl: { skills: ["grill-me"], plugins: ["b@m"], konnektorenAus: ["playwright"], erlaubnis: "plan", ausgabestil: "Learning", modell: "haiku" } }]);
    expect(trace.calls).toContain("merke /vault");
    expect(trace.sent).toEqual([{ id: "neu-1", text: "/effort high" }]);
  });

  it("starts a session without choices when no defaults were stored", async () => {
    const trace = spur();
    await new Optionsdienst(teile(trace)).handle({ typ: "neu", ordner: "/vault/a" });
    expect(trace.created).toEqual([{ folder: "/vault/a", wahl: {} }]);
    expect(trace.sent).toEqual([]);
  });

  it("refuses OpenRouter when it is not set up", async () => {
    await expect(new Optionsdienst(teile(spur())).handle({ typ: "neu", ordner: null, anbieter: "openrouter", modell: "x/y" })).rejects.toThrow(NOT_SET_UP);
  });

  it("starts an OpenRouter session only with a listed model and never in fast mode", async () => {
    const trace = spur();
    const openrouter = { list: () => Promise.resolve({ openrouter: [{ id: "x/y", name: "Y", preisEinProMio: 1, preisAusProMio: 2, kontextFenster: null }], openrouterGrund: null }) };
    const dienst = new Optionsdienst(teile(trace, { openrouter }));
    await expect(dienst.handle({ typ: "neu", ordner: null, anbieter: "openrouter", modell: "x/z" })).rejects.toThrow(OptionsFehler);
    await dienst.handle({ typ: "neu", ordner: null, anbieter: "openrouter", modell: "x/y" });
    expect(trace.created[0]?.wahl).toEqual({ anbieter: "openrouter", modell: "x/y", schnell: false });
  });

  it("refuses an unknown subscription model", async () => {
    await expect(new Optionsdienst(teile(spur())).handle({ typ: "neu", ordner: null, modell: "gpt-5" })).rejects.toThrow("Unbekanntes Modell");
  });

  it("ticks known entries with the globally active plugins as base", async () => {
    const trace = spur();
    const dienst = new Optionsdienst(teile(trace));
    await dienst.handle({ typ: "haken", sitzung: "s1", art: "plugin", kennung: "b@m", an: true });
    await expect(dienst.handle({ typ: "haken", sitzung: "s1", art: "skill", kennung: "fehlt", an: true })).rejects.toThrow(OptionsFehler);
    expect(trace.calls).toEqual(["tick plugin b@m true a@m"]);
  });

  it("refuses a tick at a skill that is always active", async () => {
    await expect(new Optionsdienst(teile(spur())).handle({ typ: "haken", sitzung: "s1", art: "skill", kennung: "grill-me", an: false })).rejects.toThrow("immer aktiv");
  });

  it("starts a session even when the inventory or the list of projects fails", async () => {
    const trace = { ...spur(), stored: VORGABEN };
    const logged: string[] = [];
    const dienst = new Optionsdienst(
      teile(trace, {
        bestand: () => Promise.reject(new Error("kaputt")),
        projekte: { list: () => Promise.resolve([]), remember: () => Promise.reject(new Error("voll")) },
        log: (text) => logged.push(text),
      }),
    );
    await dienst.handle({ typ: "neu", ordner: null });
    expect(trace.created).toHaveLength(1);
    expect(logged).toEqual([expect.stringContaining("kaputt"), expect.stringContaining("voll")]);
  });

  it("refuses an unknown style for a session", async () => {
    await expect(new Optionsdienst(teile(spur())).handle({ typ: "sitzung_einstellung", sitzung: "s1", schluessel: "ausgabestil", wert: "Laut" })).rejects.toThrow("Unbekannter Ausgabestil");
  });

  it("names a locked permission mode of a check session", async () => {
    const dienst = new Optionsdienst(teile(spur(), { sitzungen: { ...teile(spur()).sitzungen, setSetting: () => Promise.resolve({ kind: "gesperrt" }) } }));
    await expect(dienst.handle({ typ: "sitzung_einstellung", sitzung: "s1", schluessel: "erlaubnis", wert: "auto" })).rejects.toThrow("Prüfsitzung");
  });

  it("names an unknown session on rename", async () => {
    await expect(new Optionsdienst(teile(spur())).handle({ typ: "sitzung_umbenennen", sitzung: "s9", titel: "x" })).rejects.toThrow("Unbekannte Sitzung.");
  });

  it("stores a favourite only for a known entry", async () => {
    const trace = spur();
    const dienst = new Optionsdienst(teile(trace));
    await dienst.handle({ typ: "favorit", art: "konnektor", kennung: "playwright", an: true });
    await expect(dienst.handle({ typ: "favorit", art: "plugin", kennung: "z@m", an: true })).rejects.toThrow(OptionsFehler);
    expect(trace.calls).toEqual(["favorit konnektor playwright"]);
  });

  it("takes a library skill in and forgets the cached inventory", async () => {
    const trace = spur();
    const answers = await new Optionsdienst(teile(trace)).handle({ typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "pdf", sitzung: null });
    expect(answers[0]?.nachricht).toEqual({ typ: "hinzugefuegt", art: "skill", weg: "bibliothek", ok: true, text: "skill pdf", einrichtung: null });
    expect(answers[1]?.an).toBe("alle");
    expect(trace.calls).toEqual(["vergessen"]);
  });

  it("refuses a library entry that is not offered and leaves connectors to Daniel", async () => {
    const dienst = new Optionsdienst(teile(spur()));
    expect((await dienst.handle({ typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "fehlt", sitzung: null }))[0]?.nachricht).toMatchObject({ ok: false });
    expect((await dienst.handle({ typ: "hinzufuegen", art: "konnektor", weg: "bibliothek", wert: "github", sitzung: null }))[0]?.nachricht).toMatchObject({
      ok: true,
      text: expect.stringContaining("selbst einrichten") as unknown,
      einrichtung: "## Wege\nKommandozeile gh",
    });
  });

  it("checks a link in an own new session in the folder of the active one, asking for every changing tool", async () => {
    const trace = spur();
    await new Optionsdienst(teile(trace)).handle({ typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://a.de/s", sitzung: "s1" });
    expect(trace.created).toEqual([{ folder: "/vault/projekt", wahl: { pruefung: true, erlaubnis: "default", anbieter: "abo", titel: CHECK_TITLE } }]);
    expect(trace.sent).toEqual([{ id: "neu-1", text: linkAssignment("skill", "https://a.de/s") }]);
    expect(trace.calls).toEqual([]);
  });

  it("refuses the link way while it is blocked", async () => {
    const trace = spur();
    const answers = await new Optionsdienst(teile(trace, { linkGesperrt: "nicht belegt" })).handle({ typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://a.de/s", sitzung: "s1" });
    expect(answers[0]?.nachricht).toMatchObject({ ok: false, text: "nicht belegt" });
    expect(trace.created).toEqual([]);
  });

  it("sends a wish to build to the session", async () => {
    const trace = spur();
    await new Optionsdienst(teile(trace)).handle({ typ: "hinzufuegen", art: "plugin", weg: "neu", wert: "Ein Plugin", sitzung: "s1" });
    expect(trace.sent).toEqual([{ id: "s1", text: buildAssignment("plugin", "Ein Plugin") }]);
  });
});

describe("assignments", () => {
  it("asks for the security check with skill-pruefung and a question with Einziehen and Verwerfen", () => {
    const text = linkAssignment("skill", "https://a.de/s");
    for (const part of ["https://a.de/s", "skill-pruefung", "AskUserQuestion", "„Einziehen“", "„Verwerfen“", "00_System/Skill_Bauplan.md"]) expect(text).toContain(part);
  });

  it("asks to build with skill-creator after the building plan", () => {
    const text = buildAssignment("skill", "Wunsch");
    for (const part of ["Wunsch", "skill-creator", "00_System/Skill_Bauplan.md"]) expect(text).toContain(part);
  });
});

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "einbinden-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function orte(run: (args: readonly string[]) => Promise<CommandResult> = () => Promise.resolve({ kind: "ok", stdout: "" })): Parameters<typeof installPlugin>[0] {
  return { claudeOrdner: path.join(root, "claude"), vault: path.join(root, "vault"), claudeBefehl: ["claude"], run: (_command, args) => run(args), jetzt: () => 42 };
}

describe("linkLibrarySkill", () => {
  it("links a library skill into the personal skills", async () => {
    const source = path.join(root, "vault", "10_Bibliothek", "11_Skills", "05_x", "pdf");
    await mkdir(source, { recursive: true });
    await mkdir(path.join(root, "claude", "skills"), { recursive: true });
    expect(await linkLibrarySkill(orte(), "pdf", source)).toEqual({ ok: true, text: "Skill pdf eingebunden." });
    expect((await lstat(path.join(root, "claude", "skills", "pdf"))).isSymbolicLink()).toBe(true);
    expect(path.resolve(await readlink(path.join(root, "claude", "skills", "pdf")))).toBe(source);
  });

  it("overwrites nothing", async () => {
    const source = path.join(root, "vault", "10_Bibliothek", "11_Skills", "pdf");
    await mkdir(source, { recursive: true });
    await mkdir(path.join(root, "claude", "skills", "pdf"), { recursive: true });
    expect((await linkLibrarySkill(orte(), "pdf", source)).ok).toBe(false);
  });

  it("refuses a source outside the library", async () => {
    await mkdir(path.join(root, "vault", "10_Bibliothek", "11_Skills"), { recursive: true });
    const outside = path.join(root, "draussen");
    await mkdir(outside, { recursive: true });
    expect((await linkLibrarySkill(orte(), "x", outside)).ok).toBe(false);
  });
});

describe("installPlugin", () => {
  const HOOKS = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }] } };

  async function settings(content: unknown): Promise<string> {
    const file = path.join(root, "claude", "settings.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(content));
    return file;
  }

  it("backs settings.json up, installs through the given command and keeps the protected hooks", async () => {
    const file = await settings(HOOKS);
    const calls: (readonly string[])[] = [];
    const result = await installPlugin(orte((args) => {
      calls.push(args);
      return Promise.resolve({ kind: "ok", stdout: "" });
    }), "a@m");
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["plugin", "install", "a@m"]]);
    expect(await readFile(path.join(root, "claude", `${BACKUP_PREFIX}42.bak`), "utf8")).toBe(await readFile(file, "utf8"));
  });

  it("restores settings.json when the protected hooks changed", async () => {
    const file = await settings(HOOKS);
    const result = await installPlugin(orte(async () => {
      await writeFile(file, JSON.stringify({ hooks: {} }));
      return { kind: "ok", stdout: "" };
    }), "a@m");
    expect(result.ok).toBe(false);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(HOOKS);
  });

  it("compares protected hooks with event and matcher", () => {
    const moved = { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }] } };
    const otherMatcher = { hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "rtk hook claude" }] }] } };
    expect(protectedEntries(moved)).not.toBe(protectedEntries(HOOKS));
    expect(protectedEntries(otherMatcher)).not.toBe(protectedEntries(HOOKS));
    expect(protectedEntries({ hooks: { ...HOOKS.hooks, Stop: [{ hooks: [{ type: "command", command: "anderes" }] }] } })).toBe(protectedEntries(HOOKS));
  });

  it("keeps only the five newest of its own backups", async () => {
    await settings(HOOKS);
    for (const stamp of [1, 2, 3, 4, 5, 6]) await writeFile(path.join(root, "claude", `${BACKUP_PREFIX}${String(stamp)}.bak`), "{}");
    await writeFile(path.join(root, "claude", "settings.json.kommandozentrale.bak"), "{}");
    await installPlugin(orte(), "a@m");
    const left = (await readdir(path.join(root, "claude"))).filter((name) => name.endsWith(".bak")).sort();
    expect(left).toEqual([`${BACKUP_PREFIX}3.bak`, `${BACKUP_PREFIX}4.bak`, `${BACKUP_PREFIX}42.bak`, `${BACKUP_PREFIX}5.bak`, `${BACKUP_PREFIX}6.bak`, "settings.json.kommandozentrale.bak"].sort());
  });

  it("names a failed install", async () => {
    await settings(HOOKS);
    expect(await installPlugin(orte(() => Promise.resolve({ kind: "fehler", grund: "ended with code 1" })), "a@m")).toEqual({ ok: false, text: "Plugin a@m nicht installiert (ended with code 1)." });
  });
});

import { describe, expect, it } from "vitest";
import type { Bestand, BestandSkill, Konnektor, Plugin } from "./bestand";
import {
  agentKarten, kostenfalle, fortschrittAnzeige, kaertchen, konnektorGruppen, kostenText, preisText, sammlungUmschalten, skillGruppen, vorgabenMitHaken, zuletztText,
  type Gruppe, type Zeile,
} from "./ordnung";
import type { Agent } from "./verbindung";

function skill(name: string, extra: Partial<BestandSkill> = {}): BestandSkill {
  return { kennung: name, name, beschreibung: `${name} tut etwas`, bereiche: ["Web"], sammlung: null, quelle: "persoenlich", immerAktiv: false, ...extra };
}

function plugin(name: string, extra: Partial<Plugin> = {}): Plugin {
  return { kennung: `${name}@markt`, name, marktplatz: "markt", beschreibung: `${name} bündelt`, bereiche: ["Web"], aktivGlobal: false, skills: [], ...extra };
}

function konnektor(name: string, extra: Partial<Konnektor> = {}): Konnektor {
  return { kennung: name, name, art: "mcp", bereiche: ["Software"], jeSitzungSchaltbar: true, ...extra };
}

const BESTAND: Bestand = {
  skills: [
    skill("caveman", { bereiche: ["Überall"], immerAktiv: true }),
    skill("grill-me", { bereiche: ["Planung"], immerAktiv: true }),
    skill("taste-skill"),
    skill("impeccable", { bereiche: [] }),
    skill("webdesign-kette:bewegung", { name: "bewegung", sammlung: "webdesign-kette", quelle: "plugin" }),
    skill("webdesign-kette:better-ui", { name: "better-ui", sammlung: "webdesign-kette", quelle: "plugin" }),
    skill("docx", { bereiche: ["Dokumente"] }),
  ],
  plugins: [plugin("webdesign-kette", { skills: ["bewegung", "better-ui"] }), plugin("supabase", { bereiche: ["Software", "Betrieb"], aktivGlobal: true }), plugin("caveman", { bereiche: [] })],
  konnektoren: [konnektor("playwright", { bereiche: ["Web"] }), konnektor("supabase"), konnektor("Gmail", { art: "claudeai", bereiche: [], jeSitzungSchaltbar: false })],
  bibliothek: { skills: [], plugins: [], konnektoren: [] },
  favoriten: { skills: ["taste-skill"], plugins: ["supabase@markt"], konnektoren: [] },
};

const AN = { skills: ["caveman", "grill-me", "webdesign-kette:bewegung"], plugins: ["supabase@markt"], konnektoren: ["playwright"] };

function namen(gruppen: readonly Gruppe[]): [string, string[]][] {
  return gruppen.map((gruppe) => [gruppe.titel, gruppe.zeilen.map((zeile) => (zeile.kind === "sammlung" ? `[${zeile.name}]` : zeile.name))]);
}

function zeile(gruppen: readonly Gruppe[], name: string): Zeile | undefined {
  return gruppen.flatMap((gruppe) => gruppe.zeilen).find((eintrag) => eintrag.name === name);
}

function sammlungIn(gruppen: readonly Gruppe[], name: string): Zeile | undefined {
  return gruppen.flatMap((gruppe) => gruppe.zeilen).find((eintrag) => eintrag.kind === "sammlung" && eintrag.name === name);
}

describe("skillGruppen", () => {
  it("shows favourites on top, then plugins, then skills, each by area in the order of the vault", () => {
    expect(namen(skillGruppen(BESTAND, AN, ""))).toEqual([
      ["Favoriten", ["supabase", "taste-skill"]],
      ["Plugins · Web", ["webdesign-kette"]],
      ["Plugins · ohne Bereich", ["caveman"]],
      ["Skills · Web", ["[webdesign-kette]"]],
      ["Skills · Dokumente", ["docx"]],
      ["Skills · Planung", ["grill-me"]],
      ["Skills · Überall", ["caveman"]],
      ["Skills · ohne Bereich", ["impeccable"]],
    ]);
  });

  it("marks what is ticked for the session and what is always active", () => {
    const gruppen = skillGruppen(BESTAND, AN, "");
    expect(zeile(gruppen, "grill-me")).toMatchObject({ kind: "eintrag", art: "skill", an: true, immer: true, schaltbar: false });
    expect(zeile(gruppen, "docx")).toMatchObject({ kind: "eintrag", an: false, immer: false, schaltbar: true });
    expect(zeile(gruppen, "supabase")).toMatchObject({ kind: "eintrag", art: "plugin", kennung: "supabase@markt", an: true, favorit: true });
  });

  it("folds the skills of a collection and knows when only some are ticked", () => {
    const sammlung = sammlungIn(skillGruppen(BESTAND, AN, ""), "webdesign-kette");
    expect(sammlung).toMatchObject({ kind: "sammlung", an: "teils" });
    expect(sammlung?.kind === "sammlung" && sammlung.mitglieder.map((mitglied) => [mitglied.name, mitglied.an])).toEqual([["bewegung", true], ["better-ui", false]]);
  });

  it("treats every skill as unticked without a session", () => {
    expect(zeile(skillGruppen(BESTAND, null, ""), "supabase")).toMatchObject({ an: false, schaltbar: false });
    expect(zeile(skillGruppen(BESTAND, null, ""), "grill-me")).toMatchObject({ an: true, immer: true });
  });

  it.each([
    ["  DOCX ", [["Skills · Dokumente", ["docx"]]]],
    ["bündelt", [["Favoriten", ["supabase"]], ["Plugins · Web", ["webdesign-kette"]], ["Plugins · ohne Bereich", ["caveman"]]]],
    ["better", [["Skills · Web", ["[webdesign-kette]"]]]],
    ["xyz", []],
  ])("finds %j in names and descriptions", (suche, erwartet) => {
    expect(namen(skillGruppen(BESTAND, AN, suche))).toEqual(erwartet);
  });

  it("keeps only the matching skills of a collection while searching", () => {
    const sammlung = sammlungIn(skillGruppen(BESTAND, AN, "better"), "webdesign-kette");
    expect(sammlung?.kind === "sammlung" && sammlung.mitglieder.map((mitglied) => mitglied.name)).toEqual(["better-ui"]);
  });
});

describe("konnektorGruppen", () => {
  it("orders connectors by area and marks those that cannot be switched per session", () => {
    const gruppen = konnektorGruppen({ ...BESTAND, favoriten: { ...BESTAND.favoriten, konnektoren: ["supabase"] } }, AN, "");
    expect(namen(gruppen)).toEqual([["Favoriten", ["supabase"]], ["Web", ["playwright"]], ["ohne Bereich", ["Gmail"]]]);
    expect(zeile(gruppen, "Gmail")).toMatchObject({ an: false, schaltbar: false, hinweis: "nicht je Sitzung schaltbar" });
    expect(zeile(gruppen, "playwright")).toMatchObject({ an: true, schaltbar: true });
  });
});

describe("sammlungUmschalten", () => {
  const sammlung = sammlungIn(skillGruppen(BESTAND, AN, ""), "webdesign-kette");

  it("ticks the missing skills of a partly ticked collection", () => {
    expect(sammlung?.kind === "sammlung" && sammlungUmschalten("s-1", sammlung)).toEqual([
      { typ: "haken", sitzung: "s-1", art: "skill", kennung: "webdesign-kette:better-ui", an: true },
    ]);
  });

  it("unticks every skill of a fully ticked collection", () => {
    const voll = sammlungIn(skillGruppen(BESTAND, { ...AN, skills: [...AN.skills, "webdesign-kette:better-ui"] }, ""), "webdesign-kette");
    expect(voll?.kind === "sammlung" && sammlungUmschalten("s-1", voll)).toEqual([
      { typ: "haken", sitzung: "s-1", art: "skill", kennung: "webdesign-kette:bewegung", an: false },
      { typ: "haken", sitzung: "s-1", art: "skill", kennung: "webdesign-kette:better-ui", an: false },
    ]);
  });
});

describe("kaertchen", () => {
  it("puts skills left and plugins and connectors right, always active ones without a cross", () => {
    expect(kaertchen({ ...AN, anbieter: "abo", schnell: false }, BESTAND)).toEqual({
      links: [
        { art: "skill", kennung: "caveman", text: "caveman", entfernbar: false },
        { art: "skill", kennung: "grill-me", text: "grill-me", entfernbar: false },
        { art: "skill", kennung: "webdesign-kette:bewegung", text: "bewegung", entfernbar: true },
      ],
      rechts: [
        { art: "plugin", kennung: "supabase@markt", text: "supabase", entfernbar: true },
        { art: "konnektor", kennung: "playwright", text: "playwright", entfernbar: true },
      ],
    });
  });

  it("names unknown entries by their id and marks OpenRouter and fast mode", () => {
    const karten = kaertchen({ skills: ["neu-skill"], plugins: ["x@y"], konnektoren: ["Gmail"], anbieter: "openrouter", schnell: true }, BESTAND);
    expect(karten.links).toEqual([{ art: "skill", kennung: "neu-skill", text: "neu-skill", entfernbar: true }]);
    expect(karten.rechts).toEqual([
      { art: "status", kennung: "openrouter", text: "OpenRouter", entfernbar: false },
      { art: "status", kennung: "schnell", text: "Schnellmodus", entfernbar: false },
      { art: "plugin", kennung: "x@y", text: "x", entfernbar: true },
      { art: "konnektor", kennung: "Gmail", text: "Gmail", entfernbar: false },
    ]);
  });

  it("names everything by its id while the inventory is not loaded", () => {
    expect(kaertchen({ ...AN, anbieter: "abo", schnell: false }, null).links.map((karte) => [karte.text, karte.entfernbar])).toEqual([
      ["caveman", true], ["grill-me", true], ["webdesign-kette:bewegung", true],
    ]);
  });
});

function agent(id: string, extra: Partial<Agent> = {}): Agent {
  return { id, eltern: "haupt", name: id, typ: "general-purpose", stand: "laeuft", werkzeug: null, aufrufe: 0, seit: 0, skills: [], fortschritt: null, ...extra };
}

describe("agentKarten", () => {
  const sitzung = { ...AN, anbieter: "abo" as const, schnell: true };

  it("shows a helper only the skills it loaded itself, none removable", () => {
    expect(agentKarten(agent("a", { skills: ["docx", "grill-me"] }), sitzung, BESTAND)).toEqual([
      { art: "skill", kennung: "docx", text: "docx", entfernbar: false },
      { art: "skill", kennung: "grill-me", text: "grill-me", entfernbar: false },
    ]);
  });

  it("gives the main session its chosen skills, then skills it loaded on top, then status, plugins and connectors", () => {
    const karten = agentKarten(agent("haupt", { eltern: null, skills: ["grill-me", "docx"] }), sitzung, BESTAND);
    expect(karten.map((karte) => [karte.art, karte.kennung, karte.entfernbar])).toEqual([
      ["skill", "caveman", false], ["skill", "grill-me", false], ["skill", "webdesign-kette:bewegung", true], ["skill", "docx", false],
      ["status", "schnell", false], ["plugin", "supabase@markt", true], ["konnektor", "playwright", true],
    ]);
  });

  it("shows nothing for a helper without skills", () => {
    expect(agentKarten(agent("a"), sitzung, BESTAND)).toEqual([]);
  });
});

describe("fortschrittAnzeige", () => {
  it.each([
    [agent("a", { fortschritt: { erledigt: 2, gesamt: 5 } }), { kind: "zahl", anteil: 0.4, text: "2 von 5" }],
    [agent("a", { fortschritt: { erledigt: 0, gesamt: 0 } }), { kind: "zahl", anteil: 0, text: "0 von 0" }],
    [agent("a", { stand: "fertig", fortschritt: { erledigt: 5, gesamt: 5 } }), { kind: "zahl", anteil: 1, text: "5 von 5" }],
    [agent("a"), { kind: "laufend" }],
    [agent("a", { stand: "wartet" }), { kind: "keiner" }],
    [agent("a", { stand: "fertig" }), { kind: "keiner" }],
  ])("shows the progress of %o as %o", (eintrag, erwartet) => {
    expect(fortschrittAnzeige(eintrag)).toEqual(erwartet);
  });
});

describe("zuletztText", () => {
  const jetzt = new Date(2026, 10, 19, 15, 30).getTime();

  it.each([
    [new Date(2026, 10, 19, 9, 5).getTime(), "heute 09:05"],
    [new Date(2026, 10, 18, 23, 59).getTime(), "gestern 23:59"],
    [new Date(2026, 10, 2, 8, 0).getTime(), "02.11. 08:00"],
  ])("names %i as %j", (zuletzt, text) => {
    expect(zuletztText(zuletzt, jetzt)).toBe(text);
  });
});

describe("kostenText and preisText", () => {
  it.each([[0.42, "≈ 0,42 US-$"], [0, "≈ 0,00 US-$"], [12.345, "≈ 12,35 US-$"]])("shows costs of %f as %j", (usd, text) => {
    expect(kostenText(usd)).toBe(text);
  });

  it.each([[3, 15, "3 / 15 US-$ je Mio. Tokens"], [0.075, 0.3, "0,075 / 0,3 US-$ je Mio. Tokens"]])("shows prices %f and %f", (ein, aus, text) => {
    expect(preisText(ein, aus)).toBe(text);
  });
});

describe("connectors still unknown before the session started", () => {
  it("ticks no connector and says so", () => {
    const gruppen = konnektorGruppen(BESTAND, { ...AN, konnektoren: null }, "");
    expect(zeile(gruppen, "playwright")).toMatchObject({ an: false, schaltbar: false, hinweis: "noch unbekannt" });
  });

  it("shows no connector chips", () => {
    expect(kaertchen({ ...AN, konnektoren: null, anbieter: "abo", schnell: false }, BESTAND).rechts.map((karte) => karte.art)).toEqual(["plugin"]);
  });
});

describe("vorgabenMitHaken", () => {
  it("leaves out connectors that cannot be switched per session", () => {
    const vorgaben = { modell: "opus", aufwand: "high", ordner: null, ausgabestil: null, erlaubnis: "auto", skills: [], plugins: [], konnektoren: [] } as const;
    expect(vorgabenMitHaken(vorgaben, { ...AN, konnektoren: ["playwright", "Gmail"] }, BESTAND).konnektoren).toEqual(["playwright"]);
  });

  it("takes no connectors while they are still unknown", () => {
    const vorgaben = { modell: "opus", aufwand: "high", ordner: null, ausgabestil: null, erlaubnis: "auto", skills: [], plugins: [], konnektoren: ["supabase"] } as const;
    expect(vorgabenMitHaken(vorgaben, { ...AN, konnektoren: null }, BESTAND).konnektoren).toEqual(["supabase"]);
  });

  it("takes the ticks of the session without the always active skills", () => {
    const vorgaben = { modell: "opus", aufwand: "high", ordner: null, ausgabestil: null, erlaubnis: "auto", skills: [], plugins: [], konnektoren: [] } as const;
    expect(vorgabenMitHaken(vorgaben, AN, BESTAND)).toEqual({ ...vorgaben, skills: ["webdesign-kette:bewegung"], plugins: ["supabase@markt"], konnektoren: ["playwright"] });
  });
});

describe("kostenfalle", () => {
  it.each([["haiku", "plan", true], ["opusplan", "plan", true], ["opusplan[1m]", "plan", true], ["haiku[1m]", "plan", true], ["opus[1m]", "plan", false], [" Haiku ", "plan", true], ["haiku", "auto", false], ["claude-haiku-4-5", "plan", false], ["opus", "plan", false], [null, "plan", false]] as const)(
    "warns for model %j in mode %s: %s",
    (modell, erlaubnis, warnt) => {
      expect(kostenfalle(modell, erlaubnis)).toBe(warnt);
    },
  );
});

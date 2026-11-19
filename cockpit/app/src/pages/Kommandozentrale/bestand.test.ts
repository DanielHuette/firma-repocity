import { describe, expect, it } from "vitest";
import {
  BEREICHE, LAENGSTER_LINK, bauauftragLesen, LAENGSTER_TITEL, LAENGSTER_BAUAUFTRAG, favorit, haken, hinzufuegen, istBestandTyp, leseBestandNachricht, linkLesen, neueSitzungMit,
  sitzungEinstellung, titelLesen, umbenennen, vorgabenSetzen, type Vorgaben,
} from "./bestand";

const SKILL = { kennung: "grill-me", name: "grill-me", beschreibung: "Befragt Daniel", bereiche: ["Planung"], sammlung: null, quelle: "skillbase", immerAktiv: true };
const PLUGIN_SKILL = { kennung: "webdesign-kette:bewegung", name: "bewegung", beschreibung: "Animation", bereiche: ["Web"], sammlung: "webdesign-kette", quelle: "plugin", immerAktiv: false };
const PLUGIN = { kennung: "webdesign-kette@repocity-mods", name: "webdesign-kette", marktplatz: "repocity-mods", beschreibung: "Webseiten", bereiche: ["Web"], aktivGlobal: false, skills: ["bewegung"] };
const KONNEKTOR = { kennung: "playwright", name: "playwright", art: "mcp", bereiche: ["Web", "Software"], jeSitzungSchaltbar: true };
const ANGEBOT = { kennung: "domain-checker", name: "domain-checker", beschreibung: "Domains prüfen", bereiche: ["Web"], braeuchteGeheimnis: false };
const BESTAND = {
  typ: "bestand", skills: [SKILL, PLUGIN_SKILL], plugins: [PLUGIN], konnektoren: [KONNEKTOR],
  bibliothek: { skills: [ANGEBOT], plugins: [], konnektoren: [{ ...ANGEBOT, kennung: "supabase", name: "supabase", braeuchteGeheimnis: true }] },
  favoriten: { skills: ["grill-me"], plugins: [], konnektoren: [] },
};
const VORGABEN: Vorgaben = { modell: "opus", aufwand: "high", ordner: null, ausgabestil: null, erlaubnis: "auto", skills: ["caveman"], plugins: [], konnektoren: [] };
const OPTIONEN = {
  typ: "optionen", erlaubnis: ["default", "acceptEdits", "plan", "auto"], ausgabestile: ["default", "Explanatory"],
  modelle: { claude: [{ wert: "opus", text: "Opus" }], openrouter: [{ id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet", preisEinProMio: 3, preisAusProMio: 15, kontextFenster: 1_000_000 }], openrouterGrund: null },
  vorgaben: VORGABEN,
  linkGesperrt: null,
};
const PROJEKT = { ordner: "/srv/vault/20_Firma_RepoCity/22_Cockpit", name: "22_Cockpit", zuletzt: 1_700_000_000_000, status: { phasen: [{ phase: "geplant", status: "fertig", datum: "2026-11-18" }], letzteEntscheidung: "Plan freigegeben" } };

const lesen = (wert: Record<string, unknown>) => leseBestandNachricht(wert);

describe("istBestandTyp", () => {
  it.each(["bestand", "optionen", "projekte", "hinzugefuegt"])("knows %s", (typ) => {
    expect(istBestandTyp(typ)).toBe(true);
  });

  it.each(["skills", "zustand", 3])("does not take %j", (typ) => {
    expect(istBestandTyp(typ)).toBe(false);
  });
});

describe("leseBestandNachricht", () => {
  it("reads the full inventory with library and favourites", () => {
    expect(lesen(BESTAND)).toEqual(BESTAND);
  });

  it("reads options with Claude models and an OpenRouter list", () => {
    expect(lesen(OPTIONEN)).toEqual(OPTIONEN);
  });

  it("reads options whose OpenRouter list is missing with its reason", () => {
    const ohne = { ...OPTIONEN, modelle: { claude: [], openrouter: null, openrouterGrund: "nicht eingerichtet" } };
    expect(lesen(ohne)).toEqual(ohne);
  });

  it("reads options whose link way is locked with its reason", () => {
    const gesperrt = { ...OPTIONEN, linkGesperrt: "Prüfsitzung noch nicht belegt" };
    expect(lesen(gesperrt)).toEqual(gesperrt);
  });

  it("reads the setup text of a connector from the library", () => {
    const antwort = { typ: "hinzugefuegt", art: "konnektor", weg: "bibliothek", ok: true, text: "lexware braucht einen Schlüssel", einrichtung: "1. Schlüssel bei Lexware anlegen" };
    expect(lesen(antwort)).toEqual(antwort);
  });

  it("reads recent projects with and without status", () => {
    const projekte = { typ: "projekte", liste: [PROJEKT, { ...PROJEKT, ordner: "/srv/vault", name: "vault", status: null }] };
    expect(lesen(projekte)).toEqual(projekte);
  });

  it("reads the answer to an addition", () => {
    const antwort = { typ: "hinzugefuegt", art: "skill", weg: "bibliothek", ok: true, text: "domain-checker eingebunden", einrichtung: null };
    expect(lesen(antwort)).toEqual(antwort);
  });

  it("names the twelve areas of the vault in a fixed order", () => {
    expect(BEREICHE).toEqual(["Web", "Software", "Agenten", "Dokumente", "Zahlen", "Kunden", "Recherche", "Medien", "Betrieb", "Planung", "Überall", "ohne Bereich"]);
  });

  it.each([
    ["a skill of an unknown area", { ...BESTAND, skills: [{ ...SKILL, bereiche: ["Garten"] }] }],
    ["a skill from an unknown source", { ...BESTAND, skills: [{ ...SKILL, quelle: "netz" }] }],
    ["a skill whose always flag is text", { ...BESTAND, skills: [{ ...SKILL, immerAktiv: "ja" }] }],
    ["a skill whose collection is missing", { ...BESTAND, skills: [{ ...SKILL, sammlung: undefined }] }],
    ["a plugin without skills", { ...BESTAND, plugins: [{ ...PLUGIN, skills: undefined }] }],
    ["a connector of an unknown kind", { ...BESTAND, konnektoren: [{ ...KONNEKTOR, art: "telefon" }] }],
    ["an offer without secret flag", { ...BESTAND, bibliothek: { ...BESTAND.bibliothek, skills: [{ ...ANGEBOT, braeuchteGeheimnis: undefined }] } }],
    ["favourites without connectors", { ...BESTAND, favoriten: { skills: [], plugins: [] } }],
    ["an unknown permission mode", { ...OPTIONEN, erlaubnis: ["bypassPermissions"] }],
    ["a price that is text", { ...OPTIONEN, modelle: { ...OPTIONEN.modelle, openrouter: [{ id: "x", name: "x", preisEinProMio: "3", preisAusProMio: 15, kontextFenster: null }] } }],
    ["defaults with an unknown permission mode", { ...OPTIONEN, vorgaben: { ...VORGABEN, erlaubnis: "dontAsk" } }],
    ["defaults without connectors", { ...OPTIONEN, vorgaben: { ...VORGABEN, konnektoren: undefined } }],
    ["a project whose time is text", { typ: "projekte", liste: [{ ...PROJEKT, zuletzt: "gestern" }] }],
    ["a project status without phases", { typ: "projekte", liste: [{ ...PROJEKT, status: { letzteEntscheidung: null } }] }],
    ["an addition of an unknown way", { typ: "hinzugefuegt", art: "skill", weg: "post", ok: true, text: "", einrichtung: null }],
    ["an addition without setup field", { typ: "hinzugefuegt", art: "skill", weg: "link", ok: true, text: "" }],
    ["options without the link lock", { ...OPTIONEN, linkGesperrt: undefined }],
  ])("refuses %s", (_name, wert) => {
    expect(lesen(wert)).toBeUndefined();
  });
});

describe("titelLesen", () => {
  it.each([[" Bauteil 1d ", "Bauteil 1d"], ["x", "x"], ["x".repeat(LAENGSTER_TITEL), "x".repeat(60)]])("takes %j as %j", (text, titel) => {
    expect(titelLesen(text)).toEqual({ kind: "ok", titel });
  });

  it.each([["", "leer"], ["   ", "leer"], ["x".repeat(61), "zu_lang"], ["a\u0007b", "zeichen"], ["a​b", "zeichen"]] as const)("refuses %j as %s", (text, grund) => {
    expect(titelLesen(text)).toMatchObject({ kind: "fehler", grund });
  });
});

describe("linkLesen", () => {
  it.each([["https://github.com/a/b", "https://github.com/a/b"], ["  https://x.de/skill  ", "https://x.de/skill"]])("takes %j", (text, link) => {
    expect(linkLesen(text)).toEqual({ kind: "ok", link });
  });

  it("allows 500 signs and refuses 501", () => {
    const basis = "https://x.de/";
    expect(LAENGSTER_LINK).toBe(500);
    expect(linkLesen(basis + "a".repeat(500 - basis.length)).kind).toBe("ok");
    expect(linkLesen(basis + "a".repeat(501 - basis.length)).kind).toBe("fehler");
  });

  it.each(["http://x.de/skill", "ftp://x.de", "github.com/a/b", "https://", "javascript:alert(1)", "https://x.de/a\u0007b", "https://x.de/a b"])("refuses %j", (text) => {
    expect(linkLesen(text).kind).toBe("fehler");
  });
});

describe("messages to the bridge", () => {
  it("renames a session", () => {
    expect(umbenennen("s-1", "Bauteil 1d")).toEqual({ typ: "sitzung_umbenennen", sitzung: "s-1", titel: "Bauteil 1d" });
  });

  it.each([["skill", "grill-me", true], ["plugin", "webdesign-kette@repocity-mods", false], ["konnektor", "playwright", true]] as const)(
    "ticks %s %s to %s for one session",
    (art, kennung, an) => {
      expect(haken("s-1", art, kennung, an)).toEqual({ typ: "haken", sitzung: "s-1", art, kennung, an });
    },
  );

  it("marks a favourite", () => {
    expect(favorit("konnektor", "playwright", true)).toEqual({ typ: "favorit", art: "konnektor", kennung: "playwright", an: true });
  });

  it.each([["erlaubnis", "plan"], ["ausgabestil", "Explanatory"], ["schnell", true]] as const)("sets %s of a session to %j", (schluessel, wert) => {
    expect(sitzungEinstellung("s-1", schluessel, wert)).toEqual({ typ: "sitzung_einstellung", sitzung: "s-1", schluessel, wert });
  });

  it("saves the defaults of new sessions", () => {
    expect(vorgabenSetzen(VORGABEN)).toEqual({ typ: "vorgaben", werte: VORGABEN });
  });

  it("starts an OpenRouter session with the chosen model in the given folder", () => {
    expect(neueSitzungMit(" /srv/vault ", "openrouter", "anthropic/claude-sonnet-4.5")).toEqual({ typ: "neu", ordner: "/srv/vault", anbieter: "openrouter", modell: "anthropic/claude-sonnet-4.5" });
  });

  it("starts an OpenRouter session in the vault without folder", () => {
    expect(neueSitzungMit("", "openrouter", "x/y")).toEqual({ typ: "neu", ordner: null, anbieter: "openrouter", modell: "x/y" });
  });

  it.each([["skill", "bibliothek", "domain-checker", null], ["plugin", "link", "https://x.de/p", "s-1"], ["konnektor", "neu", "Konnektor für Lexware", "s-2"]] as const)(
    "adds a %s by %s for session %s",
    (art, weg, wert, sitzung) => {
      expect(hinzufuegen(art, weg, wert, sitzung)).toEqual({ typ: "hinzufuegen", art, weg, wert, sitzung });
    },
  );
});

describe("bauauftragLesen", () => {
  it.each([[" Skill für Rechnungen ", "Skill für Rechnungen"], ["Zeile 1\nZeile 2", "Zeile 1\nZeile 2"]])("takes %j", (text, auftrag) => {
    expect(bauauftragLesen(text)).toEqual({ kind: "ok", auftrag });
  });

  it("allows 2000 signs and refuses 2001", () => {
    expect(LAENGSTER_BAUAUFTRAG).toBe(2000);
    expect(bauauftragLesen("x".repeat(2000)).kind).toBe("ok");
    expect(bauauftragLesen("x".repeat(2001)).kind).toBe("fehler");
  });

  it.each(["", "   ", "a\u0007b", "a​b"])("refuses %j", (text) => {
    expect(bauauftragLesen(text).kind).toBe("fehler");
  });
});

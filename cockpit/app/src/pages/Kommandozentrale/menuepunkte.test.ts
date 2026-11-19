import { describe, expect, it } from "vitest";
import {
  AUFWAND_STUFEN, LAENGSTE_SUCHE, SCHWELLE_HOECHSTENS, SCHWELLE_MINDESTENS, aufwandSetzen, bisVolleMinute, keineDaten, modellSetzen, naechsterReiter,
  ordnerFiltern, schwelleLesen, startzeiten, suchAnfrage,
} from "./menuepunkte";
import type { Hinweis, SitzungsZustand } from "./verbindung";

function sitzungMit(hinweise: Hinweis[]): SitzungsZustand {
  return {
    id: "s-1", ordner: "/srv/vault", titel: "vault", claudeSitzung: null, stand: "ruht", modell: null, kontextProzent: null, kontextVeraltet: false,
    agenten: [], wartet: [], hinweise, prozess: "laeuft", hinweis: null, aufwand: null,
    skills: [], plugins: [], konnektoren: [], erlaubnis: "default", ausgabestil: null, schnell: false, anbieter: "abo", kostenUsd: null, neustartAusstehend: false, erlaubnisBestaetigt: true, modellWahl: null, pausiert: false, pruefung: false,
  };
}

describe("aufwandSetzen", () => {
  it("offers the effort levels of the current Claude Code documentation and auto", () => {
    expect(AUFWAND_STUFEN.map((stufe) => stufe.wert)).toEqual(["low", "medium", "high", "xhigh", "max", "auto"]);
  });

  it.each(["low", "medium", "high", "xhigh", "max", "auto"])("sends /effort %s as a chat message", (stufe) => {
    expect(aufwandSetzen("s-1", stufe)).toEqual({ typ: "nachricht", sitzung: "s-1", text: `/effort ${stufe}` });
  });
});

describe("modellSetzen", () => {
  it.each(["opus", "sonnet", "haiku"])("sends /model %s as a chat message", (modell) => {
    expect(modellSetzen("s-1", modell)).toEqual({ typ: "nachricht", sitzung: "s-1", text: `/model ${modell}` });
  });
});

describe("schwelleLesen", () => {
  it("allows 10.000 to 1.000.000 tokens", () => {
    expect([SCHWELLE_MINDESTENS, SCHWELLE_HOECHSTENS]).toEqual([10_000, 1_000_000]);
  });

  it.each([
    ["10000", 10_000], ["10.000", 10_000], ["200 000", 200_000], [" 1.000.000 ", 1_000_000], ["999999", 999_999],
  ])("reads %j as %i", (text, wert) => {
    expect(schwelleLesen(text)).toEqual({ kind: "ok", wert });
  });

  it.each(["9999", "9.999", "1000001", "1.000.001"])("refuses %j outside the range", (text) => {
    expect(schwelleLesen(text)).toEqual({ kind: "fehler", text: "Erlaubt sind 10.000 bis 1.000.000 Tokens." });
  });

  it.each(["", "abc", "12,5", "1e5", "-20000", "20.000.0", "20000x"])("refuses %j as no whole number", (text) => {
    expect(schwelleLesen(text)).toEqual({ kind: "fehler", text: "Bitte eine ganze Zahl eingeben, etwa 200.000." });
  });
});

describe("suchAnfrage", () => {
  it.each([["", { kind: "leer" }], ["   ", { kind: "leer" }], [" leinwand ", { kind: "ok", nachricht: { typ: "suche", text: "leinwand" } }]])("reads %j", (text, ergebnis) => {
    expect(suchAnfrage(text)).toEqual(ergebnis);
  });

  it("allows 200 signs and refuses 201", () => {
    expect(LAENGSTE_SUCHE).toBe(200);
    expect(suchAnfrage("x".repeat(200)).kind).toBe("ok");
    expect(suchAnfrage("x".repeat(201))).toEqual({ kind: "fehler", text: "Höchstens 200 Zeichen." });
  });

  it.each(["a\u0007b", "a​b", "a\nb"])("refuses control or invisible signs in %j", (text) => {
    expect(suchAnfrage(text)).toEqual({ kind: "fehler", text: "Steuer- und unsichtbare Zeichen sind nicht erlaubt." });
  });
});

describe("ordnerFiltern", () => {
  const ORDNER = [
    { pfad: "/srv/vault/20_Firma_RepoCity", name: "20_Firma_RepoCity" },
    { pfad: "/srv/vault/30_Privat/webseite_katja", name: "webseite_katja" },
  ];

  it.each([["", 2], ["privat", 1], ["  KATJA ", 1], ["xyz", 0]])("finds %j in names and paths", (suche, anzahl) => {
    expect(ordnerFiltern(ORDNER, suche)).toHaveLength(anzahl);
  });
});

describe("naechsterReiter", () => {
  const IDS = ["a", "b", "c"];

  it.each([
    ["a", "ArrowRight", "b"], ["c", "ArrowRight", "a"], ["a", "ArrowLeft", "c"], ["b", "ArrowLeft", "a"],
    ["b", "Home", "a"], ["b", "End", "c"], ["b", "Enter", null], [null, "ArrowRight", "a"],
  ] as const)("moves from %s with %s to %s", (aktiv, taste, ziel) => {
    expect(naechsterReiter(IDS, aktiv, taste)).toBe(ziel);
  });

  it("has no target without tabs", () => {
    expect(naechsterReiter([], null, "ArrowRight")).toBeNull();
  });
});

describe("bisVolleMinute", () => {
  it.each([[0, 60_000], [1, 59_999], [59_999, 1], [60_000, 60_000], [125_500, 54_500]])("waits from %i ms for %i ms", (jetzt, warten) => {
    expect(bisVolleMinute(jetzt)).toBe(warten);
  });
});

describe("startzeiten", () => {
  it("takes the bridge start of agents already running in the first state after connecting", () => {
    expect(startzeiten(new Map(), [{ id: "a", seit: 1000 }], 9000, true)).toEqual(new Map([["a", 1000]]));
  });

  it("takes the arrival of the state for agents that appear later and keeps known ones", () => {
    const alt = new Map([["a", 1000]]);
    expect(startzeiten(alt, [{ id: "a", seit: 5 }, { id: "b", seit: 999_999 }], 9000, false)).toEqual(new Map([["a", 1000], ["b", 9000]]));
  });

  it("forgets agents that are gone", () => {
    expect(startzeiten(new Map([["a", 1000]]), [], 9000, false)).toEqual(new Map());
  });
});

describe("keineDaten", () => {
  it.each(["kontext", "agenten", "fragen"] as const)("finds the marker for %s", (bereich) => {
    expect(keineDaten(sitzungMit([{ art: "keine_daten", anzeige: bereich }]), bereich)).toBe(true);
  });

  it("does not mix up the areas", () => {
    expect(keineDaten(sitzungMit([{ art: "keine_daten", anzeige: "agenten" }]), "kontext")).toBe(false);
  });

  it("ignores hints of other kinds and a missing session", () => {
    expect(keineDaten(sitzungMit([{ art: "verdichten", anzeige: "kontext" }]), "kontext")).toBe(false);
    expect(keineDaten(null, "kontext")).toBe(false);
  });
});

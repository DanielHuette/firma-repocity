import { describe, expect, it } from "vitest";
import type { Eintrag } from "./chat";
import { modellVorschlag, neueAufgabe, passtSchon, zeigeVorschlag } from "./vorschlag";

function eintrag(art: Eintrag["art"], text: string): Eintrag {
  return { id: `${art}-${text}`, art, zeit: 1, text, eltern: null, werkzeug: null, agent: null, frage: null, plan: null };
}

const du = (text: string): Eintrag => eintrag("du", text);
const claude = (text: string): Eintrag => eintrag("claude", text);

describe("modellVorschlag", () => {
  it.each([
    ["Migration der Datenbank auf Postgres", "fable", "low"],
    ["Bau das ganze Projekt neu auf", "fable", "low"],
    ["Opus ist gescheitert, versuch es noch mal", "fable", "low"],
    ["Erstelle einen Plan für den Linux-Server", "opus", "high"],
    ["Entwirf die Architektur der Brücke", "opus", "high"],
    ["Prüfe den Code auf Sicherheit", "opus", "high"],
    ["Mach ein Review der Änderungen", "opus", "high"],
    ["Such den Fehler im Login", "opus", "medium"],
    ["Refactor the session store", "opus", "medium"],
    ["Recherchiere die Preise von OpenRouter", "opus", "medium"],
    ["Arbeite selbständig am Login weiter", "opus", "medium"],
    ["Lass den Agenten unbeaufsichtigt laufen", "opus", "medium"],
    ["Implementiere die Funktion laut Vorgabe", "sonnet", "high"],
    ["Schreib Tests für den Parser", "sonnet", "high"],
    ["Umbenennen der Klasse in allen Dateien", "sonnet", "high"],
    ["Schreib einen LinkedIn-Beitrag", "sonnet", "high"],
    ["Fass die Datei zusammen", "sonnet", "medium"],
    ["Zusammenfassung des Gesprächs", "sonnet", "medium"],
    ["Übersetze das ins Englische", "sonnet", "medium"],
    ["Schreib eine Commit-Nachricht", "sonnet", "medium"],
    ["Hallo, was geht?", "opus", "medium"],
  ])("suggests for %j %s at %s", (text, modell, aufwand) => {
    expect(modellVorschlag(text)).toMatchObject({ modell, aufwand });
  });

  it("names model, effort and reason for the card", () => {
    expect(modellVorschlag("Plan bitte")).toEqual({ modell: "opus", aufwand: "high", anzeige: "Opus 5.5 · high", grund: "Planen oder Prüfen" });
    expect(modellVorschlag("Migration")).toMatchObject({ anzeige: "Fable 5.2 · low" });
    expect(modellVorschlag("Tests")).toMatchObject({ anzeige: "Sonnet 5.5 · high" });
  });

  it("takes the first matching rule when several fit", () => {
    expect(modellVorschlag("Plan für die Migration")).toMatchObject({ modell: "fable" });
    expect(modellVorschlag("Prüfe die Tests")).toMatchObject({ modell: "opus", aufwand: "high" });
  });

  it("does not take words that only contain a key inside another word", () => {
    expect(modellVorschlag("Testlauf starten")).toMatchObject({ modell: "opus", aufwand: "medium", grund: "keine klare Zuordnung" });
  });
});

describe("neueAufgabe", () => {
  it.each([
    ["no message yet", [], true],
    ["only answers of Claude", [claude("hallo")], true],
    ["the last own message was /clear", [du("Plan"), claude("ok"), du("  /CLEAR ")], true],
    ["an own message after /clear", [du("/clear"), du("Plan")], false],
    ["an ongoing task", [du("Plan"), claude("ok")], false],
  ] as const)("is %s → %s", (_case, eintraege, erwartet) => {
    expect(neueAufgabe(eintraege)).toBe(erwartet);
  });
});

describe("passtSchon", () => {
  const vorschlag = modellVorschlag("Plan");

  it.each([
    ["claude-opus-5-5", "high", true],
    ["Opus 5.5", "high", true],
    ["claude-opus-5-5", "medium", false],
    ["claude-sonnet-5-5", "high", false],
    [null, "high", false],
    ["claude-opus-5-5", null, false],
  ] as const)("model %j with effort %j fits: %s", (modell, aufwand, erwartet) => {
    expect(passtSchon(vorschlag, modell, aufwand)).toBe(erwartet);
  });
});

describe("zeigeVorschlag", () => {
  it("suggests for the first message of a task when the model does not fit", () => {
    expect(zeigeVorschlag("Erstelle einen Plan", [], "claude-sonnet-5-5", "medium")).toMatchObject({ modell: "opus", aufwand: "high" });
  });

  it.each([
    ["an empty draft", "   ", [], "claude-sonnet-5-5", "medium"],
    ["a command", "/model opus", [], "claude-sonnet-5-5", "medium"],
    ["a running task", "Erstelle einen Plan", [du("Hallo")], "claude-sonnet-5-5", "medium"],
    ["a fitting model", "Erstelle einen Plan", [], "claude-opus-5-5", "high"],
  ] as const)("stays quiet for %s", (_case, entwurf, eintraege, modell, aufwand) => {
    expect(zeigeVorschlag(entwurf, eintraege, modell, aufwand)).toBeNull();
  });
});

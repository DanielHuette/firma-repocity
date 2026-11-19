import { describe, expect, it } from "vitest";
import { LONGEST_MESSAGE, parseClientMessage } from "../src/nachrichten.ts";

const DEVICE = "geraet-0123456789abcdef";
const SESSION = "11111111-2222-4333-8444-555555555555";

function text(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseClientMessage", () => {
  it.each([
    ["hallo", { typ: "hallo", geraet: DEVICE, name: "PC", modus: "arbeiten" }],
    ["hallo to watch", { typ: "hallo", geraet: DEVICE, name: "PC", modus: "zusehen" }],
    ["nachricht with several lines", { typ: "nachricht", sitzung: SESSION, text: "äöü\nzweite Zeile" }],
    ["nachricht of one sign", { typ: "nachricht", sitzung: SESSION, text: "x" }],
    ["nachricht of 100000 signs", { typ: "nachricht", sitzung: SESSION, text: "x".repeat(LONGEST_MESSAGE) }],
    ["abbrechen", { typ: "abbrechen", sitzung: SESSION }],
    ["frage_antwort", { typ: "frage_antwort", sitzung: SESSION, eintrag: "toolu_1", antworten: { "Rot?": "Ja", "Teile?": ["A", "B"] } }],
    ["plan_antwort ja", { typ: "plan_antwort", sitzung: SESSION, eintrag: "toolu_2", entscheidung: "ja" }],
    ["plan_antwort nein", { typ: "plan_antwort", sitzung: SESSION, eintrag: "toolu_2", entscheidung: "nein" }],
    ["antwort ja", { typ: "antwort", frage: "frage-1", entscheidung: "ja" }],
    ["antwort nein", { typ: "antwort", frage: "frage-1", entscheidung: "nein" }],
    ["antwort immer", { typ: "antwort", frage: "frage-1", entscheidung: "immer" }],
    ["neu with folder", { typ: "neu", ordner: "/srv/vault/projekt" }],
    ["beenden", { typ: "beenden", sitzung: SESSION }],
    ["fortsetzen", { typ: "fortsetzen", sitzung: SESSION }],
    ["uebernehmen", { typ: "uebernehmen" }],
  ])("reads %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it("reads neu without folder as the default folder", () => {
    expect(parseClientMessage(text({ typ: "neu" }))).toEqual({ typ: "neu", ordner: null });
  });

  it("reads neu with a null folder as the default folder", () => {
    expect(parseClientMessage(text({ typ: "neu", ordner: null }))).toEqual({ typ: "neu", ordner: null });
  });

  it.each([
    ["no JSON", "{kaputt"],
    ["a list", "[]"],
    ["null", "null"],
    ["a text", '"hallo"'],
    ["an unknown type", text({ typ: "loeschen", sitzung: SESSION })],
    ["a missing type", text({ sitzung: SESSION, daten: "x" })],
    ["an extra field", text({ typ: "uebernehmen", geraet: DEVICE })],
    ["a missing field", text({ typ: "nachricht", sitzung: SESSION })],
    ["a message that is no text", text({ typ: "nachricht", sitzung: SESSION, text: 5 })],
    ["an empty message", text({ typ: "nachricht", sitzung: SESSION, text: "" })],
    ["a message of 100001 signs", text({ typ: "nachricht", sitzung: SESSION, text: "x".repeat(LONGEST_MESSAGE + 1) })],
    ["an empty session", text({ typ: "nachricht", sitzung: "", text: "x" })],
    ["the old input of the terminal", text({ typ: "eingabe", sitzung: SESSION, daten: "x" })],
    ["the old terminal size", text({ typ: "groesse", sitzung: SESSION, spalten: 80, zeilen: 24 })],
    ["answers that are no object", text({ typ: "frage_antwort", sitzung: SESSION, eintrag: "toolu_1", antworten: ["Ja"] })],
    ["a question answer without entry", text({ typ: "frage_antwort", sitzung: SESSION, eintrag: "", antworten: {} })],
    ["an unknown plan decision", text({ typ: "plan_antwort", sitzung: SESSION, eintrag: "toolu_2", entscheidung: "vielleicht" })],
    ["abbrechen without session", text({ typ: "abbrechen" })],
    ["fortsetzen without session", text({ typ: "fortsetzen" })],
    ["fortsetzen with an empty session", text({ typ: "fortsetzen", sitzung: "" })],
    ["fortsetzen with a session of 129 characters", text({ typ: "fortsetzen", sitzung: "a".repeat(129) })],
    ["fortsetzen with an extra field", text({ typ: "fortsetzen", sitzung: SESSION, modell: "x" })],
    ["a session of 129 characters", text({ typ: "beenden", sitzung: "a".repeat(129) })],
    ["an unknown decision", text({ typ: "antwort", frage: "frage-1", entscheidung: "vielleicht" })],
    ["a folder that is no text", text({ typ: "neu", ordner: 5 })],
    ["an inherited field", '{"typ":"uebernehmen","__proto__":{"x":1}}'],
  ])("rejects %s", (_case, message) => {
    expect(parseClientMessage(message)).toBeUndefined();
  });

  it("accepts a session id of 128 characters", () => {
    expect(parseClientMessage(text({ typ: "beenden", sitzung: "a".repeat(128) }))).toEqual({ typ: "beenden", sitzung: "a".repeat(128) });
  });
});

describe("hallo", () => {
  it.each([
    ["16 characters", "a".repeat(16)],
    ["64 characters", "b".repeat(64)],
    ["a UUID", "0b9e5c1a-2f4d-4c6e-9a7b-3d1e2f4a5b6c"],
    ["underscores", "ab_cd_ef_gh_ij_kl"],
  ])("accepts a device id of %s", (_case, geraet) => {
    expect(parseClientMessage(text({ typ: "hallo", geraet, name: "Handy", modus: "zusehen" }))).toEqual({ typ: "hallo", geraet, name: "Handy", modus: "zusehen" });
  });

  it.each([
    ["15 characters", "a".repeat(15)],
    ["65 characters", "a".repeat(65)],
    ["a space", "abcdefgh ijklmnop"],
    ["a slash", "abcdefgh/ijklmnop"],
    ["an umlaut", "abcdefghäijklmnop"],
    ["a line break at the end", `${"a".repeat(16)}\n`],
    ["a number", 1234567890123456],
  ])("rejects a device id of %s", (_case, geraet) => {
    expect(parseClientMessage(text({ typ: "hallo", geraet, name: "PC", modus: "arbeiten" }))).toBeUndefined();
  });

  it.each([
    ["one character", "P"],
    ["40 characters", "x".repeat(40)],
    ["umlauts and spaces inside", "Daniels Bürorechner"],
  ])("accepts a device name of %s", (_case, name) => {
    expect(parseClientMessage(text({ typ: "hallo", geraet: DEVICE, name, modus: "arbeiten" }))).toEqual({ typ: "hallo", geraet: DEVICE, name, modus: "arbeiten" });
  });

  it.each([
    ["no characters", ""],
    ["41 characters", "x".repeat(41)],
    ["a leading space", " PC"],
    ["a trailing space", "PC "],
    ["a line break", "P\nC"],
    ["an escape character", "P\u001b[31mC"],
    ["a zero-width character", "P​C"],
    ["a number", 7],
  ])("rejects a device name of %s", (_case, name) => {
    expect(parseClientMessage(text({ typ: "hallo", geraet: DEVICE, name, modus: "arbeiten" }))).toBeUndefined();
  });
});

describe("hallo mode", () => {
  it.each([["missing", undefined], ["unknown", "steuern"], ["no text", 1]])("rejects a %s mode", (_case, modus) => {
    expect(parseClientMessage(text({ typ: "hallo", geraet: DEVICE, name: "PC", modus }))).toBeUndefined();
  });
});

describe("menu, settings and self-test messages", () => {
  it.each([
    ["bestand_holen", { typ: "bestand_holen" }],
    ["optionen_holen", { typ: "optionen_holen" }],
    ["projekte_holen", { typ: "projekte_holen" }],
    ["einstellungen", { typ: "einstellungen" }],
    ["selbsttest", { typ: "selbsttest" }],
    ["ordner", { typ: "ordner" }],
    ["herunterfahren", { typ: "herunterfahren" }],
    ["suche of one character", { typ: "suche", text: "x" }],
    ["suche of 200 characters", { typ: "suche", text: "ä".repeat(200) }],
    ["einstellung at the lowest threshold", { typ: "einstellung", schwelleVerdichten: 10_000 }],
    ["einstellung at the highest threshold", { typ: "einstellung", schwelleVerdichten: 1_000_000 }],
  ])("reads %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it.each([
    ["an empty search", { typ: "suche", text: "" }],
    ["a blank search", { typ: "suche", text: "   " }],
    ["a search of 201 characters", { typ: "suche", text: "a".repeat(201) }],
    ["a search with a line break", { typ: "suche", text: "a\nb" }],
    ["a search that is no text", { typ: "suche", text: 5 }],
    ["a threshold below 10000", { typ: "einstellung", schwelleVerdichten: 9_999 }],
    ["a threshold above 1000000", { typ: "einstellung", schwelleVerdichten: 1_000_001 }],
    ["a fractional threshold", { typ: "einstellung", schwelleVerdichten: 150_000.5 }],
    ["the old skills request", { typ: "skills" }],
    ["bestand_holen with a field", { typ: "bestand_holen", quelle: "vault" }],
    ["optionen_holen with a field", { typ: "optionen_holen", alle: true }],
    ["projekte_holen with a field", { typ: "projekte_holen", anzahl: 4 }],
    ["ordner with a field", { typ: "ordner", tiefe: 3 }],
    ["herunterfahren with a field", { typ: "herunterfahren", sofort: true }],
  ])("rejects %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toBeUndefined();
  });
});

const VORGABEN = {
  modell: "sonnet",
  aufwand: "high",
  ordner: null,
  ausgabestil: null,
  erlaubnis: "default",
  skills: ["grill-me"],
  plugins: ["caveman@caveman"],
  konnektoren: [],
};

describe("neu with provider and model", () => {
  it.each([
    ["the subscription", { typ: "neu", ordner: null, anbieter: "abo", modell: "opus" }],
    ["OpenRouter", { typ: "neu", ordner: "/srv/vault", anbieter: "openrouter", modell: "anthropic/claude-sonnet-4.5" }],
    ["a model with a context suffix", { typ: "neu", ordner: null, modell: "opus[1m]" }],
    ["a model of 200 characters", { typ: "neu", ordner: null, modell: "m".repeat(200) }],
  ])("reads %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it.each([
    ["an unknown provider", { typ: "neu", ordner: null, anbieter: "openai" }],
    ["a provider that is null", { typ: "neu", ordner: null, anbieter: null }],
    ["a model of 201 characters", { typ: "neu", ordner: null, modell: "m".repeat(201) }],
    ["an empty model", { typ: "neu", ordner: null, modell: "" }],
    ["a model with a space", { typ: "neu", ordner: null, modell: "claude opus" }],
    ["a model with a line break at the end", { typ: "neu", ordner: null, modell: "opus\n" }],
    ["a model that is no text", { typ: "neu", ordner: null, modell: 4 }],
    ["an extra field", { typ: "neu", ordner: null, schnell: true }],
  ])("rejects %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toBeUndefined();
  });
});

describe("sitzung_umbenennen", () => {
  it.each([
    ["one character", "A"],
    ["60 characters", "t".repeat(60)],
    ["umlauts and spaces inside", "Prüfung der Brücke"],
  ])("accepts a title of %s", (_case, titel) => {
    expect(parseClientMessage(text({ typ: "sitzung_umbenennen", sitzung: SESSION, titel }))).toEqual({ typ: "sitzung_umbenennen", sitzung: SESSION, titel });
  });

  it.each([
    ["no characters", ""],
    ["61 characters", "t".repeat(61)],
    ["a leading space", " A"],
    ["a trailing space", "A "],
    ["a line break", "A\nB"],
    ["a zero-width character", "A\u200bB"],
    ["a number", 5],
  ])("rejects a title of %s", (_case, titel) => {
    expect(parseClientMessage(text({ typ: "sitzung_umbenennen", sitzung: SESSION, titel }))).toBeUndefined();
  });

  it("rejects a rename without session", () => {
    expect(parseClientMessage(text({ typ: "sitzung_umbenennen", sitzung: "", titel: "A" }))).toBeUndefined();
  });
});

describe("haken and favorit", () => {
  it.each(["skill", "plugin", "konnektor"])("reads a tick of kind %s", (art) => {
    const message = { typ: "haken", sitzung: SESSION, art, kennung: "superpowers@claude-plugins", an: true };
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it.each(["skill", "plugin", "konnektor"])("reads a favourite of kind %s", (art) => {
    const message = { typ: "favorit", art, kennung: "grill-me", an: false };
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it("accepts an id of 200 characters", () => {
    const message = { typ: "haken", sitzung: SESSION, art: "skill", kennung: "k".repeat(200), an: false };
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it.each([
    ["an id of 201 characters", { typ: "haken", sitzung: SESSION, art: "skill", kennung: "k".repeat(201), an: true }],
    ["an empty id", { typ: "haken", sitzung: SESSION, art: "skill", kennung: "", an: true }],
    ["an id with a line break", { typ: "haken", sitzung: SESSION, art: "skill", kennung: "a\nb", an: true }],
    ["an id with a trailing space", { typ: "haken", sitzung: SESSION, art: "skill", kennung: "a ", an: true }],
    ["an unknown kind", { typ: "haken", sitzung: SESSION, art: "agent", kennung: "a", an: true }],
    ["a switch that is no boolean", { typ: "haken", sitzung: SESSION, art: "skill", kennung: "a", an: "ja" }],
    ["a tick without session", { typ: "haken", art: "skill", kennung: "a", an: true }],
    ["a favourite with a session", { typ: "favorit", sitzung: SESSION, art: "skill", kennung: "a", an: true }],
    ["a favourite of an unknown kind", { typ: "favorit", art: "modell", kennung: "a", an: true }],
    ["a favourite without switch", { typ: "favorit", art: "skill", kennung: "a" }],
  ])("rejects %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toBeUndefined();
  });
});

describe("sitzung_einstellung", () => {
  it.each([
    ["erlaubnis", "default"],
    ["erlaubnis", "acceptEdits"],
    ["erlaubnis", "plan"],
    ["erlaubnis", "auto"],
    ["ausgabestil", "Explanatory"],
    ["ausgabestil", "s".repeat(100)],
    ["schnell", true],
    ["schnell", false],
  ])("reads %s = %s", (schluessel, wert) => {
    const message = { typ: "sitzung_einstellung", sitzung: SESSION, schluessel, wert };
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it.each([
    ["erlaubnis", "bypassPermissions"],
    ["erlaubnis", "dontAsk"],
    ["erlaubnis", "manual"],
    ["erlaubnis", true],
    ["ausgabestil", ""],
    ["ausgabestil", "s".repeat(101)],
    ["ausgabestil", null],
    ["ausgabestil", "Explanatory\n"],
    ["schnell", "true"],
    ["schnell", 1],
    ["modell", "opus"],
  ])("rejects %s = %s", (schluessel, wert) => {
    expect(parseClientMessage(text({ typ: "sitzung_einstellung", sitzung: SESSION, schluessel, wert }))).toBeUndefined();
  });
});

describe("vorgaben", () => {
  it("reads defaults for new sessions", () => {
    expect(parseClientMessage(text({ typ: "vorgaben", werte: VORGABEN }))).toEqual({ typ: "vorgaben", werte: VORGABEN });
  });

  it.each(["low", "medium", "high", "xhigh", "max", "auto"])("reads the effort %s", (aufwand) => {
    const werte = { ...VORGABEN, aufwand };
    expect(parseClientMessage(text({ typ: "vorgaben", werte }))).toEqual({ typ: "vorgaben", werte });
  });

  it("reads a folder and a style", () => {
    const werte = { ...VORGABEN, ordner: "/srv/vault/30_Privat", ausgabestil: "Learning", erlaubnis: "plan" };
    expect(parseClientMessage(text({ typ: "vorgaben", werte }))).toEqual({ typ: "vorgaben", werte });
  });

  it("reads 500 chosen skills", () => {
    const werte = { ...VORGABEN, skills: Array.from({ length: 500 }, (_, index) => `s${String(index)}`) };
    expect(parseClientMessage(text({ typ: "vorgaben", werte }))).toEqual({ typ: "vorgaben", werte });
  });

  it.each([
    ["501 chosen skills", { ...VORGABEN, skills: Array.from({ length: 501 }, (_, index) => `s${String(index)}`) }],
    ["a skill chosen twice", { ...VORGABEN, skills: ["a", "a"] }],
    ["a plugin that is no text", { ...VORGABEN, plugins: [5] }],
    ["connectors that are no list", { ...VORGABEN, konnektoren: "github" }],
    ["an unknown effort", { ...VORGABEN, aufwand: "extrem" }],
    ["a bypassing permission mode", { ...VORGABEN, erlaubnis: "bypassPermissions" }],
    ["a provider", { ...VORGABEN, anbieter: "openrouter" }],
    ["the fast mode", { ...VORGABEN, schnell: true }],
    ["a missing model", Object.fromEntries(Object.entries(VORGABEN).filter(([key]) => key !== "modell"))],
    ["an empty folder", { ...VORGABEN, ordner: "" }],
    ["an empty style", { ...VORGABEN, ausgabestil: "" }],
    ["a model with a space", { ...VORGABEN, modell: "claude opus" }],
    ["no object", [VORGABEN]],
  ])("rejects %s", (_case, werte) => {
    expect(parseClientMessage(text({ typ: "vorgaben", werte }))).toBeUndefined();
  });

  it("rejects an inherited field in the defaults", () => {
    const inherited = `{"typ":"vorgaben","werte":${JSON.stringify(VORGABEN).slice(0, -1)},"__proto__":{"x":1}}}`;
    expect(parseClientMessage(inherited)).toBeUndefined();
  });
});

describe("hinzufuegen", () => {
  it.each([
    ["a library skill", { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "rechnung-pruefen", sitzung: null }],
    ["a marketplace plugin", { typ: "hinzufuegen", art: "plugin", weg: "bibliothek", wert: "superpowers@claude-plugins-official", sitzung: null }],
    ["a link", { typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://github.com/beispiel/skills/tree/main/pdf", sitzung: SESSION }],
    ["a link of 500 characters", { typ: "hinzufuegen", art: "plugin", weg: "link", wert: `https://a.de/${"x".repeat(487)}`, sitzung: SESSION }],
    ["a wish over several lines", { typ: "hinzufuegen", art: "konnektor", weg: "neu", wert: "Ein Konnektor für Lexoffice.\nNur lesen.", sitzung: SESSION }],
    ["a wish of 2000 characters", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "w".repeat(2000), sitzung: SESSION }],
  ])("reads %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it("reads a library skill named for a session", () => {
    const message = { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "pdf", sitzung: SESSION };
    expect(parseClientMessage(text(message))).toEqual(message);
  });

  it.each([
    ["a link without session", { typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://a.de/x", sitzung: null }],
    ["a wish without session", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "x", sitzung: null }],
    ["a missing session", { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "pdf" }],
    ["an empty session", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "x", sitzung: "" }],
    ["a session of 129 characters", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "x", sitzung: "s".repeat(129) }],
    ["a library path", { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "../../.ssh", sitzung: null }],
    ["a library name with a slash", { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "a/b", sitzung: null }],
    ["a library name with a backslash", { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "a\\b", sitzung: null }],
    ["a library name with two dots", { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "a..b", sitzung: null }],
    ["a library name of 201 characters", { typ: "hinzufuegen", art: "skill", weg: "bibliothek", wert: "n".repeat(201), sitzung: null }],
    ["a plain http link", { typ: "hinzufuegen", art: "skill", weg: "link", wert: "http://github.com/x", sitzung: SESSION }],
    ["a file link", { typ: "hinzufuegen", art: "skill", weg: "link", wert: "file:///C:/geheim", sitzung: SESSION }],
    ["a link of 501 characters", { typ: "hinzufuegen", art: "plugin", weg: "link", wert: `https://a.de/${"x".repeat(488)}`, sitzung: SESSION }],
    ["a link with a space", { typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://a.de/x y", sitzung: SESSION }],
    ["a link with a control character", { typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://a.de/x\u0007", sitzung: SESSION }],
    ["a link with a line break at the end", { typ: "hinzufuegen", art: "skill", weg: "link", wert: "https://a.de/x\n", sitzung: SESSION }],
    ["an empty wish", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "", sitzung: SESSION }],
    ["a blank wish", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "  \n ", sitzung: SESSION }],
    ["a wish of 2001 characters", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "w".repeat(2001), sitzung: SESSION }],
    ["a wish with an escape character", { typ: "hinzufuegen", art: "skill", weg: "neu", wert: "a\u001b[31mb", sitzung: SESSION }],
    ["an unknown way", { typ: "hinzufuegen", art: "skill", weg: "marktplatz", wert: "x", sitzung: SESSION }],
    ["an unknown kind", { typ: "hinzufuegen", art: "agent", weg: "neu", wert: "x", sitzung: SESSION }],
  ])("rejects %s", (_case, message) => {
    expect(parseClientMessage(text(message))).toBeUndefined();
  });
});

describe("einziehen", () => {
  it("no longer reads the removed approval message", () => {
    expect(parseClientMessage(text({ typ: "einziehen", sitzung: SESSION, eintrag: "toolu_9" }))).toBeUndefined();
  });
});

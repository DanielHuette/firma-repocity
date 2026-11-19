import { describe, expect, it } from "vitest";
import {
  LAENGSTER_BAUAUFTRAG, LAENGSTER_LINK, LAENGSTER_TITEL, bauauftragLesen, favorit, haken, hinzufuegen, linkLesen, neueSitzungMit, sitzungEinstellung, titelLesen, umbenennen,
  vorgabenSetzen, type Vorgaben,
} from "./bestand";
import { LAENGSTE_NACHRICHT, abbrechen, frageAntwort, nachrichtLesen, planAntwort } from "./chat";
import { SCHWELLE_HOECHSTENS, SCHWELLE_MINDESTENS, aufwandSetzen, modellSetzen, suchAnfrage } from "./menuepunkte";
import { KENNUNG_VERGEBEN, fortsetzen, hallo, herunterfahren, leseNachricht, neueSitzung, ordnerAnfragen, verdichten, type ClientNachricht } from "./verbindung";

const BRUECKE_NACHRICHTEN = new URL("../../../../bruecke/src/nachrichten.ts", import.meta.url).href;
const LESER = [
  `import { parseClientMessage } from ${JSON.stringify(BRUECKE_NACHRICHTEN)};`,
  "let text = '';",
  "process.stdin.on('data', (stueck) => { text += stueck; });",
  "process.stdin.on('end', () => { process.stdout.write(JSON.stringify(JSON.parse(text).map((eintrag) => parseClientMessage(eintrag) ?? null))); });",
].join("\n");

const KINDPROZESS = "node:child_process";

interface Lauf {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type Starten = (befehl: string, argumente: readonly string[], optionen: Readonly<Record<string, unknown>>) => Lauf;

async function nodeWerkzeuge(): Promise<{ starten: Starten; node: string }> {
  const modul: unknown = await import(KINDPROZESS);
  const prozess: unknown = Reflect.get(globalThis, "process");
  if (typeof modul !== "object" || modul === null || !("spawnSync" in modul) || typeof modul.spawnSync !== "function") throw new Error("node:child_process has no spawnSync");
  if (typeof prozess !== "object" || prozess === null || !("execPath" in prozess) || typeof prozess.execPath !== "string") throw new Error("process.execPath is missing");
  const starten = modul.spawnSync as Starten;
  return { starten, node: prozess.execPath };
}

async function brueckeLiest(texte: readonly string[]): Promise<unknown[]> {
  const { starten, node } = await nodeWerkzeuge();
  const lauf = starten(node, ["--input-type=module", "--eval", LESER], { input: JSON.stringify(texte), encoding: "utf8", windowsHide: true });
  if (lauf.status !== 0) throw new Error(`the bridge parser failed: ${lauf.stderr}`);
  const ergebnis: unknown = JSON.parse(lauf.stdout);
  if (!Array.isArray(ergebnis)) throw new Error("the bridge parser answered no list");
  return ergebnis as unknown[];
}

const BRUECKE_VERBINDUNGEN = new URL("../../../../bruecke/src/verbindungen.ts", import.meta.url);

async function brueckenQuelle(datei: URL = BRUECKE_VERBINDUNGEN): Promise<string> {
  const { starten, node } = await nodeWerkzeuge();
  const skript = `process.stdout.write(require("node:fs").readFileSync(new URL(${JSON.stringify(datei.href)}), "utf8"))`;
  const lauf = starten(node, ["--eval", skript], { encoding: "utf8", windowsHide: true });
  if (lauf.status !== 0) throw new Error(`reading the bridge source failed: ${lauf.stderr}`);
  return lauf.stdout;
}

function chatNachricht(text: string): ClientNachricht {
  const gelesen = nachrichtLesen("s-1", text);
  if (gelesen.kind !== "ok") throw new Error("the page refuses the message");
  return gelesen.nachricht;
}

function suche(text: string): ClientNachricht {
  const anfrage = suchAnfrage(text);
  if (anfrage.kind !== "ok") throw new Error(`the page refuses the search ${text}`);
  return anfrage.nachricht;
}

const GERAET = { kennung: "geraet-0123456789ab", name: "PC" };

const NACHRICHTEN: [string, ClientNachricht][] = [
  ["hallo zum Arbeiten", hallo(GERAET, "arbeiten")],
  ["hallo zum Zusehen", hallo(GERAET, "zusehen")],
  ["antwort ja", { typ: "antwort", frage: "f-1", entscheidung: "ja" }],
  ["antwort nein", { typ: "antwort", frage: "f-1", entscheidung: "nein" }],
  ["antwort immer", { typ: "antwort", frage: "f-1", entscheidung: "immer" }],
  ["neu im Ordner", neueSitzung("/srv/vault/30_Privat")],
  ["beenden", { typ: "beenden", sitzung: "s-1" }],
  ["fortsetzen", fortsetzen("s-2")],
  ["uebernehmen", { typ: "uebernehmen" }],
  ["suche", suche(" leinwand ")],
  ["suche mit 200 Zeichen", suche("x".repeat(200))],
  ["einstellung kleinste Schwelle", { typ: "einstellung", schwelleVerdichten: SCHWELLE_MINDESTENS }],
  ["einstellung größte Schwelle", { typ: "einstellung", schwelleVerdichten: SCHWELLE_HOECHSTENS }],
  ["einstellungen", { typ: "einstellungen" }],
  ["selbsttest", { typ: "selbsttest" }],
  ["ordner", ordnerAnfragen()],
  ["herunterfahren", herunterfahren()],
];

const CHAT_NACHRICHTEN: [string, ClientNachricht][] = [
  ["Nachricht", chatNachricht("Hallo\nWelt")],
  ["Nachricht der größten Länge", chatNachricht("x".repeat(LAENGSTE_NACHRICHT))],
  ["Verdichten", verdichten("s-1")],
  ["Modell", modellSetzen("s-1", "sonnet")],
  ["Aufwand", aufwandSetzen("s-1", "xhigh")],
  ["Abbrechen", abbrechen("s-1")],
  ["Antwort auf eine Frage", frageAntwort("s-1", "f-1", { "Farbe?": "Rot", "Teile?": ["A", "eigene"] })],
  ["Plan freigeben", planAntwort("s-1", "p-1", "ja")],
  ["Plan ablehnen", planAntwort("s-1", "p-1", "nein")],
];

const VORGABEN: Vorgaben = {
  modell: "opus", aufwand: "high", ordner: "/srv/vault/20_Firma_RepoCity", ausgabestil: "Explanatory", erlaubnis: "acceptEdits",
  skills: ["caveman", "webdesign-kette:bewegung"], plugins: ["webdesign-kette@repocity-mods"], konnektoren: ["playwright"],
};

function gelesen<T extends string, W>(ergebnis: { readonly kind: "ok" } & Readonly<Record<T, W>> | { readonly kind: "fehler" }, feld: T): W {
  if (ergebnis.kind !== "ok") throw new Error("the page refuses its own example");
  return (ergebnis as Readonly<Record<T, W>>)[feld];
}

const BESTAND_NACHRICHTEN: [string, ClientNachricht][] = [
  ["Bestand holen", { typ: "bestand_holen" }],
  ["Optionen holen", { typ: "optionen_holen" }],
  ["Projekte holen", { typ: "projekte_holen" }],
  ["umbenennen", umbenennen("s-1", gelesen(titelLesen(" Bauteil 1d "), "titel"))],
  ["umbenennen mit 60 Zeichen", umbenennen("s-1", gelesen(titelLesen("x".repeat(LAENGSTER_TITEL)), "titel"))],
  ["Skill anhaken", haken("s-1", "skill", "grill-me", true)],
  ["Plugin abhaken", haken("s-1", "plugin", "webdesign-kette@repocity-mods", false)],
  ["Konnektor anhaken", haken("s-1", "konnektor", "playwright", true)],
  ["Favorit", favorit("skill", "taste-skill", true)],
  ["Favorit weg", favorit("konnektor", "playwright", false)],
  ["Erlaubnismodus", sitzungEinstellung("s-1", "erlaubnis", "plan")],
  ["Ausgabestil", sitzungEinstellung("s-1", "ausgabestil", "Explanatory")],
  ["Schnellmodus", sitzungEinstellung("s-1", "schnell", false)],
  ["Vorgaben", vorgabenSetzen(VORGABEN)],
  ["Vorgaben ohne Ordner und Stil", vorgabenSetzen({ ...VORGABEN, ordner: null, ausgabestil: null, skills: [], plugins: [], konnektoren: [] })],
  ["neu über OpenRouter", neueSitzungMit("", "openrouter", "anthropic/claude-sonnet-4.5")],
  ["aus der Bibliothek", hinzufuegen("skill", "bibliothek", "domain-checker", null)],
  ["per Link", hinzufuegen("plugin", "link", gelesen(linkLesen("https://github.com/a/b"), "link"), "s-1")],
  ["Link der größten Länge", hinzufuegen("skill", "link", gelesen(linkLesen(`https://x.de/${"a".repeat(LAENGSTER_LINK - 13)}`), "link"), "s-1")],
  ["neu bauen", hinzufuegen("konnektor", "neu", gelesen(bauauftragLesen("Konnektor für Lexware\nnur lesen"), "auftrag"), "s-1")],
  ["Bauauftrag der größten Länge", hinzufuegen("skill", "neu", gelesen(bauauftragLesen("x".repeat(LAENGSTER_BAUAUFTRAG)), "auftrag"), "s-1")],
  ["aus der Bibliothek mit Sitzung", hinzufuegen("konnektor", "bibliothek", "lexware", "s-1")],
];

const BRUECKE_NACHRICHTEN_DATEI = new URL("../../../../bruecke/src/nachrichten.ts", import.meta.url);
const BRUECKEN_QUELLTEXT = await brueckenQuelle(BRUECKE_NACHRICHTEN_DATEI);
const CHAT_IN_DER_BRUECKE = BRUECKEN_QUELLTEXT.includes("frage_antwort");
const BESTAND_IN_DER_BRUECKE = BRUECKEN_QUELLTEXT.includes("bestand_holen");

describe("messages of the page in the bridge", () => {
  it("the bridge reads every message of the page unchanged", async () => {
    const gelesen = await brueckeLiest(NACHRICHTEN.map(([, nachricht]) => JSON.stringify(nachricht)));
    expect(gelesen).toEqual(NACHRICHTEN.map(([, nachricht]) => nachricht));
  });

  it("the bridge reads a new session without folder as one in the vault", async () => {
    expect(await brueckeLiest([JSON.stringify(neueSitzung(""))])).toEqual([{ typ: "neu", ordner: null }]);
  });

  it("the bridge refuses the searches the page refuses", async () => {
    const texte = ["x".repeat(201), `a${String.fromCharCode(7)}b`];
    expect(texte.map((text) => suchAnfrage(text).kind)).toEqual(["fehler", "fehler"]);
    expect(await brueckeLiest(texte.map((text) => JSON.stringify({ typ: "suche", text })))).toEqual([null, null]);
  });

  it("the bridge refuses thresholds outside the range of the page", async () => {
    const werte = [SCHWELLE_MINDESTENS - 1, SCHWELLE_HOECHSTENS + 1];
    expect(await brueckeLiest(werte.map((wert) => JSON.stringify({ typ: "einstellung", schwelleVerdichten: wert })))).toEqual([null, null]);
  });

  it("the page knows the message the bridge sends when it ends", async () => {
    expect(await brueckenQuelle()).toContain(`JSON.stringify({ typ: "beendet" } satisfies ServerMessage)`);
    expect(leseNachricht(JSON.stringify({ typ: "beendet" }))).toEqual({ typ: "beendet" });
  });

  it("the page renews its device id on exactly the reason the bridge closes with", async () => {
    expect(await brueckenQuelle()).toContain(`close(POLICY_VIOLATION, ${JSON.stringify(KENNUNG_VERGEBEN)})`);
  });
});

describe.runIf(CHAT_IN_DER_BRUECKE)("chat messages of the page in the bridge", () => {
  it("the bridge reads every chat message of the page unchanged", async () => {
    const gelesen = await brueckeLiest(CHAT_NACHRICHTEN.map(([, nachricht]) => JSON.stringify(nachricht)));
    expect(gelesen).toEqual(CHAT_NACHRICHTEN.map(([, nachricht]) => nachricht));
  });

  it("the bridge refuses the messages the page refuses", async () => {
    const texte = ["", "x".repeat(LAENGSTE_NACHRICHT + 1)];
    expect(texte.map((text) => nachrichtLesen("s-1", text).kind)).toEqual(["leer", "zu_lang"]);
    expect(await brueckeLiest(texte.map((text) => JSON.stringify({ typ: "nachricht", sitzung: "s-1", text })))).toEqual([null, null]);
  });
});

describe.runIf(BESTAND_IN_DER_BRUECKE)("inventory and session option messages of the page in the bridge", () => {
  it("the bridge reads every inventory message of the page unchanged", async () => {
    const gelesen = await brueckeLiest(BESTAND_NACHRICHTEN.map(([, nachricht]) => JSON.stringify(nachricht)));
    expect(gelesen).toEqual(BESTAND_NACHRICHTEN.map(([, nachricht]) => nachricht));
  });

  it("the bridge refuses the titles the page refuses", async () => {
    const titel = ["", "x".repeat(LAENGSTER_TITEL + 1), "a\u0007b"];
    expect(titel.map((text) => titelLesen(text).kind)).toEqual(["fehler", "fehler", "fehler"]);
    expect(await brueckeLiest(titel.map((text) => JSON.stringify({ typ: "sitzung_umbenennen", sitzung: "s-1", titel: text })))).toEqual([null, null, null]);
  });

  it("the bridge refuses the links the page refuses", async () => {
    const links = ["http://x.de/skill", `https://x.de/${"a".repeat(LAENGSTER_LINK - 12)}`, "https://x.de/a\u0007b"];
    expect(links.map((text) => linkLesen(text).kind)).toEqual(["fehler", "fehler", "fehler"]);
    expect(await brueckeLiest(links.map((wert) => JSON.stringify({ typ: "hinzufuegen", art: "skill", weg: "link", wert, sitzung: "s-1" })))).toEqual([null, null, null]);
  });

  it("the bridge refuses the permission modes the page never offers", async () => {
    const modi = ["bypassPermissions", "dontAsk"];
    expect(await brueckeLiest(modi.map((wert) => JSON.stringify({ typ: "sitzung_einstellung", sitzung: "s-1", schluessel: "erlaubnis", wert })))).toEqual([null, null]);
  });

  it("the bridge refuses fast mode as text and a provider it does not know", async () => {
    const texte = [
      JSON.stringify({ typ: "sitzung_einstellung", sitzung: "s-1", schluessel: "schnell", wert: "ja" }),
      JSON.stringify({ typ: "neu", ordner: null, anbieter: "openai", modell: "gpt" }),
    ];
    expect(await brueckeLiest(texte)).toEqual([null, null]);
  });

  it("the bridge refuses a link or a building order without a session and the removed take-in message", async () => {
    const texte = [
      JSON.stringify(hinzufuegen("skill", "link", "https://x.de/p", null)),
      JSON.stringify(hinzufuegen("skill", "neu", "Skill für Rechnungen", null)),
      JSON.stringify({ typ: "einziehen", sitzung: "s-1", eintrag: "e-7" }),
    ];
    expect(await brueckeLiest(texte)).toEqual([null, null, null]);
  });

  it("the bridge no longer takes the skill list request of the old page", async () => {
    expect(await brueckeLiest([JSON.stringify({ typ: "skills" })])).toEqual([null]);
  });
});

const BRUECKEN_BEISPIELE = new URL("../../../../bruecke/test/vertrag_beispiele.json", import.meta.url);

async function brueckenBeispiele(): Promise<unknown[] | null> {
  const { starten, node } = await nodeWerkzeuge();
  const skript = `const fs = require("node:fs"); const datei = new URL(${JSON.stringify(BRUECKEN_BEISPIELE.href)}); process.stdout.write(fs.existsSync(datei) ? fs.readFileSync(datei, "utf8") : "null")`;
  const lauf = starten(node, ["--eval", skript], { encoding: "utf8", windowsHide: true });
  if (lauf.status !== 0) throw new Error(`reading the bridge examples failed: ${lauf.stderr}`);
  const gelesen: unknown = JSON.parse(lauf.stdout);
  if (gelesen === null) return null;
  const eintraege: unknown[] = Array.isArray(gelesen) ? (gelesen as unknown[]) : typeof gelesen === "object" ? Object.values(gelesen as Record<string, unknown>) : [];
  return eintraege.map((eintrag) => (typeof eintrag === "object" && eintrag !== null && "nachricht" in eintrag ? eintrag.nachricht : eintrag));
}

const BEISPIELE_DER_BRUECKE = await brueckenBeispiele();

describe.runIf(BEISPIELE_DER_BRUECKE !== null)("messages of the bridge on the page", () => {
  it("the page reads every message the bridge serialises", () => {
    const beispiele = BEISPIELE_DER_BRUECKE ?? [];
    expect(beispiele.length).toBeGreaterThan(0);
    const unlesbar = beispiele.filter((nachricht) => leseNachricht(JSON.stringify(nachricht)) === undefined);
    expect(unlesbar).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  GERAETE_KENNUNG, KENNUNG_VERGEBEN, Verbindung, brueckenAdresse, fortsetzen, ordnerAnfragen, gespeichertesGeraet, hallo, herunterfahren, leseNachricht, neueKennung, neueSitzung, steuertHier, verdichten, wartezeit,
  type Oeffnen, type Pruefung, type ServerNachricht, type VerbindungsStand,
} from "./verbindung";

const AGENT_HAUPT = { id: "haupt", eltern: null, name: "Hauptsitzung", typ: "haupt", stand: "laeuft", werkzeug: "Bash", aufrufe: 3, seit: 1000, skills: ["grill-me"], fortschritt: { erledigt: 2, gesamt: 5 } };
const AGENT_PRUEFER = { id: "a-1", eltern: "haupt", name: "Prüfer", typ: "general-purpose", stand: "wartet", werkzeug: null, aufrufe: 0, seit: 2000, skills: [], fortschritt: null };
const FRAGE = {
  id: "f-1", agent: "a-1", werkzeug: "Bash", beschreibung: "npm test",
  regelBeiImmer: [{ type: "addRules", destination: "localSettings", behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "npm test:*" }] }],
};
const SITZUNG = {
  id: "s-1", ordner: "/srv/vault", titel: "vault", claudeSitzung: "c-1", stand: "wartet", modell: "Opus", kontextProzent: 38.5,
  kontextVeraltet: false, eingabeTokens: 77000, schwelleUeberschritten: false, agenten: [AGENT_HAUPT, AGENT_PRUEFER], wartet: [FRAGE],
  hinweise: [{ art: "verdichten", anzeige: "Kontext bei 210.000 Tokens – Verdichten empfohlen" }],
  prozess: "laeuft", hinweis: null, aufwand: "high",
  skills: ["grill-me", "caveman"], plugins: ["webdesign-kette@repocity-mods"], konnektoren: ["playwright"], erlaubnis: "auto", ausgabestil: null, schnell: false,
  anbieter: "abo", kostenUsd: null, neustartAusstehend: false, erlaubnisBestaetigt: true, modellWahl: "opus", pausiert: false, pruefung: false,
};
const NEU = {
  skills: SITZUNG.skills, plugins: SITZUNG.plugins, konnektoren: SITZUNG.konnektoren, erlaubnis: "auto", ausgabestil: null, schnell: false,
  anbieter: "abo", kostenUsd: null, neustartAusstehend: false, erlaubnisBestaetigt: true, modellWahl: "opus", pausiert: false, pruefung: false,
};
const PC = { name: "PC", du: true };

const zustand = (sitzung: Record<string, unknown>) => JSON.stringify({ typ: "zustand", sitzungen: [sitzung], steuert: PC });

describe("leseNachricht", () => {
  it("reads a full state with sessions, agents, questions and hints", () => {
    const gelesen = leseNachricht(zustand(SITZUNG));
    expect(gelesen).toEqual({
      typ: "zustand", steuert: { name: "PC", du: true },
      sitzungen: [{
        id: "s-1", ordner: "/srv/vault", titel: "vault", claudeSitzung: "c-1", stand: "wartet", modell: "Opus", kontextProzent: 38.5,
        kontextVeraltet: false, agenten: [AGENT_HAUPT, AGENT_PRUEFER], wartet: [FRAGE], hinweise: SITZUNG.hinweise,
        prozess: "laeuft", hinweis: null, aufwand: "high", ...NEU,
      }],
    });
  });

  it("reads a session without effort, as from a model without effort, as having none", () => {
    const { aufwand: _ohne, ...ohneAufwand } = SITZUNG;
    const gelesen = leseNachricht(zustand(ohneAufwand));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]?.aufwand).toBeNull();
    expect(_ohne).toBe("high");
  });

  it("reads an OpenRouter session with its estimated costs and a pending restart", () => {
    const gelesen = leseNachricht(zustand({ ...SITZUNG, anbieter: "openrouter", kostenUsd: 0.42, schnell: true, ausgabestil: "Explanatory", neustartAusstehend: true }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]).toMatchObject({ anbieter: "openrouter", kostenUsd: 0.42, schnell: true, ausgabestil: "Explanatory", neustartAusstehend: true });
  });

  it("reads a paused OpenRouter session whose permission mode is not confirmed yet and whose connectors are still unknown", () => {
    const gelesen = leseNachricht(zustand({ ...SITZUNG, pausiert: true, erlaubnisBestaetigt: false, konnektoren: null, modellWahl: null }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]).toMatchObject({ pausiert: true, erlaubnisBestaetigt: false, konnektoren: null, modellWahl: null });
  });

  it("reads a check session by its flag, not by its title", () => {
    const gelesen = leseNachricht(zustand({ ...SITZUNG, titel: "vault", pruefung: true }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]?.pruefung).toBe(true);
  });

  it("reads the inventory through the inventory reader", () => {
    const antwort = { typ: "hinzugefuegt", art: "skill", weg: "link", ok: false, text: "nur https", einrichtung: null };
    expect(leseNachricht(JSON.stringify(antwort))).toEqual(antwort);
  });

  it("drops a state whose effort is no text", () => {
    expect(leseNachricht(zustand({ ...SITZUNG, aufwand: 3 }))).toBeUndefined();
  });

  it("reads a session the bridge marks as ended, with its note", () => {
    const gelesen = leseNachricht(zustand({ ...SITZUNG, prozess: "beendet", hinweis: "Claude Code wurde beendet (Rückgabewert 1)" }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]).toMatchObject({ prozess: "beendet", hinweis: "Claude Code wurde beendet (Rückgabewert 1)" });
  });

  it("ignores a terminal size an older bridge still sends", () => {
    const gelesen = leseNachricht(zustand({ ...SITZUNG, groesse: { spalten: 120, zeilen: 40 } }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]).not.toHaveProperty("groesse");
  });

  it("reads a question without a rule for always and a state nobody controls", () => {
    const sitzung = { ...SITZUNG, wartet: [{ ...FRAGE, regelBeiImmer: null }] };
    const gelesen = leseNachricht(JSON.stringify({ typ: "zustand", sitzungen: [sitzung], steuert: null }));
    expect(gelesen?.typ === "zustand" && [gelesen.steuert, gelesen.sitzungen[0]?.wartet[0]?.regelBeiImmer]).toEqual([null, null]);
  });

  it("reads hints of the self test and markers of missing data", () => {
    const hinweise = [{ art: "selbsttest", text: "Statuszeile fehlt seit Update", auftrag: "Prüfe die Statuszeile" }, { art: "keine_daten", anzeige: "kontext" }];
    const gelesen = leseNachricht(zustand({ ...SITZUNG, hinweise }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]?.hinweise).toEqual(hinweise);
  });

  it.each([
    ["a piece of chat text", { typ: "chat_teil", sitzung: "s-1", id: "c-1", text: "Hal" }],
    ["error", { typ: "fehler", text: "Ordner nicht erlaubt" }],
    ["empty projects", { typ: "projekte", liste: [] }],
    ["settings", { typ: "einstellungen", schwelleVerdichten: 200000, claudeVersion: "2.1.322 (Claude Code)" }],
    ["settings without a known version", { typ: "einstellungen", schwelleVerdichten: 150000, claudeVersion: null }],
    ["search results with a failure note", { typ: "treffer", text: "leinwand", vault: [{ pfad: "00_System/ANWEISUNG.md", zeile: 12, auszug: "Leinwand und Tabelle" }], erinnerung: [{ id: 4711, titel: "Leinwand geprüft", datum: "2026-11-17" }], fehler: "claude-mem nicht erreichbar" }],
  ])("reads %s messages", (_name, nachricht) => {
    expect(leseNachricht(JSON.stringify(nachricht))).toEqual(nachricht);
  });

  it.each([
    ["an unknown kind", { art: "laut", anzeige: "x" }],
    ["a self test without task", { art: "selbsttest", text: "x" }],
    ["a compaction hint without text", { art: "verdichten" }],
    ["no object", "x"],
  ])("drops only a hint with %s and keeps the session", (_name, kaputt) => {
    const gut = { art: "verdichten", anzeige: "ok" };
    const gelesen = leseNachricht(zustand({ ...SITZUNG, hinweise: [kaputt, gut] }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]?.hinweise).toEqual([gut]);
  });

  it("reads a question Claude asks in the terminal", () => {
    const hinweis = { art: "terminal_frage", text: "Claude fragt: Welche Variante soll ich bauen?" };
    const gelesen = leseNachricht(zustand({ ...SITZUNG, hinweise: [hinweis] }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]?.hinweise).toEqual([hinweis]);
  });

  it("reads chat messages through the chat reader", () => {
    const eintrag = { id: "d-1", art: "du", zeit: 1, text: "Hallo", eltern: null, werkzeug: null, agent: null, frage: null, plan: null };
    expect(leseNachricht(JSON.stringify({ typ: "chat", sitzung: "s-1", eintraege: [eintrag] }))).toEqual({ typ: "chat", sitzung: "s-1", eintraege: [eintrag] });
    expect(leseNachricht(JSON.stringify({ typ: "chat_neu", sitzung: "s-1", eintrag: { id: "x" } }))).toBeUndefined();
  });

  it("reads that the bridge ends", () => {
    expect(leseNachricht(JSON.stringify({ typ: "beendet" }))).toEqual({ typ: "beendet" });
  });

  it("drops a terminal question without text", () => {
    const gelesen = leseNachricht(zustand({ ...SITZUNG, hinweise: [{ art: "terminal_frage" }] }));
    expect(gelesen?.typ === "zustand" && gelesen.sitzungen[0]?.hinweise).toEqual([]);
  });

  it("reads the allowed folders", () => {
    const liste = [{ pfad: "/srv/vault", name: "vault" }, { pfad: "/srv/vault/30_Privat", name: "30_Privat" }];
    expect(leseNachricht(JSON.stringify({ typ: "ordner", liste }))).toEqual({ typ: "ordner", liste });
  });

  it("reads search results whose failure note is null as having none", () => {
    const gelesen = leseNachricht(JSON.stringify({ typ: "treffer", text: "x", vault: [], erinnerung: [], fehler: null }));
    expect(gelesen).toEqual({ typ: "treffer", text: "x", vault: [], erinnerung: [], fehler: null });
  });

  it("reads search results without a failure note as having none", () => {
    const gelesen = leseNachricht(JSON.stringify({ typ: "treffer", text: "x", vault: [], erinnerung: [{ id: "obs-1", titel: "t", datum: "2026-11-18" }] }));
    expect(gelesen).toEqual({ typ: "treffer", text: "x", vault: [], erinnerung: [{ id: "obs-1", titel: "t", datum: "2026-11-18" }], fehler: null });
  });

  it.each([
    ["no JSON", "{typ"],
    ["a list", "[]"],
    ["an unknown type", JSON.stringify({ typ: "neu" })],
    ["terminal output of an older bridge", JSON.stringify({ typ: "ausgabe", sitzung: "s-1", daten: "x" })],
    ["an unknown session state", zustand({ ...SITZUNG, stand: "schlaeft" })],
    ["an unknown process state", zustand({ ...SITZUNG, prozess: "weg" })],
    ["a session without agents", zustand({ ...SITZUNG, agenten: undefined })],
    ["an agent with a broken call count", zustand({ ...SITZUNG, agenten: [{ ...AGENT_HAUPT, aufrufe: 1.5 }] })],
    ["an agent with an unknown state", zustand({ ...SITZUNG, agenten: [{ ...AGENT_HAUPT, stand: "schlaeft" }] })],
    ["a rule without destination", zustand({ ...SITZUNG, wartet: [{ ...FRAGE, regelBeiImmer: [{ type: "addRules" }] }] })],
    ["a context share that is text", zustand({ ...SITZUNG, kontextProzent: "38" })],
    ["a controller that is a device id", JSON.stringify({ typ: "zustand", sitzungen: [], steuert: "geraet-0123456789ab" })],
    ["a controller without the own flag", JSON.stringify({ typ: "zustand", sitzungen: [], steuert: { name: "PC" } })],
    ["a session without process state", zustand({ ...SITZUNG, prozess: undefined })],
    ["a session without note", zustand({ ...SITZUNG, hinweis: undefined })],
    ["hints that are no list", zustand({ ...SITZUNG, hinweise: "keine" })],
    ["a memory with a broken id", JSON.stringify({ typ: "treffer", text: "x", vault: [], erinnerung: [{ id: 1.5, titel: "t", datum: "d" }] })],
    ["folders without list", JSON.stringify({ typ: "ordner" })],
    ["a folder without name", JSON.stringify({ typ: "ordner", liste: [{ pfad: "/srv/vault" }] })],
    ["the skill list of an older bridge", JSON.stringify({ typ: "skills", liste: [{ name: "x", art: "skill", quelle: "vault" }] })],
    ["a session without ticked skills", zustand({ ...SITZUNG, skills: undefined })],
    ["a session with a connector that is no text", zustand({ ...SITZUNG, konnektoren: [3] })],
    ["a session in a forbidden permission mode", zustand({ ...SITZUNG, erlaubnis: "bypassPermissions" })],
    ["a session with an unknown provider", zustand({ ...SITZUNG, anbieter: "openai" })],
    ["a session whose fast mode is text", zustand({ ...SITZUNG, schnell: "nein" })],
    ["a session whose costs are text", zustand({ ...SITZUNG, kostenUsd: "0,42" })],
    ["a session without restart flag", zustand({ ...SITZUNG, neustartAusstehend: undefined })],
    ["a session without pause flag", zustand({ ...SITZUNG, pausiert: undefined })],
    ["a session without check flag", zustand({ ...SITZUNG, pruefung: undefined })],
    ["a session whose confirmation is text", zustand({ ...SITZUNG, erlaubnisBestaetigt: "ja" })],
    ["a session whose chosen model is missing", zustand({ ...SITZUNG, modellWahl: undefined })],
    ["a session whose output style is missing", zustand({ ...SITZUNG, ausgabestil: undefined })],
    ["a session whose title is empty", zustand({ ...SITZUNG, titel: "" })],
    ["an agent without skills", zustand({ ...SITZUNG, agenten: [{ ...AGENT_HAUPT, skills: undefined }] })],
    ["an agent with more done than planned", zustand({ ...SITZUNG, agenten: [{ ...AGENT_HAUPT, fortschritt: { erledigt: 6, gesamt: 5 } }] })],
    ["an agent with a broken progress", zustand({ ...SITZUNG, agenten: [{ ...AGENT_HAUPT, fortschritt: { erledigt: 1.5, gesamt: 5 } }] })],
    ["an agent with negative progress", zustand({ ...SITZUNG, agenten: [{ ...AGENT_HAUPT, fortschritt: { erledigt: -1, gesamt: 5 } }] })],
    ["broken options", JSON.stringify({ typ: "optionen" })],
    ["a hit with a broken line", JSON.stringify({ typ: "treffer", text: "x", vault: [{ pfad: "a", zeile: "3", auszug: "b" }], erinnerung: [] })],
    ["a memory without date", JSON.stringify({ typ: "treffer", text: "x", vault: [], erinnerung: [{ id: 1, titel: "t" }] })],
    ["a failure note that is no text", JSON.stringify({ typ: "treffer", text: "x", vault: [], erinnerung: [], fehler: 5 })],
    ["a threshold that is not whole", JSON.stringify({ typ: "einstellungen", schwelleVerdichten: 1.5, claudeVersion: null })],
  ])("refuses %s", (_name, text) => {
    expect(leseNachricht(text)).toBeUndefined();
  });
});

describe("messages to the bridge", () => {
  it.each(["arbeiten", "zusehen"] as const)("greets with the device id, name and mode %s", (modus) => {
    expect(hallo({ kennung: "geraet-0123456789ab", name: "PC" }, modus)).toEqual({ typ: "hallo", geraet: "geraet-0123456789ab", name: "PC", modus });
  });

  it.each([["", { typ: "neu", ordner: null }], ["   ", { typ: "neu", ordner: null }], [" /srv/vault/30_Privat ", { typ: "neu", ordner: "/srv/vault/30_Privat" }]])(
    "starts a session in folder %j",
    (ordner, nachricht) => {
      expect(neueSitzung(ordner)).toEqual(nachricht);
    },
  );

  it("resumes a paused session", () => {
    expect(fortsetzen("s-2")).toEqual({ typ: "fortsetzen", sitzung: "s-2" });
  });

  it("compacts by sending /compact as a chat message", () => {
    expect(verdichten("s-1")).toEqual({ typ: "nachricht", sitzung: "s-1", text: "/compact" });
  });

  it("asks for the allowed folders", () => {
    expect(ordnerAnfragen()).toEqual({ typ: "ordner" });
  });

  it("asks the bridge to end", () => {
    expect(herunterfahren()).toEqual({ typ: "herunterfahren" });
  });
});

describe("devices", () => {
  const bytes = (laenge: number) => Uint8Array.from({ length: laenge }, (_, index) => index * 17);

  it("creates an id the bridge accepts", () => {
    const kennung = neueKennung(bytes);
    expect(kennung).toMatch(GERAETE_KENNUNG);
    expect(kennung).toHaveLength(24);
  });

  it("keeps a stored device", () => {
    expect(gespeichertesGeraet({ kennung: "abcdefghijklmnop", name: "Handy" }, "PC", bytes)).toEqual({ kennung: "abcdefghijklmnop", name: "Handy" });
  });

  it.each([
    ["missing", { kennung: null, name: null }],
    ["too short", { kennung: "abc", name: null }],
    ["with a forbidden sign", { kennung: "abcdefghijklmno/", name: null }],
  ])("replaces a %s id and falls back to the given name", (_name, gespeichert) => {
    const geraet = gespeichertesGeraet(gespeichert, "PC", bytes);
    expect(geraet).toEqual({ kennung: neueKennung(bytes), name: "PC" });
  });

  it.each([
    ["a".repeat(15), false],
    ["a".repeat(16), true],
    ["a".repeat(64), true],
    ["a".repeat(65), false],
  ])("keeps the stored id %s only within 16 to 64 signs", (kennung, behalten) => {
    expect(gespeichertesGeraet({ kennung, name: "PC" }, "PC", bytes).kennung === kennung).toBe(behalten);
  });

  it.each([["", "PC"], [" Handy", "PC"], ["x".repeat(41), "PC"], ["x".repeat(40), "x".repeat(40)], ["Tab\u0007", "PC"]])(
    "accepts the stored name %j only when the bridge would",
    (name, erwartet) => {
      expect(gespeichertesGeraet({ kennung: "abcdefghijklmnop", name }, "PC", bytes).name).toBe(erwartet);
    },
  );
});

describe("steuertHier", () => {
  it.each([
    [{ name: "PC", du: true }, "arbeiten", true],
    [{ name: "Handy", du: false }, "arbeiten", false],
    [null, "arbeiten", false],
    [{ name: "PC", du: true }, "zusehen", false],
    [{ name: "PC", du: true }, null, false],
  ] as const)("controller %o with mode %s gives %s", (steuert, modus, erwartet) => {
    expect(steuertHier(steuert, modus)).toBe(erwartet);
  });
});

describe("brueckenAdresse", () => {
  it.each([
    [{ protocol: "http:", host: "127.0.0.1:8787" }, "ws://127.0.0.1:8787/ws"],
    [{ protocol: "https:", host: "zentrale.example.ts.net" }, "wss://zentrale.example.ts.net/ws"],
  ])("connects from %o to %s", (ort, adresse) => {
    expect(brueckenAdresse(ort)).toBe(adresse);
  });
});

describe("wartezeit", () => {
  it.each([[0, 1000], [1, 2000], [2, 4000], [3, 8000], [4, 15000], [9, 15000]])("waits after attempt %i for %i ms", (versuch, ms) => {
    expect(wartezeit(versuch)).toBe(ms);
  });
});

interface FakeSockel {
  readonly adresse: string;
  readonly gesendet: string[];
  geschlossen: boolean;
  offen(): void;
  nachricht(text: string): void;
  zu(code: number, grund?: string): void;
}

function aufbau(pruefung: () => Promise<Pruefung> = () => Promise.resolve("bereit")) {
  const sockel: FakeSockel[] = [];
  let erneuert = 0;
  const geplant: { aufgabe: () => void; ms: number; abgebrochen: boolean }[] = [];
  const staende: VerbindungsStand[] = [];
  const nachrichten: ServerNachricht[] = [];
  let unlesbar = 0;
  let jetzt = 5000;
  const oeffnen: Oeffnen = (adresse, rueckrufe) => {
    const neu: FakeSockel = {
      adresse, gesendet: [], geschlossen: false,
      offen: rueckrufe.offen, nachricht: rueckrufe.nachricht, zu: (code, grund = "") => { rueckrufe.zu(code, grund); },
    };
    sockel.push(neu);
    return { senden: (text) => { neu.gesendet.push(text); }, schliessen: () => { neu.geschlossen = true; } };
  };
  const verbindung = new Verbindung({
    adresse: "ws://127.0.0.1:8787/ws",
    geraet: () => ({ kennung: "geraet-0123456789ab", name: "PC" }),
    geraetErneuern: () => {
      erneuert += 1;
      return { kennung: `neu-geraet-${String(erneuert)}-0123456789`, name: "PC" };
    },
    modus: "zusehen",
    oeffnen,
    pruefen: pruefung,
    uhr: {
      jetzt: () => jetzt,
      spaeter: (aufgabe, ms) => {
        const eintrag = { aufgabe, ms, abgebrochen: false };
        geplant.push(eintrag);
        return () => { eintrag.abgebrochen = true; };
      },
    },
    stand: (stand) => { staende.push(stand); },
    nachricht: (nachricht) => { nachrichten.push(nachricht); },
    unlesbar: () => { unlesbar += 1; },
  });
  return {
    verbindung, sockel, geplant, staende, nachrichten,
    unlesbar: () => unlesbar,
    erneuert: () => erneuert,
    stellen: (zeit: number) => { jetzt = zeit; },
    letzter: (): FakeSockel => {
      const eintrag = sockel.at(-1);
      if (eintrag === undefined) throw new Error("no socket was opened");
      return eintrag;
    },
  };
}

const ruhe = async () => { await Promise.resolve(); await Promise.resolve(); };
const HALLO = JSON.stringify({ typ: "hallo", geraet: "geraet-0123456789ab", name: "PC", modus: "zusehen" });
const HALLO_ARBEITEN = JSON.stringify({ typ: "hallo", geraet: "geraet-0123456789ab", name: "PC", modus: "arbeiten" });

describe("Verbindung", () => {
  it("opens the given address and greets before anything else", () => {
    const t = aufbau();
    t.verbindung.starten();
    expect(t.letzter().adresse).toBe("ws://127.0.0.1:8787/ws");
    expect(t.staende).toEqual([{ kind: "verbindet" }]);
    t.letzter().offen();
    expect(t.letzter().gesendet).toEqual([HALLO]);
    expect(t.staende.at(-1)).toEqual({ kind: "offen" });
  });

  it("greets with the mode chosen last when it reconnects", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.verbindung.modusSetzen("arbeiten");
    t.letzter().zu(1006);
    await ruhe();
    t.geplant[0]?.aufgabe();
    t.letzter().offen();
    expect(t.letzter().gesendet).toEqual([HALLO_ARBEITEN]);
  });

  it("passes read messages on and counts unreadable ones", () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.letzter().nachricht(JSON.stringify({ typ: "fehler", text: "nein" }));
    t.letzter().nachricht("kaputt");
    expect(t.nachrichten).toEqual([{ typ: "fehler", text: "nein" }]);
    expect(t.unlesbar()).toBe(1);
  });

  it("sends only while the connection is open", () => {
    const t = aufbau();
    t.verbindung.starten();
    expect(t.verbindung.senden({ typ: "uebernehmen" })).toBe(false);
    t.letzter().offen();
    expect(t.verbindung.senden({ typ: "uebernehmen" })).toBe(true);
    expect(t.letzter().gesendet.at(-1)).toBe(JSON.stringify({ typ: "uebernehmen" }));
  });

  it("reports since when the bridge is unreachable and greets again after reconnecting", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.stellen(9000);
    t.letzter().zu(1006);
    await ruhe();
    expect(t.staende.at(-1)).toEqual({ kind: "getrennt", seit: 9000, versuch: 1 });
    expect(t.geplant.map((eintrag) => eintrag.ms)).toEqual([1000]);
    t.stellen(10_000);
    t.geplant[0]?.aufgabe();
    t.letzter().zu(1006);
    await ruhe();
    expect(t.staende.at(-1)).toEqual({ kind: "getrennt", seit: 9000, versuch: 2 });
    expect(t.geplant.map((eintrag) => eintrag.ms)).toEqual([1000, 2000]);
    t.geplant[1]?.aufgabe();
    t.letzter().offen();
    expect(t.letzter().gesendet).toEqual([HALLO]);
    expect(t.staende.at(-1)).toEqual({ kind: "offen" });
  });

  it("starts counting from one second again after a connection worked", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().zu(1006);
    await ruhe();
    t.geplant[0]?.aufgabe();
    t.letzter().offen();
    t.letzter().zu(1006);
    await ruhe();
    expect(t.geplant.map((eintrag) => eintrag.ms)).toEqual([1000, 1000]);
  });

  it("treats a close with an old login code like any other loss and tries again", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.letzter().zu(4401);
    await ruhe();
    expect(t.staende.at(-1)).toEqual({ kind: "getrennt", seit: 5000, versuch: 1 });
    expect(t.geplant).toHaveLength(1);
  });

  it("keeps trying when the bridge cannot be asked either", async () => {
    const t = aufbau(() => Promise.resolve("unbekannt"));
    t.verbindung.starten();
    t.letzter().zu(1006);
    await ruhe();
    expect(t.geplant).toHaveLength(1);
  });

  it("connects and greets again at once on request after a loss", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().zu(1006);
    await ruhe();
    t.verbindung.jetztVerbinden();
    expect(t.sockel).toHaveLength(2);
    t.letzter().offen();
    expect(t.letzter().gesendet).toEqual([HALLO]);
  });

  it("tries at once on request instead of waiting for the timer", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().zu(1006);
    await ruhe();
    t.verbindung.jetztVerbinden();
    expect(t.geplant[0]?.abgebrochen).toBe(true);
    expect(t.sockel).toHaveLength(2);
  });

  it("does nothing on request while a connection is already open", () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.verbindung.jetztVerbinden();
    expect(t.sockel).toHaveLength(1);
  });

  it("takes a new device id once and greets with it when the bridge says the id belongs to another device", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.letzter().zu(1008, KENNUNG_VERGEBEN);
    await ruhe();
    expect(t.erneuert()).toBe(1);
    expect(t.sockel).toHaveLength(2);
    expect(t.geplant).toEqual([]);
    t.letzter().offen();
    expect(t.letzter().gesendet).toEqual([JSON.stringify({ typ: "hallo", geraet: "neu-geraet-1-0123456789", name: "PC", modus: "zusehen" })]);
  });

  it("stops with the reason when the new device id is refused as well", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().zu(1008, KENNUNG_VERGEBEN);
    await ruhe();
    t.letzter().zu(1008, KENNUNG_VERGEBEN);
    await ruhe();
    expect(t.erneuert()).toBe(1);
    expect(t.sockel).toHaveLength(2);
    expect(t.geplant).toEqual([]);
    expect(t.staende.at(-1)).toEqual({ kind: "abgewiesen", grund: KENNUNG_VERGEBEN });
  });

  it.each(["erst hallo", ""])("stops with the reason %j instead of retrying when the bridge refuses the connection", async (grund) => {
    let gefragt = 0;
    const t = aufbau(() => { gefragt += 1; return Promise.resolve("bereit"); });
    t.verbindung.starten();
    t.letzter().offen();
    t.letzter().zu(1008, grund);
    await ruhe();
    expect(t.staende.at(-1)).toEqual({ kind: "abgewiesen", grund });
    expect([t.geplant.length, t.sockel.length, gefragt]).toEqual([0, 1, 0]);
  });

  it("connects again on request after a refusal", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().zu(1008, "erst hallo");
    await ruhe();
    t.verbindung.jetztVerbinden();
    expect(t.sockel).toHaveLength(2);
  });

  it("stops when the address does not belong to the bridge", async () => {
    const t = aufbau(() => Promise.resolve("keine_bruecke"));
    t.verbindung.starten();
    t.letzter().zu(1006);
    await ruhe();
    expect(t.staende.at(-1)).toEqual({ kind: "keine_bruecke" });
    expect(t.geplant).toEqual([]);
  });

  it("ignores the answer of the login check when a new attempt started meanwhile", async () => {
    let antworten: (pruefung: Pruefung) => void = () => undefined;
    const t = aufbau(() => new Promise((fertig) => { antworten = fertig; }));
    t.verbindung.starten();
    t.letzter().zu(1006);
    await ruhe();
    t.verbindung.jetztVerbinden();
    antworten("keine_bruecke");
    await ruhe();
    expect(t.staende.at(-1)).not.toEqual({ kind: "keine_bruecke" });
    expect(t.geplant).toEqual([]);
  });

  it("closes a pending attempt when asked to connect at once", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().zu(1006);
    await ruhe();
    t.geplant[0]?.aufgabe();
    const haengend = t.letzter();
    t.verbindung.jetztVerbinden();
    expect(haengend.geschlossen).toBe(true);
    expect(t.sockel).toHaveLength(3);
  });

  it("does not connect again after the page closed", () => {
    const t = aufbau();
    t.verbindung.starten();
    t.verbindung.beenden();
    t.verbindung.jetztVerbinden();
    t.verbindung.neuVerbinden();
    expect(t.sockel).toHaveLength(1);
  });

  it("reconnects even while open when the greeting must change", () => {
    const t = aufbau();
    t.verbindung.starten();
    const alt = t.letzter();
    alt.offen();
    t.verbindung.neuVerbinden();
    expect(alt.geschlossen).toBe(true);
    expect(t.sockel).toHaveLength(2);
    expect(t.verbindung.senden({ typ: "uebernehmen" })).toBe(false);
  });

  it("stops for good when the page closes", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.verbindung.beenden();
    expect(t.letzter().geschlossen).toBe(true);
    t.letzter().zu(1000);
    await ruhe();
    expect(t.geplant).toEqual([]);
    expect(t.staende.at(-1)).toEqual({ kind: "beendet" });
  });

  it("shows the end at once when the bridge says it ends and never connects again", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    t.letzter().nachricht(JSON.stringify({ typ: "beendet" }));
    expect(t.staende.at(-1)).toEqual({ kind: "zentrale_beendet" });
    t.letzter().zu(1001, "Bruecke wird beendet");
    await ruhe();
    t.verbindung.jetztVerbinden();
    t.verbindung.neuVerbinden();
    expect(t.staende.at(-1)).toEqual({ kind: "zentrale_beendet" });
    expect(t.geplant).toEqual([]);
    expect(t.sockel).toHaveLength(1);
    expect(t.verbindung.senden({ typ: "uebernehmen" })).toBe(false);
  });

  it("treats the end of the connection after its own request to end as the end of the bridge", async () => {
    const t = aufbau();
    t.verbindung.starten();
    t.letzter().offen();
    expect(t.verbindung.senden(herunterfahren())).toBe(true);
    t.letzter().zu(1006);
    await ruhe();
    expect(t.staende.at(-1)).toEqual({ kind: "zentrale_beendet" });
    expect(t.geplant).toEqual([]);
    expect(t.sockel).toHaveLength(1);
  });

  it("ignores events of a socket it already replaced", async () => {
    const t = aufbau();
    t.verbindung.starten();
    const alt = t.letzter();
    alt.zu(1006);
    await ruhe();
    t.verbindung.jetztVerbinden();
    alt.nachricht(JSON.stringify({ typ: "fehler", text: "alt" }));
    alt.zu(1006);
    await ruhe();
    expect(t.nachrichten).toEqual([]);
    expect(t.geplant).toHaveLength(1);
  });
});

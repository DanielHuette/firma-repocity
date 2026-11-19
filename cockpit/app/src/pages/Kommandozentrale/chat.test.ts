import { describe, expect, it } from "vitest";
import {
  LAENGSTE_NACHRICHT, abbrechen, amEnde, ansageText, chatAnwenden, chatsBehalten, ersteZeile, fragenAntwort, frageAntwort, kuerzen, leseChatNachricht, nachrichtLesen, planAntwort,
  verschachteln, type Chats, type Eintrag, type Teilfrage,
} from "./chat";

const ZEIT = 1_763_500_000_000;

function eintrag(id: string, felder: Partial<Eintrag> = {}): Eintrag {
  return { id, art: "claude", zeit: ZEIT, text: "", eltern: null, werkzeug: null, agent: null, frage: null, plan: null, ...felder };
}

const WERKZEUG = { id: "w-1", art: "werkzeug", zeit: ZEIT, werkzeug: { name: "Bash", kurz: "node --version", eingabe: { command: "node --version" }, ergebnis: "v24.13.0", status: "ok" } };
const AGENT = { id: "a-1", art: "agent", zeit: ZEIT, agent: { typ: "Explore", beschreibung: "Werkstücke lesen", status: "laeuft" } };
const FRAGE = {
  id: "f-1", art: "frage", zeit: ZEIT,
  frage: { fragen: [{ frage: "Wie fandest du den Testlauf?", kopf: "Testlauf", optionen: [{ label: "gut", beschreibung: "lief" }, { label: "geht so", beschreibung: "hakte" }], mehrfach: false }] },
};
const PLAN = { id: "p-1", art: "plan", zeit: ZEIT, plan: { text: "1. bauen\n2. prüfen" } };

const lies = (nachricht: Record<string, unknown>) => leseChatNachricht(nachricht);

describe("leseChatNachricht", () => {
  it("reads the whole history with every kind of entry", () => {
    const eintraege = [{ id: "d-1", art: "du", zeit: ZEIT, text: "Hallo" }, { id: "c-1", art: "claude", zeit: ZEIT, text: "**Hi**" }, WERKZEUG, AGENT, FRAGE, PLAN, { id: "s-1", art: "system", zeit: ZEIT, text: "Sitzung gestartet" }];
    const gelesen = lies({ typ: "chat", sitzung: "s", eintraege });
    expect(gelesen?.typ === "chat" && gelesen.eintraege.map((e) => e.art)).toEqual(["du", "claude", "werkzeug", "agent", "frage", "plan", "system"]);
  });

  it("fills missing optional fields with null and keeps the tool input as given", () => {
    const gelesen = lies({ typ: "chat_neu", sitzung: "s", eintrag: WERKZEUG });
    expect(gelesen).toEqual({ typ: "chat_neu", sitzung: "s", eintrag: eintrag("w-1", { art: "werkzeug", text: null, werkzeug: { ...WERKZEUG.werkzeug, status: "ok" } }) });
  });

  it("reads a tool call that still runs, without result", () => {
    const gelesen = lies({ typ: "chat_neu", sitzung: "s", eintrag: { ...WERKZEUG, werkzeug: { name: "Bash", kurz: "ls", eingabe: "ls", status: "laeuft" } } });
    expect(gelesen?.typ === "chat_neu" && gelesen.eintrag.werkzeug).toEqual({ name: "Bash", kurz: "ls", eingabe: "ls", ergebnis: null, status: "laeuft" });
  });

  it("shows a structured tool result as JSON text", () => {
    const gelesen = lies({ typ: "chat_neu", sitzung: "s", eintrag: { ...WERKZEUG, werkzeug: { ...WERKZEUG.werkzeug, ergebnis: [{ type: "text", text: "ok" }] } } });
    expect(gelesen?.typ === "chat_neu" && gelesen.eintrag.werkzeug?.ergebnis).toBe('[{"type":"text","text":"ok"}]');
  });

  it("reads the time as milliseconds or as ISO text", () => {
    const gelesen = lies({ typ: "chat_neu", sitzung: "s", eintrag: { id: "d", art: "du", zeit: "2026-11-19T00:00:00.000Z", text: "x" } });
    expect(gelesen?.typ === "chat_neu" && gelesen.eintrag.zeit).toBe(Date.parse("2026-11-19T00:00:00.000Z"));
  });

  it("reads a question with defaults for missing header, description and multiple choice", () => {
    const gelesen = lies({ typ: "chat_neu", sitzung: "s", eintrag: { ...FRAGE, frage: { fragen: [{ frage: "Welche?", optionen: [{ label: "A" }] }] } } });
    expect(gelesen?.typ === "chat_neu" && gelesen.eintrag.frage).toEqual({ fragen: [{ frage: "Welche?", kopf: "", optionen: [{ label: "A", beschreibung: "" }], mehrfach: false }], beantwortet: null });
  });

  it("reads answered questions and decided plans", () => {
    const frage = lies({ typ: "chat_aktualisiert", sitzung: "s", eintrag: { ...FRAGE, frage: { ...FRAGE.frage, beantwortet: { "Wie fandest du den Testlauf?": "gut", Welche: ["A", "B"] } } } });
    const plan = lies({ typ: "chat_aktualisiert", sitzung: "s", eintrag: { ...PLAN, plan: { text: "x", entschieden: "nein" } } });
    expect(frage?.typ === "chat_aktualisiert" && frage.eintrag.frage?.beantwortet).toEqual({ "Wie fandest du den Testlauf?": "gut", Welche: ["A", "B"] });
    expect(plan?.typ === "chat_aktualisiert" && plan.eintrag.plan).toEqual({ text: "x", entschieden: "nein" });
  });

  it("reads a piece of streamed text", () => {
    expect(lies({ typ: "chat_teil", sitzung: "s", id: "c-1", text: "Hal" })).toEqual({ typ: "chat_teil", sitzung: "s", id: "c-1", text: "Hal" });
  });

  it("drops only the broken entries of a history", () => {
    const gelesen = lies({ typ: "chat", sitzung: "s", eintraege: [{ id: "x", art: "laut", zeit: ZEIT }, { id: "d", art: "du", zeit: ZEIT, text: "ok" }] });
    expect(gelesen?.typ === "chat" && gelesen.eintraege.map((e) => e.id)).toEqual(["d"]);
  });

  it.each([
    ["a history without list", { typ: "chat", sitzung: "s", eintraege: "x" }],
    ["a new entry without id", { typ: "chat_neu", sitzung: "s", eintrag: { art: "du", zeit: ZEIT, text: "x" } }],
    ["a new entry of an unknown kind", { typ: "chat_neu", sitzung: "s", eintrag: { id: "x", art: "laut", zeit: ZEIT } }],
    ["a message of mine without text", { typ: "chat_neu", sitzung: "s", eintrag: { id: "x", art: "du", zeit: ZEIT } }],
    ["a tool entry without tool", { typ: "chat_neu", sitzung: "s", eintrag: { id: "x", art: "werkzeug", zeit: ZEIT } }],
    ["a tool with an unknown state", { typ: "chat_neu", sitzung: "s", eintrag: { ...WERKZEUG, werkzeug: { ...WERKZEUG.werkzeug, status: "kaputt" } } }],
    ["an agent without type", { typ: "chat_neu", sitzung: "s", eintrag: { ...AGENT, agent: { beschreibung: "x", status: "laeuft" } } }],
    ["a question without options", { typ: "chat_neu", sitzung: "s", eintrag: { ...FRAGE, frage: { fragen: [{ frage: "x" }] } } }],
    ["a question whose multiple flag is text", { typ: "chat_neu", sitzung: "s", eintrag: { ...FRAGE, frage: { fragen: [{ frage: "x", optionen: [], mehrfach: "ja" }] } } }],
    ["an answer that is a number", { typ: "chat_neu", sitzung: "s", eintrag: { ...FRAGE, frage: { ...FRAGE.frage, beantwortet: { x: 1 } } } }],
    ["a plan with an unknown decision", { typ: "chat_neu", sitzung: "s", eintrag: { ...PLAN, plan: { text: "x", entschieden: "vielleicht" } } }],
    ["a time that is no date", { typ: "chat_neu", sitzung: "s", eintrag: { id: "x", art: "du", zeit: "gestern", text: "x" } }],
    ["a parent that is a number", { typ: "chat_neu", sitzung: "s", eintrag: { id: "x", art: "du", zeit: ZEIT, text: "x", eltern: 3 } }],
    ["a piece without text", { typ: "chat_teil", sitzung: "s", id: "c" }],
    ["an update without session", { typ: "chat_aktualisiert", eintrag: { id: "d", art: "du", zeit: ZEIT, text: "x" } }],
  ])("refuses %s", (_name, nachricht) => {
    expect(lies(nachricht)).toBeUndefined();
  });
});

describe("chatAnwenden", () => {
  const LEER: Chats = new Map();
  const mit = (eintraege: Eintrag[]): Chats => new Map([["s", eintraege]]);

  it("replaces the history of a session and keeps other sessions", () => {
    const vorher: Chats = new Map([["s", [eintrag("alt")]], ["t", [eintrag("t-1")]]]);
    const nachher = chatAnwenden(vorher, { typ: "chat", sitzung: "s", eintraege: [eintrag("neu")] }, ZEIT);
    expect([...nachher.entries()].map(([id, liste]) => [id, liste.map((e) => e.id)])).toEqual([["s", ["neu"]], ["t", ["t-1"]]]);
  });

  it("appends a new entry", () => {
    expect(chatAnwenden(mit([eintrag("a")]), { typ: "chat_neu", sitzung: "s", eintrag: eintrag("b") }, ZEIT).get("s")?.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("starts the history of an unknown session with a new entry", () => {
    expect(chatAnwenden(LEER, { typ: "chat_neu", sitzung: "s", eintrag: eintrag("a") }, ZEIT).get("s")).toEqual([eintrag("a")]);
  });

  it("replaces a new entry whose id it already has instead of doubling it", () => {
    const nachher = chatAnwenden(mit([eintrag("a", { text: "alt" })]), { typ: "chat_neu", sitzung: "s", eintrag: eintrag("a", { text: "neu" }) }, ZEIT);
    expect(nachher.get("s")).toEqual([eintrag("a", { text: "neu" })]);
  });

  it("lets streamed text grow", () => {
    const eins = chatAnwenden(mit([eintrag("c", { text: "Hal" })]), { typ: "chat_teil", sitzung: "s", id: "c", text: "lo " }, ZEIT);
    const zwei = chatAnwenden(eins, { typ: "chat_teil", sitzung: "s", id: "c", text: "Welt" }, ZEIT);
    expect(zwei.get("s")?.[0]?.text).toBe("Hallo Welt");
  });

  it("starts a Claude entry when a piece arrives before its entry", () => {
    expect(chatAnwenden(LEER, { typ: "chat_teil", sitzung: "s", id: "c", text: "Hal" }, ZEIT + 5).get("s")).toEqual([eintrag("c", { text: "Hal", zeit: ZEIT + 5 })]);
  });

  it("grows an entry without text from nothing", () => {
    expect(chatAnwenden(mit([eintrag("c", { text: null })]), { typ: "chat_teil", sitzung: "s", id: "c", text: "x" }, ZEIT).get("s")?.[0]?.text).toBe("x");
  });

  it("replaces an updated entry in place", () => {
    const nachher = chatAnwenden(mit([eintrag("a"), eintrag("b"), eintrag("c")]), { typ: "chat_aktualisiert", sitzung: "s", eintrag: eintrag("b", { text: "fertig" }) }, ZEIT);
    expect(nachher.get("s")?.map((e) => [e.id, e.text])).toEqual([["a", ""], ["b", "fertig"], ["c", ""]]);
  });

  it("appends an updated entry it does not know", () => {
    expect(chatAnwenden(mit([eintrag("a")]), { typ: "chat_aktualisiert", sitzung: "s", eintrag: eintrag("b") }, ZEIT).get("s")?.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not change the history it got", () => {
    const vorher = mit([eintrag("c", { text: "a" })]);
    chatAnwenden(vorher, { typ: "chat_teil", sitzung: "s", id: "c", text: "b" }, ZEIT);
    expect(vorher.get("s")?.[0]?.text).toBe("a");
  });

  it("forgets histories of sessions that are gone", () => {
    const vorher: Chats = new Map([["s", [eintrag("a")]], ["t", [eintrag("b")]]]);
    expect([...chatsBehalten(vorher, new Set(["t"])).keys()]).toEqual(["t"]);
  });
});

describe("verschachteln", () => {
  it("puts entries under the agent call they belong to, nested", () => {
    const liste = [eintrag("a", { art: "agent" }), eintrag("x", { eltern: "a" }), eintrag("b", { art: "agent", eltern: "a" }), eintrag("y", { eltern: "b" }), eintrag("z")];
    const baum = verschachteln(liste);
    expect(baum.map((k) => [k.eintrag.id, k.kinder.map((kind) => [kind.eintrag.id, kind.kinder.map((enkel) => enkel.eintrag.id)])])).toEqual([
      ["a", [["x", []], ["b", ["y"]]]], ["z", []],
    ]);
  });

  it("keeps an entry with an unknown parent on the top level", () => {
    expect(verschachteln([eintrag("x", { eltern: "fehlt" })]).map((k) => k.eintrag.id)).toEqual(["x"]);
  });

  it("keeps an entry whose parent comes later on the top level, so no loop can form", () => {
    const baum = verschachteln([eintrag("a", { eltern: "b" }), eintrag("b", { eltern: "a" })]);
    expect(baum.map((k) => [k.eintrag.id, k.kinder.map((kind) => kind.eintrag.id)])).toEqual([["a", ["b"]]]);
  });

  it("keeps an entry that names itself as parent on the top level", () => {
    expect(verschachteln([eintrag("a", { eltern: "a" })]).map((k) => k.eintrag.id)).toEqual(["a"]);
  });
});

describe("fragenAntwort", () => {
  const EINE: Teilfrage = { frage: "Farbe?", kopf: "Farbe", optionen: [{ label: "Rot", beschreibung: "" }, { label: "Blau", beschreibung: "" }], mehrfach: false };
  const MEHR: Teilfrage = { frage: "Teile?", kopf: "Teile", optionen: [{ label: "A", beschreibung: "" }, { label: "B", beschreibung: "" }], mehrfach: true };

  it("answers a single choice with the chosen label as text", () => {
    expect(fragenAntwort([EINE], { "Farbe?": { gewaehlt: ["Blau"], eigene: "" } })).toEqual({ "Farbe?": "Blau" });
  });

  it("answers a single choice with the own answer, which wins over a chosen label", () => {
    expect(fragenAntwort([EINE], { "Farbe?": { gewaehlt: ["Rot"], eigene: "  Grün  " } })).toEqual({ "Farbe?": "Grün" });
  });

  it("answers a multiple choice with a list of the chosen labels in option order and the own answer last", () => {
    expect(fragenAntwort([MEHR], { "Teile?": { gewaehlt: ["B", "A"], eigene: "C" } })).toEqual({ "Teile?": ["A", "B", "C"] });
  });

  it("answers a multiple choice with only the own answer", () => {
    expect(fragenAntwort([MEHR], { "Teile?": { gewaehlt: [], eigene: "C" } })).toEqual({ "Teile?": ["C"] });
  });

  it("answers several questions at once", () => {
    expect(fragenAntwort([EINE, MEHR], { "Farbe?": { gewaehlt: ["Rot"], eigene: "" }, "Teile?": { gewaehlt: ["A"], eigene: "" } })).toEqual({ "Farbe?": "Rot", "Teile?": ["A"] });
  });

  it.each([
    ["a question without any choice", { "Farbe?": { gewaehlt: [], eigene: "" } }],
    ["a question with only spaces as own answer", { "Farbe?": { gewaehlt: [], eigene: "   " } }],
    ["a question nobody touched", {}],
  ])("gives no answer while %s is open", (_name, wahl) => {
    expect(fragenAntwort([EINE], wahl)).toBeNull();
  });

  it("ignores a chosen label the question does not offer", () => {
    expect(fragenAntwort([EINE], { "Farbe?": { gewaehlt: ["Lila"], eigene: "" } })).toBeNull();
  });
});

describe("messages of the chat to the bridge", () => {
  it("sends a message with its text, without the trailing empty lines", () => {
    expect(nachrichtLesen("s", "  Hallo\nWelt\n\n")).toEqual({ kind: "ok", nachricht: { typ: "nachricht", sitzung: "s", text: "  Hallo\nWelt" } });
  });

  it.each(["", "   ", "\n\n"])("sends nothing for the empty text %j", (text) => {
    expect(nachrichtLesen("s", text)).toEqual({ kind: "leer" });
  });

  it("sends a message of exactly the longest length and refuses one character more", () => {
    expect(nachrichtLesen("s", "x".repeat(LAENGSTE_NACHRICHT)).kind).toBe("ok");
    expect(nachrichtLesen("s", "x".repeat(LAENGSTE_NACHRICHT + 1)).kind).toBe("zu_lang");
    expect(LAENGSTE_NACHRICHT).toBe(100_000);
  });

  it("builds stop, answer and plan messages", () => {
    expect(abbrechen("s")).toEqual({ typ: "abbrechen", sitzung: "s" });
    expect(frageAntwort("s", "f-1", { "Farbe?": "Rot" })).toEqual({ typ: "frage_antwort", sitzung: "s", eintrag: "f-1", antworten: { "Farbe?": "Rot" } });
    expect(planAntwort("s", "p-1", "ja")).toEqual({ typ: "plan_antwort", sitzung: "s", eintrag: "p-1", entscheidung: "ja" });
  });
});

describe("amEnde", () => {
  it.each([
    [{ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }, true],
    [{ scrollTop: 568, scrollHeight: 1000, clientHeight: 400 }, true],
    [{ scrollTop: 567, scrollHeight: 1000, clientHeight: 400 }, false],
    [{ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }, true],
    [{ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }, false],
  ])("follows new content at %j: %s", (lage, folgen) => {
    expect(amEnde(lage)).toBe(folgen);
  });
});

describe("kuerzen and ersteZeile", () => {
  it("keeps text up to the limit and shortens one character more", () => {
    expect(kuerzen("abcd", 4)).toEqual({ text: "abcd", gekuerzt: false });
    expect(kuerzen("abcde", 4)).toEqual({ text: "abcd", gekuerzt: true });
  });

  it("takes the first non-empty line, shortened with an ellipsis", () => {
    expect(ersteZeile("\n  erste  \nzweite", 20)).toBe("erste");
    expect(ersteZeile("abcdef", 4)).toBe("abc…");
    expect(ersteZeile("abcd", 4)).toBe("abcd");
    expect(ersteZeile("", 4)).toBe("");
  });
});

describe("ansageText", () => {
  it("announces the last answer of Claude", () => {
    expect(ansageText([eintrag("d", { art: "du", text: "x" }), eintrag("c", { text: "Fertig. **Alles** grün." })])).toBe("Claude: Fertig. **Alles** grün.");
  });

  it("announces a question or a plan Claude asks for", () => {
    expect(ansageText([eintrag("f", { art: "frage", frage: { fragen: [{ frage: "Welche?", kopf: "", optionen: [], mehrfach: false }], beantwortet: null } })])).toBe("Claude fragt: Welche?");
    expect(ansageText([eintrag("p", { art: "plan", plan: { text: "x", entschieden: null } })])).toBe("Claude legt einen Plan zur Freigabe vor.");
  });

  it("announces nothing after own messages or tools only", () => {
    expect(ansageText([eintrag("d", { art: "du", text: "x" }), eintrag("w", { art: "werkzeug" })])).toBe("");
  });

  it("shortens long answers", () => {
    expect(ansageText([eintrag("c", { text: "x".repeat(500) })]).length).toBeLessThanOrEqual(310);
  });
});

import { describe, expect, it } from "vitest";
import { assistenzHinzu } from "./useBruecke";
import { leseNachricht, type AssistenzAntwort } from "./verbindung";

const ANTWORT: AssistenzAntwort = { sitzung: "s-1", frage: "f-1", name: "Mia", entscheidung: "ja", werkzeug: "Bash", beschreibung: "npm test" };

describe("reading an answer of the assistant", () => {
  it("reads the message the bridge sends when Mia answered", () => {
    expect(leseNachricht(JSON.stringify({ typ: "assistenz_antwort", ...ANTWORT }))).toEqual({ typ: "assistenz_antwort", ...ANTWORT });
  });

  it("accepts an empty description and the answer no", () => {
    expect(leseNachricht(JSON.stringify({ typ: "assistenz_antwort", ...ANTWORT, entscheidung: "nein", beschreibung: "" }))).toMatchObject({ entscheidung: "nein", beschreibung: "" });
  });

  it.each([
    ["Immer as decision", { entscheidung: "immer" }],
    ["a missing question", { frage: "" }],
    ["a name that is no text", { name: 7 }],
    ["a description that is no text", { beschreibung: null }],
    ["a missing tool", { werkzeug: "" }],
  ])("refuses %s", (_case, aenderung) => {
    expect(leseNachricht(JSON.stringify({ typ: "assistenz_antwort", ...ANTWORT, ...aenderung }))).toBeUndefined();
  });
});

describe("assistenzHinzu", () => {
  it("puts the newest answer first and keeps one entry per question", () => {
    const zweite = { ...ANTWORT, frage: "f-2" };
    expect(assistenzHinzu(assistenzHinzu([], ANTWORT), zweite).map((antwort) => antwort.frage)).toEqual(["f-2", "f-1"]);
    expect(assistenzHinzu([zweite, ANTWORT], { ...ANTWORT, entscheidung: "nein" })).toEqual([{ ...ANTWORT, entscheidung: "nein" }, zweite]);
  });

  it("keeps at most five answers", () => {
    const viele = Array.from({ length: 7 }, (_, stelle) => ({ ...ANTWORT, frage: `f-${String(stelle)}` }));
    const liste = viele.reduce<readonly AssistenzAntwort[]>((alt, antwort) => assistenzHinzu(alt, antwort), []);
    expect(liste.map((antwort) => antwort.frage)).toEqual(["f-6", "f-5", "f-4", "f-3", "f-2"]);
  });
});

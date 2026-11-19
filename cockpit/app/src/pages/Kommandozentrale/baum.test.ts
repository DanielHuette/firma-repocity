import { describe, expect, it } from "vitest";
import { BAUM_BREITE, KNOTEN_HOEHE, PRO_REIHE, baumAnordnung, brauchtDich, kantenPfad, kuerzen, platzFuer, umwegPfad, unterzeile } from "./baum";
import type { Agent } from "./verbindung";

function agent(id: string, eltern: string | null, stand: Agent["stand"] = "laeuft", extra: Partial<Agent> = {}): Agent {
  return { id, eltern, name: id, typ: "general-purpose", stand, werkzeug: null, aufrufe: 0, seit: 0, skills: [], fortschritt: null, ...extra };
}

describe("kantenPfad", () => {
  it("draws a straight line when the child sits right below its parent", () => {
    expect(kantenPfad({ x: 140, y: 5 }, { x: 140, y: 113 }, KNOTEN_HOEHE)).toBe("M140 47 L140 113");
  });

  it("drops a little, then curves over to a child on the side", () => {
    expect(kantenPfad({ x: 140, y: 5 }, { x: 46.7, y: 113 }, KNOTEN_HOEHE)).toBe("M140 47 L140 59 C140 99 46.7 67 46.7 113");
  });

  it("starts below a taller node", () => {
    expect(kantenPfad({ x: 140, y: 5 }, { x: 140, y: 127 }, 56)).toBe("M140 61 L140 127");
  });
});

describe("umwegPfad", () => {
  it("leads around the row in between along the left lane", () => {
    expect(umwegPfad({ x: 185, y: 5 }, { x: 70, y: 197 }, KNOTEN_HOEHE)).toBe("M185 47 L185 59 L4 59 L4 185 L70 185 L70 197");
  });
});

describe("baumAnordnung", () => {
  it("puts the main session alone in the middle of the top row", () => {
    const baum = baumAnordnung([agent("haupt", null)]);
    expect(baum.knoten).toEqual([{ agent: agent("haupt", null), x: 185, y: 5, breite: 160 }]);
    expect(baum.kanten).toEqual([]);
    expect(baum.breite).toBe(BAUM_BREITE);
    expect(baum.hoehe).toBe(5 + KNOTEN_HOEHE + 5);
    expect(baum.knotenHoehe).toBe(KNOTEN_HOEHE);
  });

  it("keeps nodes the same height when agents used skills", () => {
    const baum = baumAnordnung([agent("haupt", null), agent("a", "haupt", "laeuft", { skills: ["grill-me"] })]);
    expect(baum.knotenHoehe).toBe(KNOTEN_HOEHE);
    expect(baum.knoten.map((knoten) => knoten.y)).toEqual([5, 101]);
  });

  it("spreads three sub-agents evenly below and lets light flow only towards running ones", () => {
    const baum = baumAnordnung([agent("haupt", null), agent("a", "haupt", "fertig"), agent("b", "haupt"), agent("c", "haupt", "wartet")]);
    expect(baum.knoten.map((knoten) => [knoten.agent.id, knoten.x, knoten.y, knoten.breite])).toEqual([
      ["haupt", 185, 5, 160], ["a", 68.3, 101, 112], ["b", 185, 101, 112], ["c", 301.7, 101, 112],
    ]);
    expect(baum.kanten.map((kante) => [kante.zu.agent.id, kante.fliesst, kante.stand])).toEqual([
      ["a", false, "fertig"], ["b", true, "laeuft"], ["c", false, "wartet"],
    ]);
    expect(baum.kanten[0]?.pfad).toBe(kantenPfad({ x: 185, y: 5 }, { x: 68.3, y: 101 }, KNOTEN_HOEHE));
    expect(baum.hoehe).toBe(101 + KNOTEN_HOEHE + 5);
  });

  it("hangs agents of agents one row lower below their parent's row", () => {
    const baum = baumAnordnung([agent("haupt", null), agent("a", "haupt"), agent("a1", "a")]);
    expect(baum.knoten.map((knoten) => [knoten.agent.id, knoten.y])).toEqual([["haupt", 5], ["a", 101], ["a1", 197]]);
    expect(baum.kanten.map((kante) => [kante.von.agent.id, kante.zu.agent.id])).toEqual([["haupt", "a"], ["a", "a1"]]);
    expect(baum.kanten[1]?.pfad).toBe(kantenPfad({ x: 185, y: 101 }, { x: 185, y: 197 }, KNOTEN_HOEHE));
  });

  it("hangs an agent with an unknown parent below the main session", () => {
    const baum = baumAnordnung([agent("haupt", null), agent("x", "verschwunden")]);
    expect(baum.kanten.map((kante) => [kante.von.agent.id, kante.zu.agent.id])).toEqual([["haupt", "x"]]);
  });

  it("does not loop on agents that name each other as parent", () => {
    const baum = baumAnordnung([agent("haupt", null), agent("a", "b"), agent("b", "a")]);
    expect(baum.knoten).toHaveLength(3);
    expect(baum.knoten.every((knoten) => knoten.y === 5 || knoten.y === 101)).toBe(true);
  });

  it("wraps many agents into rows of three instead of shrinking them", () => {
    expect(PRO_REIHE).toBe(3);
    const kinder = ["a", "b", "c", "d", "e", "f", "g"].map((id) => agent(id, "haupt"));
    const baum = baumAnordnung([agent("haupt", null), ...kinder]);
    expect(baum.breite).toBe(BAUM_BREITE);
    expect(baum.knoten.slice(1).map((knoten) => [knoten.agent.id, knoten.x, knoten.y, knoten.breite])).toEqual([
      ["a", 68.3, 101, 112], ["b", 185, 101, 112], ["c", 301.7, 101, 112],
      ["d", 68.3, 197, 112], ["e", 185, 197, 112], ["f", 301.7, 197, 112],
      ["g", 185, 293, 112],
    ]);
    expect(baum.hoehe).toBe(293 + KNOTEN_HOEHE + 5);
  });

  it("leads edges to wrapped rows around the rows in between, but curves to the first row", () => {
    const kinder = ["a", "b", "c", "d"].map((id) => agent(id, "haupt"));
    const baum = baumAnordnung([agent("haupt", null), ...kinder]);
    const haupt = { x: 185, y: 5 };
    expect(baum.kanten[2]?.pfad).toBe(kantenPfad(haupt, { x: 301.7, y: 101 }, KNOTEN_HOEHE));
    expect(baum.kanten[3]?.pfad).toBe(umwegPfad(haupt, { x: 185, y: 197 }, KNOTEN_HOEHE));
  });

  it("gives only the top row the wide main node", () => {
    const baum = baumAnordnung([agent("a", "b"), agent("b", "a")]);
    expect(baum.knoten.every((knoten) => knoten.breite === 160 || knoten.y > 5)).toBe(true);
  });

  it("draws nothing without agents", () => {
    expect(baumAnordnung([])).toEqual({ knoten: [], kanten: [], breite: BAUM_BREITE, hoehe: 0, knotenHoehe: KNOTEN_HOEHE });
  });
});

describe("kuerzen", () => {
  it.each([["Prüfer", 8, "Prüfer"], ["Gegenstimme", 11, "Gegenstimme"], ["Gegenstimme", 8, "Gegenst…"], ["abc", 1, "…"]])(
    "shortens %j to %i signs",
    (text, zeichen, erwartet) => {
      expect(kuerzen(text, zeichen)).toBe(erwartet);
    },
  );
});

describe("platzFuer", () => {
  it.each([[160, 20], [112, 13]])("fits %i units of width with %i signs of the label", (breite, zeichen) => {
    expect(platzFuer(breite)).toBe(zeichen);
  });
});

describe("unterzeile", () => {
  it.each([
    [agent("a", "haupt", "laeuft", { werkzeug: "WebFetch", aufrufe: 6 }), "WebFetch · 6×"],
    [agent("a", "haupt", "laeuft", { typ: "Explore" }), "Explore · 0×"],
    [agent("a", "haupt", "fertig", { aufrufe: 14 }), "fertig · 14×"],
    [agent("a", "haupt", "wartet"), "wartet auf dich"],
  ])("describes %o as %j", (eintrag, text) => {
    expect(unterzeile(eintrag)).toBe(text);
  });
});

describe("brauchtDich", () => {
  it("names the agents waiting for an answer in their order", () => {
    const agenten = [agent("haupt", null, "wartet", { name: "Hauptsitzung" }), agent("a", "haupt"), agent("b", "haupt", "wartet", { name: "Bauagent" })];
    expect(brauchtDich(agenten)).toEqual(["Hauptsitzung", "Bauagent"]);
  });
});

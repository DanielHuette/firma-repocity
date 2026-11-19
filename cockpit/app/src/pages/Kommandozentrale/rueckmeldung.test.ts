import { describe, expect, it } from "vitest";
import { BESTAETIGUNG_MS, antwortLage, steuerungsText } from "./rueckmeldung";

const GESENDET = { um: 10_000, letzteMeldung: 3 };

describe("antwortLage", () => {
  it("is free while nothing was sent", () => {
    expect(antwortLage(null, [], 99_999)).toEqual({ kind: "frei" });
  });

  it("waits for the bridge for 5 seconds", () => {
    expect(BESTAETIGUNG_MS).toBe(5000);
    expect(antwortLage(GESENDET, [{ nummer: 3, text: "alt" }], 10_000 + 4999)).toEqual({ kind: "gesendet" });
  });

  it("frees the buttons with the reason when the bridge reports an error after sending", () => {
    const meldungen = [{ nummer: 3, text: "alt" }, { nummer: 4, text: "Dieses Gerät steuert nicht; erst übernehmen." }];
    expect(antwortLage(GESENDET, meldungen, 10_001)).toEqual({ kind: "abgelehnt", text: "Dieses Gerät steuert nicht; erst übernehmen." });
  });

  it("names the newest error when several came back", () => {
    const meldungen = [{ nummer: 5, text: "erste" }, { nummer: 7, text: "neueste" }];
    expect(antwortLage(GESENDET, meldungen, 10_001)).toEqual({ kind: "abgelehnt", text: "neueste" });
  });

  it("ignores errors that were there before sending", () => {
    expect(antwortLage(GESENDET, [{ nummer: 2, text: "alt" }, { nummer: 3, text: "alt 2" }], 10_001)).toEqual({ kind: "gesendet" });
  });

  it("frees the buttons when the question is still waiting after 5 seconds", () => {
    expect(antwortLage(GESENDET, [], 10_000 + 5000)).toEqual({ kind: "unbestaetigt" });
  });
});

describe("steuerungsText", () => {
  it.each([
    ["zusehen", false, null, "Du siehst zu. Gerade steuert kein Gerät."],
    ["zusehen", false, "Handy", "Du siehst zu. „Handy“ steuert."],
    ["arbeiten", false, null, "Gerade steuert kein Gerät."],
    ["arbeiten", false, "Handy", "„Handy“ steuert gerade."],
    ["arbeiten", true, "Handy", "„Handy“ hat übernommen. Du siehst jetzt zu."],
    ["arbeiten", true, null, "Gerade steuert kein Gerät."],
  ] as const)("in mode %s, after controlling %s, with %s controlling says %j", (modus, warSteuernd, name, text) => {
    expect(steuerungsText(modus, warSteuernd, name === null ? null : { name, du: false })).toBe(text);
  });
});

import { describe, expect, it } from "vitest";
import { immerAnbieten, kontextAnzeige, laufzeit, regelZeilen, reiterStand, seitText, uhrzeitText } from "./anzeige";
import type { Regel } from "./verbindung";

describe("kontextAnzeige", () => {
  it.each([
    [null, false],
    [38, true],
    [Number.NaN, false],
    [-1, false],
  ])("shows no data for %s (stale: %s)", (prozent, veraltet) => {
    expect(kontextAnzeige(prozent, veraltet)).toEqual({ kind: "keine_daten" });
  });

  it("shows an empty bar in the faintest gold at 0", () => {
    expect(kontextAnzeige(0, false)).toEqual({ kind: "wert", prozent: 0, text: "0 %", farbe: "rgb(168,140,96)", schein: "0 0 4px rgba(201,169,110,0.20)", leuchten: "0.25" });
  });

  it("shows a full bar in the strongest gold at 100", () => {
    expect(kontextAnzeige(100, false)).toEqual({ kind: "wert", prozent: 100, text: "100 %", farbe: "rgb(255,236,190)", schein: "0 0 14px rgba(201,169,110,0.80)", leuchten: "1.00" });
  });

  it("uses the light gold in the middle", () => {
    expect(kontextAnzeige(50, false)).toMatchObject({ farbe: "rgb(234,215,174)" });
  });

  it("rounds the number but keeps the exact share for the bar", () => {
    expect(kontextAnzeige(37.6, false)).toMatchObject({ prozent: 37.6, text: "38 %" });
  });

  it("caps a share above 100 at a full bar", () => {
    expect(kontextAnzeige(104, false)).toMatchObject({ prozent: 100, text: "100 %" });
  });
});

describe("uhrzeitText", () => {
  it("names weekday, date and time like the header of the design", () => {
    expect(uhrzeitText(new Date(2026, 10, 18, 9, 5))).toBe("Mi 18.11. · 09:05");
  });
});

describe("seitText", () => {
  it("gives the time of the last contact to the second", () => {
    expect(seitText(new Date(2026, 10, 18, 9, 5, 7).getTime())).toBe("09:05:07");
  });
});

describe("laufzeit", () => {
  it.each([[0, "0:00"], [40_000, "0:40"], [59_999, "0:59"], [60_000, "1:00"], [3_599_000, "59:59"], [3_725_000, "1:02:05"], [-5_000, "0:00"]])(
    "shows %i ms as %s",
    (ms, text) => {
      expect(laufzeit(ms)).toBe(text);
    },
  );
});

describe("regelZeilen", () => {
  const regel = (felder: Record<string, unknown>): Regel => ({ type: "addRules", destination: "localSettings", ...felder });

  it.each([
    [regel({ behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "npm test:*" }] }), "Immer erlauben: Bash(npm test:*) – gespeichert in den lokalen Projekt-Einstellungen"],
    [regel({ behavior: "deny", rules: [{ toolName: "WebFetch" }], destination: "userSettings" }), "Immer verbieten: WebFetch – gespeichert in deinen Benutzer-Einstellungen"],
    [regel({ behavior: "ask", rules: [{ toolName: "Edit" }, { toolName: "Write" }], destination: "projectSettings" }), "Immer nachfragen: Edit, Write – gespeichert in den Projekt-Einstellungen"],
    [regel({ type: "replaceRules", behavior: "allow", rules: [{ toolName: "Read" }], destination: "session" }), "Regeln ersetzen durch erlauben: Read – nur für diese Sitzung"],
    [regel({ type: "removeRules", behavior: "allow", rules: [{ toolName: "Read" }] }), "Regel entfernen (erlauben): Read – gespeichert in den lokalen Projekt-Einstellungen"],
    [regel({ type: "setMode", mode: "acceptEdits", destination: "session" }), "Modus wechseln zu acceptEdits – nur für diese Sitzung"],
    [regel({ type: "addDirectories", directories: ["/srv/a", "/srv/b"], destination: "session" }), "Ordner freigeben: /srv/a, /srv/b – nur für diese Sitzung"],
    [regel({ type: "removeDirectories", directories: ["/srv/a"], destination: "session" }), "Ordner entziehen: /srv/a – nur für diese Sitzung"],
    [regel({ type: "neuartig", destination: "irgendwo" }), "Regel: {\"type\":\"neuartig\",\"destination\":\"irgendwo\"}"],
  ])("explains %o", (eintrag, zeile) => {
    expect(regelZeilen([eintrag])).toEqual([zeile]);
  });
});

describe("reiterStand", () => {
  it.each([
    ["arbeitet", "laeuft", "arbeitet"],
    ["wartet", "laeuft", "wartet"],
    ["ruht", "laeuft", "ruht"],
    ["arbeitet", "beendet", "beendet"],
  ] as const)("shows a session that %s with process %s as %s", (stand, prozess, erwartet) => {
    expect(reiterStand(stand, prozess)).toBe(erwartet);
  });
});

describe("immerAnbieten", () => {
  const frage = { id: "f-1", agent: "haupt", werkzeug: "Bash", beschreibung: "npm test", regelBeiImmer: [{ type: "addRules", destination: "session" }] };

  it.each([
    [false, frage, true],
    [true, frage, false],
    [false, { ...frage, regelBeiImmer: null }, false],
  ] as const)("offers always in a check session %s for %o: %s", (pruefung, eintrag, erwartet) => {
    expect(immerAnbieten({ pruefung }, eintrag)).toBe(erwartet);
  });
});

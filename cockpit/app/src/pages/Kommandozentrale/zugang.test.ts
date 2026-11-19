import { describe, expect, it } from "vitest";
import { KEINE_BRUECKE, statusAbfragen, type Holen } from "./zugang";

interface Aufruf {
  readonly adresse: string;
  readonly methode: string | undefined;
}

function holenMit(antwort: Response | Error): { holen: Holen; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const holen: Holen = (adresse, optionen) => {
    aufrufe.push({ adresse, methode: optionen?.method });
    return antwort instanceof Error ? Promise.reject(antwort) : Promise.resolve(antwort);
  };
  return { holen, aufrufe };
}

const json = (koerper: unknown, status = 200) => new Response(JSON.stringify(koerper), { status, headers: { "content-type": "application/json" } });

describe("statusAbfragen", () => {
  it.each([
    ["a ready answer", json({ bereit: true }), "bereit"],
    ["a ready answer with more fields", json({ bereit: true, version: "0.1.0" }), "bereit"],
    ["a failure", new Response(null, { status: 500 }), "unbekannt"],
    ["a refused host", new Response(null, { status: 403 }), "unbekannt"],
    ["an unreachable bridge", new TypeError("Failed to fetch"), "unbekannt"],
    ["the app page instead of the bridge", new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }), "keine_bruecke"],
    ["JSON without ready flag", json({ ok: true }), "keine_bruecke"],
    ["JSON whose ready flag is text", json({ bereit: "ja" }), "keine_bruecke"],
    ["JSON that says not ready", json({ bereit: false }), "keine_bruecke"],
    ["JSON that is no object", json([true]), "keine_bruecke"],
    ["broken JSON", new Response("{", { status: 200, headers: { "content-type": "application/json" } }), "keine_bruecke"],
  ] as const)("reads %s", async (_name, antwort, erwartet) => {
    const { holen, aufrufe } = holenMit(antwort);
    expect(await statusAbfragen(holen)).toBe(erwartet);
    expect(aufrufe).toEqual([{ adresse: "/status", methode: undefined }]);
  });

  it("passes on errors other than an unreachable network", async () => {
    const { holen } = holenMit(new RangeError("kaputt"));
    await expect(statusAbfragen(holen)).rejects.toThrow(RangeError);
  });

  it("explains that the page needs the bridge", () => {
    expect(KEINE_BRUECKE).toBe("Die Kommandozentrale läuft nur über die Brücke auf deinem Rechner. Öffne sie über die Adresse der Brücke.");
  });
});

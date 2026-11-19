import type { Pruefung } from "./verbindung";

export type Holen = (adresse: string, optionen?: RequestInit) => Promise<Response>;

const JSON_ART = /^application\/json(\s*;.*)?$/i;

export const KEINE_BRUECKE = "Die Kommandozentrale läuft nur über die Brücke auf deinem Rechner. Öffne sie über die Adresse der Brücke.";

async function bereitGemeldet(antwort: Response): Promise<boolean> {
  if (!JSON_ART.test(antwort.headers.get("content-type") ?? "")) return false;
  const text = await antwort.text();
  try {
    const koerper: unknown = JSON.parse(text);
    return typeof koerper === "object" && koerper !== null && "bereit" in koerper && koerper.bereit === true;
  } catch (fehler: unknown) {
    if (fehler instanceof SyntaxError) return false;
    throw fehler;
  }
}

async function statusHolen(holen: Holen): Promise<Response | null> {
  try {
    return await holen("/status", { cache: "no-store" });
  } catch (fehler: unknown) {
    if (fehler instanceof TypeError) return null;
    throw fehler;
  }
}

export async function statusAbfragen(holen: Holen): Promise<Pruefung> {
  const antwort = await statusHolen(holen);
  if (antwort?.status !== 200) return "unbekannt";
  return (await bereitGemeldet(antwort)) ? "bereit" : "keine_bruecke";
}

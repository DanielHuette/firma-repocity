import { befehl } from "./chat";
import type { ClientNachricht, OrdnerEintrag, SitzungsZustand } from "./verbindung";

export type Bereich = "kontext" | "agenten" | "fragen";
export type SchwelleGelesen = { readonly kind: "ok"; readonly wert: number } | { readonly kind: "fehler"; readonly text: string };
export type SuchAnfrage =
  | { readonly kind: "leer" }
  | { readonly kind: "fehler"; readonly text: string }
  | { readonly kind: "ok"; readonly nachricht: ClientNachricht };

export const SCHWELLE_MINDESTENS = 10_000;
export const SCHWELLE_HOECHSTENS = 1_000_000;
export const LAENGSTE_SUCHE = 200;
const MINUTE_MS = 60_000;
const TAUSENDER = /[. ]/g;
const ZIFFERN_MIT_TRENNERN = /^\d{1,3}(?:[. ]?\d{3})*$/;
const UNSICHTBAR_ODER_STEUERZEICHEN = /[\p{Cc}\p{Cf}]/u;
const KEINE_ZAHL = "Bitte eine ganze Zahl eingeben, etwa 200.000.";
const AUSSERHALB = "Erlaubt sind 10.000 bis 1.000.000 Tokens.";
const ZU_LANG = "Höchstens 200 Zeichen.";
const STEUERZEICHEN = "Steuer- und unsichtbare Zeichen sind nicht erlaubt.";

export function ordnerFiltern(liste: readonly OrdnerEintrag[], suche: string): OrdnerEintrag[] {
  const gesucht = suche.trim().toLowerCase();
  return liste.filter((ordner) => ordner.name.toLowerCase().includes(gesucht) || ordner.pfad.toLowerCase().includes(gesucht));
}

export const AUFWAND_STUFEN: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: "low", text: "niedrig (low)" },
  { wert: "medium", text: "mittel (medium)" },
  { wert: "high", text: "hoch (high)" },
  { wert: "xhigh", text: "sehr hoch (xhigh)" },
  { wert: "max", text: "höchster (max)" },
  { wert: "auto", text: "Vorgabe des Modells (auto)" },
];

export function aufwandSetzen(sitzung: string, stufe: string): ClientNachricht {
  return befehl(sitzung, `/effort ${stufe}`);
}

export function modellSetzen(sitzung: string, modell: string): ClientNachricht {
  return befehl(sitzung, `/model ${modell}`);
}

export function schwelleLesen(text: string): SchwelleGelesen {
  const ziffern = text.trim();
  if (!ZIFFERN_MIT_TRENNERN.test(ziffern)) return { kind: "fehler", text: KEINE_ZAHL };
  const wert = Number(ziffern.replace(TAUSENDER, ""));
  if (wert < SCHWELLE_MINDESTENS || wert > SCHWELLE_HOECHSTENS) return { kind: "fehler", text: AUSSERHALB };
  return { kind: "ok", wert };
}

export function suchAnfrage(text: string): SuchAnfrage {
  const gesucht = text.trim();
  if (gesucht === "") return { kind: "leer" };
  if (gesucht.length > LAENGSTE_SUCHE) return { kind: "fehler", text: ZU_LANG };
  if (UNSICHTBAR_ODER_STEUERZEICHEN.test(gesucht)) return { kind: "fehler", text: STEUERZEICHEN };
  return { kind: "ok", nachricht: { typ: "suche", text: gesucht } };
}

export function keineDaten(sitzung: SitzungsZustand | null, bereich: Bereich): boolean {
  return sitzung?.hinweise.some((hinweis) => hinweis.art === "keine_daten" && hinweis.anzeige === bereich) ?? false;
}

export function naechsterReiter(ids: readonly string[], aktiv: string | null, taste: string): string | null {
  if (ids.length === 0) return null;
  const stelle = aktiv === null ? -1 : ids.indexOf(aktiv);
  switch (taste) {
    case "ArrowRight":
      return ids[(stelle + 1) % ids.length] ?? null;
    case "ArrowLeft":
      return ids[(stelle - 1 + ids.length) % ids.length] ?? null;
    case "Home":
      return ids[0] ?? null;
    case "End":
      return ids.at(-1) ?? null;
    default:
      return null;
  }
}

export function bisVolleMinute(jetzt: number): number {
  return MINUTE_MS - (jetzt % MINUTE_MS);
}

export function startzeiten(
  alt: ReadonlyMap<string, number>,
  agenten: readonly { readonly id: string; readonly seit: number }[],
  ankunft: number,
  ersterZustand: boolean,
): Map<string, number> {
  return new Map(agenten.map((agent) => [agent.id, alt.get(agent.id) ?? (ersterZustand ? agent.seit : ankunft)]));
}

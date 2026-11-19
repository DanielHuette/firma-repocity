import type { Modus, Steuerung } from "./verbindung";

export const BESTAETIGUNG_MS = 5000;

export interface Gesendet {
  readonly um: number;
  readonly letzteMeldung: number;
}

export type AntwortLage =
  | { readonly kind: "frei" }
  | { readonly kind: "gesendet" }
  | { readonly kind: "abgelehnt"; readonly text: string }
  | { readonly kind: "unbestaetigt" };

export function antwortLage(
  gesendet: Gesendet | null,
  meldungen: readonly { readonly nummer: number; readonly text: string }[],
  jetzt: number,
): AntwortLage {
  if (gesendet === null) return { kind: "frei" };
  const neue = meldungen.filter((meldung) => meldung.nummer > gesendet.letzteMeldung);
  const neueste = neue.reduce<{ readonly nummer: number; readonly text: string } | null>(
    (bisher, meldung) => (bisher === null || meldung.nummer > bisher.nummer ? meldung : bisher),
    null,
  );
  if (neueste !== null) return { kind: "abgelehnt", text: neueste.text };
  return jetzt - gesendet.um >= BESTAETIGUNG_MS ? { kind: "unbestaetigt" } : { kind: "gesendet" };
}

export function steuerungsText(modus: Modus, warSteuernd: boolean, steuert: Steuerung | null): string {
  if (steuert === null) return modus === "zusehen" ? "Du siehst zu. Gerade steuert kein Gerät." : "Gerade steuert kein Gerät.";
  if (modus === "zusehen") return `Du siehst zu. „${steuert.name}“ steuert.`;
  return warSteuernd ? `„${steuert.name}“ hat übernommen. Du siehst jetzt zu.` : `„${steuert.name}“ steuert gerade.`;
}

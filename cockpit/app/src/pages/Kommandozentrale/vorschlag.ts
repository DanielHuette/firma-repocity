import type { Eintrag } from "./chat";

export type ModellFamilie = "fable" | "opus" | "sonnet";
export type Stufe = "low" | "medium" | "high";

export interface Vorschlag {
  readonly modell: ModellFamilie;
  readonly aufwand: Stufe;
  readonly anzeige: string;
  readonly grund: string;
}

interface Regel {
  readonly muster: RegExp;
  readonly modell: ModellFamilie;
  readonly aufwand: Stufe;
  readonly grund: string;
}

const MODELL_NAME: Readonly<Record<ModellFamilie, string>> = { fable: "Fable 5.2", opus: "Opus 5.5", sonnet: "Sonnet 5.5" };

const REGELN: readonly Regel[] = [
  {
    muster: /migration|migrier|ganze[ns]? projekt|komplette[ns]? projekt|stundenlang|über nacht|nachtschicht|von grund auf neu|opus (?:ist )?gescheitert/,
    modell: "fable",
    aufwand: "low",
    grund: "sehr schwere oder lange Aufgabe",
  },
  {
    muster: /\bplan|entwurf|entwerf|architektur|konzept|prüf|review|audit|sicherheit/,
    modell: "opus",
    aufwand: "high",
    grund: "Planen oder Prüfen",
  },
  {
    muster: /umbau|refactor|fehler|\bbug|debug|absturz|stürzt|recherch|research|analys|untersuch|unbeaufsichtigt|selbständig|selbstständig|autonom/,
    modell: "opus",
    aufwand: "medium",
    grund: "Umbau, Fehlersuche, Recherche oder unbeaufsichtigte Arbeit",
  },
  {
    muster: /implementier|programmier|funktion|\btests?\b|\btesten\b|umbenenn|rename|\btexte?\b|beitrag|artikel/,
    modell: "sonnet",
    aufwand: "high",
    grund: "klar umrissenes Programmieren oder Text schreiben",
  },
  {
    muster: /zusammenfass|\bfass.{0,60}zusammen|umformulier|übersetz|commit|kurze frage|erklär/,
    modell: "sonnet",
    aufwand: "medium",
    grund: "einfache Aufgabe",
  },
];

const IM_ZWEIFEL: Omit<Regel, "muster"> = { modell: "opus", aufwand: "medium", grund: "keine klare Zuordnung" };

function vorschlagAus({ modell, aufwand, grund }: Omit<Regel, "muster">): Vorschlag {
  return { modell, aufwand, anzeige: `${MODELL_NAME[modell]} · ${aufwand}`, grund };
}

export function modellVorschlag(text: string): Vorschlag {
  const klein = text.toLowerCase();
  return vorschlagAus(REGELN.find((regel) => regel.muster.test(klein)) ?? IM_ZWEIFEL);
}

export function neueAufgabe(eintraege: readonly Eintrag[]): boolean {
  const letzte = [...eintraege].reverse().find((eintrag) => eintrag.art === "du");
  return letzte === undefined || (letzte.text ?? "").trim().toLowerCase().startsWith("/clear");
}

export function passtSchon(vorschlag: Vorschlag, modell: string | null, aufwand: string | null): boolean {
  return modell !== null && modell.toLowerCase().includes(vorschlag.modell) && aufwand === vorschlag.aufwand;
}

export function zeigeVorschlag(entwurf: string, eintraege: readonly Eintrag[], modell: string | null, aufwand: string | null): Vorschlag | null {
  const text = entwurf.trim();
  if (text === "" || text.startsWith("/") || !neueAufgabe(eintraege)) return null;
  const vorschlag = modellVorschlag(text);
  return passtSchon(vorschlag, modell, aufwand) ? null : vorschlag;
}

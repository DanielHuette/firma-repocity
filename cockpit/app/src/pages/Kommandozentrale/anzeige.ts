import type { Frage, ProzessStand, Regel, SitzungsStand, SitzungsZustand } from "./verbindung";

export type KontextAnzeige =
  | { readonly kind: "keine_daten" }
  | { readonly kind: "wert"; readonly prozent: number; readonly text: string; readonly farbe: string; readonly schein: string; readonly leuchten: string };

export type ReiterStand = SitzungsStand | "beendet";

type Farbe = readonly [number, number, number];

const GOLD_GEDAEMPFT: Farbe = [168, 140, 96];
const GOLD_HELL: Farbe = [234, 215, 174];
const GOLD_KRAEFTIG: Farbe = [255, 236, 190];
const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const VOLL = 100;

const zweistellig = (wert: number): string => String(wert).padStart(2, "0");

function mischen(von: Farbe, nach: Farbe, anteil: number): string {
  const teile = von.map((wert, stelle) => Math.round(wert + ((nach[stelle] ?? wert) - wert) * anteil));
  return `rgb(${teile.join(",")})`;
}

function goldFuer(anteil: number): string {
  return anteil < 0.5 ? mischen(GOLD_GEDAEMPFT, GOLD_HELL, anteil * 2) : mischen(GOLD_HELL, GOLD_KRAEFTIG, (anteil - 0.5) * 2);
}

export function kontextAnzeige(prozent: number | null, veraltet: boolean): KontextAnzeige {
  if (prozent === null || veraltet || !Number.isFinite(prozent) || prozent < 0) return { kind: "keine_daten" };
  const wert = Math.min(VOLL, prozent);
  const anteil = wert / VOLL;
  return {
    kind: "wert",
    prozent: wert,
    text: `${String(Math.round(wert))} %`,
    farbe: goldFuer(anteil),
    schein: `0 0 ${String(Math.round(4 + anteil * 10))}px rgba(201,169,110,${(0.2 + anteil * 0.6).toFixed(2)})`,
    leuchten: (0.25 + anteil * 0.75).toFixed(2),
  };
}

export function uhrzeitText(datum: Date): string {
  const tag = WOCHENTAGE[datum.getDay()] ?? "";
  return `${tag} ${zweistellig(datum.getDate())}.${zweistellig(datum.getMonth() + 1)}. · ${zweistellig(datum.getHours())}:${zweistellig(datum.getMinutes())}`;
}

export function seitText(zeitpunkt: number): string {
  const datum = new Date(zeitpunkt);
  return `${zweistellig(datum.getHours())}:${zweistellig(datum.getMinutes())}:${zweistellig(datum.getSeconds())}`;
}

export function laufzeit(ms: number): string {
  const sekunden = Math.floor(Math.max(0, ms) / 1000);
  const stunden = Math.floor(sekunden / 3600);
  const minuten = Math.floor((sekunden % 3600) / 60);
  const rest = zweistellig(sekunden % 60);
  return stunden > 0 ? `${String(stunden)}:${zweistellig(minuten)}:${rest}` : `${String(minuten)}:${rest}`;
}

const ORTE: Readonly<Record<string, string>> = {
  session: "nur für diese Sitzung",
  localSettings: "gespeichert in den lokalen Projekt-Einstellungen",
  projectSettings: "gespeichert in den Projekt-Einstellungen",
  userSettings: "gespeichert in deinen Benutzer-Einstellungen",
};

const VERHALTEN: Readonly<Record<string, string>> = { allow: "erlauben", deny: "verbieten", ask: "nachfragen" };

function werkzeugListe(regeln: unknown): string | null {
  if (!Array.isArray(regeln) || regeln.length === 0) return null;
  const namen = (regeln as unknown[]).map((eintrag) => {
    if (typeof eintrag !== "object" || eintrag === null || !("toolName" in eintrag) || typeof eintrag.toolName !== "string") return null;
    const inhalt = "ruleContent" in eintrag && typeof eintrag.ruleContent === "string" ? `(${eintrag.ruleContent})` : "";
    return eintrag.toolName + inhalt;
  });
  return namen.every((name) => name !== null) ? namen.join(", ") : null;
}

function ordnerListe(ordner: unknown): string | null {
  if (!Array.isArray(ordner) || ordner.length === 0 || !(ordner as unknown[]).every((eintrag) => typeof eintrag === "string")) return null;
  return (ordner as string[]).join(", ");
}

function regelHandlung(regel: Regel): string | null {
  const verb = typeof regel.behavior === "string" ? (VERHALTEN[regel.behavior] ?? null) : null;
  const werkzeuge = werkzeugListe(regel.rules);
  const ordner = ordnerListe(regel.directories);
  const mitWerkzeugen = (text: string): string | null => (verb === null || werkzeuge === null ? null : `${text}: ${werkzeuge}`);
  switch (regel.type) {
    case "addRules":
      return mitWerkzeugen(`Immer ${verb ?? ""}`);
    case "replaceRules":
      return mitWerkzeugen(`Regeln ersetzen durch ${verb ?? ""}`);
    case "removeRules":
      return mitWerkzeugen(`Regel entfernen (${verb ?? ""})`);
    case "setMode":
      return typeof regel.mode === "string" ? `Modus wechseln zu ${regel.mode}` : null;
    case "addDirectories":
      return ordner === null ? null : `Ordner freigeben: ${ordner}`;
    case "removeDirectories":
      return ordner === null ? null : `Ordner entziehen: ${ordner}`;
    default:
      return null;
  }
}

function regelZeile(regel: Regel): string {
  const ort = ORTE[regel.destination];
  const handlung = regelHandlung(regel);
  return ort === undefined || handlung === null ? `Regel: ${JSON.stringify(regel)}` : `${handlung} – ${ort}`;
}

export function regelZeilen(regeln: readonly Regel[]): string[] {
  return regeln.map(regelZeile);
}

export function reiterStand(stand: SitzungsStand, prozess: ProzessStand): ReiterStand {
  return prozess === "beendet" ? "beendet" : stand;
}

export function immerAnbieten(sitzung: Pick<SitzungsZustand, "pruefung">, frage: Pick<Frage, "regelBeiImmer">): boolean {
  return !sitzung.pruefung && frage.regelBeiImmer !== null;
}

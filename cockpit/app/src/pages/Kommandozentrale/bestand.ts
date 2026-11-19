import { istAus, istFelder, istText, istTextOderNull, istZahl, liste, type Felder } from "./waechter";

export const BEREICHE = ["Web", "Software", "Agenten", "Dokumente", "Zahlen", "Kunden", "Recherche", "Medien", "Betrieb", "Planung", "Überall", "ohne Bereich"] as const;
export const ERLAUBNIS_MODI = ["default", "acceptEdits", "plan", "auto"] as const;
export const HAKEN_ARTEN = ["skill", "plugin", "konnektor"] as const;
export const WEGE = ["bibliothek", "link", "neu"] as const;
const SKILL_QUELLEN = ["persoenlich", "skillbase", "plugin"] as const;
const KONNEKTOR_ARTEN = ["mcp", "plugin", "claudeai"] as const;
const BESTAND_TYPEN = ["bestand", "optionen", "projekte", "hinzugefuegt"] as const;

export type Bereich = (typeof BEREICHE)[number];
export type Erlaubnis = (typeof ERLAUBNIS_MODI)[number];
export type HakenArt = (typeof HAKEN_ARTEN)[number];
export type Weg = (typeof WEGE)[number];
export type Anbieter = "abo" | "openrouter";

export interface BestandSkill {
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly bereiche: readonly Bereich[];
  readonly sammlung: string | null;
  readonly quelle: (typeof SKILL_QUELLEN)[number];
  readonly immerAktiv: boolean;
}

export interface Plugin {
  readonly kennung: string;
  readonly name: string;
  readonly marktplatz: string;
  readonly beschreibung: string;
  readonly bereiche: readonly Bereich[];
  readonly aktivGlobal: boolean;
  readonly skills: readonly string[];
}

export interface Konnektor {
  readonly kennung: string;
  readonly name: string;
  readonly art: (typeof KONNEKTOR_ARTEN)[number];
  readonly bereiche: readonly Bereich[];
  readonly jeSitzungSchaltbar: boolean;
}

export interface Angebot {
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly bereiche: readonly Bereich[];
  readonly braeuchteGeheimnis: boolean;
}

export type JeArt<T> = Readonly<Record<"skills" | "plugins" | "konnektoren", readonly T[]>>;

export interface Bestand {
  readonly skills: readonly BestandSkill[];
  readonly plugins: readonly Plugin[];
  readonly konnektoren: readonly Konnektor[];
  readonly bibliothek: JeArt<Angebot>;
  readonly favoriten: JeArt<string>;
}

export interface ModellWahl {
  readonly wert: string;
  readonly text: string;
}

export interface FremdModell {
  readonly id: string;
  readonly name: string;
  readonly preisEinProMio: number;
  readonly preisAusProMio: number;
  readonly kontextFenster: number | null;
}

export interface Vorgaben {
  readonly modell: string;
  readonly aufwand: string;
  readonly ordner: string | null;
  readonly ausgabestil: string | null;
  readonly erlaubnis: Erlaubnis;
  readonly skills: readonly string[];
  readonly plugins: readonly string[];
  readonly konnektoren: readonly string[];
}

export interface Optionen {
  readonly erlaubnis: readonly Erlaubnis[];
  readonly ausgabestile: readonly string[];
  readonly modelle: {
    readonly claude: readonly ModellWahl[];
    readonly openrouter: readonly FremdModell[] | null;
    readonly openrouterGrund: string | null;
  };
  readonly vorgaben: Vorgaben;
  readonly linkGesperrt: string | null;
}

export interface Phase {
  readonly phase: string;
  readonly status: string;
  readonly datum: string;
}

export interface Projekt {
  readonly ordner: string;
  readonly name: string;
  readonly zuletzt: number;
  readonly status: { readonly phasen: readonly Phase[]; readonly letzteEntscheidung: string | null } | null;
}

export interface Hinzugefuegt {
  readonly art: HakenArt;
  readonly weg: Weg;
  readonly ok: boolean;
  readonly text: string;
  readonly einrichtung: string | null;
}

export type BestandNachricht =
  | ({ readonly typ: "bestand" } & Bestand)
  | ({ readonly typ: "optionen" } & Optionen)
  | { readonly typ: "projekte"; readonly liste: readonly Projekt[] }
  | ({ readonly typ: "hinzugefuegt" } & Hinzugefuegt);

export type SitzungsSchluessel = "erlaubnis" | "ausgabestil" | "schnell";
type EinstellungsWert<S extends SitzungsSchluessel> = S extends "schnell" ? boolean : string;

export type BestandAnfrage =
  | { readonly typ: "bestand_holen" }
  | { readonly typ: "optionen_holen" }
  | { readonly typ: "projekte_holen" }
  | { readonly typ: "sitzung_umbenennen"; readonly sitzung: string; readonly titel: string }
  | { readonly typ: "haken"; readonly sitzung: string; readonly art: HakenArt; readonly kennung: string; readonly an: boolean }
  | { readonly typ: "favorit"; readonly art: HakenArt; readonly kennung: string; readonly an: boolean }
  | { readonly typ: "sitzung_einstellung"; readonly sitzung: string; readonly schluessel: SitzungsSchluessel; readonly wert: string | boolean }
  | { readonly typ: "vorgaben"; readonly werte: Vorgaben }
  | { readonly typ: "hinzufuegen"; readonly art: HakenArt; readonly weg: Weg; readonly wert: string; readonly sitzung: string | null };

export type Gelesen<T extends string, W> = { readonly kind: "ok" } & Readonly<Record<T, W>> | { readonly kind: "fehler"; readonly grund: "leer" | "zu_lang" | "zeichen" | "form"; readonly text: string };

export const LAENGSTER_TITEL = 60;
export const LAENGSTER_LINK = 500;
export const LAENGSTER_BAUAUFTRAG = 2000;
const UNSICHTBAR_ODER_STEUERZEICHEN = /[\p{Cc}\p{Cf}]/u;
const UNSICHTBAR_ODER_STEUERZEICHEN_AUSSER_ZEILE = /[^\P{Cc}\n]|\p{Cf}/u;
const LEERRAUM = /\s/u;

const istWahrheit = (wert: unknown): wert is boolean => typeof wert === "boolean";
const istTextListe = (wert: unknown): string[] | undefined => liste(wert, (eintrag) => (istText(eintrag) ? eintrag : undefined));
const istBereiche = (wert: unknown): Bereich[] | undefined => liste(wert, (eintrag) => (istAus(BEREICHE, eintrag) ? eintrag : undefined));

export function istBestandTyp(typ: unknown): typ is BestandNachricht["typ"] {
  return istAus(BESTAND_TYPEN, typ);
}

function leseSkill(wert: unknown): BestandSkill | undefined {
  if (!istFelder(wert)) return undefined;
  const { kennung, name, beschreibung, sammlung, quelle, immerAktiv } = wert;
  const bereiche = istBereiche(wert.bereiche);
  if (!istText(kennung) || !istText(name) || !istText(beschreibung) || bereiche === undefined) return undefined;
  if (!istTextOderNull(sammlung) || !istAus(SKILL_QUELLEN, quelle) || !istWahrheit(immerAktiv)) return undefined;
  return { kennung, name, beschreibung, bereiche, sammlung, quelle, immerAktiv };
}

function lesePlugin(wert: unknown): Plugin | undefined {
  if (!istFelder(wert)) return undefined;
  const { kennung, name, marktplatz, beschreibung, aktivGlobal } = wert;
  const bereiche = istBereiche(wert.bereiche);
  const skills = istTextListe(wert.skills);
  if (!istText(kennung) || !istText(name) || !istText(marktplatz) || !istText(beschreibung)) return undefined;
  if (bereiche === undefined || !istWahrheit(aktivGlobal) || skills === undefined) return undefined;
  return { kennung, name, marktplatz, beschreibung, bereiche, aktivGlobal, skills };
}

function leseKonnektor(wert: unknown): Konnektor | undefined {
  if (!istFelder(wert)) return undefined;
  const { kennung, name, art, jeSitzungSchaltbar } = wert;
  const bereiche = istBereiche(wert.bereiche);
  if (!istText(kennung) || !istText(name) || !istAus(KONNEKTOR_ARTEN, art) || bereiche === undefined || !istWahrheit(jeSitzungSchaltbar)) return undefined;
  return { kennung, name, art, bereiche, jeSitzungSchaltbar };
}

function leseAngebot(wert: unknown): Angebot | undefined {
  if (!istFelder(wert)) return undefined;
  const { kennung, name, beschreibung, braeuchteGeheimnis } = wert;
  const bereiche = istBereiche(wert.bereiche);
  if (!istText(kennung) || !istText(name) || !istText(beschreibung) || bereiche === undefined || !istWahrheit(braeuchteGeheimnis)) return undefined;
  return { kennung, name, beschreibung, bereiche, braeuchteGeheimnis };
}

function jeArt<T>(wert: unknown, lesen: (eintrag: unknown) => T | undefined): JeArt<T> | undefined {
  if (!istFelder(wert)) return undefined;
  const skills = liste(wert.skills, lesen);
  const plugins = liste(wert.plugins, lesen);
  const konnektoren = liste(wert.konnektoren, lesen);
  if (skills === undefined || plugins === undefined || konnektoren === undefined) return undefined;
  return { skills, plugins, konnektoren };
}

function leseBestand(felder: Felder): BestandNachricht | undefined {
  const skills = liste(felder.skills, leseSkill);
  const plugins = liste(felder.plugins, lesePlugin);
  const konnektoren = liste(felder.konnektoren, leseKonnektor);
  const bibliothek = jeArt(felder.bibliothek, leseAngebot);
  const favoriten = jeArt(felder.favoriten, (eintrag) => (istText(eintrag) ? eintrag : undefined));
  if (skills === undefined || plugins === undefined || konnektoren === undefined || bibliothek === undefined || favoriten === undefined) return undefined;
  return { typ: "bestand", skills, plugins, konnektoren, bibliothek, favoriten };
}

function leseModellWahl(wert: unknown): ModellWahl | undefined {
  return istFelder(wert) && istText(wert.wert) && istText(wert.text) ? { wert: wert.wert, text: wert.text } : undefined;
}

function leseFremdModell(wert: unknown): FremdModell | undefined {
  if (!istFelder(wert)) return undefined;
  const { id, name, preisEinProMio, preisAusProMio, kontextFenster } = wert;
  if (!istText(id) || !istText(name) || !istZahl(preisEinProMio) || !istZahl(preisAusProMio)) return undefined;
  if (kontextFenster !== null && !istZahl(kontextFenster)) return undefined;
  return { id, name, preisEinProMio, preisAusProMio, kontextFenster };
}

function leseModelle(wert: unknown): Optionen["modelle"] | undefined {
  if (!istFelder(wert)) return undefined;
  const claude = liste(wert.claude, leseModellWahl);
  const openrouter = wert.openrouter === null ? null : liste(wert.openrouter, leseFremdModell);
  const { openrouterGrund } = wert;
  if (claude === undefined || openrouter === undefined || !istTextOderNull(openrouterGrund)) return undefined;
  return { claude, openrouter, openrouterGrund };
}

function leseVorgaben(wert: unknown): Vorgaben | undefined {
  if (!istFelder(wert)) return undefined;
  const { modell, aufwand, ordner, ausgabestil, erlaubnis } = wert;
  const skills = istTextListe(wert.skills);
  const plugins = istTextListe(wert.plugins);
  const konnektoren = istTextListe(wert.konnektoren);
  if (!istText(modell) || !istText(aufwand) || !istTextOderNull(ordner) || !istTextOderNull(ausgabestil) || !istAus(ERLAUBNIS_MODI, erlaubnis)) return undefined;
  if (skills === undefined || plugins === undefined || konnektoren === undefined) return undefined;
  return { modell, aufwand, ordner, ausgabestil, erlaubnis, skills, plugins, konnektoren };
}

function leseOptionen(felder: Felder): BestandNachricht | undefined {
  const erlaubnis = liste(felder.erlaubnis, (eintrag) => (istAus(ERLAUBNIS_MODI, eintrag) ? eintrag : undefined));
  const ausgabestile = istTextListe(felder.ausgabestile);
  const modelle = leseModelle(felder.modelle);
  const vorgaben = leseVorgaben(felder.vorgaben);
  const { linkGesperrt } = felder;
  if (erlaubnis === undefined || ausgabestile === undefined || modelle === undefined || vorgaben === undefined || !istTextOderNull(linkGesperrt)) return undefined;
  return { typ: "optionen", erlaubnis, ausgabestile, modelle, vorgaben, linkGesperrt };
}

function lesePhase(wert: unknown): Phase | undefined {
  if (!istFelder(wert) || !istText(wert.phase) || !istText(wert.status) || !istText(wert.datum)) return undefined;
  return { phase: wert.phase, status: wert.status, datum: wert.datum };
}

function leseStatus(wert: unknown): Projekt["status"] | undefined {
  if (wert === null) return null;
  if (!istFelder(wert)) return undefined;
  const phasen = liste(wert.phasen, lesePhase);
  const { letzteEntscheidung } = wert;
  if (phasen === undefined || !istTextOderNull(letzteEntscheidung)) return undefined;
  return { phasen, letzteEntscheidung };
}

function leseProjekt(wert: unknown): Projekt | undefined {
  if (!istFelder(wert)) return undefined;
  const { ordner, name, zuletzt } = wert;
  const status = leseStatus(wert.status);
  if (!istText(ordner) || !istText(name) || !istZahl(zuletzt) || status === undefined) return undefined;
  return { ordner, name, zuletzt, status };
}

function leseHinzugefuegt(felder: Felder): BestandNachricht | undefined {
  const { art, weg, ok, text, einrichtung } = felder;
  if (!istAus(HAKEN_ARTEN, art) || !istAus(WEGE, weg) || !istWahrheit(ok) || !istText(text) || !istTextOderNull(einrichtung)) return undefined;
  return { typ: "hinzugefuegt", art, weg, ok, text, einrichtung };
}

export function leseBestandNachricht(felder: Felder): BestandNachricht | undefined {
  switch (felder.typ) {
    case "bestand":
      return leseBestand(felder);
    case "optionen":
      return leseOptionen(felder);
    case "projekte": {
      const projekte = liste(felder.liste, leseProjekt);
      return projekte === undefined ? undefined : { typ: "projekte", liste: projekte };
    }
    case "hinzugefuegt":
      return leseHinzugefuegt(felder);
    default:
      return undefined;
  }
}

export function titelLesen(text: string): Gelesen<"titel", string> {
  const titel = text.trim();
  if (titel === "") return { kind: "fehler", grund: "leer", text: "Der Name darf nicht leer sein." };
  if (titel.length > LAENGSTER_TITEL) return { kind: "fehler", grund: "zu_lang", text: `Höchstens ${String(LAENGSTER_TITEL)} Zeichen.` };
  if (UNSICHTBAR_ODER_STEUERZEICHEN.test(titel)) return { kind: "fehler", grund: "zeichen", text: "Steuer- und unsichtbare Zeichen sind nicht erlaubt." };
  return { kind: "ok", titel };
}

function istHttpsAdresse(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const adresse = new URL(text);
  return adresse.protocol === "https:" && adresse.hostname !== "" && text.toLowerCase().startsWith("https://");
}

export function linkLesen(text: string): Gelesen<"link", string> {
  const link = text.trim();
  if (link === "") return { kind: "fehler", grund: "leer", text: "Bitte eine Adresse eingeben." };
  if (link.length > LAENGSTER_LINK) return { kind: "fehler", grund: "zu_lang", text: `Höchstens ${String(LAENGSTER_LINK)} Zeichen.` };
  if (UNSICHTBAR_ODER_STEUERZEICHEN.test(link) || LEERRAUM.test(link)) return { kind: "fehler", grund: "zeichen", text: "Leer-, Steuer- und unsichtbare Zeichen sind nicht erlaubt." };
  if (!istHttpsAdresse(link)) return { kind: "fehler", grund: "form", text: "Nur Adressen, die mit https:// beginnen." };
  return { kind: "ok", link };
}

export function bauauftragLesen(text: string): Gelesen<"auftrag", string> {
  const auftrag = text.trim();
  if (auftrag === "") return { kind: "fehler", grund: "leer", text: "Beschreib kurz, was gebaut werden soll." };
  if (auftrag.length > LAENGSTER_BAUAUFTRAG) return { kind: "fehler", grund: "zu_lang", text: `Höchstens ${String(LAENGSTER_BAUAUFTRAG)} Zeichen.` };
  if (UNSICHTBAR_ODER_STEUERZEICHEN_AUSSER_ZEILE.test(auftrag)) return { kind: "fehler", grund: "zeichen", text: "Steuer- und unsichtbare Zeichen sind nicht erlaubt." };
  return { kind: "ok", auftrag };
}

export function umbenennen(sitzung: string, titel: string): BestandAnfrage {
  return { typ: "sitzung_umbenennen", sitzung, titel };
}

export function haken(sitzung: string, art: HakenArt, kennung: string, an: boolean): BestandAnfrage {
  return { typ: "haken", sitzung, art, kennung, an };
}

export function favorit(art: HakenArt, kennung: string, an: boolean): BestandAnfrage {
  return { typ: "favorit", art, kennung, an };
}

export function sitzungEinstellung<S extends SitzungsSchluessel>(sitzung: string, schluessel: S, wert: EinstellungsWert<S>): BestandAnfrage {
  return { typ: "sitzung_einstellung", sitzung, schluessel, wert };
}

export function vorgabenSetzen(werte: Vorgaben): BestandAnfrage {
  return { typ: "vorgaben", werte };
}

export function neueSitzungMit(ordner: string, anbieter: Anbieter, modell: string): { readonly typ: "neu"; readonly ordner: string | null; readonly anbieter: Anbieter; readonly modell: string } {
  const pfad = ordner.trim();
  return { typ: "neu", ordner: pfad === "" ? null : pfad, anbieter, modell };
}

export function hinzufuegen(art: HakenArt, weg: Weg, wert: string, sitzung: string | null): BestandAnfrage {
  return { typ: "hinzufuegen", art, weg, wert, sitzung };
}

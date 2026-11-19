import { BEREICHE, haken, type Anbieter, type Bereich, type Bestand, type BestandAnfrage, type BestandSkill, type Erlaubnis, type HakenArt, type Vorgaben } from "./bestand";
import type { Agent, SitzungsZustand } from "./verbindung";

export type Gewaehlt = Pick<SitzungsZustand, "skills" | "plugins" | "konnektoren">;

export interface Eintrag {
  readonly kind: "eintrag";
  readonly art: HakenArt;
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly an: boolean;
  readonly immer: boolean;
  readonly schaltbar: boolean;
  readonly favorit: boolean;
  readonly hinweis: string | null;
}

export interface Sammlung {
  readonly kind: "sammlung";
  readonly name: string;
  readonly mitglieder: readonly Eintrag[];
  readonly an: "ja" | "nein" | "teils";
  readonly schaltbar: boolean;
}

export type Zeile = Eintrag | Sammlung;

export interface Gruppe {
  readonly titel: string;
  readonly zeilen: readonly Zeile[];
}

export interface Kaertchen {
  readonly art: HakenArt | "status";
  readonly kennung: string;
  readonly text: string;
  readonly entfernbar: boolean;
}

export type FortschrittAnzeige =
  | { readonly kind: "zahl"; readonly anteil: number; readonly text: string }
  | { readonly kind: "laufend" }
  | { readonly kind: "keiner" };

const FAVORITEN = "Favoriten";
export const NOCH_UNBEKANNT = "noch unbekannt";
const OHNE_BEREICH: Bereich = "ohne Bereich";
const TAG_MS = 86_400_000;
const GELD = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PREIS = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });

const zweistellig = (wert: number): string => String(wert).padStart(2, "0");

function bereichVon(bereiche: readonly Bereich[]): Bereich {
  return bereiche[0] ?? OHNE_BEREICH;
}

function passt(suche: string, ...texte: readonly string[]): boolean {
  return suche === "" || texte.some((text) => text.toLowerCase().includes(suche));
}

interface Posten {
  readonly bereich: Bereich;
  readonly zeile: Zeile;
}

function nachBereich(posten: readonly Posten[], praefix: string): Gruppe[] {
  return BEREICHE.flatMap((stelle) => {
    const zeilen = posten.filter((eintrag) => eintrag.bereich === stelle).map((eintrag) => eintrag.zeile);
    return zeilen.length === 0 ? [] : [{ titel: praefix + stelle, zeilen }];
  });
}

function favoritenGruppe(zeilen: readonly Zeile[]): Gruppe[] {
  return zeilen.length === 0 ? [] : [{ titel: FAVORITEN, zeilen }];
}

function skillEintrag(skill: BestandSkill, gewaehlt: Gewaehlt | null, favoriten: ReadonlySet<string>): Eintrag {
  return {
    kind: "eintrag", art: "skill", kennung: skill.kennung, name: skill.name, beschreibung: skill.beschreibung,
    an: skill.immerAktiv || (gewaehlt?.skills.includes(skill.kennung) ?? false), immer: skill.immerAktiv,
    schaltbar: gewaehlt !== null && !skill.immerAktiv, favorit: favoriten.has(skill.kennung), hinweis: skill.immerAktiv ? "immer aktiv" : null,
  };
}

function sammlungAus(name: string, mitglieder: readonly Eintrag[]): Sammlung {
  const an = mitglieder.filter((mitglied) => mitglied.an).length;
  return { kind: "sammlung", name, mitglieder, an: an === 0 ? "nein" : an === mitglieder.length ? "ja" : "teils", schaltbar: mitglieder.some((mitglied) => mitglied.schaltbar) };
}

function skillPosten(skills: readonly BestandSkill[], gewaehlt: Gewaehlt | null, favoriten: ReadonlySet<string>, suche: string): Posten[] {
  const posten: Posten[] = [];
  const sammlungen = new Map<string, { bereich: Bereich; mitglieder: Eintrag[] }>();
  for (const skill of skills) {
    const eintrag = skillEintrag(skill, gewaehlt, favoriten);
    if (skill.sammlung === null) {
      if (passt(suche, skill.name, skill.kennung, skill.beschreibung)) posten.push({ bereich: bereichVon(skill.bereiche), zeile: eintrag });
      continue;
    }
    const sammlung = sammlungen.get(skill.sammlung) ?? { bereich: bereichVon(skill.bereiche), mitglieder: [] };
    sammlungen.set(skill.sammlung, sammlung);
    if (passt(suche, skill.sammlung, skill.name, skill.kennung, skill.beschreibung)) sammlung.mitglieder.push(eintrag);
  }
  for (const [name, { bereich, mitglieder }] of sammlungen) {
    if (mitglieder.length > 0) posten.push({ bereich, zeile: sammlungAus(name, mitglieder) });
  }
  return posten;
}

export function skillGruppen(bestand: Bestand, gewaehlt: Gewaehlt | null, suchtext: string): Gruppe[] {
  const suche = suchtext.trim().toLowerCase();
  const favoritSkills = new Set(bestand.favoriten.skills);
  const favoritPlugins = new Set(bestand.favoriten.plugins);
  const plugins = bestand.plugins.filter((plugin) => passt(suche, plugin.name, plugin.kennung, plugin.beschreibung)).map((plugin): Posten & { readonly zeile: Eintrag } => ({
    bereich: bereichVon(plugin.bereiche),
    zeile: {
      kind: "eintrag", art: "plugin", kennung: plugin.kennung, name: plugin.name, beschreibung: plugin.beschreibung,
      an: gewaehlt?.plugins.includes(plugin.kennung) ?? false, immer: false, schaltbar: gewaehlt !== null, favorit: favoritPlugins.has(plugin.kennung),
      hinweis: plugin.aktivGlobal ? "auch global aktiv" : null,
    },
  }));
  const istFavorit = (skill: BestandSkill) => skill.sammlung === null && favoritSkills.has(skill.kennung);
  const favoriten: Zeile[] = [
    ...plugins.filter((plugin) => plugin.zeile.favorit).map((plugin) => plugin.zeile),
    ...bestand.skills.filter((skill) => istFavorit(skill) && passt(suche, skill.name, skill.kennung, skill.beschreibung)).map((skill) => skillEintrag(skill, gewaehlt, favoritSkills)),
  ];
  return [
    ...favoritenGruppe(favoriten),
    ...nachBereich(plugins.filter((plugin) => !plugin.zeile.favorit), "Plugins · "),
    ...nachBereich(skillPosten(bestand.skills.filter((skill) => !istFavorit(skill)), gewaehlt, favoritSkills, suche), "Skills · "),
  ];
}

export function konnektorGruppen(bestand: Bestand, gewaehlt: Gewaehlt | null, suchtext: string): Gruppe[] {
  const suche = suchtext.trim().toLowerCase();
  const favoriten = new Set(bestand.favoriten.konnektoren);
  const unbekannt = gewaehlt !== null && gewaehlt.konnektoren === null;
  const posten = bestand.konnektoren.filter((konnektor) => passt(suche, konnektor.name, konnektor.kennung)).map((konnektor): Posten & { readonly zeile: Eintrag } => ({
    bereich: bereichVon(konnektor.bereiche),
    zeile: {
      kind: "eintrag", art: "konnektor", kennung: konnektor.kennung, name: konnektor.name, beschreibung: "",
      an: gewaehlt?.konnektoren?.includes(konnektor.kennung) ?? false, immer: false, schaltbar: unbekannt ? false : gewaehlt !== null && konnektor.jeSitzungSchaltbar,
      favorit: favoriten.has(konnektor.kennung), hinweis: unbekannt ? NOCH_UNBEKANNT : konnektor.jeSitzungSchaltbar ? null : "nicht je Sitzung schaltbar",
    },
  }));
  return [
    ...favoritenGruppe(posten.filter((eintrag) => eintrag.zeile.favorit).map((eintrag) => eintrag.zeile)),
    ...nachBereich(posten.filter((eintrag) => !eintrag.zeile.favorit), ""),
  ];
}

export function sammlungUmschalten(sitzung: string, sammlung: Sammlung): BestandAnfrage[] {
  const an = sammlung.an !== "ja";
  return sammlung.mitglieder.filter((mitglied) => mitglied.schaltbar && mitglied.an !== an).map((mitglied) => haken(sitzung, "skill", mitglied.kennung, an));
}

export function kaertchen(
  sitzung: Gewaehlt & { readonly anbieter: Anbieter; readonly schnell: boolean },
  bestand: Bestand | null,
): { readonly links: Kaertchen[]; readonly rechts: Kaertchen[] } {
  const skills = new Map(bestand?.skills.map((skill) => [skill.kennung, skill]));
  const plugins = new Map(bestand?.plugins.map((plugin) => [plugin.kennung, plugin]));
  const konnektoren = new Map(bestand?.konnektoren.map((konnektor) => [konnektor.kennung, konnektor]));
  const status: Kaertchen[] = [
    ...(sitzung.anbieter === "openrouter" ? [{ art: "status" as const, kennung: "openrouter", text: "OpenRouter", entfernbar: false }] : []),
    ...(sitzung.schnell ? [{ art: "status" as const, kennung: "schnell", text: "Schnellmodus", entfernbar: false }] : []),
  ];
  return {
    links: sitzung.skills.map((kennung) => {
      const skill = skills.get(kennung);
      return { art: "skill", kennung, text: skill?.name ?? kennung, entfernbar: skill?.immerAktiv !== true };
    }),
    rechts: [
      ...status,
      ...sitzung.plugins.map((kennung): Kaertchen => ({ art: "plugin", kennung, text: plugins.get(kennung)?.name ?? kennung.split("@")[0] ?? kennung, entfernbar: true })),
      ...(sitzung.konnektoren ?? []).map((kennung): Kaertchen => {
        const konnektor = konnektoren.get(kennung);
        return { art: "konnektor", kennung, text: konnektor?.name ?? kennung, entfernbar: konnektor?.jeSitzungSchaltbar ?? true };
      }),
    ],
  };
}

function geladeneSkills(skills: readonly string[]): Kaertchen[] {
  return skills.map((skill) => ({ art: "skill", kennung: skill, text: skill, entfernbar: false }));
}

export function agentKarten(
  agent: Agent,
  sitzung: Gewaehlt & { readonly anbieter: Anbieter; readonly schnell: boolean },
  bestand: Bestand | null,
): Kaertchen[] {
  if (agent.eltern !== null) return geladeneSkills(agent.skills);
  const { links, rechts } = kaertchen(sitzung, bestand);
  const gewaehlt = new Set(sitzung.skills);
  return [...links, ...geladeneSkills(agent.skills.filter((skill) => !gewaehlt.has(skill))), ...rechts];
}

export function fortschrittAnzeige(agent: Agent): FortschrittAnzeige {
  const { fortschritt } = agent;
  if (fortschritt !== null) {
    return { kind: "zahl", anteil: fortschritt.gesamt === 0 ? 0 : fortschritt.erledigt / fortschritt.gesamt, text: `${String(fortschritt.erledigt)} von ${String(fortschritt.gesamt)}` };
  }
  return agent.stand === "laeuft" ? { kind: "laufend" } : { kind: "keiner" };
}

function tagesbeginn(zeitpunkt: number): number {
  const datum = new Date(zeitpunkt);
  return new Date(datum.getFullYear(), datum.getMonth(), datum.getDate()).getTime();
}

export function zuletztText(zuletzt: number, jetzt: number): string {
  const datum = new Date(zuletzt);
  const uhrzeit = `${zweistellig(datum.getHours())}:${zweistellig(datum.getMinutes())}`;
  const heute = tagesbeginn(jetzt);
  if (zuletzt >= heute) return `heute ${uhrzeit}`;
  if (zuletzt >= heute - TAG_MS) return `gestern ${uhrzeit}`;
  return `${zweistellig(datum.getDate())}.${zweistellig(datum.getMonth() + 1)}. ${uhrzeit}`;
}

export function kostenText(usd: number): string {
  return `≈ ${GELD.format(usd)} US-$`;
}

export function preisText(ein: number, aus: number): string {
  return `${PREIS.format(ein)} / ${PREIS.format(aus)} US-$ je Mio. Tokens`;
}

export function vorgabenMitHaken(vorgaben: Vorgaben, gewaehlt: Gewaehlt, bestand: Bestand | null): Vorgaben {
  const immer = new Set(bestand?.skills.filter((skill) => skill.immerAktiv).map((skill) => skill.kennung));
  const schaltbar = new Set(bestand?.konnektoren.filter((konnektor) => konnektor.jeSitzungSchaltbar).map((konnektor) => konnektor.kennung));
  const konnektoren = gewaehlt.konnektoren === null ? vorgaben.konnektoren : gewaehlt.konnektoren.filter((kennung) => schaltbar.has(kennung));
  return { ...vorgaben, skills: gewaehlt.skills.filter((kennung) => !immer.has(kennung)), plugins: [...gewaehlt.plugins], konnektoren: [...konnektoren] };
}

const PLAN_ALIASE: ReadonlySet<string> = new Set(["haiku", "opusplan"]);
const GROSSES_FENSTER = "[1m]";
export const KOSTENFALLE = "Achtung: Im Planmodus läuft mit diesem Modell ein anderes, teureres Modell.";

export function kostenfalle(modell: string | null, erlaubnis: Erlaubnis): boolean {
  if (erlaubnis !== "plan" || modell === null) return false;
  const kurz = modell.trim().toLowerCase();
  return PLAN_ALIASE.has(kurz.endsWith(GROSSES_FENSTER) ? kurz.slice(0, -GROSSES_FENSTER.length) : kurz);
}

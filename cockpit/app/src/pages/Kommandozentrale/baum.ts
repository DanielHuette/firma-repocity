import type { Agent, AgentenStand } from "./verbindung";

export const BAUM_BREITE = 370;
export const KNOTEN_HOEHE = 42;
export const PRO_REIHE = 3;
const RAND = 5;
const EBENEN_ABSTAND = 96;
const GASSE = 10;
const GASSEN_LINIE = 4;
const HAUPT_BREITE = 160;
const KNOTEN_BREITE = 112;
const ABSATZ = 12;
const ZUG_OBEN = 52;
const ZUG_UNTEN = 46;
const TEXT_EINZUG = 26;
const ZEICHEN_BREITE = 6.4;
const AUSLASSUNG = "…";

export interface Punkt {
  readonly x: number;
  readonly y: number;
}

export interface Knoten extends Punkt {
  readonly agent: Agent;
  readonly breite: number;
}

export interface Kante {
  readonly von: Knoten;
  readonly zu: Knoten;
  readonly pfad: string;
  readonly fliesst: boolean;
  readonly stand: AgentenStand;
}

export interface Baum {
  readonly knoten: readonly Knoten[];
  readonly kanten: readonly Kante[];
  readonly breite: number;
  readonly hoehe: number;
  readonly knotenHoehe: number;
}

const zahl = (wert: number): string => String(wert);

export function kantenPfad(von: Punkt, zu: Punkt, knotenHoehe: number): string {
  const unten = von.y + knotenHoehe;
  if (von.x === zu.x) return `M${zahl(von.x)} ${zahl(unten)} L${zahl(zu.x)} ${zahl(zu.y)}`;
  const bogen = `C${zahl(von.x)} ${zahl(unten + ZUG_OBEN)} ${zahl(zu.x)} ${zahl(zu.y - ZUG_UNTEN)} ${zahl(zu.x)} ${zahl(zu.y)}`;
  return `M${zahl(von.x)} ${zahl(unten)} L${zahl(von.x)} ${zahl(unten + ABSATZ)} ${bogen}`;
}

export function umwegPfad(von: Punkt, zu: Punkt, knotenHoehe: number): string {
  const unten = von.y + knotenHoehe + ABSATZ;
  const oben = zu.y - ABSATZ;
  const gasse = zahl(GASSEN_LINIE);
  return `M${zahl(von.x)} ${zahl(von.y + knotenHoehe)} L${zahl(von.x)} ${zahl(unten)} L${gasse} ${zahl(unten)} L${gasse} ${zahl(oben)} L${zahl(zu.x)} ${zahl(oben)} L${zahl(zu.x)} ${zahl(zu.y)}`;
}

function gueltigeEltern(agent: Agent, nachKennung: ReadonlyMap<string, Agent>, wurzel: string | null): string | null {
  const gesehen = new Set([agent.id]);
  let schritt = agent.eltern;
  while (schritt !== null) {
    if (schritt === wurzel) return agent.eltern;
    const naechster = nachKennung.get(schritt);
    if (naechster === undefined || gesehen.has(schritt)) return wurzel;
    gesehen.add(schritt);
    schritt = naechster.eltern;
  }
  return wurzel;
}

function elternListe(agenten: readonly Agent[]): Map<string, string | null> {
  const nachKennung = new Map(agenten.map((agent) => [agent.id, agent]));
  const wurzel = agenten.find((agent) => agent.eltern === null)?.id ?? null;
  return new Map(agenten.map((agent) => [agent.id, agent.id === wurzel ? null : gueltigeEltern(agent, nachKennung, wurzel)]));
}

function tiefen(agenten: readonly Agent[], eltern: ReadonlyMap<string, string | null>): Map<string, number> {
  const tiefe = new Map<string, number>();
  const messen = (id: string): number => {
    const bekannt = tiefe.get(id);
    if (bekannt !== undefined) return bekannt;
    const oben = eltern.get(id) ?? null;
    const ergebnis = oben === null ? 0 : messen(oben) + 1;
    tiefe.set(id, ergebnis);
    return ergebnis;
  };
  for (const agent of agenten) messen(agent.id);
  return tiefe;
}

function ebenen(agenten: readonly Agent[], tiefe: ReadonlyMap<string, number>): Agent[][] {
  const stufen: Agent[][] = [];
  for (const agent of agenten) {
    const stufe = tiefe.get(agent.id) ?? 0;
    while (stufen.length <= stufe) stufen.push([]);
    stufen[stufe]?.push(agent);
  }
  return stufen.flatMap((stufe) => Array.from({ length: Math.ceil(stufe.length / PRO_REIHE) }, (_, reihe) => stufe.slice(reihe * PRO_REIHE, (reihe + 1) * PRO_REIHE)));
}

function aufEinDezimal(wert: number): number {
  return Math.round(wert * 10) / 10;
}

function anordnen(reihen: readonly Agent[][], eltern: ReadonlyMap<string, string | null>): Knoten[] {
  return reihen.flatMap((reihe, stelleDerReihe) => {
    const platz = (BAUM_BREITE - 2 * GASSE) / reihe.length;
    return reihe.map((agent, stelle) => ({
      agent,
      x: aufEinDezimal(GASSE + platz * (stelle + 0.5)),
      y: RAND + stelleDerReihe * EBENEN_ABSTAND,
      breite: stelleDerReihe === 0 && eltern.get(agent.id) === null ? HAUPT_BREITE : KNOTEN_BREITE,
    }));
  });
}

function verbinden(knoten: readonly Knoten[], eltern: ReadonlyMap<string, string | null>): Kante[] {
  const nachKennung = new Map(knoten.map((eintrag) => [eintrag.agent.id, eintrag]));
  return knoten.flatMap((zu) => {
    const von = nachKennung.get(eltern.get(zu.agent.id) ?? "");
    if (von === undefined) return [];
    const pfad = zu.y - von.y > EBENEN_ABSTAND ? umwegPfad(von, zu, KNOTEN_HOEHE) : kantenPfad(von, zu, KNOTEN_HOEHE);
    return [{ von, zu, pfad, fliesst: zu.agent.stand === "laeuft", stand: zu.agent.stand }];
  });
}

export function baumAnordnung(agenten: readonly Agent[]): Baum {
  if (agenten.length === 0) return { knoten: [], kanten: [], breite: BAUM_BREITE, hoehe: 0, knotenHoehe: KNOTEN_HOEHE };
  const eltern = elternListe(agenten);
  const reihen = ebenen(agenten, tiefen(agenten, eltern));
  const knoten = anordnen(reihen, eltern);
  const hoehe = RAND + (reihen.length - 1) * EBENEN_ABSTAND + KNOTEN_HOEHE + RAND;
  return { knoten, kanten: verbinden(knoten, eltern), breite: BAUM_BREITE, hoehe, knotenHoehe: KNOTEN_HOEHE };
}

export function kuerzen(text: string, zeichen: number): string {
  const teile = Array.from(text);
  if (teile.length <= zeichen) return text;
  return teile.slice(0, Math.max(0, zeichen - 1)).join("") + AUSLASSUNG;
}

export function platzFuer(breite: number): number {
  return Math.floor((breite - TEXT_EINZUG) / ZEICHEN_BREITE);
}

export function unterzeile(agent: Agent): string {
  switch (agent.stand) {
    case "wartet":
      return "wartet auf dich";
    case "fertig":
      return `fertig · ${String(agent.aufrufe)}×`;
    case "laeuft":
      return `${agent.werkzeug ?? agent.typ} · ${String(agent.aufrufe)}×`;
  }
}

export function brauchtDich(agenten: readonly Agent[]): string[] {
  return agenten.filter((agent) => agent.stand === "wartet").map((agent) => agent.name);
}

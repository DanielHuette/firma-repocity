export type Inline =
  | { readonly art: "text"; readonly text: string }
  | { readonly art: "code"; readonly text: string }
  | { readonly art: "umbruch" }
  | { readonly art: "fett"; readonly inhalt: readonly Inline[] }
  | { readonly art: "kursiv"; readonly inhalt: readonly Inline[] }
  | { readonly art: "link"; readonly ziel: string; readonly inhalt: readonly Inline[] };

export interface Liste {
  readonly art: "liste";
  readonly geordnet: boolean;
  readonly start: number;
  readonly punkte: readonly Punkt[];
}

export interface Punkt {
  readonly inhalt: readonly Inline[];
  readonly unter: Liste | null;
}

export type Block =
  | { readonly art: "absatz"; readonly inhalt: readonly Inline[] }
  | { readonly art: "ueberschrift"; readonly stufe: number; readonly inhalt: readonly Inline[] }
  | { readonly art: "code"; readonly sprache: string; readonly text: string }
  | { readonly art: "zitat"; readonly inhalt: readonly Block[] }
  | { readonly art: "tabelle"; readonly kopf: readonly (readonly Inline[])[]; readonly zeilen: readonly (readonly (readonly Inline[])[])[] }
  | { readonly art: "linie" }
  | Liste;

const WEBADRESSE = /^https?:\/\//i;
const AUSZEICHNUNG = new RegExp([
  "`(?<code>[^`\\n]+)`",
  "\\[(?<linktext>[^\\]\\n]+)\\]\\((?<ziel>[^)\\s]+)\\)",
  "\\*\\*(?<fett>[^\\n]+?)\\*\\*",
  "(?<![\\p{L}\\p{N}_])__(?<fett2>[^\\n]+?)__(?![\\p{L}\\p{N}_])",
  "\\*(?<kursiv>[^*\\s](?:[^*\\n]*[^*\\s])?)\\*",
  "(?<![\\p{L}\\p{N}_])_(?<kursiv2>[^_\\s](?:[^_\\n]*[^_\\s])?)_(?![\\p{L}\\p{N}_])",
  "(?<adresse>https?:\\/\\/[^\\s<>()\\[\\]]*[^\\s<>()\\[\\].,;:!?'\"])",
  "(?<umbruch>\\n)",
].join("|"), "gu");

const ZAUN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const UEBERSCHRIFT = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/;
const LINIE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const PUNKT = /^( *)([-*+]|(\d{1,9})[.)])[ \t]+(.*)$/;
const ZITAT = /^ {0,3}> ?(.*)$/;
const TRENNZEILE = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;
const LEER = /^\s*$/;

function textAnhaengen(teile: Inline[], text: string): void {
  if (text === "") return;
  const letztes = teile.at(-1);
  if (letztes?.art === "text") teile[teile.length - 1] = { art: "text", text: letztes.text + text };
  else teile.push({ art: "text", text });
}

function auszeichnung(gruppen: Readonly<Record<string, string | undefined>>, roh: string): Inline {
  const { code, linktext, ziel, fett, fett2, kursiv, kursiv2, adresse } = gruppen;
  if (code !== undefined) return { art: "code", text: code };
  if (linktext !== undefined && ziel !== undefined) return WEBADRESSE.test(ziel) ? { art: "link", ziel, inhalt: inline(linktext) } : { art: "text", text: roh };
  if (fett !== undefined || fett2 !== undefined) return { art: "fett", inhalt: inline(fett ?? fett2 ?? "") };
  if (kursiv !== undefined || kursiv2 !== undefined) return { art: "kursiv", inhalt: inline(kursiv ?? kursiv2 ?? "") };
  if (adresse !== undefined) return { art: "link", ziel: adresse, inhalt: [{ art: "text", text: adresse }] };
  return { art: "umbruch" };
}

export function inline(text: string): Inline[] {
  const teile: Inline[] = [];
  let stelle = 0;
  for (const treffer of text.matchAll(AUSZEICHNUNG)) {
    textAnhaengen(teile, text.slice(stelle, treffer.index));
    const teil = auszeichnung(treffer.groups ?? {}, treffer[0]);
    if (teil.art === "text") textAnhaengen(teile, teil.text);
    else teile.push(teil);
    stelle = treffer.index + treffer[0].length;
  }
  textAnhaengen(teile, text.slice(stelle));
  return teile;
}

interface Leser {
  readonly zeilen: readonly string[];
  stelle: number;
}

function zeile(leser: Leser): string | undefined {
  return leser.zeilen[leser.stelle];
}

function istTabellenStart(leser: Leser): boolean {
  const kopf = zeile(leser);
  const trenner = leser.zeilen[leser.stelle + 1];
  return kopf !== undefined && kopf.includes("|") && trenner !== undefined && trenner.includes("-") && TRENNZEILE.test(trenner);
}

function beginntBlock(leser: Leser): boolean {
  const text = zeile(leser) ?? "";
  return ZAUN.test(text) || UEBERSCHRIFT.test(text) || LINIE.test(text) || PUNKT.test(text) || ZITAT.test(text) || istTabellenStart(leser);
}

function codeLesen(leser: Leser, zaun: string, sprache: string): Block {
  const inhalt: string[] = [];
  leser.stelle += 1;
  for (let text = zeile(leser); text !== undefined; text = zeile(leser)) {
    leser.stelle += 1;
    if (text.trim().startsWith(zaun) && text.trim().replace(/[`~]/g, "") === "") break;
    inhalt.push(text);
  }
  return { art: "code", sprache, text: inhalt.join("\n") };
}

function zellen(text: string): Inline[][] {
  const ohneRand = text.trim().replace(/^\|/, "").replace(/\|$/, "");
  return ohneRand.split("|").map((zelle) => inline(zelle.trim()));
}

function tabelleLesen(leser: Leser): Block {
  const kopf = zellen(zeile(leser) ?? "");
  leser.stelle += 2;
  const zeilen: Inline[][][] = [];
  for (let text = zeile(leser); text?.includes("|") === true; text = zeile(leser)) {
    zeilen.push(zellen(text));
    leser.stelle += 1;
  }
  return { art: "tabelle", kopf, zeilen };
}

function zitatLesen(leser: Leser): Block {
  const inhalt: string[] = [];
  for (let treffer = ZITAT.exec(zeile(leser) ?? ""); treffer !== null; treffer = ZITAT.exec(zeile(leser) ?? "")) {
    inhalt.push(treffer[1] ?? "");
    leser.stelle += 1;
  }
  return { art: "zitat", inhalt: bloecke(inhalt.join("\n")) };
}

interface RohPunkt {
  readonly einzug: number;
  readonly geordnet: boolean;
  readonly nummer: number;
  readonly zeilen: string[];
}

function rohPunkte(leser: Leser): RohPunkt[] {
  const punkte: RohPunkt[] = [];
  for (let text = zeile(leser); text !== undefined && !LEER.test(text); text = zeile(leser)) {
    const treffer = PUNKT.exec(text);
    const letzter = punkte.at(-1);
    if (treffer !== null) {
      const nummer = treffer[3];
      punkte.push({ einzug: treffer[1]?.length ?? 0, geordnet: nummer !== undefined, nummer: Number(nummer ?? 1), zeilen: [treffer[4] ?? ""] });
    } else if (letzter !== undefined && !beginntBlock(leser)) {
      letzter.zeilen.push(text.trim());
    } else break;
    leser.stelle += 1;
  }
  return punkte;
}

function listeBauen(punkte: readonly RohPunkt[], von: number, oben: boolean): { liste: Liste; bis: number } {
  const erster = punkte[von];
  const einzug = erster?.einzug ?? 0;
  const fertig: Punkt[] = [];
  let stelle = von;
  for (let punkt = punkte[stelle]; punkt !== undefined && (oben || punkt.einzug >= einzug); punkt = punkte[stelle]) {
    const naechster = punkte[stelle + 1];
    const unter = naechster !== undefined && naechster.einzug > punkt.einzug ? listeBauen(punkte, stelle + 1, false) : null;
    fertig.push({ inhalt: inline(punkt.zeilen.join("\n")), unter: unter?.liste ?? null });
    stelle = unter?.bis ?? stelle + 1;
  }
  return { liste: { art: "liste", geordnet: erster?.geordnet ?? false, start: erster?.nummer ?? 1, punkte: fertig }, bis: stelle };
}

function absatzLesen(leser: Leser): Block {
  const inhalt: string[] = [];
  for (let text = zeile(leser); text !== undefined && !LEER.test(text); text = zeile(leser)) {
    if (inhalt.length > 0 && beginntBlock(leser)) break;
    inhalt.push(text.trim());
    leser.stelle += 1;
  }
  return { art: "absatz", inhalt: inline(inhalt.join("\n")) };
}

function blockLesen(leser: Leser): Block {
  const text = zeile(leser) ?? "";
  const zaun = ZAUN.exec(text);
  if (zaun !== null) return codeLesen(leser, zaun[1] ?? "```", zaun[2] ?? "");
  const ueberschrift = UEBERSCHRIFT.exec(text);
  if (ueberschrift !== null) {
    leser.stelle += 1;
    return { art: "ueberschrift", stufe: ueberschrift[1]?.length ?? 1, inhalt: inline(ueberschrift[2] ?? "") };
  }
  if (LINIE.test(text)) {
    leser.stelle += 1;
    return { art: "linie" };
  }
  if (PUNKT.test(text)) return listeBauen(rohPunkte(leser), 0, true).liste;
  if (ZITAT.test(text)) return zitatLesen(leser);
  if (istTabellenStart(leser)) return tabelleLesen(leser);
  return absatzLesen(leser);
}

export function bloecke(text: string): Block[] {
  const leser: Leser = { zeilen: text.replace(/\r\n?/g, "\n").split("\n"), stelle: 0 };
  const gelesen: Block[] = [];
  while (leser.stelle < leser.zeilen.length) {
    if (LEER.test(zeile(leser) ?? "")) leser.stelle += 1;
    else gelesen.push(blockLesen(leser));
  }
  return gelesen;
}

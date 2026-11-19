import type { Dirent } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isInside } from "./pfade.ts";
import { hasErrorCode } from "./private_datei.ts";
import { BEREICHE, isPermission } from "./nachrichten.ts";
import type { Angebot, Bereich, Erlaubnis, Konnektor, Plugin, Skill } from "./nachrichten.ts";
import { isFields, type Fields } from "./felder.ts";

export const ALWAYS_ACTIVE_SKILLS: readonly string[] = ["caveman", "grill-me", "senior-engineering-standard"];
export const LONGEST_DESCRIPTION = 300;
export const LONGEST_SETUP_TEXT = 4_000;
const SKILL_FILE = "SKILL.md";
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const SAFE_NAME = /^[\p{L}\p{N}](?:[\p{L}\p{N}_.: -]{0,98}[\p{L}\p{N}_.:-])?$/u;
const SAFE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SECRET_WORDS = /api[ _-]?(?:schlüssel|key)|token|geheimnis|passwort|zugangsdaten/i;
const MISSING_CODES = ["ENOENT", "ENOTDIR", "EISDIR"];
const DEEPEST_LIBRARY_FOLDER = 5;
const WITHOUT_AREA: Bereich = "ohne Bereich";
const KNOWN_AREAS: ReadonlySet<string> = new Set(BEREICHE);

export interface BestandsOrte {
  readonly claudeOrdner: string;
  readonly claudeJson: string;
  readonly vault: string;
}

export interface Eingelesen {
  readonly skills: Skill[];
  readonly plugins: Plugin[];
  readonly konnektoren: Konnektor[];
  readonly bibliothek: { readonly skills: Angebot[]; readonly plugins: Angebot[]; readonly konnektoren: Angebot[] };
  readonly bibliotheksOrte: ReadonlyMap<string, string>;
  readonly konnektorTexte: ReadonlyMap<string, string>;
  readonly probleme: string[];
}

export interface Steckbrief {
  readonly name: string | null;
  readonly beschreibung: string;
  readonly bereiche: Bereich[];
}

interface SkillOrt {
  readonly name: string;
  readonly ordner: string;
  readonly echt: string;
  readonly steckbrief: Steckbrief;
}

interface InstalliertesPlugin {
  readonly kennung: string;
  readonly name: string;
  readonly marktplatz: string;
  readonly ort: string;
}

function isMissing(error: unknown): boolean {
  return MISSING_CODES.some((code) => hasErrorCode(error, code));
}

function codeOf(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown error";
}

async function entriesOf(folder: string, problems: string[]): Promise<Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error: unknown) {
    if (!isMissing(error)) problems.push(`${folder} cannot be read (${codeOf(error)})`);
    return [];
  }
}

async function textOf(file: string, problems: string[]): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error: unknown) {
    if (!isMissing(error)) problems.push(`${file} cannot be read (${codeOf(error)})`);
    return undefined;
  }
}

async function jsonOf(file: string, problems: string[]): Promise<unknown> {
  const text = await textOf(file, problems);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    problems.push(`${file} is not valid JSON`);
    return undefined;
  }
}

async function realOf(entry: string): Promise<string | null> {
  try {
    return await realpath(entry);
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function unquoted(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return quoted?.[2] ?? trimmed;
}

function lineValue(head: string, key: string): string | null {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(head);
  if (match === null) return null;
  const first = match[1] ?? "";
  if (first !== ">" && first !== "|" && first !== ">-" && first !== "|-") return unquoted(first);
  const rest = head.slice(match.index + match[0].length).split(/\r?\n/).slice(1);
  const end = rest.findIndex((line) => !/^\s+\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).map((line) => line.trim()).join(" ");
}

export function areasOf(value: string | null): Bereich[] {
  if (value === null) return [WITHOUT_AREA];
  const inside = /^\[(.*)\]$/.exec(value.trim())?.[1] ?? value;
  const found = inside.split(",").map((part) => unquoted(part)).filter((part): part is Bereich => KNOWN_AREAS.has(part));
  const unique = [...new Set(found)];
  return unique.length === 0 ? [WITHOUT_AREA] : unique;
}

function shortened(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= LONGEST_DESCRIPTION ? single : `${single.slice(0, LONGEST_DESCRIPTION - 1)}…`;
}

export function readSteckbrief(text: string): Steckbrief {
  const head = FRONT_MATTER.exec(text)?.[1] ?? "";
  const name = lineValue(head, "name");
  const description = lineValue(head, "description") ?? lineValue(head, "Zweck") ?? "";
  return { name: name === null || name === "" ? null : name, beschreibung: shortened(description), bereiche: areasOf(lineValue(head, "Einsatz")) };
}

async function skillAt(folder: string, problems: string[]): Promise<SkillOrt | undefined> {
  const text = await textOf(path.join(folder, SKILL_FILE), problems);
  if (text === undefined) return undefined;
  const echt = await realOf(folder);
  const steckbrief = readSteckbrief(text);
  const name = steckbrief.name ?? path.basename(folder);
  if (echt === null || !SAFE_NAME.test(name)) {
    problems.push(`skill in ${folder} has no usable name`);
    return undefined;
  }
  return { name, ordner: folder, echt, steckbrief };
}

async function skillsDirectlyIn(folder: string, problems: string[]): Promise<SkillOrt[]> {
  const entries = (await entriesOf(folder, problems)).filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()));
  const found = await Promise.all(entries.map((entry) => skillAt(path.join(folder, entry.name), problems)));
  return found.filter((entry) => entry !== undefined);
}

async function skillsBelow(folder: string, problems: string[], depth = 0): Promise<SkillOrt[]> {
  const own = depth === 0 ? undefined : await skillAt(folder, problems);
  if (own !== undefined) return [own];
  if (depth >= DEEPEST_LIBRARY_FOLDER) return [];
  const children = (await entriesOf(folder, problems)).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const found = await Promise.all(children.map((entry) => skillsBelow(path.join(folder, entry.name), problems, depth + 1)));
  return found.flat();
}

function libraryFolder(vault: string): string {
  return path.join(vault, "10_Bibliothek", "11_Skills");
}

function collectionOf(vault: string, real: string): string | null {
  const library = libraryFolder(vault);
  if (!isInside(library, real)) return null;
  const parts = path.relative(library, real).split(path.sep);
  return parts.length >= 3 ? (parts.at(-2) ?? null) : null;
}

function skillOf(place: SkillOrt, quelle: Skill["quelle"], sammlung: string | null, kennung: string): Skill {
  const { beschreibung, bereiche } = place.steckbrief;
  return { kennung, name: place.name, beschreibung, bereiche, sammlung, quelle, immerAktiv: ALWAYS_ACTIVE_SKILLS.includes(kennung) };
}

async function ownSkills(orte: BestandsOrte, problems: string[]): Promise<{ skills: Skill[]; linked: Set<string> }> {
  const skillbase = path.join(orte.vault, "03_Skillbase");
  const personal = await skillsDirectlyIn(path.join(orte.claudeOrdner, "skills"), problems);
  const base = await skillsDirectlyIn(skillbase, problems);
  const realSkillbase = (await realOf(skillbase)) ?? skillbase;
  const chosen = new Map<string, Skill>();
  const linked = new Set<string>();
  for (const place of [...personal, ...base]) {
    linked.add(place.echt);
    if (chosen.has(place.name)) continue;
    const quelle = isInside(realSkillbase, place.echt) ? "skillbase" : "persoenlich";
    chosen.set(place.name, skillOf(place, quelle, collectionOf(orte.vault, place.echt), place.name));
  }
  return { skills: [...chosen.values()], linked };
}

function installedOf(installed: unknown): InstalliertesPlugin[] {
  const records = isFields(installed) && isFields(installed.plugins) ? installed.plugins : {};
  return Object.entries(records).flatMap(([kennung, list]) => {
    const [name = "", marktplatz = ""] = kennung.split("@");
    const first: unknown = Array.isArray(list) ? list[0] : undefined;
    if (!SAFE_PART.test(name) || !SAFE_PART.test(marktplatz) || !isFields(first) || typeof first.installPath !== "string") return [];
    return [{ kennung, name, marktplatz, ort: first.installPath }];
  });
}

async function planAreas(vault: string, name: string, problems: string[]): Promise<Bereich[]> {
  const folders = [path.join(vault, "10_Bibliothek", "14_Baukaesten", "_Plugins"), path.join(vault, "10_Bibliothek", "18_Konnektoren")];
  for (const folder of folders) {
    for (const candidate of new Set([name, name.replaceAll("-", "_")])) {
      const text = await textOf(path.join(folder, `${candidate}.md`), problems);
      if (text !== undefined) return readSteckbrief(text).bereiche;
    }
  }
  return [WITHOUT_AREA];
}

async function descriptionOf(file: string, problems: string[]): Promise<string> {
  const manifest = await jsonOf(file, problems);
  return isFields(manifest) && typeof manifest.description === "string" ? shortened(manifest.description) : "";
}

async function pluginWithSkills(orte: BestandsOrte, plugin: InstalliertesPlugin, active: boolean, problems: string[]): Promise<{ plugin: Plugin; skills: Skill[] }> {
  const places = await skillsDirectlyIn(path.join(plugin.ort, "skills"), problems);
  const sammlung = places.length > 1 ? plugin.name : null;
  const skills = places.map((place) => skillOf(place, "plugin", sammlung, `${plugin.name}:${place.name}`));
  const beschreibung = await descriptionOf(path.join(plugin.ort, ".claude-plugin", "plugin.json"), problems);
  const bereiche = await planAreas(orte.vault, plugin.name, problems);
  const { kennung, name, marktplatz } = plugin;
  return { plugin: { kennung, name, marktplatz, beschreibung, bereiche, aktivGlobal: active, skills: skills.map((skill) => skill.kennung) }, skills };
}

function enabledOf(settings: unknown): Fields {
  return isFields(settings) && isFields(settings.enabledPlugins) ? settings.enabledPlugins : {};
}

async function installedPlugins(orte: BestandsOrte, problems: string[]): Promise<{ plugins: Plugin[]; skills: Skill[]; installed: InstalliertesPlugin[] }> {
  const enabled = enabledOf(await jsonOf(path.join(orte.claudeOrdner, "settings.json"), problems));
  const installed = installedOf(await jsonOf(path.join(orte.claudeOrdner, "plugins", "installed_plugins.json"), problems));
  const read = await Promise.all(installed.map((plugin) => pluginWithSkills(orte, plugin, enabled[plugin.kennung] === true, problems)));
  return { plugins: read.map((entry) => entry.plugin), skills: read.flatMap((entry) => entry.skills), installed };
}

async function serversOf(plugin: InstalliertesPlugin, problems: string[]): Promise<string[]> {
  const fromFile = await jsonOf(path.join(plugin.ort, ".mcp.json"), problems);
  const manifest = await jsonOf(path.join(plugin.ort, ".claude-plugin", "plugin.json"), problems);
  const lists = [isFields(fromFile) && isFields(fromFile.mcpServers) ? fromFile.mcpServers : fromFile, isFields(manifest) ? manifest.mcpServers : undefined];
  return [...new Set(lists.flatMap((list) => (isFields(list) ? Object.keys(list) : [])))].filter((name) => SAFE_PART.test(name));
}

function normalised(name: string): string {
  return name.toLowerCase().replace(/^claude\.ai\s+/, "").replaceAll(/[\s-]+/g, "_");
}

export interface KonnektorEintrag {
  readonly name: string;
  readonly text: string;
  readonly steckbrief: Steckbrief;
}

async function connectorEntries(vault: string, problems: string[]): Promise<KonnektorEintrag[]> {
  const folder = path.join(vault, "10_Bibliothek", "18_Konnektoren");
  const files = (await entriesOf(folder, problems)).filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  const read = await Promise.all(files.map(async (file) => ({ name: file.name.slice(0, -".md".length), text: (await textOf(path.join(folder, file.name), problems)) ?? "" })));
  return read.filter((entry) => /^Einsatz:/m.test(FRONT_MATTER.exec(entry.text)?.[1] ?? "")).map((entry) => ({ ...entry, steckbrief: readSteckbrief(entry.text) }));
}

export function setupText(text: string): string {
  const body = text.replace(FRONT_MATTER, "").trim();
  return body.length <= LONGEST_SETUP_TEXT ? body : `${body.slice(0, LONGEST_SETUP_TEXT - 1)}…`;
}

function connectorOf(kennung: string, name: string, art: Konnektor["art"], entries: readonly KonnektorEintrag[]): Konnektor {
  const entry = entries.find((candidate) => normalised(candidate.name) === normalised(name));
  return { kennung, name, art, bereiche: entry?.steckbrief.bereiche ?? [WITHOUT_AREA], jeSitzungSchaltbar: art === "mcp" };
}

async function configuredConnectors(orte: BestandsOrte, active: readonly InstalliertesPlugin[], entries: readonly KonnektorEintrag[], problems: string[]): Promise<Konnektor[]> {
  const config = await jsonOf(orte.claudeJson, problems);
  const own = isFields(config) && isFields(config.mcpServers) ? Object.keys(config.mcpServers).filter((name) => SAFE_PART.test(name)) : [];
  const claudeAi = isFields(config) && Array.isArray(config.claudeAiMcpEverConnected) ? config.claudeAiMcpEverConnected.filter((name): name is string => typeof name === "string" && SAFE_NAME.test(name)) : [];
  const fromPlugins = await Promise.all(active.map(async (plugin) => (await serversOf(plugin, problems)).map((server) => connectorOf(`plugin:${plugin.name}:${server}`, server, "plugin", entries))));
  return [...own.map((name) => connectorOf(name, name, "mcp", entries)), ...fromPlugins.flat(), ...claudeAi.map((name) => connectorOf(name, name, "claudeai", entries))];
}

function offerOf(kennung: string, name: string, beschreibung: string, bereiche: Bereich[], braeuchteGeheimnis = false): Angebot {
  return { kennung, name, beschreibung, bereiche, braeuchteGeheimnis };
}

async function librarySkills(orte: BestandsOrte, own: { readonly skills: readonly Skill[]; readonly linked: ReadonlySet<string> }, problems: string[]): Promise<{ angebote: Angebot[]; orte: Map<string, string> }> {
  const found = await skillsBelow(libraryFolder(orte.vault), problems);
  const taken = new Set(own.skills.map((skill) => skill.name));
  const places = new Map<string, string>();
  const angebote: Angebot[] = [];
  for (const place of found) {
    if (own.linked.has(place.echt) || taken.has(place.name) || places.has(place.name)) continue;
    places.set(place.name, place.echt);
    angebote.push(offerOf(place.name, place.name, place.steckbrief.beschreibung, place.steckbrief.bereiche));
  }
  return { angebote, orte: places };
}

async function marketplaceOffers(orte: BestandsOrte, installed: ReadonlySet<string>, problems: string[]): Promise<Angebot[]> {
  const known = await jsonOf(path.join(orte.claudeOrdner, "plugins", "known_marketplaces.json"), problems);
  const markets = isFields(known) ? Object.entries(known).filter(([name, entry]) => SAFE_PART.test(name) && isFields(entry) && typeof entry.installLocation === "string") : [];
  const lists = await Promise.all(
    markets.map(async ([market, entry]) => {
      const manifest = await jsonOf(path.join(String((entry as Fields).installLocation), ".claude-plugin", "marketplace.json"), problems);
      const plugins: unknown[] = isFields(manifest) && Array.isArray(manifest.plugins) ? manifest.plugins : [];
      return plugins.flatMap((plugin) => (isFields(plugin) && typeof plugin.name === "string" && SAFE_PART.test(plugin.name) ? [{ market, plugin }] : []));
    }),
  );
  const offers = lists.flat().filter(({ market, plugin }) => !installed.has(`${String(plugin.name)}@${market}`));
  return Promise.all(offers.map(async ({ market, plugin }) => {
    const name = String(plugin.name);
    const beschreibung = typeof plugin.description === "string" ? shortened(plugin.description) : "";
    return offerOf(`${name}@${market}`, name, beschreibung, await planAreas(orte.vault, name, problems));
  }));
}

function connectorOffers(entries: readonly KonnektorEintrag[], configured: readonly Konnektor[]): Angebot[] {
  const present = new Set(configured.map((connector) => normalised(connector.name)));
  return entries
    .filter((entry) => !present.has(normalised(entry.name)))
    .map((entry) => offerOf(entry.name, entry.name, entry.steckbrief.beschreibung, entry.steckbrief.bereiche, SECRET_WORDS.test(entry.text)));
}

function byName<T extends { readonly name: string; readonly kennung: string }>(list: T[]): T[] {
  return list.sort((a, b) => a.name.localeCompare(b.name, "de") || a.kennung.localeCompare(b.kennung));
}

export async function readBestand(orte: BestandsOrte): Promise<Eingelesen> {
  const probleme: string[] = [];
  const own = await ownSkills(orte, probleme);
  const plugins = await installedPlugins(orte, probleme);
  const entries = await connectorEntries(orte.vault, probleme);
  const active = plugins.installed.filter((plugin) => plugins.plugins.find((entry) => entry.kennung === plugin.kennung)?.aktivGlobal === true);
  const konnektoren = await configuredConnectors(orte, active, entries, probleme);
  const library = await librarySkills(orte, own, probleme);
  const marketplace = await marketplaceOffers(orte, new Set(plugins.installed.map((plugin) => plugin.kennung)), probleme);
  return {
    skills: byName([...own.skills, ...plugins.skills]),
    plugins: byName(plugins.plugins),
    konnektoren: byName(konnektoren),
    bibliothek: { skills: byName(library.angebote), plugins: byName(marketplace), konnektoren: byName(connectorOffers(entries, konnektoren)) },
    bibliotheksOrte: library.orte,
    konnektorTexte: new Map(entries.map((entry) => [entry.name, setupText(entry.text)])),
    probleme,
  };
}

export async function defaultPermission(claudeOrdner: string): Promise<Erlaubnis> {
  const settings = await jsonOf(path.join(claudeOrdner, "settings.json"), []);
  const permissions = isFields(settings) && isFields(settings.permissions) ? settings.permissions : {};
  return isPermission(permissions.defaultMode) ? permissions.defaultMode : "default";
}

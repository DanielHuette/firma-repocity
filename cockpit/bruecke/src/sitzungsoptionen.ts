import { isKennung, isModelName, isPermission, isStyleName, isTitle, MOST_CHOSEN } from "./nachrichten.ts";
import type { Anbieter, Erlaubnis } from "./nachrichten.ts";

export interface GespeicherteOptionen {
  readonly titel: string | null;
  readonly skills: readonly string[];
  readonly plugins: readonly string[] | null;
  readonly konnektorenAus: readonly string[];
  readonly erlaubnis: Erlaubnis | null;
  readonly ausgabestil: string | null;
  readonly schnell: boolean;
  readonly anbieter: Anbieter;
  readonly modell: string | null;
  readonly pruefung: boolean;
}

export const OHNE_OPTIONEN: GespeicherteOptionen = {
  titel: null,
  skills: [],
  plugins: null,
  konnektorenAus: [],
  erlaubnis: null,
  ausgabestil: null,
  schnell: false,
  anbieter: "abo",
  modell: null,
  pruefung: false,
};

export const ASK_TOOLS: readonly string[] = ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"];
const DEFAULT_MODEL = "default";

export interface StartKontext {
  readonly installiertePlugins: readonly string[];
}

const OPTION_KEYS = Object.keys(OHNE_OPTIONEN);

function isChoice(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MOST_CHOSEN && value.every(isKennung) && new Set(value).size === value.length;
}

function orNull<T>(value: unknown, check: (entry: unknown) => entry is T): value is T | null {
  return value === null || check(value);
}

function isProvider(value: unknown): value is Anbieter {
  return value === "abo" || value === "openrouter";
}

export function parseStoredOptions(value: unknown): GespeicherteOptionen | undefined {
  if (value === undefined) return OHNE_OPTIONEN;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  if (!Object.keys(fields).every((key) => OPTION_KEYS.includes(key))) return undefined;
  const { titel, skills, plugins, konnektorenAus, erlaubnis, ausgabestil, schnell, anbieter, modell, pruefung } = { ...OHNE_OPTIONEN, ...fields };
  if (!orNull(titel, isTitle) || !isChoice(skills) || !orNull(plugins, isChoice) || !isChoice(konnektorenAus)) return undefined;
  if (!orNull(erlaubnis, isPermission) || !orNull(ausgabestil, isStyleName) || typeof schnell !== "boolean") return undefined;
  if (!isProvider(anbieter) || !orNull(modell, isModelName) || typeof pruefung !== "boolean") return undefined;
  return { titel, skills, plugins, konnektorenAus, erlaubnis, ausgabestil, schnell, anbieter, modell, pruefung };
}

export function flagSettings(options: GespeicherteOptionen, installed: readonly string[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  const { plugins, schnell, ausgabestil } = options;
  if (plugins !== null) settings.enabledPlugins = Object.fromEntries(installed.map((plugin) => [plugin, plugins.includes(plugin)]));
  if (schnell) settings.fastMode = true;
  if (ausgabestil !== null) settings.outputStyle = ausgabestil;
  if (options.pruefung) settings.permissions = { ask: ASK_TOOLS };
  return settings;
}

export function startArguments(options: GespeicherteOptionen, context: StartKontext): string[] {
  const settings = flagSettings(options, context.installiertePlugins);
  return [
    ...(options.modell === null || options.modell === DEFAULT_MODEL ? [] : ["--model", options.modell]),
    ...(options.erlaubnis === null ? [] : ["--permission-mode", options.erlaubnis]),
    ...(Object.keys(settings).length === 0 ? [] : ["--settings", JSON.stringify(settings)]),
  ];
}

function sameList(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

export interface Abweichung {
  readonly titel: boolean;
  readonly erlaubnis: boolean;
  readonly flags: boolean;
  readonly plugins: boolean;
  readonly konnektoren: { readonly aus: readonly string[]; readonly an: readonly string[] };
  readonly schnell: boolean;
}

export function differences(running: GespeicherteOptionen, wanted: GespeicherteOptionen): Abweichung {
  const plugins = !sameList(running.plugins, wanted.plugins);
  return {
    titel: running.titel !== wanted.titel,
    erlaubnis: running.erlaubnis !== wanted.erlaubnis,
    flags: plugins || running.ausgabestil !== wanted.ausgabestil,
    plugins,
    konnektoren: {
      aus: wanted.konnektorenAus.filter((name) => !running.konnektorenAus.includes(name)),
      an: running.konnektorenAus.filter((name) => !wanted.konnektorenAus.includes(name)),
    },
    schnell: running.schnell !== wanted.schnell,
  };
}

export function isSettled(difference: Abweichung): boolean {
  const { titel, erlaubnis, flags, konnektoren, schnell } = difference;
  return !titel && !erlaubnis && !flags && !schnell && konnektoren.aus.length === 0 && konnektoren.an.length === 0;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} und ${names.at(-1) ?? ""}`;
}

export function skillLine(added: readonly string[], removed: readonly string[]): string | null {
  const parts = [
    ...(added.length === 0 ? [] : [`lade mit dem Skill-Werkzeug ${added.length === 1 ? "den Skill" : "die Skills"} ${listed(added)}`]),
    ...(removed.length === 0 ? [] : [`wende ${removed.length === 1 ? "den Skill" : "die Skills"} ${listed(removed)} nicht mehr an (Hinweis an Claude)`]),
  ];
  return parts.length === 0 ? null : `Für diese Sitzung gilt zusätzlich: ${parts.join("; ")}.`;
}

export function withSkillLine(text: string, line: string | null): string {
  return line === null || text.startsWith("/") ? text : `${line}\n\n${text}`;
}

import { copyFile, lstat, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { isFields } from "./felder.ts";
import path from "node:path";
import type { Runner } from "./befehl.ts";
import type { HakenArt } from "./nachrichten.ts";
import { isInside } from "./pfade.ts";
import { hasErrorCode } from "./private_datei.ts";

export const PROTECTED_COMMANDS: readonly string[] = ["rtk hook claude", "backup-hook.ps1", "backup-check.ps1"];
export const BACKUP_PREFIX = "settings.json.plugin_einbinden_";
export const KEPT_BACKUPS = 5;
const BACKUP_NAME = /^settings\.json\.plugin_einbinden_(\d{1,16})\.bak$/;
const INSTALL_TIMEOUT_MS = 120_000;

export interface Ergebnis {
  readonly ok: boolean;
  readonly text: string;
}

export interface EinbindenOrte {
  readonly claudeOrdner: string;
  readonly vault: string;
  readonly claudeBefehl: readonly string[];
  readonly run: Runner;
  readonly jetzt: () => number;
}

function hooksOf(group: unknown): unknown[] {
  return isFields(group) && Array.isArray(group.hooks) ? group.hooks : [];
}

export function protectedEntries(settings: unknown): string {
  const events = isFields(settings) && isFields(settings.hooks) ? Object.entries(settings.hooks) : [];
  const found = events.flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((group: unknown) => {
      const matcher = isFields(group) ? (group.matcher ?? null) : null;
      return hooksOf(group).flatMap((hook) => {
        const command = isFields(hook) ? hook.command : undefined;
        return typeof command === "string" && PROTECTED_COMMANDS.some((name) => command.includes(name)) ? [JSON.stringify([event, matcher, hook])] : [];
      });
    }),
  );
  return JSON.stringify(found.sort());
}

async function protectedOf(file: string): Promise<string> {
  return protectedEntries(JSON.parse(await readFile(file, "utf8")));
}

export async function linkLibrarySkill(orte: EinbindenOrte, name: string, source: string): Promise<Ergebnis> {
  const library = await realpath(path.join(orte.vault, "10_Bibliothek", "11_Skills"));
  const real = await realpath(source);
  if (!isInside(library, real) || real === library) return { ok: false, text: `Skill ${name} liegt nicht in 10_Bibliothek/11_Skills.` };
  const target = path.join(orte.claudeOrdner, "skills", name);
  try {
    await lstat(target);
    return { ok: false, text: `Skill ${name} ist schon eingebunden; nichts überschrieben.` };
  } catch (error: unknown) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
  await symlink(real, target, "junction");
  return { ok: true, text: `Skill ${name} eingebunden.` };
}

async function dropOldBackups(folder: string): Promise<void> {
  const stamped = (await readdir(folder)).flatMap((name) => {
    const stamp = BACKUP_NAME.exec(name)?.[1];
    return stamp === undefined ? [] : [{ name, stamp: Number(stamp) }];
  });
  const old = stamped.sort((a, b) => b.stamp - a.stamp).slice(KEPT_BACKUPS);
  await Promise.all(old.map((entry) => rm(path.join(folder, entry.name), { force: true })));
}

export async function installPlugin(orte: EinbindenOrte, kennung: string): Promise<Ergebnis> {
  const settings = path.join(orte.claudeOrdner, "settings.json");
  const backup = path.join(orte.claudeOrdner, `${BACKUP_PREFIX}${String(orte.jetzt())}.bak`);
  await copyFile(settings, backup);
  await dropOldBackups(orte.claudeOrdner);
  const before = await protectedOf(settings);
  const result = await orte.run(orte.claudeBefehl, ["plugin", "install", kennung], { cwd: orte.vault, timeoutMs: INSTALL_TIMEOUT_MS });
  const after = await protectedOf(settings).catch(() => null);
  if (after !== before) {
    await copyFile(backup, settings);
    return { ok: false, text: `Plugin ${kennung}: die geschützten Hooks wurden verändert; settings.json wurde aus ${path.basename(backup)} zurückgespielt.` };
  }
  if (result.kind !== "ok") return { ok: false, text: `Plugin ${kennung} nicht installiert (${result.grund}).` };
  return { ok: true, text: `Plugin ${kennung} installiert; wirkt nach dem Neuladen der Plugins.` };
}

export function connectorByHand(name: string): Ergebnis {
  return { ok: false, text: `Konnektor ${name} bitte selbst einrichten, wie in 10_Bibliothek/18_Konnektoren/${name}.md beschrieben; die Brücke trägt keine Konnektoren in ~/.claude.json ein.` };
}

const KIND_NAMES: Readonly<Record<HakenArt, string>> = { skill: "Skill", plugin: "Plugin", konnektor: "Konnektor" };

export function linkAssignment(art: HakenArt, link: string): string {
  const kind = KIND_NAMES[art];
  return [
    `Prüfe diesen fremden ${kind} vor einer Übernahme: ${link}`,
    "Lade dazu den Skill skill-pruefung und führe die Sicherheitsprüfung eines fremden Skills durch (Prüfskript und Durchsicht auf eingeschleuste Anweisungen, Schadcode, Datenabfluss und zu weite Rechte). Ändere dabei nichts.",
    'Lege mir das Urteil danach mit dem Werkzeug AskUserQuestion als Frage vor, mit genau den Antworten „Einziehen“ und „Verwerfen“ und dem Urteil samt Befunden in der Frage.',
    "Erst wenn ich „Einziehen“ wähle: ziehe ihn nach 00_System/Skill_Bauplan.md in den Vault ein. Bei „Verwerfen“ nichts tun.",
  ].join("\n\n");
}

export function buildAssignment(art: HakenArt, wish: string): string {
  const kind = KIND_NAMES[art];
  return [`Baue einen neuen ${kind} nach diesem Wunsch:`, wish, "Lade dazu den Skill skill-creator und baue nach 00_System/Skill_Bauplan.md; den Kopf der SKILL.md schreibt und prüft der Skill skill-steckbrief."].join("\n\n");
}

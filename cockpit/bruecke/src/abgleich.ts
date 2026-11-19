import { CLAUDE_ENDED, type Steuerantwort } from "./chatprozess.ts";
import { differences, flagSettings } from "./sitzungsoptionen.ts";
import type { GespeicherteOptionen } from "./sitzungsoptionen.ts";

export interface Steuerbar {
  steuern(subtype: string, felder?: Readonly<Record<string, unknown>>): Promise<Steuerantwort>;
}

export interface Abgelehnt {
  readonly name: string;
  readonly enabled: boolean;
}

export interface Abgleich {
  readonly laufend: GespeicherteOptionen;
  readonly abgelehnt: readonly Abgelehnt[];
  readonly hinweise: readonly string[];
  readonly neustart: boolean;
}

const HOST_SOURCE = "host";

interface Stand {
  laufend: GespeicherteOptionen;
  readonly optionen: GespeicherteOptionen;
  readonly abgelehnt: Abgelehnt[];
  readonly hinweise: string[];
  neustart: boolean;
}

function failed(stand: Stand, what: string, answer: Steuerantwort, restart: boolean): boolean {
  if (answer.kind === "ok") return false;
  stand.hinweise.push(`${what} nicht übernommen (${answer.grund})${restart ? "; die Brücke startet die Sitzung vor dem nächsten Schritt mit der Einstellung neu" : ""}.`);
  stand.neustart ||= restart;
  return true;
}

async function title(claude: Steuerbar, stand: Stand): Promise<void> {
  const { titel } = stand.optionen;
  if (titel === null) return;
  failed(stand, "Neuer Titel", await claude.steuern("rename_session", { title: titel, source: HOST_SOURCE }), false);
  stand.laufend = { ...stand.laufend, titel };
}

async function permission(claude: Steuerbar, stand: Stand): Promise<void> {
  const { erlaubnis } = stand.optionen;
  if (erlaubnis === null) return;
  if (!failed(stand, "Erlaubnismodus", await claude.steuern("set_permission_mode", { mode: erlaubnis }), true)) stand.laufend = { ...stand.laufend, erlaubnis };
}

async function flags(claude: Steuerbar, stand: Stand, installed: readonly string[], plugins: boolean): Promise<void> {
  const { optionen, laufend } = stand;
  const settings = flagSettings({ ...optionen, schnell: laufend.schnell }, installed);
  if (failed(stand, "Plugins und Ausgabestil", await claude.steuern("apply_flag_settings", { settings }), true)) return;
  if (plugins && failed(stand, "Plugins", await claude.steuern("reload_plugins", { refuse_if_busy: true }), true)) return;
  stand.laufend = { ...stand.laufend, plugins: optionen.plugins, ausgabestil: optionen.ausgabestil };
}

async function connector(claude: Steuerbar, stand: Stand, name: string, enabled: boolean): Promise<void> {
  const answer = await claude.steuern("mcp_toggle", { serverName: name, enabled });
  if (answer.kind === "fehler" && answer.grund === CLAUDE_ENDED) return;
  const aus = (list: readonly string[]): string[] => (enabled ? list.filter((entry) => entry !== name) : [...list.filter((entry) => entry !== name), name]);
  if (failed(stand, `Konnektor ${name} ${enabled ? "an" : "aus"}`, answer, false)) {
    stand.abgelehnt.push({ name, enabled });
    return;
  }
  stand.laufend = { ...stand.laufend, konnektorenAus: aus(stand.laufend.konnektorenAus) };
}

export async function abgleichen(claude: Steuerbar, laufend: GespeicherteOptionen, optionen: GespeicherteOptionen, installed: readonly string[]): Promise<Abgleich> {
  const stand: Stand = { laufend, optionen, abgelehnt: [], hinweise: [], neustart: false };
  const difference = differences(laufend, optionen);
  if (difference.titel) await title(claude, stand);
  if (difference.erlaubnis) await permission(claude, stand);
  if (difference.flags) await flags(claude, stand, installed, difference.plugins);
  for (const name of difference.konnektoren.aus) await connector(claude, stand, name, false);
  for (const name of difference.konnektoren.an) await connector(claude, stand, name, true);
  return { laufend: stand.laufend, abgelehnt: stand.abgelehnt, hinweise: stand.hinweise, neustart: stand.neustart };
}

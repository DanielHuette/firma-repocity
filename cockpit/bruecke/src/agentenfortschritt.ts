import type { Fortschritt } from "./nachrichten.ts";
import { isFields, type Fields } from "./felder.ts";

export const MAIN_PARENT = "haupt";
const AGENT_TOOLS = new Set(["Agent", "Task"]);
const SKILL_TOOL = "Skill";
const TASK_LIST_TOOL = /(?:^|__)work_state_write$/;
const DONE = "done";
const DROPPED = "dropped";
const MOST_TASKS = 1_000;

export interface StreamAgent {
  readonly id: string;
  readonly typ: string;
  readonly beschreibung: string | null;
}

export interface AgentDetails {
  readonly skills: readonly string[];
  readonly fortschritt: Fortschritt | null;
}

function text(fields: Fields, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function shortDescription(input: Fields): string | null {
  const beschreibung = text(input, "description")?.trim() ?? "";
  return beschreibung === "" ? null : beschreibung;
}

export class Agentenfortschritt {
  readonly #agents: StreamAgent[] = [];
  readonly #skills = new Map<string, string[]>();
  readonly #tasks = new Map<string, Map<string, string>>();

  lesen(zeile: unknown): void {
    if (!isFields(zeile) || zeile.type !== "assistant" || !isFields(zeile.message) || !Array.isArray(zeile.message.content)) return;
    const parent = text(zeile, "parent_tool_use_id") ?? MAIN_PARENT;
    for (const block of zeile.message.content as unknown[]) {
      if (isFields(block) && block.type === "tool_use" && isFields(block.input)) this.#tool(parent, text(block, "id"), text(block, "name") ?? "", block.input);
    }
  }

  agenten(): readonly StreamAgent[] {
    return this.#agents;
  }

  von(parent: string): AgentDetails {
    const tasks = [...(this.#tasks.get(parent)?.values() ?? [])].filter((status) => status !== DROPPED);
    const fortschritt = tasks.length === 0 ? null : { erledigt: tasks.filter((status) => status === DONE).length, gesamt: tasks.length };
    return { skills: this.#skills.get(parent) ?? [], fortschritt };
  }

  #tool(parent: string, id: string | null, name: string, input: Fields): void {
    if (AGENT_TOOLS.has(name) && id !== null && !this.#agents.some((agent) => agent.id === id)) {
      this.#agents.push({ id, typ: text(input, "subagent_type") ?? "general-purpose", beschreibung: shortDescription(input) });
    } else if (name === SKILL_TOOL) {
      const skill = text(input, "skill");
      const known = this.#skills.get(parent) ?? [];
      if (skill !== null && !known.includes(skill)) this.#skills.set(parent, [...known, skill]);
    } else if (TASK_LIST_TOOL.test(name) && isFields(input.fields)) {
      this.#task(parent, text(input, "list") ?? "", input.fields);
    }
  }

  #task(parent: string, list: string, fields: Fields): void {
    const task = text(fields, "task");
    const status = text(fields, "status");
    if (task === null || status === null) return;
    const tasks = this.#tasks.get(parent) ?? new Map<string, string>();
    const key = `${list}\u0000${task}`;
    if (!tasks.has(key) && tasks.size >= MOST_TASKS) return;
    tasks.set(key, status);
    this.#tasks.set(parent, tasks);
  }
}

import { messageActions, type MessageAction } from "../src/lib/actions";

export type Priority = "info" | "wichtig" | "dringend";
export type PushAction = MessageAction;

export interface PushMessage {
  id: string;
  app: string;
  kind: string;
  priority: Priority;
  title: string;
  body: string;
  link: string;
  tag: string;
  token: string;
  actions: PushAction[];
}

export interface NotificationData {
  id: string;
  link: string;
  tag: string;
  token: string;
  title: string;
}

export interface ServerConfig {
  url: string;
  anonKey: string;
}

export interface ActionNotificationOptions extends NotificationOptions {
  actions?: PushAction[];
}

export const OFFLINE_TEXT = "Keine Verbindung zum Server. Öffne das Cockpit und schau nach, ob es geklappt hat.";
export const FAILED_TEXT = "Das hat nicht geklappt. Öffne das Cockpit und versuch es dort noch mal.";

const APP_LABEL: Record<string, string> = {
  crm: "CRM", marketing: "Marketing", trading: "Trading", system: "Cockpit", radarauditor: "RadarAuditor",
};
const PRIORITIES: readonly Priority[] = ["info", "wichtig", "dringend"];
const REQUEST_TIMEOUT_MS = 15000;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function parsePush(raw: unknown, fallbackText: string): PushMessage {
  if (typeof raw !== "object" || raw === null) {
    return { id: "", app: "system", kind: "", priority: "wichtig", title: "Neue Nachricht im Cockpit", body: fallbackText, link: "/", tag: "", token: "", actions: [] };
  }
  const fields = raw as Record<string, unknown>;
  const id = text(fields.id);
  const priority = PRIORITIES.find((entry) => entry === fields.priority) ?? "wichtig";
  return {
    id, app: text(fields.app, "system"), kind: text(fields.kind), priority,
    title: text(fields.title, "Neue Nachricht im Cockpit"), body: text(fields.body), link: text(fields.link, "/"),
    tag: text(fields.tag) === "" ? id : text(fields.tag), token: text(fields.token), actions: messageActions(fields.actions),
  };
}

export function notificationFor(message: PushMessage): { title: string; options: ActionNotificationOptions } {
  const prefix = message.priority === "dringend" ? "Dringend · " : "";
  const data: NotificationData = { id: message.id, link: message.link, tag: message.tag, token: message.token, title: message.title };
  return {
    title: `${prefix}${message.title}`,
    options: {
      body: `${APP_LABEL[message.app] ?? "Cockpit"} · ${message.body}`.slice(0, 500),
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: message.tag === "" ? undefined : message.tag,
      silent: message.priority === "info",
      requireInteraction: message.priority === "dringend",
      actions: message.actions,
      data,
    },
  };
}

export function readData(data: unknown): NotificationData {
  const fields = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const link = text(fields.link);
  return { id: text(fields.id), link: link === "" ? "/" : link, tag: text(fields.tag), token: text(fields.token), title: text(fields.title) };
}

export function actionRequest(config: ServerConfig, data: NotificationData, action: string): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { apikey: config.anonKey, "Content-Profile": "cockpit", "Content-Type": "application/json" };
  if (config.anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${config.anonKey}`;
  return {
    url: `${config.url}/rest/v1/rpc/run_action`,
    init: { method: "POST", headers, body: JSON.stringify({ p_message: data.id, p_token: data.token, p_action: action }) },
  };
}

async function answerText(response: Response): Promise<string> {
  if (!response.ok) return FAILED_TEXT;
  const answer = await response.json() as unknown;
  const sentence = typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>).text : undefined;
  return typeof sentence === "string" && sentence !== "" ? sentence : FAILED_TEXT;
}

export async function performAction(fetcher: typeof fetch, config: ServerConfig, data: NotificationData, action: string): Promise<string> {
  if (config.url === "" || config.anonKey === "" || data.id === "" || data.token === "") return FAILED_TEXT;
  const request = actionRequest(config, data, action);
  let response: Response;
  try {
    response = await fetcher(request.url, { ...request.init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return OFFLINE_TEXT;
  }
  try {
    return await answerText(response);
  } catch {
    return FAILED_TEXT;
  }
}

export function resultNotification(data: NotificationData, sentence: string): { title: string; options: ActionNotificationOptions } {
  const kept: NotificationData = { ...data, token: "" };
  return {
    title: data.title === "" ? "Cockpit" : data.title,
    options: { body: sentence, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: data.tag === "" ? undefined : data.tag, data: kept },
  };
}

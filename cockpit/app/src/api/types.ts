import type { MessageAction } from "../lib/actions";

export type AppName = "crm" | "marketing" | "trading" | "system" | "radarauditor";
export type MessagePriority = "info" | "wichtig" | "dringend";

export interface Message {
  id: string;
  app: AppName;
  kind: string;
  title: string;
  body: string;
  link: string;
  priority: MessagePriority;
  created_at: string;
  read_at: string | null;
  pushed_at: string | null;
  push_error: string;
  tag: string | null;
  actions: MessageAction[];
  action_token: string;
  acted_at: string | null;
  acted_action: string | null;
  action_result: string;
}

export interface Device {
  id: string;
  endpoint: string;
  device: string;
  created_at: string;
  last_ok_at: string | null;
  failures: number;
}

export interface CrmOverview {
  new_inquiries: number;
  overdue_invoices: number;
  pending_approvals: number;
  open_tickets: number;
  tasks_due: number;
  receivables: number;
  paid_this_month: number;
  pipeline_value: number;
  unknown_senders: number;
  failed_mails: number;
  mailbox_stale: boolean;
}

export type AssistantStatus = "queued" | "claimed" | "done" | "failed";

export interface AssistantRequest {
  id: string;
  text: string | null;
  audio_path: string | null;
  status: AssistantStatus;
  result_text: string;
  created_at: string;
  finished_at: string | null;
}

export type AuditStatus =
  | "requested" | "collecting" | "collected" | "scored" | "awaiting_analysis" | "analysed" | "reported" | "failed" | "halted";
export type AuditPurpose = "sales" | "monthly";
export type EstimateStatus = "covered" | "insufficient" | "unchecked";
export type EventKind = "route" | "check" | "manager" | "repair";
export type EventResult = "gemessen" | "fehlgeschlagen" | "ausgesetzt" | "Schritt mit Daniel" | "offen" | "neu gestartet" | "Warnung";

export interface RadarCustomer {
  id: string;
  name: string;
}

export interface RadarAudit {
  id: string;
  customer_id: string;
  status: AuditStatus;
  requested_at: string;
  finished_at: string | null;
  total_score: number | null;
  error: string | null;
  purpose: AuditPurpose | null;
  estimate_status: EstimateStatus | null;
  estimate_note: string | null;
}

export interface RadarEvent {
  id: string;
  audit_id: string;
  occurred_at: string;
  kind: EventKind;
  result: EventResult;
  label: string;
  reason: string | null;
  stage: number | null;
}

export interface RadarCost {
  audit_id: string;
  source: string;
  service: string;
  calls: number;
  cost: number;
  tokens_in: number;
  tokens_out: number;
}

export interface RadarEstimate {
  audit_id: string;
  source: string;
  service: string;
  calls: number;
  unit_cost: number;
  cost: number;
}

export interface RadarUsage {
  day: string;
  source: string;
  count: number;
  cost: number;
}

export interface RadarKeyword {
  customer_id: string;
  scope: "local" | "nationwide";
}

export interface RadarSnapshot {
  heartbeat: unknown;
  sources: unknown;
  customers: RadarCustomer[];
  audits: RadarAudit[];
  events: RadarEvent[];
  costs: RadarCost[];
  estimates: RadarEstimate[];
  usage: RadarUsage[];
  keywords: RadarKeyword[];
}

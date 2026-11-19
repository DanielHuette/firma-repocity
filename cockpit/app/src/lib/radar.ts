import type {
  AuditStatus, EstimateStatus, EventResult, RadarAudit, RadarEvent, RadarKeyword, RadarSnapshot, RadarUsage,
} from "../api/types";
import type { Tone } from "../components/ui";

export const RADAR_APP_URL = "https://app.radarauditor.speedofthespirit.dev";
export const HEARTBEAT_KEY = "worker_heartbeat";
export const SOURCES_KEY = "sources";
export const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 1000;

const MANAGER_CONCLUSION_LABEL = "Audit-Manager: Ergebnis";
const ANALYSIS_UNAVAILABLE = "Die Auswertung auf dem Server ist nicht bereit.";
const SUBSCRIPTION_SOURCE = "claude";
const MAX_POINTS = 100;
const MINUTE_MS = 60 * 1000;

export function auditLink(auditId: string): string {
  return `${RADAR_APP_URL}/auswertung/${auditId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CollectorState {
  online: boolean;
  lastSeen: Date | null;
  version: string | null;
  blockedReason: string | null;
}

function blockedReason(capabilities: Record<string, unknown>): string | null {
  if (capabilities.analysis_available !== false) return null;
  const reason = capabilities.analysis_reason;
  return typeof reason === "string" && reason.trim() !== "" ? reason.trim() : ANALYSIS_UNAVAILABLE;
}

export function collectorState(heartbeat: unknown, now: Date): CollectorState {
  const unknown: CollectorState = { online: false, lastSeen: null, version: null, blockedReason: null };
  if (!isRecord(heartbeat) || typeof heartbeat.at !== "string") return unknown;
  const lastSeen = new Date(heartbeat.at);
  if (Number.isNaN(lastSeen.getTime())) return unknown;
  const online = now.getTime() - lastSeen.getTime() < HEARTBEAT_MAX_AGE_MS;
  const capabilities = isRecord(heartbeat.capabilities) ? heartbeat.capabilities : {};
  return {
    online,
    lastSeen,
    version: typeof heartbeat.version === "string" ? heartbeat.version : null,
    blockedReason: online ? blockedReason(capabilities) : null,
  };
}

export function ago(from: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / MINUTE_MS);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${String(minutes)} Min.`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `vor ${String(hours)} Std.` : `vor ${String(Math.floor(hours / 24))} Tg.`;
}

export function lastSeenText(state: CollectorState, now: Date): string {
  if (state.lastSeen === null) return "Noch kein Lebenszeichen empfangen.";
  const version = state.version === null ? "" : ` · Version ${state.version}`;
  return `Letztes Lebenszeichen ${ago(state.lastSeen, now)}${version}`;
}

export type Phase = "running" | "halted" | "done" | "failed";

const PHASES: Record<AuditStatus, Phase> = {
  requested: "running",
  collecting: "running",
  collected: "running",
  scored: "running",
  awaiting_analysis: "running",
  analysed: "running",
  reported: "done",
  failed: "failed",
  halted: "halted",
};

export const STATUS_LABEL: Record<AuditStatus, string> = {
  requested: "Angefordert",
  collecting: "Sammelt Daten",
  collected: "Daten gesammelt",
  scored: "Bewertet",
  awaiting_analysis: "Wartet auf Auswertung",
  analysed: "Ausgewertet",
  reported: "Bericht fertig",
  failed: "Fehlgeschlagen",
  halted: "Angehalten",
};

export const PHASE_TONE: Record<Phase, Tone> = { running: "gold", halted: "bad", done: "good", failed: "bad" };

export function phaseOf(status: AuditStatus): Phase {
  return PHASES[status];
}

export interface Verdict {
  label: string;
  tone: Tone;
  reason: string | null;
}

const VERDICTS: Partial<Record<EventResult, { label: string; tone: Tone }>> = {
  gemessen: { label: "Fertig", tone: "good" },
  ausgesetzt: { label: "Unvollständig", tone: "gold" },
  fehlgeschlagen: { label: "Fehlgeschlagen", tone: "bad" },
};

export function verdictOf(events: readonly RadarEvent[]): Verdict | null {
  let latest: RadarEvent | undefined;
  for (const event of events) {
    if (event.kind !== "manager" || event.label !== MANAGER_CONCLUSION_LABEL) continue;
    if (latest === undefined || Date.parse(event.occurred_at) > Date.parse(latest.occurred_at)) latest = event;
  }
  const verdict = latest === undefined ? undefined : VERDICTS[latest.result];
  if (latest === undefined || verdict === undefined) return null;
  return { ...verdict, reason: latest.reason === null || latest.reason.trim() === "" ? null : latest.reason.trim() };
}

const POINTS = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export function pointsText(score: number | null): string | null {
  return score === null ? null : `${POINTS.format(score)} von ${String(MAX_POINTS)} Punkten`;
}

export interface CostRow {
  source: string;
  service: string;
  calls: number;
  cost: number;
}

export interface CostLine {
  source: string;
  service: string;
  calls: number;
  unit: number | null;
  total: number;
}

export interface Statement {
  lines: CostLine[];
  total: number;
  subscriptionCalls: number;
}

const SOURCE_LABEL: Record<string, string> = {
  apify: "Apify",
  dataforseo: "DataForSEO",
  places: "Google Places",
  prospect_search: "Kundensuche (Google Places)",
  claude: "Claude (im Abo enthalten)",
  google_search: "Google-Suche",
  google_maps: "Google Maps",
  google_ai: "Google KI-Modus",
  chatgpt: "ChatGPT",
};

const SERVICE_LABEL: Record<string, string> = {
  google_search: "Google-Suche",
  google_images: "Google-Bilder",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  assistants: "Fragen an den KI-Assistenten",
  analysis: "Auswertung der Befunde",
  "/v3/serp/google/organic/live/advanced": "Google-Suchergebnisse",
  "/v3/serp/google/ai_mode/task_post": "Fragen an den Google KI-Modus",
  "/v3/serp/google/organic/task_post": "Google-Suche, drei Ergebnisseiten je Suchbegriff",
  "/v3/serp/bing/organic/task_post": "Bing-Suche",
  "/v3/serp/google/maps/task_post": "Google Maps, Kartenplätze und Kartenraster",
  "/v3/business_data/google/my_business_info/task_post": "Google-Profile",
  "/v3/business_data/google/reviews/task_post": "Google-Bewertungen mit Antworten des Inhabers",
  "/v3/business_data/google/questions_and_answers/task_post": "Fragen und Antworten im Google-Profil",
  "/v3/ai_optimization/chat_gpt/llm_scraper/task_post": "Fragen an ChatGPT",
  "/v3/keywords_data/google_ads/search_volume/live": "Suchvolumen",
  "/v3/backlinks/summary/live": "Rückverweise, Übersicht",
  "/v3/backlinks/referring_domains/live": "Rückverweise, verweisende Seiten",
  "/v3/dataforseo_labs/google/ranked_keywords/live": "Platzierte Suchbegriffe",
  "/v3/dataforseo_labs/google/domain_intersection/live": "Suchbegriffe der Wettbewerber",
  "/v3/dataforseo_labs/google/historical_rank_overview/live": "Verlauf der Platzierungen",
  text_search_essentials_ids_only: "Ortssuche, nur Kennung",
  text_search_enterprise: "Ortssuche, Firmendaten",
  text_search_enterprise_atmosphere: "Ortssuche, Firmendaten mit Bewertungen",
  place_details_enterprise_atmosphere: "Firmenprofil mit Bewertungen",
  apple_maps: "Apple Karten",
  bing_maps: "Bing Karten",
  directory_search: "Suche in Branchen- und Bewertungsportalen",
};

export function statement(rows: readonly CostRow[]): Statement {
  const lines: CostLine[] = [];
  let subscriptionCalls = 0;
  for (const row of rows) {
    if (row.source === SUBSCRIPTION_SOURCE) {
      subscriptionCalls += row.calls;
      continue;
    }
    lines.push({
      source: SOURCE_LABEL[row.source] ?? row.source,
      service: SERVICE_LABEL[row.service] ?? row.service,
      calls: row.calls,
      unit: row.calls > 0 ? row.cost / row.calls : null,
      total: row.cost,
    });
  }
  return { lines, total: lines.reduce((sum, line) => sum + line.total, 0), subscriptionCalls };
}

const UNIT_PRICE = new Intl.NumberFormat("de-DE", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4,
});

export function unitPrice(amount: number): string {
  return UNIT_PRICE.format(amount);
}

const ESTIMATE_VERDICT: Record<EstimateStatus, { label: string; tone: Tone }> = {
  covered: { label: "Limits reichen", tone: "good" },
  insufficient: { label: "Limit reicht nicht", tone: "bad" },
  unchecked: { label: "Limits nicht geprüft", tone: "" },
};

export function estimateVerdict(status: EstimateStatus | null): { label: string; tone: Tone } | null {
  return status === null ? null : ESTIMATE_VERDICT[status];
}

export interface AuditRow {
  audit: RadarAudit;
  phase: Phase;
  status: string;
  verdict: Verdict | null;
  points: string | null;
  failedRoutes: number;
  repairs: RepairLine[];
  monthly: boolean;
  link: string;
  actual: Statement;
  planned: Statement;
  estimate: { label: string; tone: Tone } | null;
}

export interface RepairLine {
  tone: Tone;
  text: string;
}

const REPAIR_TONE: Partial<Record<EventResult, Tone>> = {
  "neu gestartet": "gold",
  gemessen: "good",
  fehlgeschlagen: "bad",
  Warnung: "bad",
};

export function repairLines(events: readonly RadarEvent[]): RepairLine[] {
  return events
    .filter((event) => event.kind === "repair")
    .sort((first, second) => Date.parse(first.occurred_at) - Date.parse(second.occurred_at))
    .map((event) => {
      const reason = event.reason?.trim() ?? "";
      return { tone: REPAIR_TONE[event.result] ?? "", text: reason === "" ? event.label : `${event.label}: ${reason}` };
    });
}

export interface CustomerGroup {
  customerId: string;
  name: string;
  keywords: string;
  audits: AuditRow[];
}

export function keywordSummary(keywords: readonly RadarKeyword[]): string {
  if (keywords.length === 0) return "Keine Suchbegriffe hinterlegt";
  const nationwide = keywords.filter((keyword) => keyword.scope === "nationwide").length;
  return `${String(keywords.length - nationwide)} vor Ort · ${String(nationwide)} bundesweit`;
}

function auditRow(audit: RadarAudit, snapshot: RadarSnapshot): AuditRow {
  const events = snapshot.events.filter((event) => event.audit_id === audit.id);
  return {
    audit,
    phase: phaseOf(audit.status),
    status: STATUS_LABEL[audit.status],
    verdict: verdictOf(events),
    points: pointsText(audit.total_score),
    failedRoutes: events.filter((event) => event.kind === "route" && event.result === "fehlgeschlagen").length,
    repairs: repairLines(events),
    monthly: audit.purpose === "monthly",
    link: auditLink(audit.id),
    actual: statement(snapshot.costs.filter((row) => row.audit_id === audit.id)),
    planned: statement(snapshot.estimates.filter((row) => row.audit_id === audit.id)),
    estimate: estimateVerdict(audit.estimate_status),
  };
}

function newestFirst(first: string, second: string): number {
  return Date.parse(second) - Date.parse(first);
}

export function customerGroups(snapshot: RadarSnapshot): CustomerGroup[] {
  const ordered = [...snapshot.audits].sort((a, b) => newestFirst(a.requested_at, b.requested_at));
  const groups = new Map<string, CustomerGroup>();
  for (const audit of ordered) {
    const group = groups.get(audit.customer_id) ?? {
      customerId: audit.customer_id,
      name: snapshot.customers.find((customer) => customer.id === audit.customer_id)?.name ?? "Unbekannter Kunde",
      keywords: keywordSummary(snapshot.keywords.filter((keyword) => keyword.customer_id === audit.customer_id)),
      audits: [],
    };
    group.audits.push(auditRow(audit, snapshot));
    groups.set(audit.customer_id, group);
  }
  return [...groups.values()];
}

export interface SourceMonth {
  source: string;
  label: string;
  requests: number;
  cost: number;
  limit: number | null;
  share: number | null;
}

const PAID_SOURCES: readonly string[] = ["places", "prospect_search", "dataforseo", "apify"];
const DEFAULT_MONTHLY_CAP_EUR: Record<string, number> = { places: 25, prospect_search: 10, dataforseo: 50, apify: 10 };

export function monthStart(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}-01`;
}

function monthlyCap(sources: unknown, source: string): number | null {
  const setting = isRecord(sources) ? sources[source] : undefined;
  const stored = isRecord(setting) ? setting.monthly_cost_cap_eur : undefined;
  if (typeof stored === "number" && Number.isFinite(stored) && stored >= 0) return stored;
  return DEFAULT_MONTHLY_CAP_EUR[source] ?? null;
}

export function monthSources(rows: readonly RadarUsage[], sources: unknown, fromDay: string): SourceMonth[] {
  const totals = new Map<string, { requests: number; cost: number }>();
  for (const row of rows) {
    if (row.day < fromDay) continue;
    const total = totals.get(row.source) ?? { requests: 0, cost: 0 };
    totals.set(row.source, { requests: total.requests + row.count, cost: total.cost + row.cost });
  }
  const ids = [...PAID_SOURCES, ...[...totals.keys()].filter((id) => !PAID_SOURCES.includes(id)).sort()];
  return ids.map((source) => {
    const total = totals.get(source) ?? { requests: 0, cost: 0 };
    const limit = monthlyCap(sources, source);
    return {
      source,
      label: SOURCE_LABEL[source] ?? source,
      requests: total.requests,
      cost: total.cost,
      limit,
      share: limit === null || limit === 0 ? null : total.cost / limit,
    };
  });
}

export interface RadarOverview {
  collector: CollectorState;
  running: number;
  halted: number;
  monthCost: number;
  latest: { customer: string; verdict: Verdict; points: string | null; link: string } | null;
}

export function radarOverview(snapshot: RadarSnapshot, now: Date): RadarOverview {
  const rows = customerGroups(snapshot).flatMap((group) => group.audits.map((row) => ({ row, customer: group.name })));
  const latest = rows
    .filter((entry) => entry.row.verdict !== null)
    .sort((a, b) => newestFirst(a.row.audit.requested_at, b.row.audit.requested_at))[0];
  const month = monthSources(snapshot.usage, snapshot.sources, monthStart(now));
  return {
    collector: collectorState(snapshot.heartbeat, now),
    running: rows.filter((entry) => entry.row.phase === "running").length,
    halted: rows.filter((entry) => entry.row.phase === "halted").length,
    monthCost: month.reduce((sum, entry) => sum + entry.cost, 0),
    latest: latest === undefined || latest.row.verdict === null ? null : {
      customer: latest.customer, verdict: latest.row.verdict, points: latest.row.points, link: latest.row.link,
    },
  };
}

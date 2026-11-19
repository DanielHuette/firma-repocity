import { QueryError } from "../lib/errors";
import { HEARTBEAT_KEY, SOURCES_KEY, monthStart } from "../lib/radar";
import { unwrap } from "./cockpit";
import { supabase } from "./supabase";
import type {
  RadarAudit, RadarCost, RadarCustomer, RadarEstimate, RadarEvent, RadarKeyword, RadarSnapshot, RadarUsage,
} from "./types";

const AUDIT_FIELDS = "id, customer_id, status, requested_at, finished_at, total_score, error, purpose, estimate_status, estimate_note";
const EVENT_FIELDS = "id, audit_id, occurred_at, kind, result, label, reason, stage";
const NEEDED_EVENTS = "kind.eq.manager,kind.eq.repair,and(kind.eq.route,result.eq.fehlgeschlagen)";
const AUDIT_LIMIT = 40;

async function auditDetails(auditIds: string[]): Promise<Pick<RadarSnapshot, "events" | "costs" | "estimates">> {
  if (auditIds.length === 0) return { events: [], costs: [], estimates: [] };
  const db = supabase.schema("public");
  const [events, costs, estimates] = await Promise.all([
    db.from("audit_events").select(EVENT_FIELDS).in("audit_id", auditIds).or(NEEDED_EVENTS).overrideTypes<RadarEvent[], { merge: false }>(),
    db.from("audit_costs").select("*").in("audit_id", auditIds).overrideTypes<RadarCost[], { merge: false }>(),
    db.from("audit_estimates").select("*").in("audit_id", auditIds).overrideTypes<RadarEstimate[], { merge: false }>(),
  ]);
  return {
    events: unwrap("Ereignisse laden", events),
    costs: unwrap("Kosten laden", costs),
    estimates: unwrap("Kostenvoranschläge laden", estimates),
  };
}

export async function loadRadar(now = new Date()): Promise<RadarSnapshot> {
  const db = supabase.schema("public");
  const [settings, customers, audits, usage, keywords] = await Promise.all([
    db.from("settings").select("key, value").in("key", [HEARTBEAT_KEY, SOURCES_KEY]).overrideTypes<{ key: string; value: unknown }[], { merge: false }>(),
    db.from("customers").select("id, name").order("name").overrideTypes<RadarCustomer[], { merge: false }>(),
    db.from("audits").select(AUDIT_FIELDS).order("requested_at", { ascending: false }).limit(AUDIT_LIMIT).overrideTypes<RadarAudit[], { merge: false }>(),
    db.from("source_usage").select("day, source, count, cost").gte("day", monthStart(now)).overrideTypes<RadarUsage[], { merge: false }>(),
    db.from("keywords").select("customer_id, scope").overrideTypes<RadarKeyword[], { merge: false }>(),
  ]);
  const settingRows = unwrap("Einstellungen laden", settings);
  const auditRows = unwrap("Audits laden", audits);
  return {
    heartbeat: settingRows.find((row) => row.key === HEARTBEAT_KEY)?.value ?? null,
    sources: settingRows.find((row) => row.key === SOURCES_KEY)?.value ?? null,
    customers: unwrap("Kunden laden", customers),
    audits: auditRows,
    usage: unwrap("Verbrauch laden", usage),
    keywords: unwrap("Suchbegriffe laden", keywords),
    ...(await auditDetails(auditRows.map((audit) => audit.id))),
  };
}

export async function startAudit(customerId: string): Promise<string> {
  const id: unknown = unwrap("Audit starten", await supabase.schema("public").rpc("queue_field_audit", {
    p_customer_id: customerId, p_disabled_checks: [],
  }));
  if (typeof id !== "string") throw new QueryError("Audit starten", "keine Prüfungsnummer erhalten", null);
  return id;
}

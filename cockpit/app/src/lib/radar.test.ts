import { describe, expect, it } from "vitest";
import type { RadarAudit, RadarEvent, RadarSnapshot, RadarUsage } from "../api/types";
import {
  ago, auditLink, collectorState, customerGroups, estimateVerdict, keywordSummary, lastSeenText, monthSources,
  monthStart, phaseOf, pointsText, radarOverview, statement, unitPrice, verdictOf,
} from "./radar";

const NOW = new Date("2026-11-13T12:00:00Z");

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

function audit(overrides: Partial<RadarAudit> = {}): RadarAudit {
  return {
    id: "a1", customer_id: "c1", status: "reported", requested_at: "2026-11-13T10:00:00Z", finished_at: null,
    total_score: null, error: null, purpose: "sales", estimate_status: null, estimate_note: null, ...overrides,
  };
}

function event(overrides: Partial<RadarEvent> = {}): RadarEvent {
  return {
    id: "e1", audit_id: "a1", occurred_at: "2026-11-13T10:30:00Z", kind: "manager", result: "gemessen",
    label: "Audit-Manager: Ergebnis", reason: null, stage: null, ...overrides,
  };
}

function snapshot(overrides: Partial<RadarSnapshot> = {}): RadarSnapshot {
  return {
    heartbeat: null, sources: null, customers: [{ id: "c1", name: "Bäckerei Korn" }], audits: [], events: [],
    costs: [], estimates: [], usage: [], keywords: [], ...overrides,
  };
}

describe("collectorState", () => {
  it.each([
    ["no heartbeat", null],
    ["a heartbeat without time", { version: "1" }],
    ["a time that is no date", { at: "gestern" }],
    ["a time that is no text", { at: 5 }],
    ["a list", []],
  ])("is offline and unknown for %s", (_name, value) => {
    expect(collectorState(value, NOW)).toEqual({ online: false, lastSeen: null, version: null, blockedReason: null });
  });

  it("is online up to the second before two minutes", () => {
    expect(collectorState({ at: secondsAgo(119) }, NOW).online).toBe(true);
  });

  it("is offline at exactly two minutes", () => {
    expect(collectorState({ at: secondsAgo(120) }, NOW).online).toBe(false);
  });

  it("keeps the last time and the version of an offline collector", () => {
    const state = collectorState({ at: secondsAgo(600), version: "2.4.0" }, NOW);
    expect(state.lastSeen?.toISOString()).toBe(secondsAgo(600));
    expect(state.version).toBe("2.4.0");
  });

  it("names the reason when the analysis is not available", () => {
    const heartbeat = { at: secondsAgo(5), capabilities: { analysis_available: false, analysis_reason: " Kein Claude-Zugang " } };
    expect(collectorState(heartbeat, NOW).blockedReason).toBe("Kein Claude-Zugang");
  });

  it("falls back to a general text when no reason is given", () => {
    const heartbeat = { at: secondsAgo(5), capabilities: { analysis_available: false, analysis_reason: "  " } };
    expect(collectorState(heartbeat, NOW).blockedReason).toBe("Die Auswertung auf dem Server ist nicht bereit.");
  });

  it("does not block while the analysis is available or unreported", () => {
    expect(collectorState({ at: secondsAgo(5), capabilities: { analysis_available: true } }, NOW).blockedReason).toBeNull();
    expect(collectorState({ at: secondsAgo(5) }, NOW).blockedReason).toBeNull();
  });

  it("ignores the capabilities of a collector that is offline", () => {
    const heartbeat = { at: secondsAgo(900), capabilities: { analysis_available: false } };
    expect(collectorState(heartbeat, NOW).blockedReason).toBeNull();
  });
});

describe("ago", () => {
  it.each([
    [59, "gerade eben"],
    [60, "vor 1 Min."],
    [59 * 60 + 59, "vor 59 Min."],
    [60 * 60, "vor 1 Std."],
    [23 * 3600 + 59 * 60, "vor 23 Std."],
    [24 * 3600, "vor 1 Tg."],
  ])("says %s seconds as %s", (seconds, text) => {
    expect(ago(new Date(secondsAgo(seconds)), NOW)).toBe(text);
  });
});

describe("lastSeenText", () => {
  it("says so when there was never a heartbeat", () => {
    expect(lastSeenText(collectorState(null, NOW), NOW)).toBe("Noch kein Lebenszeichen empfangen.");
  });

  it("names the time and the version", () => {
    expect(lastSeenText(collectorState({ at: secondsAgo(180), version: "2.4.0" }, NOW), NOW))
      .toBe("Letztes Lebenszeichen vor 3 Min. · Version 2.4.0");
  });

  it("leaves the version out when it is unknown", () => {
    expect(lastSeenText(collectorState({ at: secondsAgo(180) }, NOW), NOW)).toBe("Letztes Lebenszeichen vor 3 Min.");
  });
});

describe("phaseOf", () => {
  it.each([
    ["requested", "running"], ["collecting", "running"], ["collected", "running"], ["scored", "running"],
    ["awaiting_analysis", "running"], ["analysed", "running"], ["reported", "done"], ["failed", "failed"], ["halted", "halted"],
  ] as const)("puts %s into %s", (status, phase) => {
    expect(phaseOf(status)).toBe(phase);
  });
});

describe("verdictOf", () => {
  it("reads the conclusion of the audit manager", () => {
    expect(verdictOf([event({ reason: "  Alles gemessen " })])).toEqual({ label: "Fertig", tone: "good", reason: "Alles gemessen" });
  });

  it.each([
    ["ausgesetzt", "Unvollständig", "gold"],
    ["fehlgeschlagen", "Fehlgeschlagen", "bad"],
  ] as const)("calls %s %s", (result, label, tone) => {
    expect(verdictOf([event({ result })])).toEqual({ label, tone, reason: null });
  });

  it("takes the newest conclusion", () => {
    const older = event({ id: "e1", occurred_at: "2026-11-13T09:00:00Z", result: "fehlgeschlagen" });
    const newer = event({ id: "e2", occurred_at: "2026-11-13T09:00:00.500Z", result: "gemessen" });
    expect(verdictOf([newer, older])?.label).toBe("Fertig");
    expect(verdictOf([older, newer])?.label).toBe("Fertig");
  });

  it("gives none for notes, other kinds and conclusions that are still open", () => {
    expect(verdictOf([])).toBeNull();
    expect(verdictOf([event({ label: "Audit-Manager" })])).toBeNull();
    expect(verdictOf([event({ kind: "route" })])).toBeNull();
    expect(verdictOf([event({ result: "offen" })])).toBeNull();
  });
});

describe("pointsText", () => {
  it.each([
    [62.5, "62,5 von 100 Punkten"],
    [100, "100 von 100 Punkten"],
    [0, "0 von 100 Punkten"],
    [47.25, "47,25 von 100 Punkten"],
  ])("writes %s", (score, text) => {
    expect(pointsText(score)).toBe(text);
  });

  it("gives none without a score", () => {
    expect(pointsText(null)).toBeNull();
  });
});

describe("statement", () => {
  it("lists paid calls with their labels, unit price and total", () => {
    const result = statement([
      { source: "dataforseo", service: "/v3/backlinks/summary/live", calls: 4, cost: 0.02 },
      { source: "places", service: "text_search_enterprise", calls: 2, cost: 0.06 },
    ]);
    expect(result.lines).toEqual([
      { source: "DataForSEO", service: "Rückverweise, Übersicht", calls: 4, unit: 0.005, total: 0.02 },
      { source: "Google Places", service: "Ortssuche, Firmendaten", calls: 2, unit: 0.03, total: 0.06 },
    ]);
    expect(result.total).toBeCloseTo(0.08, 10);
  });

  it("counts the subscription separately and keeps it out of the cost", () => {
    const result = statement([
      { source: "claude", service: "analysis", calls: 3, cost: 0 },
      { source: "claude", service: "assistants", calls: 2, cost: 0 },
    ]);
    expect(result).toEqual({ lines: [], total: 0, subscriptionCalls: 5 });
  });

  it("has no unit price for a line without calls and keeps unknown names", () => {
    const result = statement([{ source: "neu", service: "dienst", calls: 0, cost: 0 }]);
    expect(result.lines).toEqual([{ source: "neu", service: "dienst", calls: 0, unit: null, total: 0 }]);
  });
});

describe("unitPrice", () => {
  it.each([
    [0.005, "0,005 €"],
    [0.03, "0,03 €"],
    [2, "2,00 €"],
  ])("writes %s as %s", (amount, text) => {
    expect(unitPrice(amount).replace(/\s/g, " ")).toBe(text);
  });
});

describe("estimateVerdict", () => {
  it.each([
    ["covered", "Limits reichen", "good"],
    ["insufficient", "Limit reicht nicht", "bad"],
    ["unchecked", "Limits nicht geprüft", ""],
  ] as const)("names %s", (status, label, tone) => {
    expect(estimateVerdict(status)).toEqual({ label, tone });
  });

  it("gives none without a status", () => {
    expect(estimateVerdict(null)).toBeNull();
  });
});

describe("keywordSummary", () => {
  it("says so without keywords", () => {
    expect(keywordSummary([])).toBe("Keine Suchbegriffe hinterlegt");
  });

  it("counts local and nationwide ones", () => {
    const keywords = [
      { customer_id: "c1", scope: "local" as const },
      { customer_id: "c1", scope: "local" as const },
      { customer_id: "c1", scope: "nationwide" as const },
    ];
    expect(keywordSummary(keywords)).toBe("2 vor Ort · 1 bundesweit");
  });
});

describe("customerGroups", () => {
  it("groups the audits by customer, newest customer and newest audit first", () => {
    const groups = customerGroups(snapshot({
      customers: [{ id: "c1", name: "Bäckerei Korn" }, { id: "c2", name: "Zahnarzt Nord" }],
      audits: [
        audit({ id: "a1", customer_id: "c1", requested_at: "2026-11-10T10:00:00Z" }),
        audit({ id: "a2", customer_id: "c2", requested_at: "2026-11-12T10:00:00Z" }),
        audit({ id: "a3", customer_id: "c1", requested_at: "2026-11-11T10:00:00Z" }),
      ],
    }));
    expect(groups.map((group) => group.name)).toEqual(["Zahnarzt Nord", "Bäckerei Korn"]);
    expect(groups[1]?.audits.map((row) => row.audit.id)).toEqual(["a3", "a1"]);
  });

  it("names a customer it does not know", () => {
    const groups = customerGroups(snapshot({ customers: [], audits: [audit()] }));
    expect(groups[0]?.name).toBe("Unbekannter Kunde");
  });

  it("builds the row of an audit from its own events and costs only", () => {
    const rows = customerGroups(snapshot({
      audits: [audit({ id: "a1", total_score: 62.5, purpose: "monthly", estimate_status: "covered" }), audit({ id: "a2" })],
      events: [
        event({ audit_id: "a1", result: "ausgesetzt", reason: "Drei Prüfungen fehlen" }),
        event({ id: "e2", audit_id: "a1", kind: "route", result: "fehlgeschlagen", label: "Bing" }),
        event({ id: "e3", audit_id: "a1", kind: "route", result: "gemessen", label: "Website" }),
        event({ id: "e4", audit_id: "a2", kind: "route", result: "fehlgeschlagen", label: "Maps" }),
      ],
      costs: [{ audit_id: "a1", source: "places", service: "text_search_enterprise", calls: 1, cost: 0.03, tokens_in: 0, tokens_out: 0 }],
      estimates: [{ audit_id: "a1", source: "places", service: "text_search_enterprise", calls: 2, unit_cost: 0.03, cost: 0.06 }],
    }));
    const row = rows[0]?.audits.find((entry) => entry.audit.id === "a1");
    expect(row).toMatchObject({
      phase: "done", status: "Bericht fertig", points: "62,5 von 100 Punkten", failedRoutes: 1, monthly: true,
      link: auditLink("a1"), verdict: { label: "Unvollständig" }, estimate: { label: "Limits reichen" },
    });
    expect(row?.actual.total).toBe(0.03);
    expect(row?.planned.total).toBe(0.06);
    expect(rows[0]?.audits.find((entry) => entry.audit.id === "a2")?.failedRoutes).toBe(1);
  });

  it("lists restarts, takeovers and warnings of the audit agent in time order", () => {
    const rows = customerGroups(snapshot({
      audits: [audit({ id: "a1", customer_id: "c1", status: "collecting" })],
      events: [
        event({ id: "e1", audit_id: "a1", kind: "repair", result: "Warnung", label: "Audit-Agent: Teil scheitert weiter", reason: "Bing-Suche scheitert nach 5 Versuchen weiter", occurred_at: "2026-11-13T10:05:00Z" }),
        event({ id: "e2", audit_id: "a1", kind: "repair", result: "neu gestartet", label: "Audit-Agent übernimmt", reason: "Bing-Suche, Versuch 5: Sicherheitsabfrage", occurred_at: "2026-11-13T10:00:00Z" }),
        event({ id: "e3", audit_id: "a1", kind: "repair", result: "gemessen", label: "Audit-Agent: Teil erledigt", reason: null, occurred_at: "2026-11-13T10:10:00Z" }),
        event({ id: "e4", audit_id: "a1", kind: "route", result: "fehlgeschlagen", label: "Bing", occurred_at: "2026-11-13T09:00:00Z" }),
      ],
    }));
    expect(rows[0]?.audits[0]?.repairs).toEqual([
      { tone: "gold", text: "Audit-Agent übernimmt: Bing-Suche, Versuch 5: Sicherheitsabfrage" },
      { tone: "bad", text: "Audit-Agent: Teil scheitert weiter: Bing-Suche scheitert nach 5 Versuchen weiter" },
      { tone: "good", text: "Audit-Agent: Teil erledigt" },
    ]);
  });
});

describe("monthStart", () => {
  it.each([
    ["2026-11-13T12:00:00Z", "2026-11-01"],
    ["2026-10-31T22:59:59Z", "2026-10-01"],
    ["2026-10-31T23:00:00Z", "2026-11-01"],
  ])("puts %s in the month starting %s", (moment, day) => {
    expect(monthStart(new Date(moment))).toBe(day);
  });
});

describe("monthSources", () => {
  const usage: RadarUsage[] = [
    { day: "2026-10-31", source: "dataforseo", count: 99, cost: 40 },
    { day: "2026-11-01", source: "dataforseo", count: 10, cost: 5 },
    { day: "2026-11-12", source: "dataforseo", count: 5, cost: 7.5 },
    { day: "2026-11-12", source: "google_search", count: 30, cost: 0 },
  ];

  it("adds up the month from its first day on and relates the cost to the default limit", () => {
    const entry = monthSources(usage, null, "2026-11-01").find((source) => source.source === "dataforseo");
    expect(entry).toEqual({ source: "dataforseo", label: "DataForSEO", requests: 15, cost: 12.5, limit: 50, share: 0.25 });
  });

  it("takes the limit from the settings", () => {
    const sources = { dataforseo: { enabled: true, monthly_cost_cap_eur: 25 } };
    expect(monthSources(usage, sources, "2026-11-01").find((source) => source.source === "dataforseo")?.share).toBe(0.5);
  });

  it("falls back to the default for an invalid limit", () => {
    const sources = { dataforseo: { monthly_cost_cap_eur: -1 } };
    expect(monthSources(usage, sources, "2026-11-01").find((source) => source.source === "dataforseo")?.limit).toBe(50);
  });

  it("lists every paid source, also unused ones, and then the others that were used", () => {
    expect(monthSources(usage, null, "2026-11-01").map((source) => source.source))
      .toEqual(["places", "prospect_search", "dataforseo", "apify", "google_search"]);
    expect(monthSources([], null, "2026-11-01").find((source) => source.source === "places"))
      .toEqual({ source: "places", label: "Google Places", requests: 0, cost: 0, limit: 25, share: 0 });
  });

  it("has no share for a source without a limit or with a limit of zero", () => {
    const sources = { apify: { monthly_cost_cap_eur: 0 } };
    const result = monthSources(usage, sources, "2026-11-01");
    expect(result.find((source) => source.source === "google_search")?.share).toBeNull();
    expect(result.find((source) => source.source === "apify")?.share).toBeNull();
  });
});

describe("radarOverview", () => {
  it("counts running and halted audits, adds the month's cost and names the latest verdict", () => {
    const overview = radarOverview(snapshot({
      heartbeat: { at: secondsAgo(10) },
      audits: [
        audit({ id: "a1", status: "collecting", requested_at: "2026-11-13T11:00:00Z" }),
        audit({ id: "a2", status: "halted", requested_at: "2026-11-13T09:00:00Z" }),
        audit({ id: "a3", status: "reported", total_score: 80, requested_at: "2026-11-12T09:00:00Z" }),
        audit({ id: "a4", status: "reported", total_score: 50, requested_at: "2026-11-11T09:00:00Z" }),
      ],
      events: [
        event({ id: "e1", audit_id: "a3", result: "gemessen" }),
        event({ id: "e2", audit_id: "a4", result: "fehlgeschlagen" }),
      ],
      usage: [
        { day: "2026-11-02", source: "places", count: 3, cost: 1.5 },
        { day: "2026-10-30", source: "places", count: 3, cost: 9 },
      ],
    }), NOW);
    expect(overview.collector.online).toBe(true);
    expect(overview.running).toBe(1);
    expect(overview.halted).toBe(1);
    expect(overview.monthCost).toBe(1.5);
    expect(overview.latest).toEqual({
      customer: "Bäckerei Korn", verdict: { label: "Fertig", tone: "good", reason: null },
      points: "80 von 100 Punkten", link: auditLink("a3"),
    });
  });

  it("has no latest verdict while no audit has one", () => {
    expect(radarOverview(snapshot({ audits: [audit({ status: "collecting" })] }), NOW).latest).toBeNull();
  });
});

describe("auditLink", () => {
  it("points to the evaluation in the RadarAuditor app", () => {
    expect(auditLink("abc")).toBe("https://app.radarauditor.speedofthespirit.dev/auswertung/abc");
  });
});

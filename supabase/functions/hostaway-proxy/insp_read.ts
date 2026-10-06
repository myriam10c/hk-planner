// Lectures du module Inspections : liste du jour, tableau du parc, historique.
import { plusDays, V3_PHOTO_BUCKET } from "./v3.ts";
import {
  daysBetween, dubaiDay, eligibilityFor, fleetColor, INSP_DEFAULT_TARGET, INSP_GOAL_DAYS, INSP_ZONES, listingLabel, rankToday,
} from "./insp_rules.ts";
import type { InspCard, InspReservation } from "./insp_rules.ts";

export type OverviewRow = {
  listingId: string; name: string; excluded: boolean; lastAt: string | null; lastInspector: string | null;
  daysSince: number | null; color: string; openIssues: number; missed: number;
};
const CLOSED = new Set(["resolved", "cancelled"]);
export type TodayCard = InspCard & { claimedBy: number | null; claimedByName: string | null; inProgressBy: string | null;
  inProgressById: number | null; doneToday: { by: string; at: string } | null };

async function cleanerNames(sb: any): Promise<Record<string, string>> {
  const { data } = await sb.from("cleaners").select("id, name");
  const m: Record<string, string> = {};
  for (const c of data ?? []) m[String(c.id)] = c.name;
  return m;
}

const PAGE = 1000; // PostgREST max_rows : sans pagination, la lecture est tronquee en silence.
async function finishedInspections(sb: any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0;; from += PAGE) {
    const { data } = await sb.from("inspections").select("id, listing_id, inspector_id, finished_at")
      .not("finished_at", "is", null).order("finished_at", { ascending: false }).order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out.filter((r: any) => r.finished_at);
}

export async function loadLastDone(sb: any, names?: Record<string, string>, finished?: any[]) {
  const n = names ?? await cleanerNames(sb);
  const out: Record<string, { finishedAt: string; inspector: string; id: number }> = {};
  for (const r of finished ?? await finishedInspections(sb)) {
    const prev = out[r.listing_id];
    if (!prev || r.finished_at > prev.finishedAt) {
      out[r.listing_id] = { finishedAt: r.finished_at, inspector: n[String(r.inspector_id)] ?? "Someone", id: r.id };
    }
  }
  return out;
}

async function openIssuesByListing(sb: any, lastDone: Record<string, { id: number }>): Promise<Record<string, number>> {
  const lastIds = Object.values(lastDone).map((d) => d.id);
  if (!lastIds.length) return {};
  const { data: items } = await sb.from("inspection_items").select("inspection_id, ticket_id, status, outcome").in("inspection_id", lastIds);
  const withTicket = (items ?? []).filter((i: any) => i.ticket_id && i.status === "not_ok" && i.outcome === "maintenance");
  if (!withTicket.length) return {};
  const { data: tickets } = await sb.from("maintenance_tickets").select("id, status").in("id", withTicket.map((i: any) => i.ticket_id));
  const open = new Set((tickets ?? []).filter((t: any) => !CLOSED.has(String(t.status))).map((t: any) => String(t.id)));
  const byInsp: Record<string, string> = {};
  for (const [lid, d] of Object.entries(lastDone)) byInsp[String(d.id)] = lid;
  const out: Record<string, number> = {};
  for (const i of withTicket) {
    if (!open.has(String(i.ticket_id))) continue;
    const lid = byInsp[String(i.inspection_id)];
    out[lid] = (out[lid] ?? 0) + 1;
  }
  return out;
}

export async function loadOpenIssueListings(sb: any): Promise<Set<string>> {
  return new Set(Object.keys(await openIssuesByListing(sb, await loadLastDone(sb))));
}

// Propositions ratees : rang >= 1, strictement apres le jour Dubai de la derniere inspection terminee, avant `day`.
async function missedCounts(sb: any, day: string, lastDone: Record<string, { finishedAt: string }>) {
  const { data } = await sb.from("inspection_proposals").select("proposal_date, listing_id, rank")
    .lt("proposal_date", day).gte("proposal_date", plusDays(day, -120));
  const out: Record<string, number> = {};
  for (const p of data ?? []) {
    if (!(Number(p.rank) >= 1)) continue;
    const last = lastDone[p.listing_id];
    if (last && String(p.proposal_date) <= dubaiDay(last.finishedAt)) continue;
    out[p.listing_id] = (out[p.listing_id] ?? 0) + 1;
  }
  return out;
}

async function readTarget(sb: any): Promise<number> {
  const { data } = await sb.from("app_config").select("value").eq("key", "inspections_daily_target").maybeSingle();
  const n = Number(data?.value);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : INSP_DEFAULT_TARGET;
}

export async function inspToday(
  sb: any, day: string, reservations: InspReservation[], cachedAt: string | null,
): Promise<{ day: string; target: number; cachedAt: string | null; today: TodayCard[]; also: TodayCard[] }> {
  const loggedRows = async () => {
    const { data } = await sb.from("inspection_proposals").select("listing_id, claimed_by, rank").eq("proposal_date", day);
    return data ?? [];
  };
  // Lectures independantes en parallele ; seuls issues et missed dependent des inspections terminees.
  const [names, finished, target, { data: listings }, props0, { data: running }] = await Promise.all([
    cleanerNames(sb), finishedInspections(sb), readTarget(sb),
    sb.from("listing_config").select("listing_id, internal_name, listing_name, inspection_excluded"),
    loggedRows(),
    sb.from("inspections").select("listing_id, inspector_id").eq("inspection_date", day).is("finished_at", null),
  ]);
  const lastDone = await loadLastDone(sb, names, finished);
  const [issues, missed] = await Promise.all([openIssuesByListing(sb, lastDone), missedCounts(sb, day, lastDone)]);
  const ranked = rankToday({
    day, target, listings: listings ?? [], reservations, lastDone,
    openIssueListings: new Set(Object.keys(issues)), missed,
  });
  // Les propositions sont journalisees UNE fois par jour Dubai : la liste du jour reste stable.
  let props = props0;
  if (!props.some((p: any) => Number(p.rank) >= 1) && ranked.today.length) {
    await sb.from("inspection_proposals").upsert(
      ranked.today.map((c, i) => ({ proposal_date: day, listing_id: c.listingId, rank: i + 1 })),
      { onConflict: "proposal_date,listing_id", ignoreDuplicates: true },
    );
    props = await loggedRows();
  }
  const claimed: Record<string, number | null> = {};
  for (const p of props) claimed[p.listing_id] = p.claimed_by ?? null;
  const logged = props.filter((p: any) => Number(p.rank) >= 1).sort((a: any, b: any) => Number(a.rank) - Number(b.rank));
  const loggedIds = new Set<string>(logged.map((p: any) => String(p.listing_id)));
  const runningBy: Record<string, string> = {};
  const runningById: Record<string, number> = {};
  for (const r of running ?? []) {
    runningBy[r.listing_id] = names[String(r.inspector_id)] ?? "Someone";
    runningById[r.listing_id] = Number(r.inspector_id);
  }
  const doneToday: Record<string, { by: string; at: string }> = {};
  for (const r of finished) { // trie du plus recent au plus ancien : on garde le premier du jour
    if (dubaiDay(r.finished_at) !== day || doneToday[r.listing_id]) continue;
    doneToday[r.listing_id] = { by: names[String(r.inspector_id)] ?? "Someone", at: r.finished_at };
  }
  const decorate = (c: InspCard): TodayCard => {
    const by = claimed[c.listingId] ?? null;
    return {
      ...c, claimedBy: by, claimedByName: by ? names[String(by)] ?? null : null,
      inProgressBy: runningBy[c.listingId] ?? null, inProgressById: runningById[c.listingId] ?? null,
      doneToday: doneToday[c.listingId] ?? null,
    };
  };
  const rankedById: Record<string, InspCard> = {};
  for (const c of ranked.today.concat(ranked.also)) rankedById[c.listingId] = c;
  const lById: Record<string, any> = {};
  for (const l of listings ?? []) lById[String(l.listing_id)] = l;
  const cardFor = (id: string): InspCard => {
    if (rankedById[id]) return rankedById[id];
    const last = lastDone[id];
    // Carte journalisee devenue occupee : "unavailable" (sauf si deja faite aujourd'hui).
    return {
      listingId: id, name: listingLabel(lById[id] ?? {}),
      eligibility: eligibilityFor(id, reservations, day) ?? (doneToday[id] ? { kind: "vacant", nextArrival: null } : { kind: "unavailable" }),
      daysSince: last ? daysBetween(last.finishedAt, day) : null, lastInspector: last ? last.inspector : null,
      missed: missed[id] ?? 0, openIssue: id in issues,
    };
  };
  return {
    day, target, cachedAt,
    today: logged.map((p: any) => decorate(cardFor(String(p.listing_id)))),
    also: ranked.today.concat(ranked.also).filter((c) => !loggedIds.has(c.listingId)).map(decorate),
  };
}

export async function inspOverview(sb: any, day: string) {
  const [names, { data: listings }, finished] = await Promise.all([
    cleanerNames(sb),
    sb.from("listing_config").select("listing_id, internal_name, listing_name, inspection_excluded"),
    finishedInspections(sb),
  ]);
  const lastDone = await loadLastDone(sb, names, finished);
  const [issues, missed] = await Promise.all([openIssuesByListing(sb, lastDone), missedCounts(sb, day, lastDone)]);
  const rows: OverviewRow[] = (listings ?? []).map((l: any): OverviewRow => {
    const last = lastDone[l.listing_id];
    const daysSince = last ? daysBetween(last.finishedAt, day) : null;
    return {
      listingId: l.listing_id, name: listingLabel(l), excluded: !!l.inspection_excluded,
      lastAt: last?.finishedAt ?? null, lastInspector: last?.inspector ?? null, daysSince,
      color: fleetColor(daysSince), openIssues: issues[l.listing_id] ?? 0, missed: missed[l.listing_id] ?? 0,
    };
  });
  const k = (r: OverviewRow) => (r.daysSince === null ? Number.MAX_SAFE_INTEGER : r.daysSince);
  rows.sort((a, b) => Number(a.excluded) - Number(b.excluded) || k(b) - k(a) || a.name.localeCompare(b.name));
  const active = rows.filter((r) => !r.excluded);
  const covered = active.filter((r) => r.daysSince !== null && r.daysSince < INSP_GOAL_DAYS).length;
  const monthStart = day.slice(0, 8) + "01";
  const inspectedThisMonth = finished
    .filter((r: any) => dubaiDay(r.finished_at) >= monthStart).length;
  return {
    coveragePct: active.length ? Math.round((covered / active.length) * 100) : 0,
    inspectedThisMonth, rows,
  };
}

export async function inspHistory(sb: any, listingId: string) {
  const [names, { data: l }, { data: insps }] = await Promise.all([
    cleanerNames(sb),
    sb.from("listing_config").select("listing_id, internal_name, listing_name").eq("listing_id", listingId).maybeSingle(),
    sb.from("inspections").select("*").eq("listing_id", listingId).order("started_at", { ascending: false }).limit(20),
  ]);
  const list = (insps ?? []).slice().sort((a: any, b: any) => String(b.started_at).localeCompare(String(a.started_at))).slice(0, 20);
  const ids = list.map((i: any) => i.id);
  const [{ data: items }, { data: photos }] = await Promise.all([
    ids.length ? sb.from("inspection_items").select("*").in("inspection_id", ids) : { data: [] },
    ids.length ? sb.from("inspection_photos").select("*").in("inspection_id", ids) : { data: [] },
  ]);
  const ticketIds = (items ?? []).map((i: any) => i.ticket_id).filter(Boolean);
  const paths = (photos ?? []).map((p: any) => p.storage_path);
  const [{ data: tickets }, signedRes] = await Promise.all([
    ticketIds.length ? sb.from("maintenance_tickets").select("id, status, title").in("id", ticketIds) : { data: [] },
    paths.length ? sb.storage.from(V3_PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] },
  ]);
  const tById: Record<string, any> = {};
  for (const t of tickets ?? []) tById[String(t.id)] = t;
  const signed: Record<string, string> = {};
  for (const s of signedRes?.data ?? []) if (s.signedUrl) signed[s.path] = s.signedUrl;
  const label = (z: string) => INSP_ZONES.find((x) => x.key === z)?.label ?? z;
  return {
    listingId, name: listingLabel(l ?? {}),
    inspections: list.map((i: any) => ({
      id: i.id, inspector: names[String(i.inspector_id)] ?? "Someone", startedAt: i.started_at,
      finishedAt: i.finished_at ?? null, eligibility: i.eligibility, generalNote: i.general_note ?? null,
      items: (items ?? []).filter((it: any) => it.inspection_id === i.id && it.status === "not_ok")
        .sort((a: any, b: any) => INSP_ZONES.findIndex((z) => z.key === a.zone) - INSP_ZONES.findIndex((z) => z.key === b.zone))
        .map((it: any) => ({
          zone: it.zone, label: label(it.zone), status: it.status, note: it.note, outcome: it.outcome, fixNote: it.fix_note,
          ticket: it.ticket_id && tById[String(it.ticket_id)]
            ? { id: it.ticket_id, status: tById[String(it.ticket_id)].status, title: tById[String(it.ticket_id)].title } : null,
          photos: (photos ?? []).filter((p: any) => p.inspection_id === i.id && p.zone === it.zone)
            .map((p: any) => ({ kind: p.kind, url: signed[p.storage_path] ?? null })).filter((p: any) => p.url),
        })),
    })),
  };
}

// Recap quotidien (job serveur Telegram) : couverture, propositions du jour et ce qui a ete fait.
export async function inspRecap(sb: any, day: string) {
  const [names, finished, target, { data: listings }, { data: props }, { data: running }, { data: openT }] = await Promise.all([
    cleanerNames(sb), finishedInspections(sb), readTarget(sb),
    sb.from("listing_config").select("listing_id, internal_name, listing_name, inspection_excluded"),
    sb.from("inspection_proposals").select("listing_id, rank").eq("proposal_date", day),
    sb.from("inspections").select("listing_id, inspector_id").eq("inspection_date", day).is("finished_at", null),
    sb.from("maintenance_tickets").select("id, status").eq("source", "inspection").not("status", "in", "(resolved,cancelled)"),
  ]);
  const lastDone = await loadLastDone(sb, names, finished);
  const lById: Record<string, any> = {};
  for (const l of listings ?? []) lById[String(l.listing_id)] = l;
  const nameOf = (id: string) => listingLabel(lById[id] ?? {});

  // Meme calcul que inspOverview.
  const active = (listings ?? []).filter((l: any) => !l.inspection_excluded);
  const days = active.map((l: any) => {
    const last = lastDone[l.listing_id];
    return last ? daysBetween(last.finishedAt, day) : null;
  });
  const covered = days.filter((d: number | null) => d !== null && d < INSP_GOAL_DAYS).length;
  const monthStart = day.slice(0, 8) + "01";

  const todays = finished.filter((r: any) => dubaiDay(r.finished_at) === day)
    .sort((a: any, b: any) => String(a.finished_at).localeCompare(String(b.finished_at)) || Number(a.id) - Number(b.id));
  const doneFirst: Record<string, any> = {};
  for (const r of todays) if (!doneFirst[r.listing_id]) doneFirst[r.listing_id] = r;
  const runningByListingId: Record<string, any> = {};
  for (const r of running ?? []) if (!runningByListingId[r.listing_id]) runningByListingId[r.listing_id] = r;
  const runningIds = new Set((running ?? []).map((r: any) => String(r.listing_id)));
  const logged = (props ?? []).filter((p: any) => Number(p.rank) >= 1).sort((a: any, b: any) => Number(a.rank) - Number(b.rank));
  const loggedIds = new Set<string>(logged.map((p: any) => String(p.listing_id)));

  const proposals = logged.map((p: any) => {
    const id = String(p.listing_id);
    const d = doneFirst[id];
    const r = runningByListingId[id];
    return {
      listingId: id, name: nameOf(id), rank: Number(p.rank),
      status: (d ? "done" : runningIds.has(id) ? "in_progress" : "not_done") as "done" | "in_progress" | "not_done",
      by: d ? names[String(d.inspector_id)] ?? "Someone" : (r ? names[String(r.inspector_id)] ?? "Someone" : null), at: d ? d.finished_at as string : null,
    };
  });

  const ids = todays.map((r: any) => r.id);
  const { data: items } = ids.length
    ? await sb.from("inspection_items").select("inspection_id, zone, status, outcome, ticket_id").in("inspection_id", ids)
    : { data: [] };
  const label = (z: string) => INSP_ZONES.find((x) => x.key === z)?.label ?? z;
  const doneToday = todays.map((r: any) => ({
    listingId: String(r.listing_id), name: nameOf(String(r.listing_id)),
    by: names[String(r.inspector_id)] ?? "Someone", at: r.finished_at as string,
    adhoc: !loggedIds.has(String(r.listing_id)),
    issues: (items ?? []).filter((i: any) => i.inspection_id === r.id && i.status === "not_ok")
      .sort((a: any, b: any) => INSP_ZONES.findIndex((z) => z.key === a.zone) - INSP_ZONES.findIndex((z) => z.key === b.zone))
      .map((i: any) => ({
        label: label(i.zone),
        outcome: (i.outcome === "fixed" || i.outcome === "maintenance" ? i.outcome : null) as "fixed" | "maintenance" | null,
        ticketId: i.ticket_id ? Number(i.ticket_id) : null,
      })),
  }));

  return {
    day, target,
    coveragePct: active.length ? Math.round((covered / active.length) * 100) : 0,
    inspectedThisMonth: finished.filter((r: any) => dubaiDay(r.finished_at) >= monthStart).length,
    neverInspected: days.filter((d: number | null) => d === null).length,
    overdue: days.filter((d: number | null) => d === null || d > 30).length,
    proposals, doneToday,
    openTickets: (openT ?? []).filter((t: any) => !CLOSED.has(String(t.status))).length,
  };
}

// Plage de l'ecran Reports : jours Dubai inclusifs. null si mal formee, inversee ou > 366 jours.
export function parseReportRange(from: string | null, to: string | null, today: string): { from: string; to: string } | null {
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && plusDays(d, 0) === d;
  const t = to || today;
  const f = from || plusDays(t, -30);
  if (!valid(f) || !valid(t) || f > t || plusDays(f, 366) < t) return null;
  return { from: f, to: t };
}

const BATCH = 200;
const must = (r: { data: any; error: any }, what: string): any[] => {
  if (r.error) throw new Error(what + ": " + (r.error.message ?? "read failed"));
  return r.data ?? [];
};
// Lecture par lots d'ids, chaque lot pagine : un lot ne depasse jamais le plafond de PostgREST sans etre relu.
async function inBatches(sb: any, table: string, cols: string, col: string, ids: any[], extra?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    for (let start = 0;; start += PAGE) {
      let q = sb.from(table).select(cols).in(col, batch);
      if (extra) q = extra(q);
      // Ordre total sur la cle primaire : sans lui, Postgres peut sauter ou doubler des lignes entre deux pages.
      const page = must(await q.order("id", { ascending: true }).range(start, start + PAGE - 1), table);
      out.push(...page);
      if (page.length < PAGE) break;
    }
  }
  return out;
}

// Rapports d'inspection termines sur [from, to] (jours Dubai). finished_at est en UTC : fenetre elargie d'un jour, filtre exact en JS.
// Toute lecture en erreur leve : un echec ne doit jamais ressembler a un rapport propre.
export async function inspReports(sb: any, from: string, to: string) {
  const lo = plusDays(from, -1) + "T00:00:00Z", hi = plusDays(to, 2) + "T00:00:00Z";
  const fetchWindow = async () => {
    const out: any[] = [];
    for (let start = 0;; start += PAGE) {
      const page = must(
        await sb.from("inspections").select("id, listing_id, inspector_id, finished_at, eligibility")
          .not("finished_at", "is", null).gte("finished_at", lo).lt("finished_at", hi)
          .order("id", { ascending: false }).range(start, start + PAGE - 1),
        "inspections",
      );
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  };
  const [cleaners, listings, window] = await Promise.all([
    sb.from("cleaners").select("id, name").then((r: any) => must(r, "cleaners")),
    sb.from("listing_config").select("listing_id, internal_name, listing_name").then((r: any) => must(r, "listing_config")),
    fetchWindow(),
  ]);
  const names: Record<string, string> = {};
  for (const c of cleaners) names[String(c.id)] = c.name;
  const insps = window
    .map((r: any) => ({ r, day: r.finished_at ? dubaiDay(r.finished_at) : "" }))
    .filter((x: any) => x.day >= from && x.day <= to)
    .map((x: any) => x.r)
    .sort((a: any, b: any) => String(b.finished_at).localeCompare(String(a.finished_at)) || Number(b.id) - Number(a.id));
  const items = (await inBatches(sb, "inspection_items", "inspection_id, zone, status, outcome, ticket_id", "inspection_id",
    insps.map((r: any) => r.id), (q) => q.eq("status", "not_ok")))
    .filter((i: any) => i.status === "not_ok");
  const itemsBy = new Map<string, any[]>();
  for (const i of items) {
    const k = String(i.inspection_id);
    if (!itemsBy.has(k)) itemsBy.set(k, []);
    itemsBy.get(k)!.push(i);
  }
  const ticketIds = [...new Set(items.map((i: any) => i.ticket_id).filter(Boolean))];
  const tickets = await inBatches(sb, "maintenance_tickets", "id, status", "id", ticketIds);
  const tById: Record<string, any> = {};
  for (const t of tickets) tById[String(t.id)] = t;
  const lById: Record<string, any> = {};
  for (const l of listings) lById[String(l.listing_id)] = l;
  const zoneIdx = (z: string) => INSP_ZONES.findIndex((x) => x.key === z);

  const reports = insps.map((r: any) => {
    const issues = (itemsBy.get(String(r.id)) ?? []).slice()
      .sort((a: any, b: any) => zoneIdx(a.zone) - zoneIdx(b.zone))
      .map((i: any) => ({
        zone: i.zone as string, label: INSP_ZONES.find((x) => x.key === i.zone)?.label ?? i.zone as string,
        outcome: (i.outcome === "fixed" || i.outcome === "maintenance" ? i.outcome : null) as "fixed" | "maintenance" | null,
        ticket: i.ticket_id && tById[String(i.ticket_id)] ? { id: i.ticket_id, status: tById[String(i.ticket_id)].status } : null,
      }));
    const result = (!issues.length ? "clean" : issues.some((i: any) => i.outcome === "maintenance") ? "maintenance" : "fixed") as
      "clean" | "fixed" | "maintenance";
    return {
      id: r.id, listingId: String(r.listing_id), name: listingLabel(lById[String(r.listing_id)] ?? {}),
      inspector: names[String(r.inspector_id)] ?? "Someone", finishedAt: r.finished_at as string,
      eligibility: r.eligibility ?? null, result, issues,
    };
  });

  const lastByListing: Record<string, string> = {}; // reports est trie : la premiere rencontre est la derniere inspection
  for (const r of reports) if (!(r.listingId in lastByListing)) lastByListing[r.listingId] = r.result;
  const apartments = Object.keys(lastByListing);
  const zones = reports.flatMap((r) => r.issues);
  const openIds = new Set<string>();
  for (const z of zones) if (z.ticket && !CLOSED.has(String(z.ticket.status))) openIds.add(String(z.ticket.id));
  return {
    from, to,
    totals: {
      inspections: reports.length, apartments: apartments.length,
      clean: apartments.filter((a) => lastByListing[a] === "clean").length,
      withIssues: apartments.filter((a) => lastByListing[a] !== "clean").length,
      fixedOnSpot: zones.filter((z) => z.outcome === "fixed").length,
      sentToMaintenance: zones.filter((z) => z.outcome === "maintenance").length,
      openTickets: openIds.size,
    },
    reports,
  };
}

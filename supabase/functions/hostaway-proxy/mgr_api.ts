// Action mgr.today : un seul appel qui rend les 4 blocs de Today deja calcules
// (spec 2026-10-09-hk-manager-app-design.md, section 6).
import type { SessionUser } from "./auth.ts";
import { byRoleThenName, parseRiskHours, type MgrReservation } from "./mgr_rules.ts";
import {
  buildArrivals, buildJobs, buildTicketsByListing, buildWho, loadCore,
  type MgrArrivals, type MgrTicketLite, type MgrWho,
} from "./mgr_today.ts";
import { loadProblems, type MgrProblems } from "./mgr_problems.ts";
import { loadControl, type MgrControl } from "./mgr_control.ts";
import { loadTodayMaintenance, type MgrTodayMaintenance } from "./mgr_today_mnt.ts";

export type MgrToday = {
  day: string; generatedAt: string; bookingsCachedAt: string | null; riskHours: number;
  me: { id: number; name: string };
  strip: { cleanings: number; unassigned: number; arrivals: number; notReady: number };
  // problems : taches d'equipe seulement ; maintenance : null si la lecture a echoue.
  who: MgrWho; problems: MgrProblems; maintenance: MgrTodayMaintenance | null; control: MgrControl; arrivals: MgrArrivals;
  assignable: Array<{ id: number; name: string; role: string }>;
  ticketsByListing: Record<string, MgrTicketLite[]>;
};

export async function mgrToday(sb: any, o: {
  day: string; nowMs: number; me: SessionUser;
  loadReservations: (day: string) => Promise<{ reservations: MgrReservation[]; cachedAt: string | null }>;
}): Promise<{ status: number; body: MgrToday | { error: string } }> {
  let loaded: { reservations: MgrReservation[]; cachedAt: string | null };
  try {
    loaded = await o.loadReservations(o.day);
  } catch (e) {
    return { status: 503, body: { error: (e as Error).message } };
  }
  const cfg = await sb.from("app_config").select("value").eq("key", "mgr_risk_hours").maybeSingle();
  const riskHours = parseRiskHours(cfg?.data?.value);
  const core = await loadCore(sb, { day: o.day, nowMs: o.nowMs, riskHours, reservations: loaded.reservations });
  const jobs = buildJobs(core);
  const who = buildWho(core, jobs);
  const arrivals = buildArrivals(core);
  const [problems, control, maintenance] = await Promise.all([
    loadProblems(sb, core, jobs, arrivals.rows), loadControl(sb, core),
    loadTodayMaintenance(sb, { nowMs: o.nowMs, listings: core.listings, people: core.people }),
  ]);
  const assignable = Object.values(core.people)
    .filter((p) => p.active && (p.role === "cleaner" || p.role === "subcontractor"))
    .sort(byRoleThenName)
    .map((p) => ({ id: p.id, name: p.name, role: p.role }));
  return {
    status: 200,
    body: {
      day: o.day, generatedAt: new Date(o.nowMs).toISOString(), bookingsCachedAt: loaded.cachedAt, riskHours,
      me: { id: o.me.cleaner_id, name: o.me.name },
      strip: {
        cleanings: jobs.length,
        unassigned: jobs.filter((j) => !j.assigned.length && j.state !== "done").length,
        arrivals: arrivals.rows.length,
        notReady: arrivals.rows.filter((a) => a.tone !== "ok").length,
      },
      who, problems, maintenance, control, arrivals, assignable,
      ticketsByListing: buildTicketsByListing(core),
    },
  };
}

// KPIs du dashboard (corps de l'ancienne action getDashboardKPIs d'index.ts), extrait pour
// etre partage avec mgr.people et teste sans Hostaway. Le jour metier est injecte (today,
// jour Dubai) : plus de date UTC de la machine pour les 7 derniers jours.
import { plusDays } from "./v3.ts";
import { dubaiDay } from "./insp_rules.ts";

// Performance par cleaner a partir de lignes deja lues (partage avec mgr.people).
export function cleanerPerformance(clnrs: any[], timers: any[], assigns: any[], dones: any[]): any[] {
  // Per-cleaner performance, multi-assign aware: count any cleaning where the cleaner is in the list.
  const assignMap: Record<string, number[]> = {};
  assigns.forEach((a: any) => {
    if (!assignMap[a.reservation_key]) assignMap[a.reservation_key] = [];
    assignMap[a.reservation_key].push(a.cleaner_id);
  });
  const isAssigned = (key: string, cid: number) => (assignMap[key] || []).includes(cid);
  const cleanerPerf: any[] = clnrs.filter((c: any) => c.role === 'cleaner').map((c: any) => {
    const cTimers = timers.filter((t: any) => isAssigned(t.reservation_key, c.id));
    const cDurations = cTimers.map((t: any) => t.duration_minutes).filter((d: number) => d > 0 && d < 480);
    const cDone = dones.filter((d: any) => d.done && isAssigned(d.reservation_key, c.id));
    const avgTime = cDurations.length > 0 ? Math.round(cDurations.reduce((a: number, b: number) => a + b, 0) / cDurations.length) : 0;
    const fastest = cDurations.length > 0 ? Math.min(...cDurations) : 0;
    const slowest = cDurations.length > 0 ? Math.max(...cDurations) : 0;
    return { id: c.id, name: c.name, color: c.color, totalCleanings: cDone.length, avgTime, fastest, slowest, timerCount: cDurations.length };
  });
  return cleanerPerf;
}

export async function dashboardKpis(sb: any, month: string | null, today: string): Promise<any> {
  // Tri par récence + limit : PostgREST clampe de toute façon à max-rows (1000 par
  // défaut), donc sans ORDER BY la troncature jetterait des lignes arbitraires et
  // fausserait les KPIs fenêtrés (7 jours / mois courant). Trié desc, le cap ne
  // coupe que du vieux.
  const [timerRes, assignRes, doneRes, cleanerRes, ticketRes] = await Promise.all([
    sb.from("cleaning_timer").select("reservation_key, cleaner_id, started_at, finished_at, duration_minutes").not("duration_minutes", "is", null).order("started_at", { ascending: false }).limit(5000),
    sb.from("cleaning_assignments").select("reservation_key, cleaner_id").order("assigned_at", { ascending: false }).limit(5000),
    sb.from("menage_done").select("reservation_key, done, updated_at").order("updated_at", { ascending: false }).limit(5000),
    sb.from("cleaners").select("id, name, color, role").eq("is_active", true).limit(200),
    sb.from("maintenance_tickets").select("id, status, priority, category, created_at, resolved_at").order("created_at", { ascending: false }).limit(5000),
  ]);
  const timers = timerRes.data || [];
  const assigns = assignRes.data || [];
  const dones = doneRes.data || [];
  const clnrs = cleanerRes.data || [];
  const tickets = ticketRes.data || [];

  // Global avg cleaning time
  const durations = timers.map((t: any) => t.duration_minutes).filter((d: number) => d > 0 && d < 480);
  const avgCleaningTime = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;

  const cleanerPerf = cleanerPerformance(clnrs, timers, assigns, dones);

  // Maintenance summary
  const openTickets = tickets.filter((t: any) => ['open','assigned','in_progress','waiting_parts'].includes(t.status));
  const resolvedThisMonth = month ? tickets.filter((t: any) => t.status === 'resolved' && t.resolved_at && t.resolved_at.startsWith(month)) : [];
  const avgResolutionTime = (() => {
    const resolved = tickets.filter((t: any) => t.resolved_at && t.created_at);
    if (resolved.length === 0) return 0;
    const total = resolved.reduce((sum: number, t: any) => {
      return sum + (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600000;
    }, 0);
    return Math.round(total / resolved.length);
  })();

  // Completion rate trends (last 7 days)
  const last7: any[] = [];
  for (let i = 6; i >= 0; i--) {
    // Jour metier Dubai (argument today), plus la date UTC de la machine.
    const ds = plusDays(today, -i);
    // updated_at est en UTC : on le convertit en jour Dubai (01:00 Dubai = la veille en UTC).
    const dayDones = dones.filter((r: any) => r.done && r.updated_at && !isNaN(Date.parse(r.updated_at)) && dubaiDay(r.updated_at) === ds);
    last7.push({ date: ds, completions: dayDones.length });
  }

  return {
    avgCleaningTime,
    totalTimerSessions: durations.length,
    cleanerPerformance: cleanerPerf,
    openMaintenanceTickets: openTickets.length,
    resolvedThisMonth: resolvedThisMonth.length,
    avgResolutionHours: avgResolutionTime,
    last7DaysCompletions: last7,
  };
}

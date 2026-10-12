// Bloc Maintenance de Today (phase 2) : compteurs et 5 tickets ouverts, avec les
// regles et les lignes de mnt.list (mnt_read.ts). Une erreur de lecture ne fait
// jamais echouer mgr.today : le bloc vaut null et l'erreur est journalisee.
import {
  mntCtx, mntOpenCounts, mntOpenOrder, mntPage, mntTicketRow, readOpenTickets, readPendingProposals,
  type MntTicketRow,
} from "./mnt_read.ts";
import type { MgrPerson } from "./mgr_today.ts";
import { todayDubai } from "./v3.ts";

export const MGR_TODAY_MNT_TOP = 5;

export type MgrTodayMaintenance = {
  counts: { proposals: number; proposalsUrgent: number; open: number; urgent: number; unassigned: number };
  top: MntTicketRow[];
};

// listings et people viennent du coeur de Today (deja lus) : seuls les tickets,
// les propositions et les prestataires sont relus ici.
export async function loadTodayMaintenance(sb: any, o: {
  nowMs: number; listings: Record<string, { apt: string; bld: string }>; people: Record<string, MgrPerson>;
}): Promise<MgrTodayMaintenance | null> {
  try {
    const [open, pending, vendorRows] = await Promise.all([
      readOpenTickets(sb),
      readPendingProposals(sb),
      mntPage(sb, "vendors", "id, name, is_active", (x) => x),
    ]);
    const ctx = mntCtx([], Object.values(o.people), vendorRows, { today: todayDubai(o.nowMs), listings: o.listings });
    const c = mntOpenCounts(open);
    return {
      counts: {
        proposals: pending.length, proposalsUrgent: pending.filter((p: any) => p.urgency === "urgent").length,
        open: c.open, urgent: c.urgent, unassigned: c.unassigned,
      },
      top: open.slice().sort(mntOpenOrder).slice(0, MGR_TODAY_MNT_TOP).map((t: any) => mntTicketRow(t, ctx, false)),
    };
  } catch (e) {
    console.error("[mgr_today_mnt] maintenance block failed:", (e as Error)?.message ?? String(e));
    return null;
  }
}

// Data access layer — all Supabase queries the app needs.
// Each function takes the orgId so we don't rely on globals.

import { requireSupabase } from './supabase';
import type {
  Property, Turnover, Ticket, WaMessage, Building, Profile,
  TicketStage, TicketStatus,
} from './database.types';

const sb = () => requireSupabase();

// ─── Properties + buildings ───────────────────────────────────────
export async function listProperties(orgId: string): Promise<Property[]> {
  const { data, error } = await sb().from('properties').select('*').eq('org_id', orgId);
  if (error) throw error;
  return data ?? [];
}

export async function listBuildings(orgId: string): Promise<Building[]> {
  const { data, error } = await sb().from('buildings').select('*').eq('org_id', orgId);
  if (error) throw error;
  return data ?? [];
}

// ─── Staff (org members) ──────────────────────────────────────────
export async function listOrgMembers(orgId: string) {
  const { data, error } = await sb()
    .from('memberships')
    .select('role, user_id, profiles(*)')
    .eq('org_id', orgId);
  if (error) throw error;
  return (data ?? []).map((m: any) => ({ ...(m.profiles as Profile), role: m.role as string }));
}

// ─── Turnovers ────────────────────────────────────────────────────
export async function listTurnoversForDay(orgId: string, dayIso: string): Promise<Turnover[]> {
  const start = `${dayIso}T00:00:00.000Z`;
  const end   = `${dayIso}T23:59:59.999Z`;
  const { data, error } = await sb()
    .from('turnovers')
    .select('*')
    .eq('org_id', orgId)
    .gte('checkout_at', start)
    .lte('checkout_at', end)
    .order('checkout_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function setTurnoverStatus(id: string, status: Turnover['status']) {
  const { error } = await sb().from('turnovers').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function assignTurnoverCleaner(id: string, cleanerId: string | null) {
  const { error } = await sb().from('turnovers').update({ cleaner_id: cleanerId }).eq('id', id);
  if (error) throw error;
}

// ─── Tickets ──────────────────────────────────────────────────────
export async function listTickets(orgId: string, opts?: { open?: boolean }): Promise<Ticket[]> {
  let q = sb().from('tickets').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (opts?.open) q = q.neq('status', 'closed');
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const { data, error } = await sb().from('tickets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createTicket(input: Partial<Ticket> & { org_id: string; property_id: string; title: string; type: string }): Promise<Ticket> {
  const { data, error } = await sb().from('tickets').insert(input as any).select().single();
  if (error) throw error;
  return data!;
}

export async function updateTicket(id: string, patch: Partial<Ticket>) {
  const { data, error } = await sb().from('tickets').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data!;
}

const STAGES: TicketStage[] = ['open', 'accepted', 'en-route', 'on-site', 'fixed', 'closed'];

export async function advanceTicket(id: string) {
  const cur = await getTicket(id);
  if (!cur) throw new Error('Ticket not found');
  const idx = STAGES.indexOf(cur.stage);
  const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  const status: TicketStatus = next === 'closed' ? 'closed' : next === 'fixed' ? 'waiting' : 'in-progress';
  return updateTicket(id, { stage: next, status });
}

export async function captureTicketPhoto(id: string, phase: 'before' | 'during' | 'after', url: string) {
  const cur = await getTicket(id);
  if (!cur) throw new Error('Ticket not found');
  const photos = { ...(cur.photos || {}), [phase]: url };
  return updateTicket(id, { photos });
}

// ─── WhatsApp messages ────────────────────────────────────────────
export async function listMessages(orgId: string): Promise<WaMessage[]> {
  const { data, error } = await sb()
    .from('wa_messages').select('*').eq('org_id', orgId)
    .order('received_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function rejectMessage(id: string) {
  const { error } = await sb().from('wa_messages').update({ status: 'rejected' }).eq('id', id);
  if (error) throw error;
}

export async function ticketFromMessage(orgId: string, msg: WaMessage, overrides?: Partial<Ticket>) {
  const ticket = await createTicket({
    org_id: orgId,
    property_id: msg.parsed_property_id ?? overrides?.property_id ?? '',
    title: overrides?.title ?? msg.body.slice(0, 80),
    type: msg.parsed_type ?? 'general',
    priority: (msg.parsed_priority as Ticket['priority']) ?? 'med',
    source_message_id: msg.id,
    blocks_turnover: ['urgent', 'high'].includes(msg.parsed_priority ?? ''),
    ...overrides,
  });
  await sb().from('wa_messages').update({ status: 'ticketed', ticket_id: ticket.id }).eq('id', msg.id);
  return ticket;
}

// ─── Checklist (per turnover instance) ────────────────────────────
export async function listTurnoverChecklist(turnoverId: string) {
  const { data, error } = await sb()
    .from('turnover_checklist_items').select('*').eq('turnover_id', turnoverId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function toggleChecklistItem(itemId: string, done: boolean, userId?: string) {
  const { error } = await sb()
    .from('turnover_checklist_items')
    .update({
      done,
      done_at: done ? new Date().toISOString() : null,
      done_by: done ? userId ?? null : null,
    })
    .eq('id', itemId);
  if (error) throw error;
}

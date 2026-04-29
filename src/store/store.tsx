import React from 'react';
import type { Route, Turnover, Ticket, WaMessage, ChecklistGroup, Tweaks } from '../types';
import { TURNOVERS, WA_MSGS, TICKETS_INIT, buildChecklist, staffById, STAFF } from './data';

interface StoreValue {
  route: Route;
  goto: (page: string, params?: Record<string, string>) => void;
  role: string;
  setRole: (r: string) => void;
  messages: WaMessage[];
  tickets: Ticket[];
  turnovers: Turnover[];
  checklist: ChecklistGroup[];
  toast: string | null;
  showToast: (text: string, ms?: number) => void;
  createTicketFromMsg: (msgId: string, overrides?: Partial<Ticket>) => string | undefined;
  rejectMsg: (msgId: string) => void;
  assignTech: (ticketId: string, techId: string) => void;
  closeTicket: (ticketId: string) => void;
  setTurnoverStatus: (id: string, status: string) => void;
  toggleChecklistItem: (gi: number, ii: number) => void;
  capturePhoto: (gi: number, ii: number) => void;
  captureTicketPhoto: (ticketId: string, phase: string) => void;
  assignCleaners: (map: Record<string, string>) => void;
  advanceTicket: (id: string) => void;
  setTicketCost: (id: string, cost: string) => void;
  tweaks: Tweaks;
  setTweaks: (fn: (prev: Tweaks) => Tweaks) => void;
}

export const StoreCtx = React.createContext<StoreValue>(null as any);
export const useStore = () => React.useContext(StoreCtx);

const TICKET_STAGES = ['open', 'accepted', 'en-route', 'on-site', 'fixed', 'closed'];

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [route, setRoute] = React.useState<Route>({ page: 'today' });
  const [role, setRole] = React.useState('manager');
  const [messages, setMessages] = React.useState(WA_MSGS);
  const [tickets, setTickets] = React.useState(TICKETS_INIT);
  const [turnovers, setTurnovers] = React.useState(TURNOVERS);
  const [checklist, setChecklist] = React.useState<ChecklistGroup[]>(buildChecklist());
  const [toast, setToast] = React.useState<string | null>(null);
  const [tweaks, setTweaks] = React.useState<Tweaks>({
    density: 'comfortable', aiConfidence: 0.78, autoCreate: false,
    autoReply: true, sidebarCollapsed: false, showAnnotations: false,
  });

  const showToast = (text: string, ms = 2200) => {
    setToast(text);
    setTimeout(() => setToast(t => (t === text ? null : t)), ms);
  };

  const goto = (page: string, params: Record<string, string> = {}) =>
    setRoute({ page, ...params });

  const createTicketFromMsg = (msgId: string, overrides: Partial<Ticket> = {}) => {
    const m = messages.find(x => x.id === msgId);
    if (!m) return;
    const newId = String(parseInt(tickets[0].id) + 1);
    const t: Ticket = {
      id: newId,
      title: overrides.title || m.text.slice(0, 60).replace(/\.$/, ''),
      prop: m.parsed.prop,
      type: m.parsed.type,
      prio: m.parsed.prio,
      status: 'open',
      tech: null,
      due: overrides.due || 'Today',
      cost: '—',
      source: m.id,
      created: 'just now',
      blocksTurnover: m.parsed.prio === 'urgent' || m.parsed.prio === 'high',
      ...overrides,
    };
    setTickets(prev => [t, ...prev]);
    setMessages(prev => prev.map(x => x.id === msgId ? { ...x, status: 'ticketed', ticketId: newId } : x));
    showToast(`Ticket #${newId} created`);
    return newId;
  };

  const rejectMsg = (msgId: string) => {
    setMessages(prev => prev.map(x => x.id === msgId ? { ...x, status: 'rejected' } : x));
    showToast('Message dismissed');
  };

  const assignTech = (ticketId: string, techId: string) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, tech: techId, status: t.status === 'open' ? 'in-progress' : t.status } : t));
    showToast(`Assigned to ${staffById(techId)?.name}`);
  };

  const closeTicket = (ticketId: string) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: 'closed' } : t));
    showToast(`Ticket #${ticketId} closed`);
  };

  const setTurnoverStatus = (id: string, status: string) =>
    setTurnovers(prev => prev.map(t => t.id === id ? { ...t, status } : t));

  const assignCleaners = (map: Record<string, string>) => {
    setTurnovers(prev => prev.map(t => map[t.id] ? { ...t, cleaner: map[t.id] } : t));
    showToast(`Assigned ${Object.keys(map).length} turnovers · WhatsApp sent`);
  };

  const advanceTicket = (id: string) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== id) return t;
      const cur = TICKET_STAGES.indexOf(t.stage || (t.status === 'in-progress' ? 'accepted' : 'open'));
      const next = TICKET_STAGES[Math.min(cur + 1, TICKET_STAGES.length - 1)];
      return { ...t, stage: next, status: next === 'closed' ? 'closed' : (next === 'fixed' ? 'waiting' : 'in-progress') };
    }));
  };

  const setTicketCost = (id: string, cost: string) =>
    setTickets(prev => prev.map(t => t.id === id ? { ...t, cost } : t));

  const toggleChecklistItem = (gi: number, ii: number) =>
    setChecklist(prev => prev.map((g, i) => i !== gi ? g : { ...g, items: g.items.map((it, j) => j !== ii ? it : { ...it, done: !it.done }) }));

  const capturePhoto = (gi: number, ii: number) => {
    setChecklist(prev => prev.map((g, i) => i !== gi ? g : { ...g, items: g.items.map((it, j) => j !== ii ? it : { ...it, captured: true, done: true }) }));
    showToast('Photo captured');
  };

  const captureTicketPhoto = (ticketId: string, phase: string) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const photos = { ...(t.photos || {}), [phase]: true };
      return { ...t, photos };
    }));
    showToast(`${phase} photo captured`);
  };

  const value: StoreValue = {
    route, goto, role, setRole,
    messages, tickets, turnovers, checklist,
    showToast, toast,
    createTicketFromMsg, rejectMsg, assignTech, closeTicket,
    setTurnoverStatus, toggleChecklistItem, capturePhoto, captureTicketPhoto,
    assignCleaners, advanceTicket, setTicketCost,
    tweaks, setTweaks,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
};

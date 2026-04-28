// Shared data + state store for the prototype.

// Buildings group properties at the same address — same cleaner can do all units.
const BUILDINGS = [
  { id: 'B1', name: 'Marais — rue de Bretagne', addr: '38 rue de Bretagne, 75003', zone: 'Paris 03', units: 2 },
  { id: 'B2', name: 'Belleville — Denoyez',     addr: '12 rue Denoyez, 75020',     zone: 'Paris 20', units: 1 },
  { id: 'B3', name: 'Montmartre — Trois Frères',addr: '5 rue des Trois Frères, 75018', zone: 'Paris 18', units: 1 },
  { id: 'B4', name: 'Canal — Jemmapes',         addr: '102 Quai de Jemmapes, 75010', zone: 'Paris 10', units: 2 },
  { id: 'B5', name: 'Latin — Mouffetard',       addr: '24 rue Mouffetard, 75005',  zone: 'Paris 05', units: 1 },
  { id: 'B6', name: 'Pigalle — Frochot',        addr: '18 rue Frochot, 75009',     zone: 'Paris 09', units: 1 },
];

const PROPS = [
  { id: 'P1', name: 'Marais 2BR',        unit: 'Apt 3A', building: 'B1', full: 'Marais — rue de Bretagne · Apt 3A',     addr: '38 rue de Bretagne, 75003 — Apt 3A', zone: 'Paris 03', code: '4421', wifi: 'ENJ-marais',    notes: 'Boiler in cupboard left of fridge. Coffee machine = Nespresso.' },
  { id: 'P5', name: 'Marais 3BR Family', unit: 'Apt 5B', building: 'B1', full: 'Marais — rue de Bretagne · Apt 5B',     addr: '38 rue de Bretagne, 75003 — Apt 5B', zone: 'Paris 03', code: '8801', wifi: 'bastille-fam', notes: 'Two bathrooms. Top floor (5th, no lift).' },
  { id: 'P2', name: 'Belleville Studio', unit: 'Studio', building: 'B2', full: 'Belleville Loft · Studio',              addr: '12 rue Denoyez, 75020',              zone: 'Paris 20', code: '7782', wifi: 'belleville-2g', notes: 'Lockbox under stairs. Heating thermostat in hall.' },
  { id: 'P3', name: 'Montmartre 1BR',    unit: '1BR',    building: 'B3', full: 'Montmartre 1BR · vue Sacré-Cœur',       addr: '5 rue des Trois Frères, 75018',      zone: 'Paris 18', code: '1290', wifi: 'mont-1br',     notes: 'Tight stairs — no large supplies cart.' },
  { id: 'P4', name: 'Canal Studio',      unit: 'Apt 1',  building: 'B4', full: 'Canal St-Martin · Apt 1 (rez)',          addr: '102 Quai de Jemmapes, 75010 — Apt 1', zone: 'Paris 10', code: '5566', wifi: 'canal-flat',   notes: '' },
  { id: 'P7', name: 'Canal 1BR',         unit: 'Apt 4',  building: 'B4', full: 'Canal St-Martin · Apt 4',                addr: '102 Quai de Jemmapes, 75010 — Apt 4', zone: 'Paris 10', code: '6677', wifi: 'canal-1br',    notes: 'Same building as Apt 1, 4th floor.' },
  { id: 'P6', name: 'Latin Studio',      unit: 'Studio', building: 'B5', full: 'Latin Quarter Studio',                   addr: '24 rue Mouffetard, 75005',           zone: 'Paris 05', code: '3344', wifi: 'latin-q',      notes: '' },
];

const buildingById = (id) => BUILDINGS.find(b => b.id === id) || { name: '—', addr: '', zone: '' };

// Computed urgency: gap < 4h between checkout and check-in is "back-to-back".
const turnoverUrgency = (t) => {
  if (!t.in || t.in === '—') return { level: 'normal', gapMin: null, label: 'Same-day, no checkin' };
  const [oh, om] = t.out.split(':').map(Number);
  const [ih, im] = t.in.split(':').map(Number);
  const gap = (ih * 60 + im) - (oh * 60 + om);
  if (gap < 180) return { level: 'urgent',     gapMin: gap, label: 'Back-to-back · ' + Math.floor(gap / 60) + 'h ' + (gap % 60).toString().padStart(2, '0') + 'm window' };
  if (gap < 240) return { level: 'tight',      gapMin: gap, label: 'Tight · ' + Math.floor(gap / 60) + 'h ' + (gap % 60).toString().padStart(2, '0') + 'm window' };
  return { level: 'normal', gapMin: gap, label: Math.floor(gap / 60) + 'h ' + (gap % 60).toString().padStart(2, '0') + 'm window' };
};

const STAFF = [
  { id: 'S1', name: 'Amina K.', role: 'Cleaner', phone: '+33 6 12 11 22 33', online: true },
  { id: 'S2', name: 'Jorge M.', role: 'Cleaner', phone: '+33 6 33 44 55 66', online: true },
  { id: 'S3', name: 'Lin W.',   role: 'Cleaner', phone: '+33 6 22 33 44 55', online: false },
  { id: 'S4', name: 'Diane B.', role: 'Cleaner / Lead', phone: '+33 6 99 88 77 66', online: true },
  { id: 'S5', name: 'Rashid F.',role: 'Maintenance',     phone: '+33 6 11 88 99 00', online: true },
];

const TURNOVERS = [
  { id: 'T1', prop: 'P1', out: '11:00', in: '15:00', guests: 4, nights: 5, cleaner: 'S1', status: 'done',        notes: 'Guest reported wobbly chair · check', tickets: 1, photos: true },
  { id: 'T5', prop: 'P5', out: '11:00', in: '14:00', guests: 6, nights: 4, cleaner: 'S1', status: 'pending',     notes: 'Same building as Apt 3A — batch with T1', tickets: 0, photos: true },
  { id: 'T2', prop: 'P2', out: '10:00', in: '16:00', guests: 2, nights: 3, cleaner: 'S2', status: 'in-progress', notes: 'Code 4421 · gate sticky', tickets: 0, photos: true },
  { id: 'T3', prop: 'P3', out: '11:00', in: '13:00', guests: 3, nights: 7, cleaner: 'S3', status: 'pending',     notes: 'Back-to-back — 2h window only', tickets: 2, photos: true },
  { id: 'T4', prop: 'P4', out: '12:00', in: '17:00', guests: 2, nights: 2, cleaner: 'S1', status: 'pending',     notes: '', tickets: 0, photos: false },
  { id: 'T7', prop: 'P7', out: '11:30', in: '14:00', guests: 2, nights: 6, cleaner: null, status: 'pending',     notes: 'Same building as Apt 1 (Canal) — pair cleaners', tickets: 0, photos: true },
  { id: 'T6', prop: 'P6', out: '11:00', in: '—',    guests: 1, nights: 1, cleaner: 'S2', status: 'pending',     notes: 'Deep clean (no checkin today)', tickets: 1, photos: true },
];

const CHECKLIST_TPL = [
  { g: 'Entrance', items: ['Empty bins / replace liners', 'Sweep & mop floor', 'Wipe door handles'] },
  { g: 'Kitchen', items: ['Dishwasher empty + run if needed', 'Wipe surfaces, hob, microwave', 'Restock coffee, sugar, tea', 'Check fridge — discard guest leftovers', { t: 'Photo: kitchen wide', photo: true }] },
  { g: 'Bathroom', items: ['Disinfect WC, sink, shower', 'Replace towels (4×)', 'Restock toilet paper, soap, shampoo', { t: 'Photo: shower glass', photo: true }] },
  { g: 'Bedroom', items: ['Strip + remake beds', 'Vacuum carpet & under bed', 'Reset cushions / blackout curtains'] },
  { g: 'Final', items: ['AC at 21°C, lights off', 'Welcome card on table', { t: 'Photo: lockbox', photo: true }] },
];

// Build initial checklist with 6 items already done
const buildChecklist = () => {
  let i = 0;
  return CHECKLIST_TPL.map(g => ({
    g: g.g,
    items: g.items.map(it => {
      const item = typeof it === 'string' ? { t: it } : it;
      return { ...item, done: i++ < 6 };
    }),
  }));
};

const WA_MSGS = [
  { id: 'M1', who: 'Sophie L.', sub: 'Marais 2BR · guest', avatar: 'SL', time: '08:42',
    text: 'Hi! The shower is leaking onto the bathroom floor when used. Picture attached',
    photo: true, parsed: { type: 'plumbing', prop: 'P1', prio: 'high', confidence: 0.92 }, status: 'pending' },
  { id: 'M2', who: 'Diane B.', sub: 'Cleaner', avatar: 'DB', time: '09:15',
    text: 'Hoover is making a horrible noise at Belleville. Probably belt. Need replacement.',
    parsed: { type: 'appliance', prop: 'P2', prio: 'med', confidence: 0.85 }, status: 'pending' },
  { id: 'M3', who: 'Tom R.', sub: 'Marais 3BR · guest', avatar: 'TR', time: '09:48',
    text: 'No hot water this morning?? Also the wifi is down',
    parsed: { type: 'multi', prop: 'P5', prio: 'urgent', confidence: 0.78, splits: 2 }, status: 'pending' },
  { id: 'M4', who: 'Amina K.', sub: 'Cleaner', avatar: 'AK', time: '10:02',
    text: 'Light bulb out in entry, Montmartre. Can fix if you bring one tomorrow',
    parsed: { type: 'electrical', prop: 'P3', prio: 'low', confidence: 0.93 }, status: 'pending' },
  { id: 'M5', who: 'Marc D.', sub: 'Canal Studio · guest', avatar: 'MD', time: '10:30',
    text: 'Door handle came off in my hand. Stuck inside!',
    parsed: { type: 'lock', prop: 'P4', prio: 'urgent', confidence: 0.96 }, status: 'pending' },
  { id: 'M6', who: 'Jorge M.', sub: 'Cleaner', avatar: 'JM', time: '11:11',
    text: 'Out of toilet paper at Latin. Restocking from supply. Also smoke alarm beeping (battery)',
    parsed: { type: 'general', prop: 'P6', prio: 'med', confidence: 0.71 }, status: 'pending' },
];

const TICKETS_INIT = [
  { id: '241', title: 'Shower leaking onto floor', prop: 'P1', type: 'plumbing', prio: 'high', status: 'in-progress', tech: 'S5', due: 'Today 17:00', cost: '—', source: 'M1', created: '08:43', blocksTurnover: true },
  { id: '237', title: 'Door handle broken — guest stuck', prop: 'P4', type: 'lock', prio: 'urgent', status: 'in-progress', tech: 'S5', due: 'NOW', cost: '€60 est', source: 'M5', created: '10:31', blocksTurnover: false },
  { id: '236', title: 'Smoke alarm battery + TP restock', prop: 'P6', type: 'general', prio: 'med', status: 'waiting', tech: 'S5', due: 'Wed', cost: '€8', source: '—', created: 'Yesterday', blocksTurnover: false },
  { id: '235', title: 'Coffee machine descale', prop: 'P1', type: 'appliance', prio: 'low', status: 'closed', tech: 'S4', due: '—', cost: '€0', source: '—', created: 'Apr 24', blocksTurnover: false },
  { id: '234', title: 'Door buzzer intermittent', prop: 'P3', type: 'electrical', prio: 'low', status: 'open', tech: null, due: 'Thu', cost: '—', source: '—', created: 'Apr 23', blocksTurnover: false },
];

// ─── Store (React context) ─────────────────────────────────────────
const StoreCtx = React.createContext(null);

const useStore = () => React.useContext(StoreCtx);

const StoreProvider = ({ children }) => {
  const [route, setRoute] = React.useState({ page: 'today' });
  const [role, setRole] = React.useState('manager'); // manager | cleaner
  const [messages, setMessages] = React.useState(WA_MSGS);
  const [tickets, setTickets] = React.useState(TICKETS_INIT);
  const [turnovers, setTurnovers] = React.useState(TURNOVERS);
  const [checklist, setChecklist] = React.useState(buildChecklist());
  const [toast, setToast] = React.useState(null);
  const [tweaks, setTweaks] = React.useState({
    density: 'comfortable',
    aiConfidence: 0.78,
    autoCreate: false,
    autoReply: true,
    sidebarCollapsed: false,
    showAnnotations: false,
  });

  const showToast = (text, ms = 2200) => {
    setToast(text);
    setTimeout(() => setToast(t => (t === text ? null : t)), ms);
  };

  const goto = (page, params = {}) => setRoute({ page, ...params });

  // Convert WA message → ticket
  const createTicketFromMsg = (msgId, overrides = {}) => {
    const m = messages.find(x => x.id === msgId);
    if (!m) return;
    const newId = String(parseInt(tickets[0].id) + 1);
    const t = {
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

  const rejectMsg = (msgId) => {
    setMessages(prev => prev.map(x => x.id === msgId ? { ...x, status: 'rejected' } : x));
    showToast('Message dismissed');
  };

  const assignTech = (ticketId, techId) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, tech: techId, status: t.status === 'open' ? 'in-progress' : t.status } : t));
    showToast(`Assigned to ${STAFF.find(s => s.id === techId)?.name}`);
  };

  const closeTicket = (ticketId) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: 'closed' } : t));
    showToast(`Ticket #${ticketId} closed`);
  };

  const setTurnoverStatus = (id, status) => {
    setTurnovers(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const assignCleaners = (map) => {
    setTurnovers(prev => prev.map(t => map[t.id] ? { ...t, cleaner: map[t.id] } : t));
    showToast(`Assigned ${Object.keys(map).length} turnovers · WhatsApp sent`);
  };

  // Ticket lifecycle
  const TICKET_STAGES = ['open', 'accepted', 'en-route', 'on-site', 'fixed', 'closed'];
  const advanceTicket = (id) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== id) return t;
      const cur = TICKET_STAGES.indexOf(t.stage || (t.status === 'in-progress' ? 'accepted' : 'open'));
      const next = TICKET_STAGES[Math.min(cur + 1, TICKET_STAGES.length - 1)];
      return { ...t, stage: next, status: next === 'closed' ? 'closed' : (next === 'fixed' ? 'waiting' : 'in-progress') };
    }));
  };
  const setTicketCost = (id, cost) => {
    setTickets(prev => prev.map(t => t.id === id ? { ...t, cost } : t));
  };

  const toggleChecklistItem = (gi, ii) => {
    setChecklist(prev => prev.map((g, i) => i !== gi ? g : { ...g, items: g.items.map((it, j) => j !== ii ? it : { ...it, done: !it.done }) }));
  };

  const capturePhoto = (gi, ii) => {
    setChecklist(prev => prev.map((g, i) => i !== gi ? g : { ...g, items: g.items.map((it, j) => j !== ii ? it : { ...it, captured: true, done: true }) }));
    showToast('Photo captured');
  };

  const captureTicketPhoto = (ticketId, phase) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const photos = { ...(t.photos || {}), [phase]: true };
      return { ...t, photos };
    }));
    showToast(`${phase} photo captured`);
  };

  const value = {
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

const propById = id => PROPS.find(p => p.id === id);
const staffById = id => STAFF.find(s => s.id === id);
const msgById = (msgs, id) => msgs.find(m => m.id === id);

Object.assign(window, { PROPS, STAFF, StoreProvider, useStore, propById, staffById, msgById });

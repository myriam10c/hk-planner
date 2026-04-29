import type { Building, Property, Staff, Turnover, WaMessage, Ticket, ChecklistGroup, UrgencyResult } from '../types';

export const BUILDINGS: Building[] = [
  { id: 'B1', name: 'Marais — rue de Bretagne', addr: '38 rue de Bretagne, 75003', zone: 'Paris 03', units: 2 },
  { id: 'B2', name: 'Belleville — Denoyez',     addr: '12 rue Denoyez, 75020',     zone: 'Paris 20', units: 1 },
  { id: 'B3', name: 'Montmartre — Trois Frères',addr: '5 rue des Trois Frères, 75018', zone: 'Paris 18', units: 1 },
  { id: 'B4', name: 'Canal — Jemmapes',         addr: '102 Quai de Jemmapes, 75010', zone: 'Paris 10', units: 2 },
  { id: 'B5', name: 'Latin — Mouffetard',       addr: '24 rue Mouffetard, 75005',  zone: 'Paris 05', units: 1 },
  { id: 'B6', name: 'Pigalle — Frochot',        addr: '18 rue Frochot, 75009',     zone: 'Paris 09', units: 1 },
];

export const PROPS: Property[] = [
  { id: 'P1', name: 'Marais 2BR',        unit: 'Apt 3A', building: 'B1', full: 'Marais — rue de Bretagne · Apt 3A',     addr: '38 rue de Bretagne, 75003 — Apt 3A', zone: 'Paris 03', code: '4421', wifi: 'ENJ-marais',    notes: 'Boiler in cupboard left of fridge. Coffee machine = Nespresso.' },
  { id: 'P5', name: 'Marais 3BR Family', unit: 'Apt 5B', building: 'B1', full: 'Marais — rue de Bretagne · Apt 5B',     addr: '38 rue de Bretagne, 75003 — Apt 5B', zone: 'Paris 03', code: '8801', wifi: 'bastille-fam', notes: 'Two bathrooms. Top floor (5th, no lift).' },
  { id: 'P2', name: 'Belleville Studio', unit: 'Studio', building: 'B2', full: 'Belleville Loft · Studio',              addr: '12 rue Denoyez, 75020',              zone: 'Paris 20', code: '7782', wifi: 'belleville-2g', notes: 'Lockbox under stairs. Heating thermostat in hall.' },
  { id: 'P3', name: 'Montmartre 1BR',    unit: '1BR',    building: 'B3', full: 'Montmartre 1BR · vue Sacré-Cœur',       addr: '5 rue des Trois Frères, 75018',      zone: 'Paris 18', code: '1290', wifi: 'mont-1br',     notes: 'Tight stairs — no large supplies cart.' },
  { id: 'P4', name: 'Canal Studio',      unit: 'Apt 1',  building: 'B4', full: 'Canal St-Martin · Apt 1 (rez)',          addr: '102 Quai de Jemmapes, 75010 — Apt 1', zone: 'Paris 10', code: '5566', wifi: 'canal-flat',   notes: '' },
  { id: 'P7', name: 'Canal 1BR',         unit: 'Apt 4',  building: 'B4', full: 'Canal St-Martin · Apt 4',                addr: '102 Quai de Jemmapes, 75010 — Apt 4', zone: 'Paris 10', code: '6677', wifi: 'canal-1br',    notes: 'Same building as Apt 1, 4th floor.' },
  { id: 'P6', name: 'Latin Studio',      unit: 'Studio', building: 'B5', full: 'Latin Quarter Studio',                   addr: '24 rue Mouffetard, 75005',           zone: 'Paris 05', code: '3344', wifi: 'latin-q',      notes: '' },
];

export const STAFF: Staff[] = [
  { id: 'S1', name: 'Amina K.', role: 'Cleaner', phone: '+33 6 12 11 22 33', online: true },
  { id: 'S2', name: 'Jorge M.', role: 'Cleaner', phone: '+33 6 33 44 55 66', online: true },
  { id: 'S3', name: 'Lin W.',   role: 'Cleaner', phone: '+33 6 22 33 44 55', online: false },
  { id: 'S4', name: 'Diane B.', role: 'Cleaner / Lead', phone: '+33 6 99 88 77 66', online: true },
  { id: 'S5', name: 'Rashid F.',role: 'Maintenance',     phone: '+33 6 11 88 99 00', online: true },
];

export const TURNOVERS: Turnover[] = [
  { id: 'T1', prop: 'P1', out: '11:00', in: '15:00', guests: 4, nights: 5, cleaner: 'S1', status: 'done',        notes: 'Guest reported wobbly chair · check', tickets: 1, photos: true },
  { id: 'T5', prop: 'P5', out: '11:00', in: '14:00', guests: 6, nights: 4, cleaner: 'S1', status: 'pending',     notes: 'Same building as Apt 3A — batch with T1', tickets: 0, photos: true },
  { id: 'T2', prop: 'P2', out: '10:00', in: '16:00', guests: 2, nights: 3, cleaner: 'S2', status: 'in-progress', notes: 'Code 4421 · gate sticky', tickets: 0, photos: true },
  { id: 'T3', prop: 'P3', out: '11:00', in: '13:00', guests: 3, nights: 7, cleaner: 'S3', status: 'pending',     notes: 'Back-to-back — 2h window only', tickets: 2, photos: true },
  { id: 'T4', prop: 'P4', out: '12:00', in: '17:00', guests: 2, nights: 2, cleaner: 'S1', status: 'pending',     notes: '', tickets: 0, photos: false },
  { id: 'T7', prop: 'P7', out: '11:30', in: '14:00', guests: 2, nights: 6, cleaner: null, status: 'pending',     notes: 'Same building as Apt 1 (Canal) — pair cleaners', tickets: 0, photos: true },
  { id: 'T6', prop: 'P6', out: '11:00', in: '—',    guests: 1, nights: 1, cleaner: 'S2', status: 'pending',     notes: 'Deep clean (no checkin today)', tickets: 1, photos: true },
];

export const CHECKLIST_TPL = [
  { g: 'Entrance', items: ['Empty bins / replace liners', 'Sweep & mop floor', 'Wipe door handles'] },
  { g: 'Kitchen', items: ['Dishwasher empty + run if needed', 'Wipe surfaces, hob, microwave', 'Restock coffee, sugar, tea', 'Check fridge — discard guest leftovers', { t: 'Photo: kitchen wide', photo: true }] },
  { g: 'Bathroom', items: ['Disinfect WC, sink, shower', 'Replace towels (4×)', 'Restock toilet paper, soap, shampoo', { t: 'Photo: shower glass', photo: true }] },
  { g: 'Bedroom', items: ['Strip + remake beds', 'Vacuum carpet & under bed', 'Reset cushions / blackout curtains'] },
  { g: 'Final', items: ['AC at 21°C, lights off', 'Welcome card on table', { t: 'Photo: lockbox', photo: true }] },
];

export const buildChecklist = (): ChecklistGroup[] => {
  let i = 0;
  return CHECKLIST_TPL.map(g => ({
    g: g.g,
    items: g.items.map(it => {
      const item = typeof it === 'string' ? { t: it } : it;
      return { ...item, done: i++ < 6 };
    }),
  }));
};

export const WA_MSGS: WaMessage[] = [
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

export const TICKETS_INIT: Ticket[] = [
  { id: '241', title: 'Shower leaking onto floor', prop: 'P1', type: 'plumbing', prio: 'high', status: 'in-progress', tech: 'S5', due: 'Today 17:00', cost: '—', source: 'M1', created: '08:43', blocksTurnover: true },
  { id: '237', title: 'Door handle broken — guest stuck', prop: 'P4', type: 'lock', prio: 'urgent', status: 'in-progress', tech: 'S5', due: 'NOW', cost: '€60 est', source: 'M5', created: '10:31', blocksTurnover: false },
  { id: '236', title: 'Smoke alarm battery + TP restock', prop: 'P6', type: 'general', prio: 'med', status: 'waiting', tech: 'S5', due: 'Wed', cost: '€8', source: '—', created: 'Yesterday', blocksTurnover: false },
  { id: '235', title: 'Coffee machine descale', prop: 'P1', type: 'appliance', prio: 'low', status: 'closed', tech: 'S4', due: '—', cost: '€0', source: '—', created: 'Apr 24', blocksTurnover: false },
  { id: '234', title: 'Door buzzer intermittent', prop: 'P3', type: 'electrical', prio: 'low', status: 'open', tech: null, due: 'Thu', cost: '—', source: '—', created: 'Apr 23', blocksTurnover: false },
];

export const propById = (id: string): Property => PROPS.find(p => p.id === id) || PROPS[0];
export const staffById = (id: string | null | undefined): Staff | undefined => STAFF.find(s => s.id === id);
export const buildingById = (id: string): Building => BUILDINGS.find(b => b.id === id) || BUILDINGS[0];

export const turnoverUrgency = (t: Turnover): UrgencyResult => {
  if (!t.in || t.in === '—') return { level: 'normal', gapMin: null, label: 'Same-day, no checkin' };
  const [oh, om] = t.out.split(':').map(Number);
  const [ih, im] = t.in.split(':').map(Number);
  const gap = (ih * 60 + im) - (oh * 60 + om);
  if (gap < 180) return { level: 'urgent', gapMin: gap, label: `Back-to-back · ${Math.floor(gap / 60)}h ${(gap % 60).toString().padStart(2, '0')}m window` };
  if (gap < 240) return { level: 'tight',  gapMin: gap, label: `Tight · ${Math.floor(gap / 60)}h ${(gap % 60).toString().padStart(2, '0')}m window` };
  return { level: 'normal', gapMin: gap, label: `${Math.floor(gap / 60)}h ${(gap % 60).toString().padStart(2, '0')}m window` };
};

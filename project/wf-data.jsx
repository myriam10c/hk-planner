// Sample data shared across wireframes. Loose enough to riff on.

const PROPS = [
  { id: 'P1', name: 'Marais 2BR · rue de Bretagne', short: 'Marais 2BR', addr: '38 rue de Bretagne, 75003', zone: 'Paris 03' },
  { id: 'P2', name: 'Belleville Loft · Studio', short: 'Belleville Studio', addr: '12 rue Denoyez, 75020', zone: 'Paris 20' },
  { id: 'P3', name: 'Montmartre 1BR · vue Sacré-Cœur', short: 'Montmartre 1BR', addr: '5 rue des Trois Frères, 75018', zone: 'Paris 18' },
  { id: 'P4', name: 'Canal St-Martin Studio', short: 'Canal Studio', addr: '102 Quai de Jemmapes, 75010', zone: 'Paris 10' },
  { id: 'P5', name: 'Bastille 3BR Family', short: 'Bastille 3BR', addr: '7 rue de la Roquette, 75011', zone: 'Paris 11' },
  { id: 'P6', name: 'Latin Quarter Studio', short: 'Latin Studio', addr: '24 rue Mouffetard, 75005', zone: 'Paris 05' },
  { id: 'P7', name: 'Pigalle 1BR', short: 'Pigalle 1BR', addr: '18 rue Frochot, 75009', zone: 'Paris 09' },
];

const STAFF = [
  { id: 'S1', name: 'Amina K.', initials: 'AK', role: 'Cleaner' },
  { id: 'S2', name: 'Jorge M.', initials: 'JM', role: 'Cleaner' },
  { id: 'S3', name: 'Lin W.', initials: 'LW', role: 'Cleaner' },
  { id: 'S4', name: 'Diane B.', initials: 'DB', role: 'Cleaner / Lead' },
  { id: 'S5', name: 'Rashid F.', initials: 'RF', role: 'Maintenance' },
];

// Today's turnovers
const TURNOVERS = [
  { id: 'T1', prop: 'P1', out: '11:00', in: '15:00', guests: 4, nights: 5, cleaner: 'S1', status: 'done',        notes: 'Guest reported wobbly chair · check', linen: '4×bed/8×towel', tickets: 1, photos: true },
  { id: 'T2', prop: 'P2', out: '10:00', in: '16:00', guests: 2, nights: 3, cleaner: 'S2', status: 'in-progress', notes: 'Code 4421 · gate sticky', linen: '1×bed/4×towel', tickets: 0, photos: true },
  { id: 'T3', prop: 'P3', out: '11:00', in: '14:00', guests: 3, nights: 7, cleaner: 'S3', status: 'pending',     notes: 'Tight turnover — 3h window', linen: '2×bed/6×towel', tickets: 2, photos: true },
  { id: 'T4', prop: 'P4', out: '12:00', in: '17:00', guests: 2, nights: 2, cleaner: 'S1', status: 'pending',     notes: '', linen: '1×bed/4×towel', tickets: 0, photos: false },
  { id: 'T5', prop: 'P5', out: '10:00', in: '15:00', guests: 6, nights: 4, cleaner: 'S4', status: 'blocked',     notes: 'No keys returned · contact guest', linen: '5×bed/10×towel', tickets: 0, photos: true },
  { id: 'T6', prop: 'P6', out: '11:00', in: '—',    guests: 1, nights: 1, cleaner: 'S2', status: 'pending',     notes: 'Deep clean (no checkin today)', linen: '1×bed/2×towel', tickets: 1, photos: true },
  { id: 'T7', prop: 'P7', out: '09:30', in: '15:00', guests: 2, nights: 6, cleaner: '—',  status: 'pending',     notes: 'Unassigned ⚠', linen: '1×bed/4×towel', tickets: 0, photos: true },
];

// Cleaning checklist for property detail
const CHECKLIST = [
  { g: 'Entrance', items: [
    { t: 'Empty bins / replace liners', done: true },
    { t: 'Sweep & mop floor', done: true },
    { t: 'Wipe door handles', done: false },
  ]},
  { g: 'Kitchen', items: [
    { t: 'Dishwasher empty + run if needed', done: true },
    { t: 'Wipe surfaces, hob, microwave', done: true },
    { t: 'Restock coffee, sugar, tea', done: false },
    { t: 'Check fridge — discard guest leftovers', done: false },
    { t: 'Photos: kitchen wide + close', done: false, photo: true },
  ]},
  { g: 'Bathroom', items: [
    { t: 'Disinfect WC, sink, shower', done: false },
    { t: 'Replace towels (4×)', done: false },
    { t: 'Restock toilet paper, soap, shampoo', done: false },
    { t: 'Photos: shower glass + mirror', done: false, photo: true },
  ]},
  { g: 'Bedroom', items: [
    { t: 'Strip + remake beds (2×)', done: false },
    { t: 'Vacuum carpet & under bed', done: false },
    { t: 'Reset cushions / blackout curtains', done: false },
  ]},
  { g: 'Final', items: [
    { t: 'AC at 21°C, lights off', done: false },
    { t: 'Welcome card on table', done: false },
    { t: 'Lockbox photo', done: false, photo: true },
  ]},
];

// WhatsApp messages → tickets
const WA_MESSAGES = [
  { id: 'M1', who: 'Sophie L. · Marais 2BR', avatar: 'SL', time: '08:42', text: 'Hi! The shower is leaking onto the bathroom floor when used. Picture attached 📷', photo: true, parsed: 'leak', prop: 'P1', prio: 'high' },
  { id: 'M2', who: 'Diane B. · Cleaner', avatar: 'DB', time: '09:15', text: 'Hoover is making a horrible noise at Belleville. Probably belt. Need replacement.', parsed: 'appliance', prop: 'P2', prio: 'med' },
  { id: 'M3', who: 'Tom R. · Bastille 3BR', avatar: 'TR', time: '09:48', text: 'No hot water this morning?? Also the wifi is down', photo: false, parsed: 'multi', prop: 'P5', prio: 'urgent' },
  { id: 'M4', who: 'Amina K. · Cleaner', avatar: 'AK', time: '10:02', text: 'Light bulb out in entry, Montmartre. Can fix if you bring one tomorrow', parsed: 'electrical', prop: 'P3', prio: 'low' },
  { id: 'M5', who: 'Marc D. · Canal Studio', avatar: 'MD', time: '10:30', text: 'Door handle came off in my hand. Stuck inside!', parsed: 'urgent-lock', prop: 'P4', prio: 'urgent' },
  { id: 'M6', who: 'Jorge M. · Cleaner', avatar: 'JM', time: '11:11', text: 'Out of toilet paper at Latin. Restocking from supply. Also smoke alarm beeping (battery)', parsed: 'multi', prop: 'P6', prio: 'med' },
];

// Generated tickets
const TICKETS = [
  { id: '#241', title: 'Shower leaking onto floor', prop: 'P1', type: 'plumbing', prio: 'high', status: 'in-progress', tech: 'S5', due: 'Today 17:00', cost: '€—', source: 'M1' },
  { id: '#240', title: 'Vacuum belt replacement', prop: 'P2', type: 'appliance', prio: 'med', status: 'open', tech: '—', due: 'Tue 30', cost: '€45 est', source: 'M2' },
  { id: '#239', title: 'No hot water + wifi down', prop: 'P5', type: 'plumbing', prio: 'urgent', status: 'open', tech: 'S5', due: 'ASAP', cost: '€—', source: 'M3' },
  { id: '#238', title: 'Light bulb — entry', prop: 'P3', type: 'electrical', prio: 'low', status: 'open', tech: 'S4', due: 'Tue 30', cost: '€2', source: 'M4' },
  { id: '#237', title: 'Door handle broken — guest stuck', prop: 'P4', type: 'lock', prio: 'urgent', status: 'in-progress', tech: 'S5', due: 'NOW', cost: '€60 est', source: 'M5' },
  { id: '#236', title: 'Smoke alarm battery + TP restock', prop: 'P6', type: 'general', prio: 'med', status: 'waiting', tech: 'S5', due: 'Wed 1', cost: '€8', source: 'M6' },
  { id: '#235', title: 'Coffee machine descale', prop: 'P1', type: 'appliance', prio: 'low', status: 'closed', tech: 'S4', due: '—', cost: '€0', source: '—' },
];

const propById = id => PROPS.find(p => p.id === id);
const staffById = id => STAFF.find(s => s.id === id);
const msgById = id => WA_MESSAGES.find(m => m.id === id);

Object.assign(window, { PROPS, STAFF, TURNOVERS, CHECKLIST, WA_MESSAGES, TICKETS, propById, staffById, msgById });

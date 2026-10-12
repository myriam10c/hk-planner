// Reponses mnt.list / mnt.get / mnt.act au format de supabase/functions/hostaway-proxy/mnt_read.ts et mnt_get.ts.
export const NOW_MNT = new Date('2026-10-09T07:00:00Z'); // 11:00 Dubai

export const SEMAX = { id: 21, name: 'Semax', color: '#0e9384', role: 'maintenance', email: 'semax@example.com' };

export function PRP(o: any = {}) {
  return {
    id: 5, ref: 'PRP-5', listingId: 'L1', apt: '1509', bld: 'Westwood', title: 'AC not cooling in bedroom',
    category: 'ac', categoryLabel: 'AC', urgency: 'urgent', guestName: 'Ann Lee', stayFrom: '2026-10-08', stayTo: '2026-10-12',
    guestInNow: true,
    quotes: [
      { message_id: 'm1', at: '2026-10-09T05:10:00Z', text: 'It is hot in here' },
      { message_id: 'm2', at: '2026-10-09T06:58:00Z', text: 'The AC is <b>blowing warm</b> air' },
    ],
    conversationId: '987654', reservationId: 'R1', openTicket: null, status: 'pending', rejectReason: null, rejectNote: null,
    ticket: null, decidedBy: null, decidedAt: null, createdAt: '2026-10-09T05:10:00Z', updatedAt: '2026-10-09T06:58:00Z',
    ...o,
  };
}

export const PRP_MERGE = () => PRP({
  id: 6, ref: 'PRP-6', listingId: 'L2', apt: '4609', bld: 'Peninsula 3', title: 'Shower drain blocked', category: 'plumbing',
  categoryLabel: 'Plumbing', urgency: 'normal', guestInNow: false, guestName: null, stayFrom: '2026-09-28', stayTo: '2026-10-03', conversationId: '111',
  quotes: [{ message_id: 'm3', at: '2026-10-08T05:31:00Z', text: 'Water is still not going down' }],
  openTicket: { id: 12, ref: 'MNT-12', title: 'Shower drain blocked' },
});

export function TICKET(o: any = {}) {
  return {
    id: 14, ref: 'MNT-14', listingId: 'L1', apt: '1509', bld: 'Westwood', title: 'AC not cooling', category: 'ac',
    priority: 'urgent', status: 'open', stage: 'todo', origin: 'guest_message', assignee: null, dueOn: null,
    createdAt: '2026-10-09T06:20:00Z', startedAt: null, resolvedAt: null, resolvedBy: null, resolutionNotes: null,
    actualCost: null, proposalId: 5, ...o,
  };
}

export const TEAM = [
  { id: 8, name: 'Walter', role: 'manager' },
  { id: 21, name: 'Semax', role: 'maintenance' },
];
export const VENDORS = [{ id: 3, name: 'CoolFix AC' }];
export const LISTINGS = [
  { id: 'L3', apt: '2514', bld: 'Emaar Grand' },
  { id: 'L2', apt: '4609', bld: 'Peninsula 3' },
  { id: 'L1', apt: '1509', bld: 'Westwood' },
];

export function listBody(tab: string, o: any = {}) {
  return {
    tab, counts: { proposals: 2, open: 3, urgent: 1, unassigned: 2, mine: 1 },
    proposals: [], tickets: [], team: TEAM, vendors: VENDORS, listings: LISTINGS, ...o,
  };
}

export const PROPOSALS = (o: any = {}) => listBody('proposals', { proposals: [PRP(), PRP_MERGE()], ...o });
export const OPEN = (o: any = {}) => listBody('open', {
  tickets: [
    TICKET(),
    TICKET({ id: 12, ref: 'MNT-12', title: 'Shower drain blocked', apt: '4609', bld: 'Peninsula 3', priority: 'high', dueOn: '2026-10-09', origin: 'manual' }),
    TICKET({ id: 9, ref: 'MNT-9', title: 'Door handle loose', apt: '2514', bld: 'Emaar Grand', priority: 'medium', stage: 'in_progress', status: 'in_progress', origin: 'cleaner_report', assignee: { kind: 'member', id: 21, name: 'Semax' } }),
  ],
  ...o,
});
export const DONE = (o: any = {}) => listBody('done', {
  tickets: [
    TICKET({ id: 7, ref: 'MNT-7', title: 'Kitchen tap leaking', stage: 'done', status: 'resolved', resolvedAt: '2026-10-08T08:00:00Z',
      resolvedBy: 'Semax', resolutionNotes: 'Seal <i>replaced</i>', actualCost: 120 }),
    TICKET({ id: 4, ref: 'MNT-4', title: 'Wifi router offline', stage: 'done', status: 'resolved', resolvedAt: '2026-10-07T08:00:00Z',
      resolvedBy: 'Ismael', resolutionNotes: null, actualCost: null }),
  ],
  ...o,
});
export const REJECTED = () => listBody('proposals', {
  proposals: [
    PRP({ id: 3, ref: 'PRP-3', title: 'TV remote missing', status: 'rejected', rejectReason: 'other', rejectNote: 'Guest found it',
      decidedBy: 'Walter', decidedAt: '2026-10-08T09:00:00Z' }),
    PRP({ id: 2, ref: 'PRP-2', title: 'Drain again', status: 'merged', ticket: { id: 12, ref: 'MNT-12' }, decidedBy: 'Semax', decidedAt: '2026-10-07T09:00:00Z' }),
  ],
});

// Modele de l'ecran Today (lot 4a, spec refonte-today sections 2 a 4) : pur, sans
// import, sans DOM ni horloge. Range la reponse du proxy (mgr.today pour le jour des
// donnees, mgr.planning pour les autres jours) en logements, moments et comptes ; la
// vue (today-view.js) en fait le HTML. Aucun statut recalcule : tone, word et cause
// viennent du proxy tels quels. Dates et heures : chaines de Dubai deja rendues par le
// proxy (YYYY-MM-DD, HH:MM), jamais relues au fuseau de la machine.

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Ordre du decompte d'un moment, et mots de son aria-label.
const TALLY = ['blocked', 'risk', 'none', 'elite', 'prog', 'todo', 'planned', 'ready', 'done'];
const WORDS = {
  blocked: 'blocked', risk: 'at risk', none: 'with no cleaner', elite: 'not logged yet', prog: 'in progress',
  todo: 'not started', planned: 'with a cleaner', ready: 'ready', done: 'done',
};
const ARRIVAL_K = { bad: 'blocked', warn: 'risk', ok: 'ready', idle: 'planned' };
// Mot du proxy pour un menage sans personne qu'Elite fait d'habitude et saisit le lendemain.
const ELITE_WORD = 'Not logged yet';
const RANK = { blocked: 0, risk: 1 };

function parts(day) { return String(day).split('-').map(Number); }
function addDays(day, n) { const p = parts(day); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function shortDay(day) { const p = parts(day); return WD[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ' ' + p[2]; }
function longDay(day) { const p = parts(day); return WD_LONG[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]; }
function ddmm(day) { return day ? day.slice(8, 10) + '/' + day.slice(5, 7) : ''; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// Meme regle que personSlots du proxy (mgr_planning_rules.ts) : cleaners par nom, p1 a p4
// en boucle ; sous-traitant sur sa couleur ; les autres roles n'en ont pas.
export function slotsOf(people) {
  const out = {};
  const cleaners = (people || []).filter((p) => p.role === 'cleaner')
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  cleaners.forEach((p, i) => { out[String(p.id)] = 'p' + ((i % 4) + 1); });
  for (const p of people || []) if (p.role === 'subcontractor') out[String(p.id)] = 'sub';
  return out;
}

// Logement sans cleaner : un menage du jour, pas fait, personne dessus, pas attendu chez Elite.
export function isNone(u) { return !!u && !!u.job && u.job.state !== 'done' && !u.assigned.length && !u.job.elite; }
function matches(u, filter) {
  if (filter == null) return true;
  if (filter === 'none') return isNone(u);
  return !!u.job && u.assigned.indexOf(Number(filter)) >= 0;
}

function jobPart(j) {
  const assigned = j.assigned || [];
  return {
    key: j.key, extra: j.kind === 'extra',
    // Heure dediee d'un extra : extraTime (mgr.today) ou extra.cleaningTime (mgr.planning).
    extraTime: j.kind === 'extra' ? (j.extraTime || (j.extra && j.extra.cleaningTime) || null) : null,
    checkout: j.checkout || null, postponedFrom: j.postponedFrom || null, state: j.state,
    elite: !assigned.length && j.word === ELITE_WORD,
  };
}
function nextPart(n) {
  return n ? { date: n.date, time: n.time || null, sameDay: !!n.sameDay, owner: !!n.owner } : null;
}
function kOf(a, j, today) {
  if (a) return ARRIVAL_K[a.tone] || 'planned';
  if (j.state === 'done') return 'done';
  if (!(j.assigned || []).length) return j.word === ELITE_WORD ? 'elite' : 'none';
  if (j.state === 'in_progress') return 'prog';
  return today ? 'todo' : 'planned';
}
function shapeOf(k) { return k === 'blocked' ? 'blocked' : k === 'ready' || k === 'done' ? 'line' : 'card'; }

// Cause du proxy affichee sur la carte : carte pleine d'une arrivee, ou carte Blocked qui
// n'a que la cause pour raison.
function causeShown(u) {
  return !!(u.arrival && u.cause && (u.shape === 'card' || u.reasons.some((r) => r.type === 'cause')));
}
// Ligne des heures (gabarit timesLine de la page de test). Un logement avec arrivee ne dit
// que son depart : l'heure d'arrivee est celle du moment. Un report remplace « Checkout
// time not set. » (le depart a eu lieu un autre jour, le proxy ne rend pas son heure).
// « Checkout time not set. » n'est pas repete quand la cause affichee le dit deja.
function timesLine(u, date, today) {
  const j = u.job;
  const out = [];
  if (j) {
    if (j.extra) out.push(j.extraTime ? 'Extra cleaning at ' + j.extraTime + '.' : 'Extra cleaning.');
    else if (j.checkout) out.push('Out ' + j.checkout + '.');
    else if (!j.postponedFrom && !(causeShown(u) && u.cause.toLowerCase().indexOf('checkout time not set') >= 0)) out.push('Checkout time not set.');
    if (j.postponedFrom) out.push('Postponed from ' + ddmm(j.postponedFrom) + '.');
  }
  if (u.arrival || !j) return out.join(' ');
  const n = u.next;
  if (!n) {
    // mgr.planning ne cherche jamais le prochain guest d'un extra : rien a en dire.
    if (today || !j.extra) out.push('No guest in the next 14 days.');
    return out.join(' ');
  }
  const who = n.owner ? 'Owner' : 'Guest';
  const at = n.time ? ' at ' + n.time : '';
  if (n.sameDay) out.push(who + ' arrives the same day' + at + '.');
  else {
    const when = n.date === addDays(date, 1) ? (today ? 'tomorrow' : 'the next day') : shortDay(n.date);
    out.push('Next ' + who.toLowerCase() + ' ' + when + at + '.');
  }
  return out.join(' ');
}

// Etat d'un menage dit sur la ligne Cleaner d'une carte Blocked (page de test, blocked()).
const JOB_WORD = { done: 'Done', in_progress: 'In progress' };
// Raisons d'une carte Blocked : tickets urgents, menage sans personne, sinon la cause du proxy ;
// puis, quand le menage du jour a deja une personne, la ligne Cleaner (son etat).
function reasonsOf(u) {
  if (u.k !== 'blocked') return [];
  const out = u.tickets.filter((t) => t.priority === 'urgent')
    .map((t) => ({ type: 'ticket', ref: t.ref, title: t.title, since: t.since, tech: t.tech }));
  if (u.job && u.job.state !== 'done' && !u.assigned.length) out.push({ type: 'cleaning', elite: u.job.elite });
  if (!out.length) out.push({ type: 'cause', text: u.cause });
  if (u.job && u.assigned.length) out.push({ type: 'cleaner', word: JOB_WORD[u.job.state] || 'Not started' });
  return out;
}

// a : arrivee de mgr.today (ou null), j : menage de mgr.today ou de mgr.planning (ou null).
function unitOf(a, j, date, today, tickets) {
  const src = j || a;
  const key = j ? j.key : (a.prevKey || null);
  const k = kOf(a, j, today);
  const u = {
    id: j ? j.key : 'arr:' + a.id, key,
    listingId: String(src.listingId == null ? '' : src.listingId), apt: src.apt || '', bld: src.bld || '',
    shape: shapeOf(k), k, tone: (a || j).tone, word: (a || j).word, cause: a ? (a.cause || '') : '',
    arrival: a ? { id: a.id, time: a.time, timeSet: !!a.timeSet, owner: /^Owner/.test(a.kind || '') } : null,
    job: j ? jobPart(j) : null,
    next: j ? nextPart(j.next) : null,
    assigned: (src.assigned || []).slice(),
    canAssign: !!key && (j ? j.state !== 'done' : !a.done),
    opens: a ? { type: 'arr', ref: a.id } : { type: 'job', ref: j.key },
    timesLine: '', tickets, reasons: [],
  };
  // Raisons d'abord : la ligne des heures regarde si la cause est affichee.
  u.reasons = reasonsOf(u);
  u.timesLine = timesLine(u, date, today);
  return u;
}

function tallyOf(units) {
  return TALLY.map((k) => ({ k, n: units.filter((u) => u.k === k).length, w: WORDS[k] })).filter((t) => t.n);
}
function momentOf(id, label, tint, units) {
  const sorted = units.map((u, i) => ({ u, i }))
    .sort((a, b) => (a.u.k in RANK ? RANK[a.u.k] : 2) - (b.u.k in RANK ? RANK[b.u.k] : 2) || a.i - b.i)
    .map((x) => x.u);
  return { id, label, tint, unitIds: sorted.map((u) => u.id), tally: tallyOf(sorted), units: sorted };
}
// Moments dans l'ordre ; les unites de la journee suivent l'ordre affiche.
function finish(day, moments) {
  day.moments = moments.filter((m) => m.units.length);
  day.units = [];
  for (const m of day.moments) { day.units.push(...m.units); delete m.units; }
  return day;
}

function countsOf(units) {
  const arr = (k) => units.filter((u) => u.arrival && u.k === k).length;
  return {
    arrivals: units.filter((u) => u.arrival).length,
    ready: arr('ready'), scheduled: arr('planned'), risk: arr('risk'), blocked: arr('blocked'),
    cleanings: units.filter((u) => u.job).length,
    none: units.filter(isNone).length,
    elite: units.filter((u) => u.job && u.job.elite && u.job.state !== 'done').length,
  };
}

// base : personnes affectables, dans l'ordre du proxy ; known : autres personnes connues du
// proxy. Toute personne affectee a un logement du jour figure, connue ou non.
function peopleOf(base, known, units, off) {
  const slots = slotsOf(base);
  const list = base.map((p) => ({ id: p.id, name: p.name, role: p.role, assignable: true }));
  const seen = new Set(list.map((p) => p.id));
  for (const u of units) {
    for (const id of u.assigned) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = known.find((x) => x.id === id);
      list.push(p ? { id, name: p.name, role: p.role, assignable: false } : { id, name: 'Member ' + id, role: 'unknown', assignable: false });
    }
  }
  return list.map((p) => ({
    id: p.id, name: p.name, role: p.role, slot: slots[String(p.id)] || 'other',
    ini: p.role === 'unknown' ? '?' : initials(p.name),
    count: units.filter((u) => u.job && u.assigned.indexOf(p.id) >= 0).length,
    off: off.indexOf(p.id) >= 0, assignable: p.assignable,
  }));
}

// Jour des donnees, depuis mgr.today.
export function buildToday(data) {
  const date = data.day;
  const jobs = (data.who && data.who.jobs) || [];
  const rows = (data.arrivals && data.arrivals.rows) || [];
  const tk = data.ticketsByListing || {};
  const ticketsOf = (listingId) => (tk[listingId] || []).map((t) => ({
    id: t.id, ref: 'MNT-' + t.id, title: t.title, priority: t.priority, since: t.since, tech: t.tech == null ? null : t.tech,
  }));
  const byKey = {};
  for (const j of jobs) byKey[j.key] = j;
  const merged = {};
  const units = [];
  for (const a of rows) {
    // Une arrivee et le menage que designe prevKey ne font qu'un logement (une seule fois).
    const j = a.prevKey && byKey[a.prevKey] && !merged[a.prevKey] ? byKey[a.prevKey] : null;
    if (j) merged[j.key] = true;
    units.push(unitOf(a, j, date, true, ticketsOf(String(a.listingId))));
  }
  for (const j of jobs) if (!merged[j.key]) units.push(unitOf(null, j, date, true, ticketsOf(String(j.listingId))));

  // Un moment par heure d'arrivee. Un autre menage du jour sur un logement ou un guest
  // arrive aujourd'hui (un extra, par exemple) reste une carte a part, sous cette arrivee.
  const groups = {};
  const momentKey = (u) => {
    let time = u.arrival ? u.arrival.time : null;
    if (!time && u.next && u.next.sameDay) {
      const a = rows.find((r) => String(r.listingId) === u.listingId);
      if (a) time = a.time;
    }
    return time ? 'arr-' + time.replace(':', '') : 'none';
  };
  for (const u of units) {
    const id = momentKey(u);
    (groups[id] = groups[id] || []).push(u);
  }
  const ids = Object.keys(groups).filter((id) => id !== 'none').sort();
  const moments = ids.map((id) => {
    const time = id.slice(4, 6) + ':' + id.slice(6);
    return momentOf(id, 'Arriving at ' + time, time < '18:00' ? 'day' : 'night', groups[id]);
  });
  if (groups.none) moments.push(momentOf('none', 'No guest today', 'any', groups.none));
  const day = finish({ date, source: 'today', people: [], units: [], moments: [], counts: null }, moments);
  day.counts = countsOf(day.units);
  day.people = peopleOf(data.assignable || [], (data.who && data.who.people) || [], day.units, []);
  return day;
}

// Un autre jour, depuis la semaine mgr.planning qui le contient. Annules jamais montres.
export function buildAhead(week, date) {
  const jobs = ((week && week.jobs) || []).filter((j) => j.date === date && !j.cancelled);
  const units = jobs.map((j) => unitOf(null, j, date, false, []));
  const moments = [
    momentOf('same', 'Guest arrives the same day', 'day', units.filter((u) => u.next && u.next.sameDay)),
    momentOf('later', 'Next guest later', 'any', units.filter((u) => !(u.next && u.next.sameDay))),
  ];
  const day = finish({ date, source: 'ahead', people: [], units: [], moments: [], counts: null }, moments);
  day.counts = countsOf(day.units);
  const team = (week && week.people) || [];
  const row = ((week && week.days) || []).find((d) => d.date === date);
  day.people = peopleOf(team.filter((p) => p.assignable), team, day.units, (row && row.off) || []);
  return day;
}

// Menages sans cleaner d'un jour de la semaine (bande des jours) : ni annules, ni faits,
// ni attendus chez Elite.
export function countNone(week, date) {
  return ((week && week.jobs) || []).filter((j) => j.date === date && !j.cancelled && j.state !== 'done'
    && !(j.assigned || []).length && j.word !== ELITE_WORD).length;
}

// Moments affiches pour un filtre : null (tout), 'none' (sans cleaner) ou l'id d'une personne.
export function visible(day, filter) {
  if (filter == null) return day.moments;
  const byId = {};
  for (const u of day.units) byId[u.id] = u;
  const out = [];
  for (const m of day.moments) {
    const ids = m.unitIds.filter((id) => matches(byId[id], filter));
    if (ids.length) out.push({ id: m.id, label: m.label, tint: m.tint, unitIds: ids, tally: tallyOf(ids.map((id) => byId[id])) });
  }
  return out;
}

// Prochain logement sans cleaner apres afterId dans l'ordre affiche (filtre compris), en
// repartant du debut ; afterId peut avoir quitte la liste filtree (il vient d'etre affecte) :
// sa place se lit dans la liste complete. null s'il n'y en a plus.
export function nextNone(day, afterId, filter) {
  const byId = {};
  for (const u of day.units) byId[u.id] = u;
  const order = [];
  for (const m of day.moments) order.push(...m.unitIds);
  const i = afterId == null ? -1 : order.indexOf(afterId);
  const ring = order.slice(i + 1).concat(order.slice(0, Math.max(i, 0)));
  for (const id of ring) if (isNone(byId[id]) && matches(byId[id], filter)) return id;
  return null;
}

// Phrase du jour (gabarits de renderHead dans la page de test). opts.today (true par defaut) :
// le jour des donnees est celui de l'horloge ; sinon (apres minuit) « on Friday » au lieu de
// « today », d'apres day.date.
export function sentence(day, opts) {
  const c = day.counts;
  const when = opts && opts.today === false ? 'on ' + longDay(day.date) : 'today';
  const isAre = (n) => n + (n === 1 ? ' is' : ' are');
  if (day.source !== 'today') {
    if (!c.cleanings) return 'No cleaning planned.';
    const n0 = c.none + c.elite;
    const same = day.units.filter((u) => u.next && u.next.sameDay).length;
    return plural(c.cleanings, 'cleaning', 'cleanings') + '. '
      + (n0 ? n0 + (n0 === 1 ? ' has' : ' have') + ' no cleaner yet.' : 'All have a cleaner.')
      + (same ? ' ' + plural(same, 'guest arrives', 'guests arrive') + ' the same day.' : '');
  }
  const guests = c.arrivals
    ? plural(c.arrivals, 'guest arrives', 'guests arrive') + ' ' + when + '. ' + c.ready + (c.ready === 1 ? ' apartment is' : ' apartments are') + ' ready'
      + (c.scheduled ? ', ' + isAre(c.scheduled) + ' scheduled' : '') + (c.risk ? ', ' + isAre(c.risk) + ' at risk' : '')
      + (c.blocked ? ', ' + isAre(c.blocked) + ' blocked' : '') + '.'
    : 'No guest arrives ' + when + '.';
  const cleanings = c.cleanings
    ? plural(c.cleanings, 'cleaning', 'cleanings') + (c.none ? ', ' + c.none + ' with no cleaner' : '')
      + (c.elite ? ', ' + c.elite + ' expected with Elite' : '') + (!c.none && !c.elite ? ', all with a cleaner' : '') + '.'
    : 'No cleaning planned.';
  return guests + ' ' + cleanings;
}

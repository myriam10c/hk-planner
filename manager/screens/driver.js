// Planning du chauffeur (28/10/2026, demande de Hillal) : la veille, le manager envoie au
// chauffeur externe, par WhatsApp et lui-meme, la tournee du lendemain. Le chauffeur prend
// l'equipe et le linge propre au bureau, depose chaque cleaner d'un appartement a l'autre,
// puis rentre au bureau avec le linge sale. Rien ne part automatiquement.
import { addDays, esc, I } from '/manager/ui/dom.js';
import { dayLong, dayShort } from '/manager/screens/planning-rules.js';

const live = (j) => !j.cancelled;

function where(j) {
  const apt = j.apt ? 'Apt ' + j.apt : '';
  return [apt, j.addr || j.bld].filter(Boolean).join(' · ');
}

function when(j) {
  if (j.checkout && !j.postponedFrom) return 'free from ' + j.checkout;
  if (j.extra && j.extra.cleaningTime) return 'at ' + j.extra.cleaningTime;
  return '';
}

// Tournee de chaque personne, dans l'ordre du planning (heure, puis appartement).
export function driverRoutes(d, date) {
  const names = {};
  for (const p of d.people || []) names[p.id] = p.name;
  const jobs = (d.jobs || []).filter((j) => j.date === date && live(j));
  const routes = new Map();
  for (const j of jobs) {
    for (const id of j.assigned) {
      if (!routes.has(id)) routes.set(id, { id, name: names[id] || 'Cleaner ' + id, stops: [] });
      const mates = j.assigned.filter((x) => x !== id).map((x) => names[x] || 'Cleaner ' + x);
      routes.get(id).stops.push({ job: j, mates });
    }
  }
  return {
    routes: [...routes.values()],
    unassigned: jobs.filter((j) => !j.assigned.length),
    total: jobs.filter((j) => j.assigned.length).length,
  };
}

export function driverText(d, date) {
  const { routes, total } = driverRoutes(d, date);
  const out = ['🚐 *DRIVER SCHEDULE · ' + dayShort(date) + '*'];
  if (!routes.length) return out.concat(['No cleaning assigned for this day.']).join('\n');
  out.push('Start: pick up the team and the clean linen at the office.');
  for (const r of routes) {
    out.push('', '*' + r.name + '*');
    r.stops.forEach((s, i) => {
      const bits = [where(s.job), when(s.job), s.mates.length ? 'with ' + s.mates.join(' and ') : ''].filter(Boolean);
      out.push((i + 1) + '. ' + bits.join(' · '));
    });
  }
  out.push('', 'End: pick up each cleaner at the last apartment and bring the dirty linen back to the office.');
  out.push(total + ' cleaning' + (total === 1 ? '' : 's') + ' · ' + routes.length + ' cleaner' + (routes.length === 1 ? '' : 's'));
  return out.join('\n');
}

// Jour propose : demain s'il est dans la semaine affichee, sinon le jour choisi.
export function driverDefaultDay(d, today, day) {
  const tomorrow = addDays(today, 1);
  return (d.days || []).some((x) => x.date === tomorrow) ? tomorrow : (day || (d.days[0] && d.days[0].date));
}

export function driverSheet(d, date) {
  const { unassigned } = driverRoutes(d, date);
  const days = (d.days || []).map((x) => '<button type="button" class="chip" data-pa="driver-day" data-date="' + esc(x.date) + '" aria-pressed="'
    + (x.date === date ? 'true' : 'false') + '">' + esc(dayShort(x.date)) + '</button>').join('');
  const warn = unassigned.length
    ? '<p class="sheet-warn" role="note">' + unassigned.length + ' cleaning' + (unassigned.length === 1 ? '' : 's') + ' not assigned yet, not in the message: '
      + esc(unassigned.map(where).join(', ')) + '.</p>'
    : '';
  return '<div class="sheet-h"><div><h2 id="sheetTitle">Driver schedule</h2><div class="sub">' + esc(dayLong(date)) + ' · send it on WhatsApp</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>'
    + '<div class="sheet-b"><div class="chiprow drv-days" role="group" aria-label="Day">' + days + '</div>' + warn
    + '<pre class="drv-text" id="drvText">' + esc(driverText(d, date)) + '</pre></div>'
    + '<div class="sheet-f"><button class="btn primary" type="button" data-pa="driver-share">Share on WhatsApp</button>'
    + '<button class="btn" type="button" data-pa="driver-copy">Copy</button>'
    + '<button class="btn" type="button" data-close>Close</button></div>';
}

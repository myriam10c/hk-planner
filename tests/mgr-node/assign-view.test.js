// Vue pure de l'ecran Assign (lot 4b, tache 3) : manager/screens/assign-view.js.
// vm a la forme des fonctions de la tache 2 (stripDays, peopleOn, buildRows) ; jeux
// d'essai inventes, aucun vrai nom de guest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignHtml } from '../../manager/screens/assign-view.js';

const WED = '2026-11-25';
const THU = '2026-11-26';

const STRIP = [
  { date: WED, label: 'Wed', num: 25, count: 14 },
  { date: THU, label: 'Thu', num: 26, count: null },
  { date: '2026-11-27', label: 'Fri', num: 27, count: 0 },
];
const PEOPLE = [
  { id: 10, name: 'Annet', ini: 'A', slot: 'p1', off: false, load: 2 },
  { id: 4, name: 'Faiza', ini: 'F', slot: 'p2', off: false, load: 1 },
  { id: 3, name: 'Pionah', ini: 'P', slot: 'p3', off: true, load: 0 },
  { id: 12, name: 'Elite Cleaning', ini: 'EC', slot: 'sub', off: false, load: 0 },
];
const ROW = (o) => ({ key: '2026-11-25_Ann Lee', place: 'Apt 1602 · The Grand Emaar', line: 'Out 11:00 · Guest arrives 15:00',
  ids: [], serviceType: null, group: 'todo', ...o });
const ROWS = {
  todo: [ROW({}), ROW({ key: '2026-11-25_Bo Ray', place: 'Apt 308 · Binghatti Lavender', line: 'Out time not set · No next guest' })],
  assigned: [ROW({ key: '2026-11-25_Di Fox', place: 'Apt 805 · Azizi Riviera 39', ids: [10, 4], serviceType: 'CHC', group: 'assigned' })],
  elite: [
    ROW({ key: '2026-11-25_Cy Doe', place: 'Apt 909 · Bloom Height', group: 'elite' }),
    ROW({ key: '2026-11-25_Ed Gu', place: 'Apt 404 · Elysee 1', group: 'elite' }),
  ],
};
const VM = (o) => ({ strip: STRIP, sel: WED, people: PEOPLE, rows: ROWS, eliteOpen: false, busy: new Set(), ro: {}, empty: false, ...o });

// Balise ouvrante qui porte attr (ex. 'data-qa-day="2026-11-25"'), sinon null.
function openTag(html, attr) {
  const i = html.indexOf(attr);
  if (i < 0) return null;
  return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1);
}
// Toutes les balises ouvrantes d'un element qui a la classe cls.
function tagsWithClass(html, cls) {
  return [...html.matchAll(/<[a-z0-9]+\b[^>]*>/g)].map((m) => m[0])
    .filter((t) => { const c = /class="([^"]*)"/.exec(t); return c && c[1].split(/\s+/).includes(cls); });
}
// Texte (sans balises) de chaque element <tag class="... cls ...">...</tag> non imbrique.
function texts(html, tag, cls) {
  const re = new RegExp('<' + tag + '\\b[^>]*class="(?:[^"]*\\s)?' + cls + '(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</' + tag + '>', 'g');
  return [...html.matchAll(re)].map((m) => m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag || ''); return m ? m[1] : null; };

test('heading and back link', () => {
  const h = assignHtml(VM());
  assert.ok(h.includes('<h1>Assign</h1>'));
  assert.ok(h.includes('Tap a name to give the cleaning. Tap it again to take it back.'));
  assert.ok(h.includes('<a class="qa-back" href="#/today">Today</a>'));
});

test('strip labels with and without count', () => {
  const h = assignHtml(VM());
  const wed = openTag(h, 'data-qa-day="' + WED + '"');
  assert.ok(wed.startsWith('<button'));
  assert.ok(attr(wed, 'class').split(' ').includes('qa-day'));
  assert.equal(attr(wed, 'aria-pressed'), 'true');
  assert.equal(attr(wed, 'aria-label'), 'Wed 25, 14 with no cleaner');
  const thu = openTag(h, 'data-qa-day="' + THU + '"');
  assert.equal(attr(thu, 'aria-pressed'), 'false');
  assert.equal(attr(thu, 'aria-label'), 'Thu 26');
  assert.equal(attr(openTag(h, 'data-qa-day="2026-11-27"'), 'aria-label'), 'Fri 27, 0 with no cleaner');
  assert.equal(tagsWithClass(h, 'qa-day').length, 3);
});

test('load chips 2 jobs, 1 job, Off', () => {
  const chips = texts(assignHtml(VM()), 'li', 'qa-load');
  assert.deepEqual(chips, ['A Annet 2 jobs', 'F Faiza 1 job', 'P Pionah Off', 'EC Elite Cleaning 0 jobs']);
  // Le disque est decoratif : le nom est ecrit a cote.
  const disc = tagsWithClass(assignHtml(VM()), 'qa-disc')[0];
  assert.equal(attr(disc, 'aria-hidden'), 'true');
  assert.ok(attr(disc, 'class').split(' ').includes('qa-p1'));
});

test('elite group collapsed shows count only', () => {
  const h = assignHtml(VM());
  assert.deepEqual(texts(h, 'h2', 'qa-gh').slice(0, 2), ['No cleaner yet (2)', 'Already assigned (1)']);
  const tog = openTag(h, 'data-qa-elite');
  assert.ok(tog.startsWith('<button'));
  assert.equal(attr(tog, 'aria-expanded'), 'false');
  assert.deepEqual(texts(h, 'button', 'qa-elite'), ['Usually Elite (2)']);
  assert.equal(h.includes('data-qa-row="2026-11-25_Cy Doe"'), false);
  assert.equal(tagsWithClass(h, 'qa-row').length, 3);

  const open = assignHtml(VM({ eliteOpen: true }));
  assert.equal(attr(openTag(open, 'data-qa-elite'), 'aria-expanded'), 'true');
  assert.ok(open.includes('data-qa-row="2026-11-25_Cy Doe"'));
  assert.ok(open.includes('data-qa-row="2026-11-25_Ed Gu"'));
  assert.equal(tagsWithClass(open, 'qa-row').length, 5);

  // Groupe vide : ni titre ni bouton.
  const none = assignHtml(VM({ rows: { todo: ROWS.todo, assigned: [], elite: [] } }));
  assert.deepEqual(texts(none, 'h2', 'qa-gh'), ['No cleaner yet (2)']);
  assert.equal(none.includes('data-qa-elite'), false);
});

test('person button pressed and labels', () => {
  const h = assignHtml(VM({ busy: new Set(['2026-11-25_Di Fox']), people: PEOPLE.concat({ id: 20, name: 'New Hire', ini: 'NH', slot: undefined, off: false, load: 0 }) }));
  const row = openTag(h, 'data-qa-row="2026-11-25_Di Fox"');
  assert.ok(attr(row, 'class').split(' ').includes('qa-row'));
  assert.equal(attr(row, 'aria-busy'), 'true');
  assert.equal(attr(openTag(h, 'data-qa-row="2026-11-25_Ann Lee"'), 'aria-busy'), null);
  assert.deepEqual(texts(h, 'span', 'qa-place').slice(0, 2), ['Apt 1602 · The Grand Emaar', 'Apt 308 · Binghatti Lavender']);
  assert.deepEqual(texts(h, 'span', 'qa-line').slice(0, 2), ['Out 11:00 · Guest arrives 15:00', 'Out time not set · No next guest']);

  const btns = tagsWithClass(h, 'qa-p').filter((t) => attr(t, 'data-qa-key') === '2026-11-25_Di Fox');
  assert.equal(btns.length, 5);
  const [annet, faiza, , elite, other] = btns;
  assert.ok(annet.startsWith('<button'));
  assert.deepEqual(attr(annet, 'class').split(' '), ['qa-p', 'qa-p1']);
  assert.equal(attr(annet, 'data-qa-id'), '10');
  assert.equal(attr(annet, 'aria-pressed'), 'true');
  assert.equal(attr(annet, 'aria-label'), 'Annet, Apt 805 · Azizi Riviera 39');
  assert.equal(attr(annet, 'aria-disabled'), null);
  assert.equal(attr(faiza, 'aria-pressed'), 'true');
  assert.equal(attr(elite, 'aria-pressed'), 'false');
  assert.deepEqual(attr(elite, 'class').split(' '), ['qa-p', 'qa-sub']);
  assert.equal(attr(elite, 'aria-label'), 'Elite Cleaning, Apt 805 · Azizi Riviera 39');
  assert.deepEqual(attr(other, 'class').split(' '), ['qa-p', 'qa-other']);
  // Texte du bouton : les initiales.
  assert.deepEqual(texts(h, 'button', 'qa-p').slice(0, 5), ['A', 'F', 'P', 'EC', 'NH']);
});

test('off person aria-disabled', () => {
  const h = assignHtml(VM());
  const off = tagsWithClass(h, 'qa-p').filter((t) => attr(t, 'data-qa-id') === '3');
  assert.equal(off.length, 3);
  for (const t of off) {
    assert.deepEqual(attr(t, 'class').split(' '), ['qa-p', 'qa-p3', 'qa-off']);
    assert.equal(attr(t, 'aria-disabled'), 'true');
    assert.equal(attr(t, 'aria-label'), 'Pionah, off on Wed 25');
  }
  const on = tagsWithClass(h, 'qa-p').filter((t) => attr(t, 'data-qa-id') !== '3');
  assert.ok(on.every((t) => attr(t, 'aria-disabled') === null));
});

test('read-only line and retry', () => {
  const plain = assignHtml(VM({ ro: { [THU]: true } }));
  assert.equal(plain.includes('Reconnect to make changes.'), false);
  assert.equal(plain.includes('data-qa-retry'), false);

  const h = assignHtml(VM({ ro: { [WED]: true } }));
  assert.ok(h.includes('Reconnect to make changes.'));
  const retry = openTag(h, 'data-qa-retry');
  assert.ok(retry.startsWith('<button'));
  assert.equal(attr(retry, 'type'), 'button');
  assert.ok(/data-qa-retry[^>]*>Retry<\/button>/.test(h));
  const btns = tagsWithClass(h, 'qa-p');
  assert.equal(btns.length, 12);
  assert.ok(btns.every((t) => attr(t, 'aria-disabled') === 'true'));
  // Le nom accessible d'une personne disponible ne change pas en lecture seule.
  assert.equal(attr(btns[0], 'aria-label'), 'Annet, Apt 1602 · The Grand Emaar');
});

test('empty day line', () => {
  const h = assignHtml(VM({ empty: true, rows: { todo: [], assigned: [], elite: [] } }));
  assert.ok(h.includes('No cleaning planned for Wed 25.'));
  assert.equal(tagsWithClass(h, 'qa-row').length, 0);
  assert.equal(tagsWithClass(h, 'qa-gh').length, 0);
  assert.equal(assignHtml(VM()).includes('No cleaning planned'), false);
});

test('nothing left line when every cleaning is done', () => {
  const NONE = { todo: [], assigned: [], elite: [] };
  const h = assignHtml(VM({ rows: NONE, nothingLeft: true }));
  assert.deepEqual(texts(h, 'p', 'qa-empty'), ['Nothing left to assign on Wed 25.']);
  assert.equal(h.includes('No cleaning planned'), false);
  // La charge du jour reste : les menages faits comptent.
  assert.equal(texts(h, 'li', 'qa-load').length, 4);
  assert.equal(tagsWithClass(h, 'qa-row').length, 0);
  // empty l'emporte : un jour sans menage non annule.
  const empty = assignHtml(VM({ rows: NONE, nothingLeft: true, empty: true }));
  assert.deepEqual(texts(empty, 'p', 'qa-empty'), ['No cleaning planned for Wed 25.']);
  assert.equal(texts(empty, 'li', 'qa-load').length, 0);
  assert.equal(assignHtml(VM()).includes('Nothing left to assign'), false);
});

test('escapes building names', () => {
  const evil = ROW({ key: '2026-11-25_O"Neil <x>', place: 'Apt 7 · Tower <b>A</b> & "Sons"', line: "Out 11:00 · It's <i>late</i>" });
  const h = assignHtml(VM({
    rows: { todo: [evil], assigned: [], elite: [] },
    people: [{ id: 10, name: 'Ann<e>t "A"', ini: '<A', slot: 'p1" onclick="x', off: false, load: 1 }],
  }));
  assert.equal(/<b>|<i>|<e>|<x>|onclick="/.test(h), false);
  assert.ok(h.includes('Apt 7 · Tower &lt;b&gt;A&lt;/b&gt; &amp; &quot;Sons&quot;'));
  assert.ok(h.includes('Out 11:00 · It&#39;s &lt;i&gt;late&lt;/i&gt;'));
  assert.ok(h.includes('data-qa-row="2026-11-25_O&quot;Neil &lt;x&gt;"'));
  assert.ok(h.includes('aria-label="Ann&lt;e&gt;t &quot;A&quot;, Apt 7 · Tower &lt;b&gt;A&lt;/b&gt; &amp; &quot;Sons&quot;"'));
  assert.ok(h.includes('>&lt;A</button>'));
  // Une valeur de slot inconnue retombe sur other : rien d'injecte dans class.
  assert.ok(tagsWithClass(h, 'qa-p').every((t) => attr(t, 'class') === 'qa-p qa-other'));
});

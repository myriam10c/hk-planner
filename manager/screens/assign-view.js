// Ecran Assign (lot 4b, spec-quick-assign section 3) : HTML pur, teste sous node. Une ligne
// par menage, une initiale par personne affectable ; un toucher affecte ou retire (assign.js).
// vm = { strip, sel, people, rows: {todo, assigned, elite}, eliteOpen, busy: Set<cle>,
// ro: { [date]: boolean }, empty } ; strip, people et rows viennent de assign-model.js.
// Aucun import : node doit charger ce fichier (les modules du manager importent des chemins
// absolus). Classes qa- seulement, styles dans manager/ui/assign.css.

// Copie locale de esc (manager/ui/dom.js).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const plural = (n, one) => n + ' ' + (n === 1 ? one : one + 's');
// Couleur d'une personne : slot du proxy (p1 a p4, sub), sinon other.
const slotOf = (p) => (/^(p[1-4]|sub)$/.test(p.slot) ? p.slot : 'other');
// « Wed 25 » : le jour choisi tel que la bande l'ecrit.
function dayOf(vm) {
  const s = vm.strip.find((d) => d.date === vm.sel);
  return s ? s.label + ' ' + s.num : vm.sel;
}

const RO_LINE = 'Reconnect to make changes.';
const CHEV = '<svg class="qa-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';

function head() {
  return '<header class="qa-head"><a class="qa-back" href="#/today">Today</a><h1>Assign</h1>'
    + '<p class="qa-lede">Tap a name to give the cleaning. Tap it again to take it back.</p></header>';
}

// Bande des 7 jours, meme compte que Today ; count null tant que la semaine n'est pas lue.
function week(vm) {
  return '<nav class="qa-week" aria-label="Next seven days">' + vm.strip.map((s) => {
    const known = s.count != null;
    return '<button class="qa-day" type="button" data-qa-day="' + esc(s.date) + '" aria-pressed="' + (s.date === vm.sel ? 'true' : 'false')
      + '" aria-label="' + esc(s.label + ' ' + s.num + (known ? ', ' + s.count + ' with no cleaner' : '')) + '">'
      + '<span class="qa-dl">' + esc(s.label) + '</span><span class="qa-dn">' + esc(s.num) + '</span>'
      + '<span class="qa-dc' + (known && s.count ? '' : ' qa-zero') + '">' + (known ? esc(s.count) : '·') + '</span></button>';
  }).join('') + '</nav><p class="qa-weeknote">Under each day: cleanings with no cleaner yet.</p>';
}

function roBox() {
  return '<div class="qa-ro"><p class="qa-rol" role="status">' + RO_LINE + '</p>'
    + '<button class="qa-btn" type="button" data-qa-retry>Retry</button></div>';
}

// Charge du jour : une pastille par personne, le disque est decoratif (le nom est ecrit).
function loads(vm, day) {
  if (!vm.people.length) return '';
  return '<ul class="qa-loads" aria-label="' + esc('Jobs on ' + day) + '">' + vm.people.map((p) =>
    '<li class="qa-load' + (p.off ? ' qa-off' : '') + '"><span class="qa-disc qa-' + slotOf(p) + '" aria-hidden="true">' + esc(p.ini) + '</span> '
    + '<span class="qa-ln">' + esc(p.name) + '</span> <span class="qa-lc">' + (p.off ? 'Off' : plural(p.load, 'job')) + '</span></li>').join('') + '</ul>';
}

// Une initiale par personne : aria-pressed quand elle est sur le menage ; refusee (aria-disabled)
// quand elle est off ce jour-la ou en lecture seule. Le controleur ignore un toucher refuse.
function personBtn(row, p, day, ro) {
  const on = row.ids.map(Number).includes(Number(p.id));
  return '<button class="qa-p qa-' + slotOf(p) + (p.off ? ' qa-off' : '') + '" type="button" data-qa-key="' + esc(row.key) + '" data-qa-id="' + esc(p.id)
    + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(p.name + ', ' + (p.off ? 'off on ' + day : row.place)) + '"'
    + (p.off || ro ? ' aria-disabled="true"' : '') + '>' + esc(p.ini) + '</button>';
}
function rowHtml(row, vm, day, ro) {
  return '<li class="qa-row" data-qa-row="' + esc(row.key) + '"' + (vm.busy && vm.busy.has(row.key) ? ' aria-busy="true"' : '') + '>'
    + '<div class="qa-what"><span class="qa-place">' + esc(row.place) + '</span><span class="qa-line">' + esc(row.line) + '</span></div>'
    + '<div class="qa-ps">' + vm.people.map((p) => personBtn(row, p, day, ro)).join('') + '</div></li>';
}
const rowList = (rows, vm, day, ro, id) => '<ul class="qa-rows"' + (id ? ' id="' + id + '"' : '') + '>'
  + rows.map((r) => rowHtml(r, vm, day, ro)).join('') + '</ul>';

// Trois groupes dans l'ordre ; un groupe vide n'est pas montre. Usually Elite : replie au
// depart, son bouton donne le compte, ses lignes ne sont rendues qu'ouvert.
function groups(vm, day, ro) {
  const { todo, assigned, elite } = vm.rows;
  let h = '';
  if (todo.length) h += '<section class="qa-group"><h2 class="qa-gh">No cleaner yet (' + todo.length + ')</h2>' + rowList(todo, vm, day, ro) + '</section>';
  if (assigned.length) h += '<section class="qa-group"><h2 class="qa-gh">Already assigned (' + assigned.length + ')</h2>' + rowList(assigned, vm, day, ro) + '</section>';
  if (elite.length) {
    const open = !!vm.eliteOpen;
    h += '<section class="qa-group"><h2 class="qa-gh"><button class="qa-elite" type="button" data-qa-elite aria-expanded="' + (open ? 'true' : 'false') + '"'
      + (open ? ' aria-controls="qa-elite-rows"' : '') + '>Usually Elite (' + elite.length + ')' + CHEV + '</button></h2>'
      + (open ? rowList(elite, vm, day, ro, 'qa-elite-rows') : '') + '</section>';
  }
  return h;
}

export function assignHtml(vm) {
  const day = dayOf(vm);
  const ro = !!(vm.ro && vm.ro[vm.sel]);
  return '<div class="qa">' + head() + week(vm) + (ro ? roBox() : '')
    + (vm.empty ? '<p class="qa-empty">' + esc('No cleaning planned for ' + day + '.') + '</p>' : loads(vm, day) + groups(vm, day, ro))
    + '</div>';
}

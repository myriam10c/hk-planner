// Date de rectification programmee (zone envoyee en maintenance) : champs du formulaire et affichage.
// Le serveur valide (jour valide, pas dans le passe, creneau <= 40 caracteres) et calcule le retard.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function todayDubai() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Dubai' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day;
}

// "12 Oct" ou "12 Oct, morning".
export function fixText(date, slot) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return Number(date.slice(8, 10)) + ' ' + MON[Number(date.slice(5, 7)) - 1] + (slot ? ', ' + slot : '');
}

// Champs date + creneau. data-f / data-z suivent la convention de l'ecran d'inspection.
export function fixFields(esc, key, date, slot) {
  return '<div class="fixsched"><label class="lbl" for="fixd-' + esc(key) + '">Fix scheduled for (optional)</label>'
    + '<div class="fixrow"><input type="date" id="fixd-' + esc(key) + '" class="inp" data-f="fixDate" data-z="' + esc(key) + '" min="' + todayDubai() + '" value="' + esc(date || '') + '">'
    + '<input type="text" id="fixs-' + esc(key) + '" class="inp" data-f="fixSlot" data-z="' + esc(key) + '" maxlength="40" autocomplete="off"'
    + ' placeholder="Time, e.g. morning or 2 pm" aria-label="Time (optional)" value="' + esc(slot || '') + '"></div></div>';
}

// Ligne d'affichage : "Fix scheduled: 12 Oct, morning" + badge Overdue.
export function fixBadge(esc, it) {
  if (!it || !it.fixScheduledFor) return '';
  return '<span class="badge fix">Fix scheduled: ' + esc(fixText(it.fixScheduledFor, it.fixScheduledSlot)) + '</span>'
    + (it.fixOverdue ? '<span class="badge bad overdue">Overdue</span>' : '');
}

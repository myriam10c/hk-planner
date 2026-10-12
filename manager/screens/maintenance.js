// Ecran Maintenance (propositions, tickets ouverts, tickets faits). Provisoire :
// en-tete seul, l'ecran complet arrive avec la tache 4 de la phase 2.
import { I } from '/manager/ui/dom.js';

export async function renderMaintenance(ctx) {
  ctx.main.innerHTML = '<header class="top"><div><h1>Maintenance</h1></div>'
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></header>'
    + '<p class="boot" role="status">Loading…</p>';
}

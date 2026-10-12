// Ecrans des phases suivantes : en attendant, un lien vers l'ecran actuel.
import { esc } from '/manager/ui/dom.js';

const P = {
  today: { title: 'Today', text: 'Today could not be loaded.', href: '#/today', cta: 'Try again' },
  planning: { title: 'Planning', text: 'The week grid comes in a later phase. Until then, plan cleanings in the current app.', href: '/?legacy=1', cta: 'Open planning in the current app' },
  maintenance: { title: 'Maintenance', text: 'Maintenance could not be loaded.', href: '/?legacy=1', cta: 'Open maintenance in the current app' },
  tasks: { title: 'Tasks', text: 'Tasks could not be loaded.', href: '/?legacy=1', cta: 'Open the current app' },
  inspections: { title: 'Inspections', text: 'Inspections move into this app in a later phase.', href: '/inspections/', cta: 'Open Inspections' },
};

export function renderPlaceholder(ctx, view) {
  const p = P[view] || P.today;
  ctx.main.innerHTML = '<header class="top"><div><h1>' + esc(p.title) + '</h1></div></header>'
    + '<div class="ph"><p>' + esc(p.text) + '</p><a class="btn primary" href="' + esc(p.href) + '">' + esc(p.cta) + '</a></div>';
}

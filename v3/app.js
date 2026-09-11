// Application cleaner v3. Modules ES natifs, aucun bundler : le site Netlify
// publie la racine sans etape de build.
import { readSession } from '/v3/api.js';
import { icon } from '/v3/ui.js';

function renderGate() {
  document.getElementById('app').innerHTML =
    '<div class="gate">' +
      '<h1>HK Planner</h1>' +
      '<p class="muted">Sign in on HK Planner to see your day.</p>' +
      '<a href="/#cleaner">Sign in</a>' +
    '</div>';
}

export function boot() {
  if (!readSession()) {
    renderGate();
    return false;
  }
  // Remplace par le routeur a la tache 9. Le repere visuel sert deja au pilote :
  // une session valide n'affiche jamais l'ecran de connexion.
  document.getElementById('app').innerHTML =
    '<div class="gate">' + icon('clock', 28) + '<h1>HK Planner</h1>' +
    '<p class="muted">Loading your day.</p></div>';
  return true;
}

boot();
// Repere de fin de boot pour les tests : rien d'autre ne le pose.
window.__v3ready = true;

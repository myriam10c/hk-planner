// Types de problème, urgence par défaut (jamais demandée à la cleaner), fabrique d'un problème.
export const SAFETY_GAS = "Open the windows. Do not touch switches. Leave and call your manager on duty.";

// Ordre de la grille 5 × 2 : la sécurité d'abord.
export const KINDS = [
  { key: "Gas smell", icon: "gas", always: "urgent", safety: SAFETY_GAS, subs: null },
  { key: "Leak", icon: "water", subs: ["Toilet", "Sink", "Shower", "Ceiling", "Under the AC"] },
  { key: "AC", icon: "ac", subs: ["Not cooling", "Noisy", "Water dripping", "Remote"] },
  { key: "Power", icon: "light", subs: ["Light", "Socket", "No power"] },
  { key: "Insects", icon: "bug", subs: ["Cockroaches", "Ants", "Flies", "Bed bugs"] },
  { key: "Missing", icon: "box", subs: ["Towel", "TV remote", "Kettle", "Hair dryer", "Vacuum charger", "Mop", "Bed sheet"] },
  { key: "Broken", icon: "broken", subs: ["Sofa", "Table or chair", "Door", "Wall or paint", "Glass or mirror", "Appliance"] },
  { key: "Stain", icon: "spray", subs: ["Sofa", "Carpet", "Mattress", "Curtains"] },
  { key: "Very dirty", icon: "trash", subs: ["Lots of trash", "Smoke smell", "After a party", "Pet hair"] },
  { key: "Guest forgot", icon: "bag", subs: ["Clothes", "Charger", "Documents", "Jewelry or watch"] },
];

// Type imposé par la question des murs (étape 2), hors de la grille des tuiles et sans sous-types.
export const WALL_KIND = "Wall damage";

export const URGENCY = {
  urgent: { dot: "🔴", label: "Urgent" },
  soon: { dot: "🟠", label: "Soon" },
  later: { dot: "⚪", label: "Not urgent" },
};

// Révision du 05/10 : Soon par défaut, Urgent seulement pour Gas smell et Can't get in.
// Le délai avant le prochain voyageur n'entre plus en compte (modifiable en un geste sur la page du problème).
export function autoUrgency(kind) {
  if (kind === "Can't get in") return "urgent";
  const k = KINDS.find(x => x.key === kind);
  return k && k.always ? k.always : "soon";
}

export function makeProblem({ kind, where, photos = [], hoursAway = null, at, ref }) {
  const urgency = autoUrgency(kind); // hoursAway gardé dans la signature, sans effet depuis le 05/10
  // note : texte tapé ou dicté au clavier du téléphone, ou null (pas de note vocale depuis le 05/10).
  return { kind, detail: null, note: null, where, photos, urgency, notified: urgency === "urgent", at, ref };
}

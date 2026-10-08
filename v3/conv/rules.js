// Constantes metier de la conversation (data.js du prototype, sans les appartements
// de demo : la journee reelle vient de v3.myDay, voir day.js).
export const GROUP_NAME = "Medini Homes Housekeeping";

export const SUPPLIES = ["Toilet paper", "Shampoo & soap", "Coffee & tea", "Water bottles", "Trash bags", "Dish soap"];

// Valeurs les plus frequentes de laundry_counts (60 derniers jours) ; cles = colonnes de la base.
export const LINEN_USUAL = [
  { key: "pillowcases", one: "pillowcase", many: "pillowcases", n: 4 },
  { key: "bed_sheets", one: "bed sheet", many: "bed sheets", n: 1 },
  { key: "duvet_covers", one: "duvet cover", many: "duvet covers", n: 1 },
  { key: "large_towels", one: "bath towel", many: "bath towels", n: 3 },
  { key: "small_towels", one: "hand towel", many: "hand towels", n: 0 },
  { key: "face_towels", one: "face towel", many: "face towels", n: 0 },
  { key: "bath_mats", one: "bath mat", many: "bath mats", n: 1 },
];

// Verifications avant de partir : le gaz d'abord. La ligne AC prend son libelle de acInstruction()
// au debut du menage. `ko` : second bouton « not working » qui enregistre un probleme Soon.
// `reported` : types deja signales pendant le menage qui pre-reglent la ligne sur « not working » (spec §11).
export const LEAVE_CHECKS = [
  { key: "gas", label: "Gas works, now off", ko: "Gas not working", reported: ["Gas smell", "Gas not working"] },
  { key: "ac", label: null, ko: "AC not working", reported: ["AC", "AC not working"] },
  { key: "wifi", label: "Wi-Fi works", ko: "Wi-Fi not working" },
  { key: "lights", label: "Lights off" },
  { key: "windows", label: "Windows & balcony closed" },
  { key: "trash", label: "Trash taken out" },
  { key: "door", label: "Door locked, keys & card left inside" },
];

// Consigne de Hillal : AC eteinte l'hiver, allumee en mode auto l'ete (avril a octobre a Dubai).
export const SUMMER_MONTHS = [3, 4, 5, 6, 7, 8, 9];
export function acInstruction(date) {
  return SUMMER_MONTHS.includes(date.getMonth()) ? "AC on, Auto mode" : "AC off";
}

// Libelle d'un appartement : numero + immeuble, sans espace orphelin.
export function aptLabel(a) {
  return [a.num, a.building].filter(Boolean).join(" ");
}

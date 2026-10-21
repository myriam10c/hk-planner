// Regles pures des relances automatiques par push (plan 2026-10-20-hk-reminders).
// Aucune base, aucun reseau, aucun Deno.env : reminders.ts charge le snapshot,
// appelle evaluate puis applyLimits, envoie et journalise dans reminder_log.

export const REM_RULES = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"] as const;
export type RemRule = typeof REM_RULES[number];
// r5 n'envoie rien : c'est le facteur guest applique aux delais des autres regles.
export const REM_TEXT_RULES = ["r1", "r2", "r3", "r4", "r6", "r7", "r8", "r9", "r10"] as const;
type TextRule = typeof REM_TEXT_RULES[number];

const DELAY_KEYS = [
  "urgentUnassignedMin", "unassignedNoDueMin", "assignedFirstMin", "assignedSecondMin",
  "inProgressStaleMin", "proposalPendingMin", "cleaningLateMin",
] as const;
type DelayKey = typeof DELAY_KEYS[number];

export type RemConfig = {
  enabled: boolean;
  rules: Record<RemRule, boolean>;
  urgentUnassignedMin: number;
  unassignedNoDueMin: number;
  assignedFirstMin: number;
  // Compte depuis l'envoi reel du premier rappel (pas depuis l'assignation).
  assignedSecondMin: number;
  inProgressStaleMin: number;
  proposalPendingMin: number;
  guestFactor: number;
  quiet: { start: string; end: string };
  tomorrowCheckAt: string;
  cleaningLateMin: number;
  cleaningDefaultTime: string;
  maxPerSubjectPerDay: number;
  minGapMin: number;
  escalateAfter: number;
  // Minutes apres le dernier rappel compte avant d'escalader (laisse le temps d'agir).
  escalateGraceMin: number;
  // Au-dela de N relances pour une meme personne dans un passage, une seule notification
  // recapitulative (urgentes et ordinaires groupees a part) : evite la rafale.
  digestOver: number;
  // null = managers actifs sauf le compte assistant IA, resolus par l'appelant (snapshot.managers).
  managerIds: number[] | null;
  texts: Record<TextRule, string>;
};

export const REM_DEFAULTS: RemConfig = {
  enabled: true,
  rules: { r1: true, r2: true, r3: true, r4: true, r5: true, r6: true, r7: true, r8: true, r9: true, r10: true },
  urgentUnassignedMin: 30,
  unassignedNoDueMin: 1440,
  assignedFirstMin: 120,
  assignedSecondMin: 240,
  inProgressStaleMin: 1440,
  proposalPendingMin: 1440,
  guestFactor: 0.5,
  quiet: { start: "21:00", end: "07:00" },
  tomorrowCheckAt: "09:15",
  cleaningLateMin: 120,
  cleaningDefaultTime: "11:00",
  maxPerSubjectPerDay: 3,
  minGapMin: 60,
  escalateAfter: 2,
  escalateGraceMin: 60,
  digestOver: 3,
  managerIds: null,
  texts: {
    r1: "Urgent ticket with no one assigned: {title}. Assign a technician now.",
    r2: "No one assigned and no due date: {title}. Assign someone or set a due date.",
    r3: "{title} is assigned to you and not started. Start it or update the ticket.",
    r4: "No update for {hours} h on {title}. Add an update or mark it done.",
    r6: "{title} is past its due date ({due}). {who}: fix it or set a new date.",
    r7: "{count} cleanings tomorrow have no one assigned: {list}. Assign them in Planning.",
    r8: "Cleaning at {apt} is not marked done. Finish it and mark it done in the app.",
    r9: "Proposal waiting for {hours} h: {title}. Accept, merge or reject it.",
    r10: "{who} got {count} reminders on {ref} with no action: {title}. Call {who} or reassign.",
  },
};

// --- Snapshot (lectures faites par reminders.ts) ----------------------------------

// Ticket ouvert (statuts MGR_OPEN_TICKET_STATUSES). assignedAt = derniere assignation
// (cleaning_log mnt_ticket.assign, ticket_events to_status='assigned'), a defaut
// last_update puis created_at. lastChangeAt = max(last_update, dernier changement de
// statut) : sert a l'escalade r10 ; absent = max(last_update, assignedAt, created_at).
export type RemTicket = {
  id: number;
  listing_id: string | number | null;
  title: string;
  priority: string | null;
  status: string;
  created_at: string;
  last_update: string | null;
  due_on: string | null;
  assigned_technician_id: number | null;
  assigned_vendor_id: number | null;
  assignedAt: string | null;
  lastChangeAt?: string | null;
  label: string; // « 305 Neva Residence »
};

// Proposition maintenance_proposals.status = 'pending'.
export type RemProposal = {
  id: number;
  listing_id: string | number | null;
  title: string;
  urgency: string | null;
  created_at: string;
  label: string;
};

// Menage du jour ou du lendemain (forme PlanJob reduite). time = heure prevue
// (cleaning_time de l'extra, sinon checkout Hostaway), null = cleaningDefaultTime.
export type RemCleaning = {
  key: string;
  date: string;
  listingId: string | number | null;
  label: string;
  assigned: Array<{ id: number; role: string }>;
  state: "done" | "in_progress" | "not_started";
  cancelled: boolean;
  time: string | null;
};

// Ligne de reminder_log (aujourd'hui + 2 jours). key est facultative : la table n'a
// pas de colonne key, la comparaison retombe alors sur regle + sujet.
export type RemHistoryRow = {
  rule: string;
  subject_kind: string;
  subject_id: string;
  cleaner_id: number | null;
  key?: string | null;
  title?: string | null;
  status: string;
  sent_at: string;
};

export type RemSnapshot = {
  today: string; // jour Dubai YYYY-MM-DD
  tickets: RemTicket[];
  proposals: RemProposal[];
  cleanings: RemCleaning[]; // aujourd'hui et demain
  guestOnSite: Set<string> | Record<string, boolean>; // par listing id (chaine)
  managers: number[]; // managers actifs resolus par l'appelant
  people: Record<string, { name: string; role: string }>;
  history: RemHistoryRow[];
};

export type Due = {
  rule: RemRule;
  subjectKind: "ticket" | "proposal" | "cleaning";
  subjectId: string;
  ref: string;
  recipients: number[];
  urgent: boolean;
  guestOnSite: boolean;
  title: string;
  body: string;
  url: string;
  key: string;
};

export type SkipReason = "quiet" | "capped" | "duplicate" | "disabled";

// --- Temps Dubai (UTC+4, sans heure d'ete) ----------------------------------------

const DUBAI_MS = 4 * 3_600_000;
const MIN_MS = 60_000;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function dubaiDay(ms: number): string {
  return new Date(ms + DUBAI_MS).toISOString().slice(0, 10);
}
function dubaiMinuteOfDay(ms: number): number {
  const d = new Date(ms + DUBAI_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function hhmmToMin(s: string): number {
  const m = HHMM_RE.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
// Instant UTC d'une heure Dubai d'un jour donne.
function dubaiAt(day: string, hhmm: string): number {
  return Date.parse(day + "T00:00:00Z") - DUBAI_MS + hhmmToMin(hhmm) * MIN_MS;
}
function plusDays(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

// Fenetre de silence ; elle peut passer minuit (21:00-07:00). start = end : aucun silence.
export function isQuiet(nowMs: number, cfg: RemConfig): boolean {
  const s = hhmmToMin(cfg.quiet.start), e = hhmmToMin(cfg.quiet.end), m = dubaiMinuteOfDay(nowMs);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

// --- Configuration ------------------------------------------------------------------

type FieldCheck = (v: unknown) => boolean;
const isInt = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isTime: FieldCheck = (v) => typeof v === "string" && HHMM_RE.test(v);
const isText: FieldCheck = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const isManagerIds: FieldCheck = (v) =>
  v === null || (Array.isArray(v) && v.length <= 50 && v.every((x) => isInt(x, 1, Number.MAX_SAFE_INTEGER)));

const SCALARS: Record<string, { check: FieldCheck; error: string }> = {
  enabled: { check: (v) => typeof v === "boolean", error: "enabled must be true or false" },
  guestFactor: { check: (v) => typeof v === "number" && v >= 0.1 && v <= 1, error: "guestFactor must be between 0.1 and 1" },
  tomorrowCheckAt: { check: isTime, error: "tomorrowCheckAt must be HH:MM" },
  cleaningDefaultTime: { check: isTime, error: "cleaningDefaultTime must be HH:MM" },
  maxPerSubjectPerDay: { check: (v) => isInt(v, 1, 10), error: "maxPerSubjectPerDay must be 1 to 10" },
  minGapMin: { check: (v) => isInt(v, 0, 1440), error: "minGapMin must be 0 to 1440" },
  escalateAfter: { check: (v) => isInt(v, 1, 10), error: "escalateAfter must be 1 to 10" },
  escalateGraceMin: { check: (v) => isInt(v, 0, 1440), error: "escalateGraceMin must be 0 to 1440" },
  digestOver: { check: (v) => isInt(v, 1, 50), error: "digestOver must be 1 to 50" },
  managerIds: { check: isManagerIds, error: "managerIds must be null or a list of ids" },
};
for (const k of DELAY_KEYS) SCALARS[k] = { check: (v) => isInt(v, 1, 10080), error: k + " must be 1 to 10080 minutes" };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function clone(c: RemConfig): RemConfig {
  return {
    ...c, rules: { ...c.rules }, quiet: { ...c.quiet }, texts: { ...c.texts },
    managerIds: c.managerIds ? [...c.managerIds] : null,
  };
}

// Fusion tolerante de la valeur stockee (app_config cle reminders) : cles inconnues et
// valeurs invalides ignorees, jamais d'exception (une config abimee ne coupe pas le moteur).
export function mergeConfig(stored: unknown): RemConfig {
  const out = clone(REM_DEFAULTS);
  if (!isObj(stored)) return out;
  const o = out as unknown as Record<string, unknown>;
  for (const [k, f] of Object.entries(SCALARS)) {
    if (k in stored && f.check(stored[k])) o[k] = k === "managerIds" && stored[k] ? [...new Set(stored[k] as number[])] : stored[k];
  }
  if (isObj(stored.quiet)) {
    for (const k of ["start", "end"] as const) if (isTime(stored.quiet[k])) out.quiet[k] = stored.quiet[k] as string;
  }
  if (isObj(stored.rules)) {
    for (const r of REM_RULES) if (typeof stored.rules[r] === "boolean") out.rules[r] = stored.rules[r] as boolean;
  }
  if (isObj(stored.texts)) {
    for (const r of REM_TEXT_RULES) if (isText(stored.texts[r])) out.texts[r] = (stored.texts[r] as string).trim();
  }
  return out;
}

// Validation stricte d'un patch de l'ecran admin : toute cle inconnue ou valeur hors
// bornes refuse le patch entier, avec un message court en anglais.
export function validateConfigPatch(body: unknown): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (!isObj(body)) return { ok: false, error: "Invalid config." };
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k in SCALARS) {
      if (!SCALARS[k].check(v)) return { ok: false, error: SCALARS[k].error + "." };
      patch[k] = k === "managerIds" && v ? [...new Set(v as number[])] : v;
    } else if (k === "quiet") {
      if (!isObj(v)) return { ok: false, error: "quiet must be an object." };
      const q: Record<string, string> = {};
      for (const [qk, qv] of Object.entries(v)) {
        if (qk !== "start" && qk !== "end") return { ok: false, error: "Unknown field quiet." + qk + "." };
        if (!isTime(qv)) return { ok: false, error: "quiet." + qk + " must be HH:MM." };
        q[qk] = qv as string;
      }
      patch.quiet = q;
    } else if (k === "rules") {
      if (!isObj(v)) return { ok: false, error: "rules must be an object." };
      const r: Record<string, boolean> = {};
      for (const [rk, rv] of Object.entries(v)) {
        if (!(REM_RULES as readonly string[]).includes(rk)) return { ok: false, error: "Unknown rule " + rk + "." };
        if (typeof rv !== "boolean") return { ok: false, error: "rules." + rk + " must be true or false." };
        r[rk] = rv;
      }
      patch.rules = r;
    } else if (k === "texts") {
      if (!isObj(v)) return { ok: false, error: "texts must be an object." };
      const t: Record<string, string> = {};
      for (const [tk, tv] of Object.entries(v)) {
        if (!(REM_TEXT_RULES as readonly string[]).includes(tk)) return { ok: false, error: "Unknown text " + tk + "." };
        if (!isText(tv)) return { ok: false, error: "texts." + tk + " must be 1 to 200 characters." };
        t[tk] = (tv as string).trim();
      }
      patch.texts = t;
    } else {
      return { ok: false, error: "Unknown field " + k + "." };
    }
  }
  return { ok: true, patch };
}

// --- Evaluation -------------------------------------------------------------------

const URGENT_PRIORITIES = ["urgent", "high"];
const TECH_RULES = ["r3", "r4", "r6"];
// Deux lignes d'une meme regle a moins de 2 min = un seul passage du moteur (un
// envoi a plusieurs managers ecrit une ligne par destinataire).
const FIRING_SPREAD_MS = 2 * MIN_MS;

function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : ""));
}
function baseKey(rule: string, kind: string, id: string): string {
  return rule + ":" + kind + ":" + id;
}
function rowKey(r: RemHistoryRow): string {
  return r.key || baseKey(r.rule, r.subject_kind, r.subject_id);
}
function guestSet(g: RemSnapshot["guestOnSite"]): Set<string> {
  if (g instanceof Set) return new Set([...g].map(String));
  return new Set(Object.entries(g || {}).filter(([, v]) => v).map(([k]) => String(k)));
}
function uniq(ids: number[]): number[] {
  return [...new Set(ids.filter((x) => Number.isInteger(x) && x > 0))];
}
function hours(min: number): number {
  return Math.round((min / 60) * 10) / 10;
}

// Lignes 'sent' d'une regle sur un sujet, triees.
function sentRows(h: RemHistoryRow[], rule: string, kind: string, id: string, who?: number): number[] {
  return h
    .filter((r) => r.status === "sent" && r.rule === rule && r.subject_kind === kind && r.subject_id === id
      && (who === undefined || r.cleaner_id === who))
    .map((r) => ms(r.sent_at))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
}
function firings(times: number[]): number[] {
  const out: number[] = [];
  for (const t of times) if (!out.length || t - out[out.length - 1] > FIRING_SPREAD_MS) out.push(t);
  return out;
}

export function evaluate(snap: RemSnapshot, cfg: RemConfig, nowMs: number): Due[] {
  if (!cfg.enabled) return [];
  const on = (r: RemRule) => cfg.rules[r] !== false;
  const guests = guestSet(snap.guestOnSite);
  const hasGuest = (lid: unknown) => lid !== null && lid !== undefined && guests.has(String(lid));
  // r5 : delais raccourcis quand un guest est sur place (regle desactivable).
  const delay = (k: DelayKey, guest: boolean) => cfg[k] * (guest && on("r5") ? cfg.guestFactor : 1);
  const managers = uniq(cfg.managerIds ?? snap.managers ?? []);
  const nameOf = (id: number | null) => (id !== null && snap.people?.[String(id)]?.name) || "Technician";
  const h = snap.history || [];
  const today = snap.today || dubaiDay(nowMs);
  const out: Due[] = [];

  const ticketDue = (
    t: RemTicket, rule: RemRule, recipients: number[], vars: Record<string, string | number>, opt: { urgent?: boolean; stage?: string } = {},
  ) => {
    const guest = hasGuest(t.listing_id);
    const urgent = !!opt.urgent || (guest && URGENT_PRIORITIES.includes(String(t.priority ?? "")));
    const ref = "MNT-" + t.id;
    const plain = ref + " · " + t.label;
    let body = fill(cfg.texts[rule as TextRule], { apt: t.label, title: t.title, ref, ...vars });
    if (guest) body += " Guest on site.";
    const r = uniq(recipients);
    if (!r.length) return;
    out.push({
      rule, subjectKind: "ticket", subjectId: String(t.id), ref, recipients: r, urgent, guestOnSite: guest,
      title: urgent ? ("URGENT · " + plain).toUpperCase() : plain, body,
      url: "/manager/#/maintenance?ref=" + ref,
      key: baseKey(rule, "ticket", String(t.id)) + (opt.stage ? ":" + opt.stage : ""),
    });
  };

  for (const t of snap.tickets || []) {
    const id = String(t.id);
    const guest = hasGuest(t.listing_id);
    const created = ms(t.created_at) ?? nowMs;
    const tech = t.assigned_technician_id ?? null;
    const unassigned = tech === null && (t.assigned_vendor_id ?? null) === null;
    const lastOf = (rule: string) => {
      const s = sentRows(h, rule, "ticket", id);
      return s.length ? s[s.length - 1] : null;
    };

    // r1 : urgent sans responsable ; repetition bornee par l'ecart et le plafond du jour.
    if (on("r1") && unassigned && t.priority === "urgent" && nowMs - created >= delay("urgentUnassignedMin", guest) * MIN_MS) {
      ticketDue(t, "r1", managers, {}, { urgent: true });
    }
    // r2 : ni responsable ni date ; repete au plus une fois par delai.
    if (on("r2") && unassigned && !t.due_on) {
      const d = delay("unassignedNoDueMin", guest) * MIN_MS;
      const last = lastOf("r2");
      if (nowMs - created >= d && (last === null || nowMs - last >= d)) ticketDue(t, "r2", managers, { hours: hours(d / MIN_MS) });
    }
    // r3 : premier rappel assignedFirstMin apres l'assignation, second assignedSecondMin
    // apres l'envoi reel du premier (un premier retarde par les heures calmes decale le second).
    if (on("r3") && t.status === "assigned" && tech !== null) {
      const since = ms(t.assignedAt) ?? ms(t.last_update) ?? created;
      const fired = firings(sentRows(h, "r3", "ticket", id, tech).filter((x) => x >= since));
      const first = delay("assignedFirstMin", guest) * MIN_MS;
      const second = delay("assignedSecondMin", guest) * MIN_MS;
      if (fired.length === 0 && nowMs - since >= first) ticketDue(t, "r3", [tech], { who: nameOf(tech) }, { stage: "first" });
      else if (fired.length === 1 && nowMs - fired[0] >= second) ticketDue(t, "r3", [tech], { who: nameOf(tech) }, { stage: "second" });
    }
    // r4 : en cours sans mise a jour ; un rappel par periode de silence du ticket.
    if (on("r4") && t.status === "in_progress" && tech !== null) {
      const d = delay("inProgressStaleMin", guest) * MIN_MS;
      const upd = ms(t.last_update) ?? ms(t.assignedAt) ?? created;
      const last = lastOf("r4");
      const ref = Math.max(upd, last ?? 0);
      if (nowMs - ref >= d) ticketDue(t, "r4", [tech], { hours: hours(d / MIN_MS), who: nameOf(tech) });
    }
    // r6 : echeance depassee ; technicien et managers dans une seule relance (compte 1
    // au plafond), une fois par jour (toutes les 12 h avec un guest).
    if (on("r6") && t.due_on && t.due_on < today) {
      const d = 1440 * (guest && on("r5") ? cfg.guestFactor : 1) * MIN_MS;
      const last = lastOf("r6");
      if (last === null || nowMs - last >= d) {
        ticketDue(t, "r6", [...(tech !== null ? [tech] : []), ...managers], {
          due: t.due_on, who: tech !== null ? nameOf(tech) : "Team",
        });
      }
    }
    // r10 : escalade apres N rappels au technicien sans changement du ticket depuis le premier.
    if (on("r10") && tech !== null) {
      const change = ms(t.lastChangeAt) ?? Math.max(ms(t.last_update) ?? 0, ms(t.assignedAt) ?? 0, created);
      let n = 0;
      let latest = 0;
      for (const r of TECH_RULES) {
        const f = firings(sentRows(h, r, "ticket", id, tech).filter((x) => x > change));
        n += f.length;
        if (f.length) latest = Math.max(latest, f[f.length - 1]);
      }
      const doneToday = sentRows(h, "r10", "ticket", id).some((x) => dubaiDay(x) === dubaiDay(nowMs));
      // Delai de grace apres le dernier rappel compte : le technicien a le temps d'agir.
      const graceOk = nowMs - latest >= cfg.escalateGraceMin * MIN_MS;
      if (n >= cfg.escalateAfter && !doneToday && graceOk) {
        ticketDue(t, "r10", managers, { who: nameOf(tech), count: n }, { urgent: true });
      }
    }
  }

  // r9 : proposition en attente ; un rappel par delai.
  if (on("r9")) {
    for (const p of snap.proposals || []) {
      const id = String(p.id);
      const guest = hasGuest(p.listing_id);
      const d = delay("proposalPendingMin", guest) * MIN_MS;
      const created = ms(p.created_at) ?? nowMs;
      const s = sentRows(h, "r9", "proposal", id);
      const last = s.length ? s[s.length - 1] : null;
      if (nowMs - created < d || (last !== null && nowMs - last < d) || !managers.length) continue;
      const ref = "PRP-" + p.id;
      let body = fill(cfg.texts.r9, { apt: p.label, title: p.title, ref, hours: hours(d / MIN_MS) });
      if (guest) body += " Guest on site.";
      out.push({
        rule: "r9", subjectKind: "proposal", subjectId: id, ref, recipients: managers, urgent: false, guestOnSite: guest,
        title: ref + " · " + p.label, body, url: "/manager/#/maintenance?ref=" + ref, key: baseKey("r9", "proposal", id),
      });
    }
  }

  const cleanings = snap.cleanings || [];
  // r7 : menages de demain sans personne, une seule alerte a partir de tomorrowCheckAt.
  const tomorrow = plusDays(today, 1);
  if (on("r7") && managers.length && nowMs >= dubaiAt(today, cfg.tomorrowCheckAt)) {
    const open = cleanings.filter((c) => c.date === tomorrow && !c.cancelled && !(c.assigned || []).length);
    const subj = "unassigned:" + tomorrow;
    if (open.length && !sentRows(h, "r7", "cleaning", subj).length) {
      const list = open.map((c) => c.label).join(", ");
      out.push({
        rule: "r7", subjectKind: "cleaning", subjectId: subj, ref: tomorrow, recipients: managers, urgent: false,
        guestOnSite: false, title: "Tomorrow · " + open.length + (open.length === 1 ? " cleaning" : " cleanings") + " not assigned",
        body: fill(cfg.texts.r7, { count: open.length, list, date: tomorrow }),
        url: "/manager/#/planning", key: baseKey("r7", "cleaning", subj),
      });
    }
  }
  // r8 : menage pas termine 2 h apres l'heure prevue ; Elite (subcontractor) n'a pas d'app.
  if (on("r8")) {
    for (const c of cleanings) {
      if (c.cancelled || c.state === "done" || c.date > today) continue;
      const people = (c.assigned || []).filter((a) => a.role !== "subcontractor");
      if (!people.length) continue;
      const at = dubaiAt(c.date, c.time && isTime(c.time) ? c.time : cfg.cleaningDefaultTime);
      if (nowMs < at + cfg.cleaningLateMin * MIN_MS) continue;
      if (sentRows(h, "r8", "cleaning", c.key).length) continue;
      const guest = hasGuest(c.listingId);
      const body = fill(cfg.texts.r8, { apt: c.label, title: c.label, ref: c.date + " · " + c.label });
      // Une relance par lien : les managers vont au Planning, les cleaners a /v3/ ;
      // meme cle, donc un seul passage au plafond.
      const groups: Array<[string, number[]]> = [
        ["/manager/#/planning", people.filter((a) => a.role === "manager").map((a) => a.id)],
        ["/v3/", people.filter((a) => a.role !== "manager").map((a) => a.id)],
      ];
      for (const [url, ids] of groups) {
        const r = uniq(ids);
        if (!r.length) continue;
        out.push({
          rule: "r8", subjectKind: "cleaning", subjectId: c.key, ref: c.date + " · " + c.label, recipients: r, urgent: false,
          guestOnSite: guest, title: "Cleaning · " + c.label, body, url, key: baseKey("r8", "cleaning", c.key),
        });
      }
    }
  }
  return out;
}

// --- Limites ----------------------------------------------------------------------

// Silence, ecart minimal entre deux relances identiques au meme destinataire, plafond
// par sujet et par jour Dubai (un passage compte 1 quel que soit le nombre de managers).
// Les urgentes passent d'abord pour ne pas etre plafonnees par une relance ordinaire.
export function applyLimits(
  dues: Due[], history: RemHistoryRow[], nowMs: number, cfg: RemConfig,
): { send: Due[]; skipped: Array<{ due: Due; reason: SkipReason }> } {
  const send: Due[] = [];
  const skipped: Array<{ due: Due; reason: SkipReason }> = [];
  const quiet = isQuiet(nowMs, cfg);
  const day = dubaiDay(nowMs);
  const gapMs = cfg.minGapMin * MIN_MS;
  const sent = (history || []).filter((r) => r.status === "sent" && ms(r.sent_at) !== null);

  // Passages deja faits aujourd'hui par sujet : regle + cle, regroupes dans le temps.
  const subjOf = (kind: string, id: string) => kind + ":" + id;
  const today = new Map<string, Set<string>>();
  const groups = new Map<string, number[]>();
  for (const r of sent) {
    const t = ms(r.sent_at)!;
    if (dubaiDay(t) !== day) continue;
    const g = subjOf(r.subject_kind, r.subject_id) + "|" + r.rule + "|" + rowKey(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  for (const [g, times] of groups) {
    const subj = g.split("|")[0];
    if (!today.has(subj)) today.set(subj, new Set());
    for (const f of firings(times.sort((a, b) => a - b))) today.get(subj)!.add(g + "@" + f);
  }

  const ordered = [...dues].sort((a, b) => Number(b.urgent) - Number(a.urgent));
  for (const due of ordered) {
    if (!cfg.enabled || cfg.rules[due.rule] === false) { skipped.push({ due, reason: "disabled" }); continue; }
    if (quiet && !(due.urgent && due.guestOnSite)) { skipped.push({ due, reason: "quiet" }); continue; }
    const recent = sent.filter((r) =>
      r.rule === due.rule && r.subject_kind === due.subjectKind && r.subject_id === due.subjectId
      && (r.key ? r.key === due.key : true) && nowMs - ms(r.sent_at)! < gapMs
    );
    const blocked = new Set(recent.map((r) => r.cleaner_id));
    const recipients = due.recipients.filter((id) => !blocked.has(id));
    if (!recipients.length) { skipped.push({ due, reason: "duplicate" }); continue; }
    const subj = subjOf(due.subjectKind, due.subjectId);
    const fired = today.get(subj) ?? new Set<string>();
    const mine = subj + "|" + due.rule + "|run:" + due.key;
    if (!fired.has(mine) && fired.size >= cfg.maxPerSubjectPerDay) { skipped.push({ due, reason: "capped" }); continue; }
    fired.add(mine);
    today.set(subj, fired);
    send.push(recipients.length === due.recipients.length ? due : { ...due, recipients });
  }
  return { send, skipped };
}

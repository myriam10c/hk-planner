// Ecritures du module Inspections. Identite toujours depuis la session.
import type { ActionResult, SessionUser } from "./v3.ts";
import { plusDays, todayDubai, V3_PHOTO_BUCKET, validIdem } from "./v3.ts";
import { V3_MAX_PHOTO_BYTES, V3_PHOTO_MIME } from "./v3_photos.ts";
import {
  FIX_LINE_PREFIX, fixLine, fixOverdue, focusOut, INSP_DET_ITEMS, INSP_DET_KEYS, INSP_ZONE_KEYS, INSP_ZONES, listingLabel,
} from "./insp_rules.ts";

const ELIGIBILITIES = new Set(["checkout", "vacant", "adhoc"]);
const zoneLabel = (k: string) => INSP_ZONES.find((z) => z.key === k)?.label ?? k;
const clean = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// Texte sur une seule ligne : retours ligne et caracteres de controle remplaces par un espace.
const cleanLine = (v: unknown, max: number) =>
  (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const bad = (status: number, error: string): ActionResult => ({ status, body: { error } });

const itemOut = (r: any) => ({
  zone: r.zone, status: r.status, note: r.note ?? null, outcome: r.outcome ?? null,
  fixNote: r.fix_note ?? null, ticketId: r.ticket_id ?? null,
  missingItems: Array.isArray(r.missing_items) ? r.missing_items : [],
  fixScheduledFor: r.fix_scheduled_for ?? null, fixScheduledSlot: r.fix_scheduled_slot ?? null,
});

// Date de rectification : vide = aucune ; sinon jour valide, pas avant aujourd'hui (Dubai) sauf si inchangee,
// au plus un an devant. Le creneau (texte court) n'existe qu'avec une date.
const FIX_MAX_AHEAD_DAYS = 365;
function validDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd;
}
function parseFix(rawDate: unknown, rawSlot: unknown, day: string, prevDate: string | null):
  { date: string | null; slot: string | null; err?: undefined } | { err: ActionResult } {
  const d = rawDate == null ? "" : String(rawDate).trim();
  if (!d) return { date: null, slot: null };
  if (!validDay(d)) return { err: bad(400, "Invalid fix date.") };
  if (d < day && d !== prevDate) return { err: bad(400, "The fix date cannot be in the past.") };
  if (d > plusDays(day, FIX_MAX_AHEAD_DAYS)) return { err: bad(400, "The fix date is too far ahead.") };
  return { date: d, slot: cleanLine(rawSlot, 40) || null };
}
// Remplace (ou retire) la ligne "Fix date" de la description du ticket, sans toucher au reste.
function withFixLine(desc: unknown, line: string): string {
  // Ligne entiere seulement (mode multi-lignes) : une mention en milieu de phrase reste intacte.
  const base = String(desc ?? "").replace(new RegExp("\\n*^" + FIX_LINE_PREFIX + "[^\\n]*$", "gm"), "").replace(/\s+$/, "");
  return line ? (base ? base + "\n\n" : "") + line : base;
}

const WHO_TEXT: Record<string, string> = {
  owner: "Owner supplies (owner pays, tell Hillal before buying)",
  medini: "Medini supplies",
  both: "Owner buys, Medini restocks",
};
const detLabels = (keys: string[]) => keys.map((k) => INSP_DET_ITEMS.find((i) => i.key === k)?.label ?? k);
// Memes statuts clos que insp_read.
const TICKET_CLOSED = new Set(["resolved", "cancelled", "closed"]);

async function loadOwned(sb: any, me: SessionUser, inspectionId: unknown) {
  const id = Number(inspectionId);
  if (!Number.isInteger(id) || id <= 0) return { err: bad(400, "inspectionId required") };
  const { data } = await sb.from("inspections").select("*").eq("id", id).maybeSingle();
  if (!data) return { err: bad(404, "Inspection not found.") };
  if (Number(data.inspector_id) !== Number(me.cleaner_id)) return { err: bad(403, "forbidden") };
  return { insp: data };
}

async function snapshot(sb: any, insp: any) {
  const { data: items } = await sb.from("inspection_items").select("*").eq("inspection_id", insp.id);
  const { data: photos } = await sb.from("inspection_photos").select("id, zone, kind").eq("inspection_id", insp.id);
  const { data: listing } = await sb.from("listing_config").select("internal_name, listing_name").eq("listing_id", insp.listing_id).maybeSingle();
  const { data: focus } = await sb.from("inspection_focus").select("*").eq("listing_id", insp.listing_id).eq("active", true);
  return {
    inspection: { id: insp.id, listingId: insp.listing_id, name: listingLabel(listing ?? {}), eligibility: insp.eligibility, startedAt: insp.started_at },
    items: (items ?? []).map(itemOut),
    photos: (photos ?? []).map((p: any) => ({ id: p.id, zone: p.zone, kind: p.kind })),
    detItems: INSP_DET_ITEMS,
    focus: focusOut(focus ?? []),
  };
}

export async function startInspection(sb: any, me: SessionUser, body: any, now = Date.now()): Promise<ActionResult> {
  const listingId = clean(body?.listingId, 40);
  if (!listingId) return bad(400, "listingId required");
  if (!ELIGIBILITIES.has(String(body?.eligibility))) return bad(400, "invalid eligibility");
  if (!validIdem(body?.idem)) return bad(400, "idem required");
  const { data: listing } = await sb.from("listing_config").select("listing_id").eq("listing_id", listingId).maybeSingle();
  if (!listing) return bad(404, "Apartment not found.");
  const day = todayDubai(now);
  // Rejeu de la meme cle, ou reprise de l'inspection ouverte du jour.
  const { data: byIdem } = await sb.from("inspections").select("*").eq("idem_key", body.idem)
    .eq("inspector_id", me.cleaner_id).maybeSingle();
  if (byIdem) return { status: 200, body: await snapshot(sb, byIdem) };
  const findOpen = async () => (await sb.from("inspections").select("*")
    .eq("listing_id", listingId).eq("inspector_id", me.cleaner_id).eq("inspection_date", day).is("finished_at", null)
    .maybeSingle()).data;
  const open = await findOpen();
  if (open) return { status: 200, body: await snapshot(sb, open) };
  const { data, error } = await sb.from("inspections").insert({
    listing_id: listingId, inspector_id: me.cleaner_id, inspection_date: day,
    eligibility: body.eligibility, idem_key: body.idem, started_at: new Date(now).toISOString(),
  }).select().single();
  if (error) {
    if (String(error.code) !== "23505") throw error;
    const { data: race } = await sb.from("inspections").select("*").eq("idem_key", body.idem)
      .eq("inspector_id", me.cleaner_id).maybeSingle();
    if (race) return { status: 200, body: await snapshot(sb, race) };
    // Autre cle idem, meme inspection ouverte (index partiel uq_inspections_open).
    const other = await findOpen();
    if (other) return { status: 200, body: await snapshot(sb, other) };
    throw error;
  }
  return { status: 200, body: await snapshot(sb, data) };
}

// Titre et description du ticket. Zone det : liste des manquants avec qui fournit, note libre a la suite.
function ticketText(zone: string, note: string, missing: string[], by: string, fix = "") {
  const sig = "\n\nFound during inspection by " + by + "." + (fix ? "\n\n" + fix : "");
  if (zone !== "det") return { title: zoneLabel(zone) + ": " + note.slice(0, 80), description: note + sig };
  const lines = missing.map((k) => {
    const it = INSP_DET_ITEMS.find((i) => i.key === k);
    return "- " + (it?.label ?? k) + " · " + (WHO_TEXT[it?.who ?? ""] ?? "");
  });
  return {
    title: "DET equipment missing: " + detLabels(missing).join(", ").slice(0, 80),
    description: lines.join("\n") + (note ? "\n\n" + note : "") + sig,
  };
}

async function ensureTicket(sb: any, me: SessionUser, insp: any, zone: string, note: string, now: number,
  missing: string[] = [], fix = ""): Promise<number> {
  const ref = "inspection:" + insp.id + ":" + zone;
  const { data: existing } = await sb.from("maintenance_tickets").select("id").eq("source_ref", ref).maybeSingle();
  // Ticket deja cree (reprise apres echec) : sa ligne Fix date suit la date demandee.
  if (existing) { await rewriteFixOnTicket(sb, existing.id, fix, now); return existing.id; }
  const { data: sla } = await sb.from("maintenance_sla").select("max_hours")
    .eq("category", "general").eq("priority", "medium").maybeSingle();
  const hours = sla?.max_hours ?? 72;
  // Plus ancienne photo "issue" de la zone, si elle existe deja.
  const { data: shots } = await sb.from("inspection_photos").select("id, storage_path, created_at")
    .eq("inspection_id", insp.id).eq("zone", zone).eq("kind", "issue");
  const first = (shots ?? []).slice().sort((a: any, b: any) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || Number(a.id) - Number(b.id))[0];
  const txt = ticketText(zone, note, missing, me.name, fix);
  const { data, error } = await sb.from("maintenance_tickets").insert({
    listing_id: insp.listing_id,
    title: txt.title,
    description: txt.description,
    category: "general", priority: "medium", status: "open",
    reported_by: me.name, source: "inspection", source_ref: ref,
    sla_deadline: new Date(now + hours * 3600_000).toISOString(),
    ...(first?.storage_path ? { photo_path: first.storage_path } : {}),
  }).select("id").single();
  if (!error) return data.id;
  if (String(error.code) !== "23505") throw error;
  const { data: race } = await sb.from("maintenance_tickets").select("id").eq("source_ref", ref).maybeSingle();
  if (!race) throw error;
  await rewriteFixOnTicket(sb, race.id, fix, now);
  return race.id;
}

export async function saveItem(sb: any, me: SessionUser, body: any, now = Date.now()): Promise<ActionResult> {
  const o = await loadOwned(sb, me, body?.inspectionId);
  if (o.err) return o.err;
  const insp = o.insp;
  if (insp.finished_at) return bad(409, "Inspection already finished.");
  const zone = String(body?.zone ?? "");
  if (!INSP_ZONE_KEYS.has(zone)) return bad(400, "unknown zone");
  const status = String(body?.status ?? "");
  if (status !== "ok" && status !== "not_ok") return bad(400, "invalid status");
  const { data: prev } = await sb.from("inspection_items").select("*")
    .eq("inspection_id", insp.id).eq("zone", zone).maybeSingle();
  const row: any = { inspection_id: insp.id, zone, status, updated_at: new Date(now).toISOString(),
    note: null, outcome: null, fix_note: null, ticket_id: prev?.ticket_id ?? null,
    fix_scheduled_for: null, fix_scheduled_slot: null };
  // missing_items seulement pour det : les autres zones marchent meme sans la migration.
  if (zone === "det") row.missing_items = [];
  let detChanged = false;
  if (status === "not_ok") {
    let missing: string[] = [];
    const note = clean(body?.note);
    if (zone === "det") {
      const raw = Array.isArray(body?.missing) ? body.missing.map(String) : [];
      if (!raw.length || raw.some((k: string) => !INSP_DET_KEYS.has(k))) return bad(400, "Tick what is missing.");
      // Dedoublonne et garde l'ordre de la liste.
      missing = INSP_DET_ITEMS.filter((i) => raw.includes(i.key)).map((i) => i.key);
    }
    // det : la liste suffit, note libre facultative.
    if (!note && zone !== "det") return bad(400, "Describe what is wrong.");
    const outcome = body?.outcome ?? null;
    if (outcome !== null && outcome !== "fixed" && outcome !== "maintenance") return bad(400, "invalid outcome");
    const fixNote = clean(body?.fixNote);
    if (outcome === "fixed" && !fixNote) return bad(400, "Describe the fix.");
    // Date de rectification : seulement pour une zone envoyee en maintenance, toujours facultative.
    if (outcome === "maintenance") {
      const fx = parseFix(body?.fixScheduledFor, body?.fixScheduledSlot, todayDubai(now), prev?.fix_scheduled_for ?? null);
      if (fx.err) return fx.err;
      row.fix_scheduled_for = fx.date; row.fix_scheduled_slot = fx.slot;
    }
    row.note = note || null; row.outcome = outcome; row.fix_note = outcome === "fixed" ? fixNote : null;
    if (zone === "det") row.missing_items = missing;
    if (outcome === "maintenance" && !row.ticket_id) {
      row.ticket_id = await ensureTicket(sb, me, insp, zone, note, now, missing,
        fixLine(row.fix_scheduled_for, row.fix_scheduled_slot));
    } else if (outcome === "maintenance" && zone === "det") {
      // Liste (ou note) modifiee : on remet a jour le ticket tant qu'il n'est pas clos.
      const prevMissing = Array.isArray(prev?.missing_items) ? prev.missing_items : [];
      detChanged = prevMissing.join(",") !== missing.join(",") || (prev?.note ?? "") !== note;
    }
    if (detChanged) {
      const { data: t } = await sb.from("maintenance_tickets").select("id, status").eq("id", row.ticket_id).maybeSingle();
      if (t && !TICKET_CLOSED.has(String(t.status))) {
        const txt = ticketText(zone, note, missing, me.name, fixLine(row.fix_scheduled_for, row.fix_scheduled_slot));
        const { error: upErr } = await sb.from("maintenance_tickets")
          .update({ title: txt.title, description: txt.description, last_update: new Date(now).toISOString() }).eq("id", row.ticket_id);
        if (upErr) throw upErr;
      }
    }
  }
  // Ticket deja lie dont la date de rectification change (posee, modifiee ou retiree) : ligne remplacee.
  const fixChanged = (prev?.fix_scheduled_for ?? null) !== row.fix_scheduled_for
    || (prev?.fix_scheduled_slot ?? null) !== row.fix_scheduled_slot;
  if (prev?.ticket_id && fixChanged && !detChanged) {
    await rewriteFixOnTicket(sb, prev.ticket_id, fixLine(row.fix_scheduled_for, row.fix_scheduled_slot), now);
  }
  const { error } = await sb.from("inspection_items").upsert(row, { onConflict: "inspection_id,zone" });
  if (error) throw error;
  return { status: 200, body: { item: itemOut(row) } };
}

// Met a jour la ligne "Fix date" d'un ticket encore ouvert. Rend false si le ticket est clos (ou introuvable).
async function rewriteFixOnTicket(sb: any, ticketId: number, line: string, now: number): Promise<boolean> {
  const { data: t } = await sb.from("maintenance_tickets").select("id, status, description").eq("id", ticketId).maybeSingle();
  if (!t || TICKET_CLOSED.has(String(t.status))) return false;
  const next = withFixLine(t.description, line);
  if (next === String(t.description ?? "")) return true;
  const { error } = await sb.from("maintenance_tickets")
    .update({ description: next, last_update: new Date(now).toISOString() }).eq("id", ticketId);
  if (error) throw error;
  return true;
}

// Date de rectification posee ou modifiee apres coup (historique) : manager ou inspecteur auteur,
// zone envoyee en maintenance, ticket lie encore ouvert.
export async function setFixSchedule(sb: any, me: SessionUser, body: any, now = Date.now()): Promise<ActionResult> {
  const id = Number(body?.inspectionId);
  if (!Number.isInteger(id) || id <= 0) return bad(400, "inspectionId required");
  const zone = String(body?.zone ?? "");
  if (!INSP_ZONE_KEYS.has(zone)) return bad(400, "unknown zone");
  const { data: insp } = await sb.from("inspections").select("*").eq("id", id).maybeSingle();
  if (!insp) return bad(404, "Inspection not found.");
  if (me.role !== "manager" && me.role !== "maintenance" && Number(insp.inspector_id) !== Number(me.cleaner_id)) return bad(403, "forbidden");
  const { data: item } = await sb.from("inspection_items").select("*").eq("inspection_id", id).eq("zone", zone).maybeSingle();
  if (!item) return bad(404, "This zone was not checked in this inspection.");
  if (item.status !== "not_ok" || item.outcome !== "maintenance") {
    return bad(409, "Only zones sent to maintenance can get a fix date.");
  }
  const fx = parseFix(body?.date, body?.slot, todayDubai(now), item.fix_scheduled_for ?? null);
  if (fx.err) return fx.err;
  let ticketStatus: string | null = null;
  if (item.ticket_id) {
    const { data: t } = await sb.from("maintenance_tickets").select("id, status").eq("id", item.ticket_id).maybeSingle();
    if (t && TICKET_CLOSED.has(String(t.status))) return bad(409, "This ticket is already closed.");
    ticketStatus = t ? String(t.status) : null;
  }
  const patch = { fix_scheduled_for: fx.date, fix_scheduled_slot: fx.slot, updated_at: new Date(now).toISOString() };
  const { error } = await sb.from("inspection_items").update(patch).eq("inspection_id", id).eq("zone", zone);
  if (error) throw error;
  if (item.ticket_id) await rewriteFixOnTicket(sb, item.ticket_id, fixLine(fx.date, fx.slot), now);
  return { status: 200, body: { item: { ...itemOut({ ...item, ...patch }), fixOverdue: fixOverdue(fx.date, ticketStatus, todayDubai(now)) } } };
}

export async function uploadInspectionPhoto(sb: any, me: SessionUser, form: FormData): Promise<ActionResult> {
  const idem = form.get("idem");
  if (!validIdem(idem)) return bad(400, "idem required");
  const o = await loadOwned(sb, me, form.get("inspectionId"));
  if (o.err) return o.err;
  if (o.insp.finished_at) return bad(409, "Inspection already finished.");
  const zone = String(form.get("zone") ?? "");
  if (!INSP_ZONE_KEYS.has(zone)) return bad(400, "unknown zone");
  const kind = String(form.get("kind") ?? "");
  if (kind !== "issue" && kind !== "after") return bad(400, "invalid kind");
  const { data: dup } = await sb.from("inspection_photos").select("id, zone, kind").eq("idem_key", String(idem))
    .eq("inspection_id", o.insp.id).maybeSingle();
  if (dup) return { status: 200, body: { photo: dup } };
  const file = form.get("file") as any;
  if (!file || typeof file.arrayBuffer !== "function") return bad(400, "file required");
  const ext = V3_PHOTO_MIME[String(file.type ?? "").toLowerCase()];
  if (!ext) return bad(400, "unsupported image type");
  const size = Number(file.size ?? 0);
  if (!(size > 0)) return bad(400, "empty file");
  if (size > V3_MAX_PHOTO_BYTES) return bad(413, "photo is too large");
  const path = "inspections/" + o.insp.id + "/" + zone + "/" + crypto.randomUUID() + "." + ext;
  const up = await sb.storage.from(V3_PHOTO_BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (up.error) throw up.error;
  const { data, error } = await sb.from("inspection_photos").insert({
    inspection_id: o.insp.id, zone, kind, storage_path: path, idem_key: String(idem),
  }).select("id, zone, kind").single();
  if (error) {
    await sb.storage.from(V3_PHOTO_BUCKET).remove([path]);
    if (String(error.code) !== "23505") throw error;
    const { data: race } = await sb.from("inspection_photos").select("id, zone, kind").eq("idem_key", String(idem)).maybeSingle();
    if (!race) throw error;
    return { status: 200, body: { photo: race } };
  }
  if (kind === "issue") {
    try {
      const { data: item } = await sb.from("inspection_items").select("ticket_id")
        .eq("inspection_id", o.insp.id).eq("zone", zone).maybeSingle();
      if (item?.ticket_id) {
        const { error: upErr } = await sb.from("maintenance_tickets").update({ photo_path: path })
          .eq("id", item.ticket_id).is("photo_path", null);
        if (upErr) console.error("inspection photo -> ticket failed", upErr);
      }
    } catch (e) { console.error("inspection photo -> ticket failed", e); }
  }
  return { status: 200, body: { photo: data } };
}

export async function finishInspection(sb: any, me: SessionUser, body: any, now = Date.now()): Promise<ActionResult> {
  const o = await loadOwned(sb, me, body?.inspectionId);
  if (o.err) return o.err;
  const insp = o.insp;
  if (insp.finished_at) return { status: 200, body: { inspection: { id: insp.id, finishedAt: insp.finished_at } } };
  const { data: items } = await sb.from("inspection_items").select("*").eq("inspection_id", insp.id);
  const byZone: Record<string, any> = {};
  for (const i of items ?? []) byZone[i.zone] = i;
  const missing = INSP_ZONES.filter((z) => !byZone[z.key]);
  // Seule det manque : appli en cache sans la nouvelle zone.
  if (missing.length === 1 && missing[0].key === "det") {
    return bad(400, "Missing: DET equipment. Reload the app to see this new zone.");
  }
  if (missing.length) return bad(400, "Missing: " + missing.map((z) => z.label).join(", "));
  const { data: photos } = await sb.from("inspection_photos").select("zone, kind").eq("inspection_id", insp.id);
  const withPhoto = new Set((photos ?? []).filter((p: any) => p.kind === "issue").map((p: any) => p.zone));
  const notOk = INSP_ZONES.filter((z) => byZone[z.key].status === "not_ok");
  // Zone det : on ne photographie pas un absent, photo facultative.
  const noPhoto = notOk.filter((z) => z.key !== "det" && !withPhoto.has(z.key)).map((z) => z.label);
  if (noPhoto.length) return bad(400, "Add a photo for: " + noPhoto.join(", "));
  const noOutcome = notOk.filter((z) => !byZone[z.key].outcome).map((z) => z.label);
  if (noOutcome.length) return bad(400, "Choose fixed or maintenance for: " + noOutcome.join(", "));
  const finishedAt = new Date(now).toISOString();
  const { data: updated, error } = await sb.from("inspections")
    .update({ finished_at: finishedAt, general_note: clean(body?.generalNote) || null })
    .eq("id", insp.id).is("finished_at", null).select("id");
  if (error) throw error;
  if (!updated || updated.length === 0) {
    const { data: cur } = await sb.from("inspections").select("finished_at").eq("id", insp.id).maybeSingle();
    return { status: 200, body: { inspection: { id: insp.id, finishedAt: cur?.finished_at ?? finishedAt } } };
  }
  return { status: 200, body: { inspection: { id: insp.id, finishedAt } } };
}

async function proposalRow(sb: any, listingId: string, day: string) {
  const { data } = await sb.from("inspection_proposals").select("*")
    .eq("proposal_date", day).eq("listing_id", listingId).maybeSingle();
  return data;
}
async function nameOf(sb: any, id: number) {
  const { data } = await sb.from("cleaners").select("name").eq("id", id).maybeSingle();
  return data?.name ?? "someone";
}

async function listingExists(sb: any, listingId: string) {
  const { data } = await sb.from("listing_config").select("listing_id").eq("listing_id", listingId).maybeSingle();
  return !!data;
}

export async function claimProposal(sb: any, me: SessionUser, body: any, now = Date.now()): Promise<ActionResult> {
  const listingId = clean(body?.listingId, 40);
  if (!listingId) return bad(400, "listingId required");
  if (!(await listingExists(sb, listingId))) return bad(404, "Apartment not found.");
  const day = todayDubai(now);
  // La ligne existe (rank 0 si absente), puis prise conditionnelle et atomique.
  const ins = await sb.from("inspection_proposals")
    .upsert({ proposal_date: day, listing_id: listingId, rank: 0 },
      { onConflict: "proposal_date,listing_id", ignoreDuplicates: true });
  if (ins.error) throw ins.error;
  const { data: won, error } = await sb.from("inspection_proposals")
    .update({ claimed_by: me.cleaner_id, claimed_at: new Date(now).toISOString() })
    .eq("proposal_date", day).eq("listing_id", listingId)
    .or("claimed_by.is.null,claimed_by.eq." + me.cleaner_id)
    .select("listing_id");
  if (error) throw error;
  if (!won || won.length === 0) {
    const p = await proposalRow(sb, listingId, day);
    return bad(409, "Already taken by " + (p?.claimed_by ? await nameOf(sb, p.claimed_by) : "someone") + ".");
  }
  return { status: 200, body: { proposal: { listingId, claimedBy: me.cleaner_id, claimedByName: me.name } } };
}

export async function unclaimProposal(sb: any, me: SessionUser, body: any, now = Date.now()): Promise<ActionResult> {
  const listingId = clean(body?.listingId, 40);
  if (!listingId) return bad(400, "listingId required");
  const day = todayDubai(now);
  const p = await proposalRow(sb, listingId, day);
  if (!p || !p.claimed_by) return { status: 200, body: { proposal: { listingId, claimedBy: null } } };
  if (Number(p.claimed_by) !== Number(me.cleaner_id) && me.role !== "manager") return bad(403, "forbidden");
  const { error } = await sb.from("inspection_proposals")
    .update({ claimed_by: null, claimed_at: null, assigned_by: null })
    .eq("proposal_date", day).eq("listing_id", listingId);
  if (error) throw error;
  return { status: 200, body: { proposal: { listingId, claimedBy: null } } };
}

export async function assignProposal(sb: any, me: SessionUser, body: any, now = Date.now()): Promise<ActionResult> {
  const listingId = clean(body?.listingId, 40);
  const cleanerId = Number(body?.cleanerId);
  if (!listingId || !Number.isInteger(cleanerId)) return bad(400, "listingId and cleanerId required");
  const { data: c } = await sb.from("cleaners").select("id, name, role, is_active").eq("id", cleanerId).maybeSingle();
  if (!c || !c.is_active || c.role === "subcontractor") return bad(400, "This person cannot do inspections.");
  if (!(await listingExists(sb, listingId))) return bad(404, "Apartment not found.");
  const day = todayDubai(now);
  const p = await proposalRow(sb, listingId, day);
  const row = { proposal_date: day, listing_id: listingId, rank: p?.rank ?? 0,
    claimed_by: cleanerId, claimed_at: new Date(now).toISOString(), assigned_by: me.cleaner_id };
  const { error } = await sb.from("inspection_proposals").upsert(row, { onConflict: "proposal_date,listing_id" });
  if (error) throw error;
  return { status: 200, body: { proposal: { listingId, claimedBy: cleanerId, claimedByName: c.name } } };
}

export async function setExcluded(sb: any, _me: SessionUser, body: any): Promise<ActionResult> {
  const listingId = clean(body?.listingId, 40);
  if (!listingId || typeof body?.excluded !== "boolean") return bad(400, "listingId and excluded required");
  if (!(await listingExists(sb, listingId))) return bad(404, "Apartment not found.");
  const { error } = await sb.from("listing_config").update({ inspection_excluded: body.excluded }).eq("listing_id", listingId);
  if (error) throw error;
  return { status: 200, body: { listingId, excluded: body.excluded } };
}

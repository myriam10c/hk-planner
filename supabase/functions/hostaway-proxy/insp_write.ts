// Ecritures du module Inspections. Identite toujours depuis la session.
import type { ActionResult, SessionUser } from "./v3.ts";
import { todayDubai, V3_PHOTO_BUCKET, validIdem } from "./v3.ts";
import { V3_MAX_PHOTO_BYTES, V3_PHOTO_MIME } from "./v3_photos.ts";
import { INSP_ZONE_KEYS, INSP_ZONES, listingLabel } from "./insp_rules.ts";

const ELIGIBILITIES = new Set(["checkout", "vacant", "adhoc"]);
const zoneLabel = (k: string) => INSP_ZONES.find((z) => z.key === k)?.label ?? k;
const clean = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bad = (status: number, error: string): ActionResult => ({ status, body: { error } });

const itemOut = (r: any) => ({
  zone: r.zone, status: r.status, note: r.note ?? null, outcome: r.outcome ?? null,
  fixNote: r.fix_note ?? null, ticketId: r.ticket_id ?? null,
});

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
  return {
    inspection: { id: insp.id, listingId: insp.listing_id, name: listingLabel(listing ?? {}), eligibility: insp.eligibility, startedAt: insp.started_at },
    items: (items ?? []).map(itemOut),
    photos: (photos ?? []).map((p: any) => ({ id: p.id, zone: p.zone, kind: p.kind })),
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

async function ensureTicket(sb: any, me: SessionUser, insp: any, zone: string, note: string, now: number): Promise<number> {
  const ref = "inspection:" + insp.id + ":" + zone;
  const { data: existing } = await sb.from("maintenance_tickets").select("id").eq("source_ref", ref).maybeSingle();
  if (existing) return existing.id;
  const { data: sla } = await sb.from("maintenance_sla").select("max_hours")
    .eq("category", "general").eq("priority", "medium").maybeSingle();
  const hours = sla?.max_hours ?? 72;
  // Plus ancienne photo "issue" de la zone, si elle existe deja.
  const { data: shots } = await sb.from("inspection_photos").select("id, storage_path, created_at")
    .eq("inspection_id", insp.id).eq("zone", zone).eq("kind", "issue");
  const first = (shots ?? []).slice().sort((a: any, b: any) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || Number(a.id) - Number(b.id))[0];
  const { data, error } = await sb.from("maintenance_tickets").insert({
    listing_id: insp.listing_id,
    title: zoneLabel(zone) + ": " + note.slice(0, 80),
    description: note + "\n\nFound during inspection by " + me.name + ".",
    category: "general", priority: "medium", status: "open",
    reported_by: me.name, source: "inspection", source_ref: ref,
    sla_deadline: new Date(now + hours * 3600_000).toISOString(),
    ...(first?.storage_path ? { photo_path: first.storage_path } : {}),
  }).select("id").single();
  if (!error) return data.id;
  if (String(error.code) !== "23505") throw error;
  const { data: race } = await sb.from("maintenance_tickets").select("id").eq("source_ref", ref).maybeSingle();
  if (!race) throw error;
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
    note: null, outcome: null, fix_note: null, ticket_id: prev?.ticket_id ?? null };
  if (status === "not_ok") {
    const note = clean(body?.note);
    if (!note) return bad(400, "Describe what is wrong.");
    const outcome = body?.outcome ?? null;
    if (outcome !== null && outcome !== "fixed" && outcome !== "maintenance") return bad(400, "invalid outcome");
    const fixNote = clean(body?.fixNote);
    if (outcome === "fixed" && !fixNote) return bad(400, "Describe the fix.");
    row.note = note; row.outcome = outcome; row.fix_note = outcome === "fixed" ? fixNote : null;
    if (outcome === "maintenance" && !row.ticket_id) row.ticket_id = await ensureTicket(sb, me, insp, zone, note, now);
  }
  const { error } = await sb.from("inspection_items").upsert(row, { onConflict: "inspection_id,zone" });
  if (error) throw error;
  return { status: 200, body: { item: itemOut(row) } };
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
  const missing = INSP_ZONES.filter((z) => !byZone[z.key]).map((z) => z.label);
  if (missing.length) return bad(400, "Missing: " + missing.join(", "));
  const { data: photos } = await sb.from("inspection_photos").select("zone, kind").eq("inspection_id", insp.id);
  const withPhoto = new Set((photos ?? []).filter((p: any) => p.kind === "issue").map((p: any) => p.zone));
  const notOk = INSP_ZONES.filter((z) => byZone[z.key].status === "not_ok");
  const noPhoto = notOk.filter((z) => !withPhoto.has(z.key)).map((z) => z.label);
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

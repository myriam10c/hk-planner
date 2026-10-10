// Litiges d'avis : parties pures (validation du statut, payload d'update, acces).
// Auteur = membre de la session (sessionActor), jamais le updated_by du navigateur.

export const DISPUTE_STATUSES = ["todo", "submitted", "removed", "rejected", "not_disputable"] as const;

export type DisputePatch = {
  review_id: number; updated_at: string; dispute_status?: string; reply_posted?: boolean; updated_by: string;
};

// 401 sans session, 403 si le role n'est pas manager (PIN ou email, les deux passent).
export function disputeAccess(me: { role: string } | null): { status: number; error: string } | null {
  if (!me) return { status: 401, error: "auth required" };
  if (me.role !== "manager") return { status: 403, error: "Only managers can do this." };
  return null;
}

export function buildDisputeUpdate(
  body: any, actor: string, nowIso: string,
): { ok: true; patch: DisputePatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || !body.review_id) return { ok: false, error: "review_id required" };
  const patch: DisputePatch = {
    review_id: Number(body.review_id), updated_at: nowIso, updated_by: String(actor).slice(0, 40),
  };
  if (body.dispute_status !== undefined) {
    if (!(DISPUTE_STATUSES as readonly string[]).includes(body.dispute_status)) {
      return { ok: false, error: "invalid dispute_status" };
    }
    patch.dispute_status = body.dispute_status;
  }
  if (body.reply_posted !== undefined) {
    if (typeof body.reply_posted !== "boolean") return { ok: false, error: "invalid reply_posted" };
    patch.reply_posted = body.reply_posted;
  }
  return { ok: true, patch };
}

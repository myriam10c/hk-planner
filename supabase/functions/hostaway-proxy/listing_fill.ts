// Logements absents de listing_config : la table n'a ete remplie qu'une fois
// (syncListings, 28/04/2026), les logements ajoutes depuis s'affichaient
// « Listing 590453 ». A chaque relecture Hostaway des reservations, les
// logements vus et absents de la table y sont ajoutes depuis Hostaway.
// Insertion seule : une fiche existante n'est jamais modifiee (prix, tags et
// reglages verrouilles restent ceux de la base).
export const LISTING_FILL_MAX = 40;

export async function fillMissingListings(
  sb: any,
  listingIds: Iterable<string>,
  fetchListing: (id: string) => Promise<any | null>,
  toRow: (l: any) => Record<string, unknown>,
): Promise<string[]> {
  const ids = [...new Set([...listingIds].map(String).filter((s) => /^\d+$/.test(s)))];
  if (!ids.length) return [];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("listing_config").select("listing_id").in("listing_id", ids.slice(i, i + 200));
    if (error) throw new Error("listing_config: " + (error.message ?? "read failed"));
    for (const r of data ?? []) known.add(String(r.listing_id));
  }
  const missing = ids.filter((id) => !known.has(id)).slice(0, LISTING_FILL_MAX);
  const added: string[] = [];
  for (const id of missing) {
    const l = await fetchListing(id);
    if (!l || String(l.id ?? "") !== id) continue;
    const { error } = await sb.from("listing_config")
      .upsert(toRow(l), { onConflict: "listing_id", ignoreDuplicates: true });
    if (error) console.error("[listing_fill] insert " + id + ":", error.message);
    else added.push(id);
  }
  return added;
}

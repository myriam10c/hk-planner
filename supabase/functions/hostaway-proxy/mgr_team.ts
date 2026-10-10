// Equipe de l'app manager (More > Team) : lecture seule. Les ecritures reutilisent
// saveCleaner, inviteCleaner et deleteCleaner (gardes de session deja en place).
// pin_hash n'est lu que pour en tirer un booleen : le hash ne sort jamais d'ici.

const ROLE_ORDER: Record<string, number> = { manager: 0, cleaner: 1, subcontractor: 2, maintenance: 3 };
const rank = (role: string) => (role in ROLE_ORDER ? ROLE_ORDER[role] : 99);

export type TeamMember = {
  id: number;
  name: string;
  role: string;
  color: string;
  phone: string;
  email: string | null;
  active: boolean;
  hasPin: boolean;
  hasAccount: boolean;
  isOwner: boolean;
  system: boolean;
};

export async function mgrTeam(sb: any): Promise<{ members: TeamMember[] }> {
  const { data, error } = await sb.from("cleaners")
    .select("id, name, role, color, phone, email, is_active, is_owner, pin_hash");
  if (error) throw error;
  const members: TeamMember[] = (data ?? [])
    // Le compte machine du CEO Agent n'est pas un membre d'equipe.
    .filter((r: any) => r.role !== "system")
    .map((r: any) => ({
      id: r.id,
      name: String(r.name ?? ""),
      role: String(r.role ?? ""),
      color: String(r.color ?? ""),
      phone: r.phone ? String(r.phone) : "",
      email: r.email ? String(r.email) : null,
      active: r.is_active !== false,
      // Booleen seulement, jamais le hash ni un derive.
      hasPin: typeof r.pin_hash === "string" && r.pin_hash.length > 0,
      // L'email d'une ligne n'est pose que par inviteCleaner ou linkEmail : il vaut compte Auth lie.
      hasAccount: !!r.email,
      isOwner: r.is_owner === true,
      system: false,
    }));
  // Aucune date de desactivation en base : tous les inactifs sont rendus.
  members.sort((a, b) =>
    Number(b.active) - Number(a.active) || rank(a.role) - rank(b.role) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { members };
}

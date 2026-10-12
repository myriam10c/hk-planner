// Qui entre dans /manager/ (spec section 6) : managers et maintenance (Semax) en
// session email. Cleaner -> /v3/ ; subcontractor et autres -> ancienne app ;
// manager ou maintenance avec un PIN seulement -> ecran « Sign in with your email ».
const ROLES = ['manager', 'maintenance'];

export function decideAccess(session, cleaner) {
  if (!session || !cleaner) return { go: '/' };
  if (cleaner.role === 'cleaner') return { go: '/v3/' };
  if (!ROLES.includes(cleaner.role)) return { go: '/' };
  if (session.kind !== 'bearer') return { screen: 'email' };
  return { ok: true };
}

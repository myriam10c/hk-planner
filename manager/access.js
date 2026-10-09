// Qui entre dans /manager/ (spec section 6) : managers en session email.
// Cleaner -> /v3/ ; subcontractor, maintenance et autres -> ancienne app ;
// manager avec un PIN seulement -> ecran « Sign in with your email ».
export function decideAccess(session, cleaner) {
  if (!session || !cleaner) return { go: '/' };
  if (cleaner.role === 'cleaner') return { go: '/v3/' };
  if (cleaner.role !== 'manager') return { go: '/' };
  if (session.kind !== 'bearer') return { screen: 'email' };
  return { ok: true };
}

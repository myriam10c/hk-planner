import { supabase, hasSupabase } from './supabase';
import type { MemberRole, Profile, Membership, Org } from './database.types';

export interface AuthSession {
  user: { id: string; email: string | null };
  profile: Profile | null;
  org: Org | null;
  role: MemberRole | null;
}

export async function loadSession(): Promise<AuthSession | null> {
  if (!hasSupabase || !supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('memberships').select('*, orgs(*)').eq('user_id', user.id).limit(1),
  ]);

  const m = memberships?.[0] as (Membership & { orgs: Org }) | undefined;
  return {
    user: { id: user.id, email: user.email ?? null },
    profile: profile ?? null,
    org: m?.orgs ?? null,
    role: m?.role ?? null,
  };
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email: string, password: string, fullName: string, phone?: string) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: fullName, phone: phone ?? null } },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// Stub join helper until proper invite flow is built.
export async function joinOrgBySlug(slug: string, role: MemberRole = 'manager') {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('join_org', { p_slug: slug, p_role: role });
  if (error) throw error;
  return data as string;
}

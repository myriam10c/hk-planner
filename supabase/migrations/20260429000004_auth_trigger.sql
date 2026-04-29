-- When a new auth.users row is inserted (via signup), create a matching profile.
-- The signup form passes `full_name` via auth metadata.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Convenience RPC: accept an invite to an org.
-- (Real invites would have a one-time token; this stub takes an org slug + role.)
create or replace function public.join_org(p_slug text, p_role member_role default 'manager')
returns uuid
language plpgsql
security definer
as $$
declare
  v_org uuid;
begin
  select id into v_org from orgs where slug = p_slug;
  if v_org is null then
    raise exception 'Org % not found', p_slug;
  end if;
  insert into memberships (org_id, user_id, role)
  values (v_org, auth.uid(), p_role)
  on conflict do nothing;
  return v_org;
end;
$$;

revoke all on function public.join_org(text, member_role) from public;
grant execute on function public.join_org(text, member_role) to authenticated;

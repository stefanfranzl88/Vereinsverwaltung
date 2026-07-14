-- =====================================================================
-- RLS für die Tabellen, die die App im Login-/Tenant-/Mitglieder-Pfad liest.
--
-- Das Basisschema (vereinsverwaltung_schema.sql, Abschnitt 9) aktiviert RLS nur
-- exemplarisch auf members/transactions/invoices/protocols und markiert den Rest
-- als TODO. Ohne dieses Skript wären profiles, tenants, tenant_modules, roles und
-- member_roles für JEDEN eingeloggten Benutzer über alle Mandanten hinweg lesbar
-- und beschreibbar – ein Mandantenleck.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

-- Hilfsfunktionen sind security definer und umgehen RLS selbst –
-- deshalb entsteht keine Rekursion, wenn eine profiles-Policy auth_tenant_id() nutzt.

-- ---------------------------------------------------------------
-- profiles: eigenes Profil lesen; Vereinskollegen sichtbar, damit die App
-- Mitglied↔Login verknüpfen kann. Schreiben nur am EIGENEN Profil (Consent).
-- ---------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (tenant_id = auth_tenant_id());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------
-- tenants: nur der eigene Verein.
-- ---------------------------------------------------------------
alter table tenants enable row level security;

drop policy if exists tenants_select on tenants;
create policy tenants_select on tenants for select
  using (id = auth_tenant_id());

drop policy if exists tenants_update on tenants;
create policy tenants_update on tenants for update
  using (id = auth_tenant_id() and has_perm('roles.manage'))
  with check (id = auth_tenant_id());

-- ---------------------------------------------------------------
-- tenant_modules: Basis des Modul-Gatings. Lesen darf jedes Mitglied
-- (sonst kann die App die Navigation nicht aufbauen). Buchen/Kündigen ist
-- bewusst NICHT über die Client-API möglich – das gehört ins Billing/Backoffice.
-- ---------------------------------------------------------------
alter table tenant_modules enable row level security;

drop policy if exists tenant_modules_select on tenant_modules;
create policy tenant_modules_select on tenant_modules for select
  using (tenant_id = auth_tenant_id());

-- ---------------------------------------------------------------
-- roles / role_permissions / member_roles: Rollenzuordnung des eigenen Vereins.
-- ---------------------------------------------------------------
alter table roles enable row level security;

drop policy if exists roles_select on roles;
create policy roles_select on roles for select
  using (tenant_id = auth_tenant_id());

drop policy if exists roles_write on roles;
create policy roles_write on roles for all
  using (tenant_id = auth_tenant_id() and has_perm('roles.manage') and not is_locked)
  with check (tenant_id = auth_tenant_id() and not is_locked);

alter table role_permissions enable row level security;

drop policy if exists role_permissions_select on role_permissions;
create policy role_permissions_select on role_permissions for select
  using (exists (
    select 1 from roles r
    where r.id = role_permissions.role_id and r.tenant_id = auth_tenant_id()
  ));

drop policy if exists role_permissions_write on role_permissions;
create policy role_permissions_write on role_permissions for all
  using (exists (
    select 1 from roles r
    where r.id = role_permissions.role_id
      and r.tenant_id = auth_tenant_id()
      and not r.is_locked
  ) and has_perm('roles.manage'))
  with check (exists (
    select 1 from roles r
    where r.id = role_permissions.role_id
      and r.tenant_id = auth_tenant_id()
      and not r.is_locked
  ));

alter table member_roles enable row level security;

drop policy if exists member_roles_select on member_roles;
create policy member_roles_select on member_roles for select
  using (exists (
    select 1 from members m
    where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id()
  ));

drop policy if exists member_roles_write on member_roles;
create policy member_roles_write on member_roles for all
  using (exists (
    select 1 from members m
    where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id()
  ) and has_perm('roles.manage'))
  with check (exists (
    select 1 from members m
    where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id()
  ));

-- ---------------------------------------------------------------
-- Kataloge: für alle eingeloggten Benutzer lesbar, aber nicht schreibbar.
-- ---------------------------------------------------------------
alter table modules enable row level security;

drop policy if exists modules_select on modules;
create policy modules_select on modules for select
  to authenticated using (true);

alter table permissions enable row level security;

drop policy if exists permissions_select on permissions;
create policy permissions_select on permissions for select
  to authenticated using (true);

-- ---------------------------------------------------------------
-- members: das Basisschema erlaubt members_write nur mit 'members.edit'.
-- Ergänzung: Jede Person darf ihr EIGENES Profilbild setzen – so wie im Prototyp
-- ("Dein eigenes Profilbild kannst du selbst ändern").
--
-- BEWUSST als Funktion und NICHT als update-Policy auf der eigenen Zeile:
-- RLS wirkt zeilen-, nicht spaltenweise. Eine Policy "id = auth_member_id()"
-- würde jedem Mitglied erlauben, an der eigenen Zeile ALLE Spalten zu ändern –
-- also auch funktion oder status. Diese Funktion schreibt ausschließlich photo_path.
-- ---------------------------------------------------------------
create or replace function set_own_avatar(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update members
     set photo_path = p_path
   where id = auth_member_id();

  if not found then
    raise exception 'Kein Mitglied mit dem eigenen Login verknüpft';
  end if;
end
$$;

revoke all on function set_own_avatar(text) from public;
grant execute on function set_own_avatar(text) to authenticated;

-- ---------------------------------------------------------------
-- Storage: Bucket für Profilbilder. Pfad = {tenant_id}/{member_id}.{ext},
-- passend zu src/features/members/api.ts.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
  );

drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
  );

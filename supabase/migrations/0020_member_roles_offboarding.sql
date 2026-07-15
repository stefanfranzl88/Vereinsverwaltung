-- =====================================================================
-- MITGLIEDER: Rollenzuweisung (roles.manage) + member_roles-RLS
--
-- Austritt und DSGVO-Löschung brauchen den service_role-Key (Auth-Benutzer
-- entfernen) und laufen deshalb in der Edge Function 'member-offboard' –
-- dafür ist hier keine SQL-Funktion nötig.
--
-- Hier: die Rollenzuweisung im Mitglieder-Dialog. Sie ist NUR mit roles.manage
-- erlaubt – durchgesetzt sowohl in der Funktion als auch per RLS auf
-- member_roles (insert/update/delete nur roles.manage).
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) member_roles-Schreibrechte erneut absichern (nur roles.manage)
--
--    So sieht ein members.edit-Berechtigter OHNE roles.manage im Dialog keine
--    Rollenauswahl – und selbst ein direkter API-Aufruf würde von der RLS
--    abgelehnt. with check UND using tragen has_perm('roles.manage').
-- =====================================================================
alter table member_roles enable row level security;

drop policy if exists member_roles_write on member_roles;
create policy member_roles_write on member_roles for all
  using (
    has_perm('roles.manage')
    and exists (
      select 1 from members m
      where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id()
    )
  )
  with check (
    has_perm('roles.manage')
    and exists (
      select 1 from members m
      where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id()
    )
    and exists (
      select 1 from roles r
      where r.id = member_roles.role_id and r.tenant_id = auth_tenant_id()
    )
  );


-- =====================================================================
-- 2) ROLLE SETZEN (Einzelrolle)
--
--    Ersetzt die Rollen des Mitglieds durch die gewählte. p_role_key = null
--    entfernt alle Rollen → das Mitglied gilt als einfaches "Mitglied".
--    Einzelrollen-Modell für den Dialog; Mehrfachrollen (z. B. Kassier Stv. +
--    admin) bleiben per SQL/Seed möglich, würden von diesem Aufruf aber ersetzt.
-- =====================================================================
create or replace function set_member_role(p_member_id uuid, p_role_key text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid := auth_tenant_id();
  v_role_id uuid;
begin
  if not has_perm('roles.manage') then
    raise exception 'Keine Berechtigung (roles.manage erforderlich)';
  end if;

  if not exists (
    select 1 from members m where m.id = p_member_id and m.tenant_id = v_tenant
  ) then
    raise exception 'Mitglied gehört nicht zu diesem Verein';
  end if;

  -- bestehende Rollen entfernen
  delete from member_roles where member_id = p_member_id;

  -- gewünschte Rolle setzen (falls angegeben)
  if coalesce(trim(p_role_key), '') <> '' then
    select id into v_role_id
      from roles where tenant_id = v_tenant and key = p_role_key;
    if v_role_id is null then
      raise exception 'Rolle % gibt es in diesem Verein nicht', p_role_key;
    end if;
    insert into member_roles (member_id, role_id) values (p_member_id, v_role_id)
    on conflict do nothing;
  end if;
end
$$;

revoke all on function set_member_role(uuid, text) from public;
grant execute on function set_member_role(uuid, text) to authenticated;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public' and tablename = 'member_roles'
order by policyname;

-- =====================================================================
-- SICHERHEITSFIX: Rechteprüfung fehlte in den WITH-CHECK-Klauseln
--
-- Muster des Fehlers (steckt im Basisschema UND in 0002):
--
--   create policy x_write on tbl for all
--     using      (tenant_id = auth_tenant_id() and has_perm('...'))  -- greift bei UPDATE/DELETE
--     with check (tenant_id = auth_tenant_id());                     -- greift bei INSERT
--
-- Bei INSERT wertet Postgres AUSSCHLIESSLICH die WITH-CHECK-Klausel aus – USING
-- wird nicht herangezogen. Die Rechteprüfung stand aber nur im USING. Ergebnis:
-- Jedes eingeloggte Mitglied konnte in die betroffenen Tabellen INSERTen, auch
-- ohne das jeweilige Recht. Konkret möglich war damit u.a.:
--
--   * role_permissions: sich selbst beliebige Rechte erteilen
--   * member_roles:     sich selbst die Systemadmin-Rolle zuweisen
--   * members:          fremde Mitglieder anlegen (ohne 'members.edit')
--   * protocols:        Protokolle verfassen (ohne 'protokoll.edit')
--
-- UPDATE und DELETE waren nicht betroffen, dort greift USING.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- ---------------------------------------------------------------
-- role_permissions – Kern der Rollen-Matrix.
-- Schreiben nur mit 'roles.manage', nur im eigenen Verein und nur bei
-- NICHT gesperrten Rollen (is_locked = Systemadmin-Spalte).
-- ---------------------------------------------------------------
drop policy if exists role_permissions_write on role_permissions;
create policy role_permissions_write on role_permissions for all
  using (
    has_perm('roles.manage')
    and exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and r.tenant_id = auth_tenant_id()
        and not r.is_locked
    )
  )
  with check (
    has_perm('roles.manage')
    and exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and r.tenant_id = auth_tenant_id()
        and not r.is_locked
    )
  );


-- ---------------------------------------------------------------
-- member_roles – wer welche Rolle hat. Ohne Fix: Selbstzuweisung der Admin-Rolle.
-- ---------------------------------------------------------------
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


-- ---------------------------------------------------------------
-- roles – Rollen anlegen/umbenennen nur mit 'roles.manage'.
-- ---------------------------------------------------------------
drop policy if exists roles_write on roles;
create policy roles_write on roles for all
  using (tenant_id = auth_tenant_id() and has_perm('roles.manage') and not is_locked)
  with check (tenant_id = auth_tenant_id() and has_perm('roles.manage') and not is_locked);


-- ---------------------------------------------------------------
-- members – aus dem Basisschema (Abschnitt 9). Ohne Fix konnte jedes Mitglied
-- neue Mitglieder anlegen, obwohl 'members.edit' verlangt ist.
-- ---------------------------------------------------------------
drop policy if exists members_write on members;
create policy members_write on members for all
  using (tenant_id = auth_tenant_id() and has_perm('members.edit'))
  with check (tenant_id = auth_tenant_id() and has_perm('members.edit'));


-- ---------------------------------------------------------------
-- protocols – ebenfalls aus dem Basisschema, gleicher Fehler.
-- ---------------------------------------------------------------
drop policy if exists proto_write on protocols;
create policy proto_write on protocols for all
  using (tenant_id = auth_tenant_id() and has_perm('protokoll.edit'))
  with check (tenant_id = auth_tenant_id() and has_perm('protokoll.edit'));


-- ---------------------------------------------------------------
-- tenants – Vereinsstammdaten nur mit 'roles.manage'.
-- ---------------------------------------------------------------
drop policy if exists tenants_update on tenants;
create policy tenants_update on tenants for update
  using (id = auth_tenant_id() and has_perm('roles.manage'))
  with check (id = auth_tenant_id() and has_perm('roles.manage'));


-- ---------------------------------------------------------------
-- KONTROLLE: Jede Policy muss die Rechteprüfung in BEIDEN Klauseln tragen.
-- 'qual' = USING, 'with_check' = WITH CHECK. Beide Spalten dürfen bei den
-- Schreib-Policies nicht null sein und müssen has_perm(...) enthalten.
-- ---------------------------------------------------------------
select
  tablename,
  policyname,
  cmd,
  qual       is not null and qual       like '%has_perm%' as using_geprueft,
  with_check is not null and with_check like '%has_perm%' as check_geprueft
from pg_policies
where schemaname = 'public'
  and policyname in (
    'role_permissions_write','member_roles_write','roles_write',
    'members_write','proto_write','tenants_update'
  )
order by tablename;

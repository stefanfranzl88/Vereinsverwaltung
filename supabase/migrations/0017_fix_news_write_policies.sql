-- =====================================================================
-- FIX: Schreib-Policies (news + Audit aller Tabellen)
--
-- Anlass: "new row violates row-level security policy for table news" beim
-- Veröffentlichen einer Mitteilung.
--
-- Das Skript ist idempotent und AUTORITATIV: es setzt die betroffenen Policies
-- unabhängig vom Ist-Zustand auf den Soll-Zustand. Teil D diagnostiziert die
-- ganze Fehlerklasse (Schreib-Policies ohne with-check), Teil E zeigt die
-- Rechtelage. Der eigentliche Live-Test-Insert steht separat in
-- test_news_insert.sql (danach ausführen).
--
-- Im Supabase SQL-Editor als Ganzes ausführen.
-- =====================================================================


-- =====================================================================
-- TEIL A – news
--
-- Getrennte Policies je Operation (statt einer for-all-Policy), damit die
-- Bedingungen pro Fall klar sind. WICHTIG: Beim INSERT prüft Postgres NUR
-- die with-check-Klausel – die Rechteprüfung MUSS dort stehen.
--
--   SELECT: eigener Verein; abgelaufene Mitteilungen sieht nur, wer posten darf.
--           (Der Ablauffilter bleibt serverseitig – sonst bekämen normale
--           Mitglieder abgelaufene Mitteilungen über die API ausgeliefert.
--           Das Frontend filtert nicht zusätzlich; es verlässt sich darauf.)
--   INSERT: eigener Verein UND news.post UND author_id = eigenes Mitglied
--           (author_id-Prüfung verhindert das Posten unter fremdem Namen).
--   UPDATE/DELETE: eigener Verein UND news.post.
-- =====================================================================
alter table news enable row level security;

-- alte Varianten wegräumen (egal wie sie hießen)
drop policy if exists news_select on news;
drop policy if exists news_write  on news;
drop policy if exists news_insert on news;
drop policy if exists news_update on news;
drop policy if exists news_delete on news;

create policy news_select on news for select
  using (
    tenant_id = auth_tenant_id()
    and (expires_at is null or expires_at >= current_date or has_perm('news.post'))
  );

create policy news_insert on news for insert
  with check (
    tenant_id = auth_tenant_id()
    and has_perm('news.post')
    and author_id = auth_member_id()
  );

create policy news_update on news for update
  using      (tenant_id = auth_tenant_id() and has_perm('news.post'))
  with check (tenant_id = auth_tenant_id() and has_perm('news.post'));

create policy news_delete on news for delete
  using (tenant_id = auth_tenant_id() and has_perm('news.post'));


-- =====================================================================
-- TEIL B – Basisschema-Tabellen erneut absichern
--
-- Diese Policies stammen aus vereinsverwaltung_schema.sql (Abschnitt 9) und
-- hatten dort die Rechteprüfung NUR im using (das with-check-Problem). 0003
-- bzw. setup_complete.sql korrigieren das – hier zur Sicherheit erneut, falls
-- eine dieser Migrationen auf der Live-DB nicht (vollständig) lief.
-- =====================================================================
drop policy if exists members_write on members;
create policy members_write on members for all
  using      (tenant_id = auth_tenant_id() and has_perm('members.edit'))
  with check (tenant_id = auth_tenant_id() and has_perm('members.edit'));

drop policy if exists proto_write on protocols;
create policy proto_write on protocols for all
  using      (tenant_id = auth_tenant_id() and has_perm('protokoll.edit'))
  with check (tenant_id = auth_tenant_id() and has_perm('protokoll.edit'));

drop policy if exists tenants_update on tenants;
create policy tenants_update on tenants for update
  using      (id = auth_tenant_id() and has_perm('roles.manage'))
  with check (id = auth_tenant_id() and has_perm('roles.manage'));

drop policy if exists roles_write on roles;
create policy roles_write on roles for all
  using      (tenant_id = auth_tenant_id() and has_perm('roles.manage') and not is_locked)
  with check (tenant_id = auth_tenant_id() and has_perm('roles.manage') and not is_locked);

drop policy if exists role_permissions_write on role_permissions;
create policy role_permissions_write on role_permissions for all
  using (
    has_perm('roles.manage')
    and exists (select 1 from roles r
                where r.id = role_permissions.role_id
                  and r.tenant_id = auth_tenant_id() and not r.is_locked)
  )
  with check (
    has_perm('roles.manage')
    and exists (select 1 from roles r
                where r.id = role_permissions.role_id
                  and r.tenant_id = auth_tenant_id() and not r.is_locked)
  );

drop policy if exists member_roles_write on member_roles;
create policy member_roles_write on member_roles for all
  using (
    has_perm('roles.manage')
    and exists (select 1 from members m
                where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id())
  )
  with check (
    has_perm('roles.manage')
    and exists (select 1 from members m
                where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id())
    and exists (select 1 from roles r
                where r.id = member_roles.role_id and r.tenant_id = auth_tenant_id())
  );


-- =====================================================================
-- TEIL C – Buchungen: das Basisschema erlaubt tx_write nur als INSERT
-- (kein UPDATE/DELETE, gewollt). Nur sicherstellen, dass with check greift.
-- =====================================================================
drop policy if exists tx_write on transactions;
create policy tx_write on transactions for insert
  with check (tenant_id = auth_tenant_id() and module_active('kassa') and has_perm('kassa.edit'));


-- =====================================================================
-- TEIL D – AUDIT (nur Anzeige): der ganze Fehlerklasse auf der Spur
--
-- D1: JEDE Schreib-Policy (INSERT/UPDATE/ALL) OHNE with-check-Klausel.
--     Jede Zeile hier ist ein Leck wie bei news: der Insert wird nicht geprüft.
--     Erwartung nach diesem Skript: 0 Zeilen.
-- =====================================================================
select 'D1: Schreib-Policy ohne with-check' as befund,
       schemaname, tablename, policyname, cmd
from pg_policies
where schemaname in ('public', 'storage')
  and cmd in ('INSERT', 'UPDATE', 'ALL')
  and with_check is null
order by schemaname, tablename, policyname;

-- D2: Tabellen mit aktivierter RLS, die GAR KEINE INSERT-fähige Policy haben
--     (RLS an + keine passende Policy = alle Inserts werden abgelehnt – genau
--     das Symptom bei news, falls die Insert-Policy fehlte). Erwartung: news
--     ist NICHT dabei (hat jetzt news_insert). Andere Tabellen ohne Insert-Weg
--     sind teils gewollt (reine Lese-/Funktions-Tabellen).
select 'D2: RLS an, aber keine INSERT/ALL-Policy' as befund,
       c.relname as tabelle
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
      and p.cmd in ('INSERT', 'ALL')
  )
order by c.relname;

-- D3: alle news-Policies zur Sichtkontrolle
select 'D3: news-Policies' as befund, policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public' and tablename = 'news'
order by policyname;


-- =====================================================================
-- TEIL E – Rechte- und Live-Test
--
-- E1: Hat der Systemadmin / haben die Rollen news.post? Falls der Fehler NICHT
--     an der Policy lag, sondern am fehlenden Recht, sieht man es hier.
-- =====================================================================
select 'E1: news.post pro Rolle' as befund,
       r.label as rolle,
       exists (
         select 1 from role_permissions rp
         where rp.role_id = r.id and rp.permission_key = 'news.post'
       ) as hat_news_post
from roles r
join tenants t on t.id = r.tenant_id and t.slug = 'goedersdorf'
order by r.sort_order;

-- E2: Der eigentliche Live-Test-Insert steht in einer EIGENEN Datei:
--     supabase/test_news_insert.sql
--     Grund: Der Test nutzt begin/rollback. Fasst der SQL-Editor dieses Skript
--     hier in eine Transaktion, würde ein rollback im Test auch die Policy-
--     Änderungen aus Teil A–C verwerfen. Deshalb strikt getrennt:
--     ZUERST diese Datei ausführen, DANN test_news_insert.sql.

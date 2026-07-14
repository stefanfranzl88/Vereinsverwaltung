-- =====================================================================
-- VEREINSVERWALTUNG – KOMPLETT-SETUP
--
-- Ein Skript, im Supabase SQL-Editor als Ganzes ausführbar.
-- Durchgängig idempotent: Schon Vorhandenes wird nicht doppelt angelegt,
-- das Skript darf beliebig oft laufen.
--
-- VORAUSSETZUNG
--   1. vereinsverwaltung_schema.sql ist eingespielt (Tabellen + Hilfsfunktionen
--      auth_tenant_id(), auth_member_id(), has_perm(), module_active()).
--   2. Der Auth-Benutzer existiert:
--      Dashboard → Authentication → Users → Add user
--      → E-Mail + Passwort, "Auto Confirm User" aktivieren.
--
-- >>> E-MAIL DES AUTH-BENUTZERS: 'stefanfranzl88@gmail.com'
-- >>> Kommt in Abschnitt 3 und 4 vor. Bei abweichender Adresse dort ersetzen.
--
-- ABLAUF
--   0  Vorher-Befund
--   1  RLS-Policies + Storage        (ersetzt Migration 0002 und 0003)
--   2  Seed: Verein, Module, Rollen, Rechte, Mitglieder
--   3  Profil-Verknüpfung: Auth-Benutzer ↔ Verein ↔ Mitglied Stefan Franzl
--   4  Kontrollabfragen
--
-- HINWEIS ZUR REIHENFOLGE: RLS wird VOR dem Seed aktiviert. Das ist unkritisch –
-- der SQL-Editor läuft als Rolle 'postgres' und umgeht RLS (BYPASSRLS).
-- =====================================================================


-- =====================================================================
-- 0) VORHER-BEFUND – was ist schon da?
-- =====================================================================
select 'VORHER' as phase,
       (select count(*) from modules)           as module,
       (select count(*) from permissions)       as rechte,
       (select count(*) from tenants)           as vereine,
       (select count(*) from tenant_modules)    as gebuchte_module,
       (select count(*) from roles)             as rollen,
       (select count(*) from role_permissions)  as rollenrechte,
       (select count(*) from members)           as mitglieder,
       (select count(*) from member_roles)      as mitglied_rollen,
       (select count(*) from profiles)          as profile,
       (select count(*) from auth.users)        as auth_benutzer;


-- =====================================================================
-- 1) ROW LEVEL SECURITY
--
-- Das Basisschema (Abschnitt 9) aktiviert RLS nur exemplarisch auf members,
-- transactions, invoices und protocols und endet mit einem TODO. Genau die
-- Tabellen, die der Login-Pfad liest – profiles, tenants, tenant_modules,
-- roles, member_roles – hatten gar keine. Sie wären damit über ALLE Vereine
-- hinweg lesbar und beschreibbar.
--
-- WICHTIG – häufiger Fallstrick, der auch im Basisschema steckt:
-- Bei einer "for all"-Policy wertet Postgres beim INSERT AUSSCHLIESSLICH die
-- with-check-Klausel aus; using wird dabei nicht herangezogen. Steht die
-- Rechteprüfung nur im using, kann jedes eingeloggte Mitglied INSERTen – also
-- sich selbst Rechte (role_permissions) oder die Admin-Rolle (member_roles)
-- erteilen. Deshalb steht has_perm(...) unten IMMER in BEIDEN Klauseln.
-- =====================================================================

-- --- profiles: eigenes Profil + Vereinskollegen lesen, schreiben nur am eigenen
alter table profiles enable row level security;

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (tenant_id = auth_tenant_id());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- --- tenants: nur der eigene Verein
alter table tenants enable row level security;

drop policy if exists tenants_select on tenants;
create policy tenants_select on tenants for select
  using (id = auth_tenant_id());

drop policy if exists tenants_update on tenants;
create policy tenants_update on tenants for update
  using (id = auth_tenant_id() and has_perm('roles.manage'))
  with check (id = auth_tenant_id() and has_perm('roles.manage'));

-- --- tenant_modules: Basis des Modul-Gatings. Lesen darf jedes Mitglied, sonst
--     kann die App die Navigation nicht aufbauen. Buchen/Kündigen bewusst NICHT
--     über die Client-API – das gehört ins Billing/Backoffice.
alter table tenant_modules enable row level security;

drop policy if exists tenant_modules_select on tenant_modules;
create policy tenant_modules_select on tenant_modules for select
  using (tenant_id = auth_tenant_id());

-- --- roles
alter table roles enable row level security;

drop policy if exists roles_select on roles;
create policy roles_select on roles for select
  using (tenant_id = auth_tenant_id());

drop policy if exists roles_write on roles;
create policy roles_write on roles for all
  using      (tenant_id = auth_tenant_id() and has_perm('roles.manage') and not is_locked)
  with check (tenant_id = auth_tenant_id() and has_perm('roles.manage') and not is_locked);

-- --- role_permissions: Kern der Rollen-Matrix.
--     Schreiben nur mit 'roles.manage', nur im eigenen Verein, nur bei NICHT
--     gesperrten Rollen (is_locked = Systemadmin-Spalte).
alter table role_permissions enable row level security;

drop policy if exists role_permissions_select on role_permissions;
create policy role_permissions_select on role_permissions for select
  using (exists (
    select 1 from roles r
    where r.id = role_permissions.role_id and r.tenant_id = auth_tenant_id()
  ));

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

-- --- member_roles: wer welche Rolle hat. Ohne den with-check-Fix könnte sich
--     jedes Mitglied selbst die Systemadmin-Rolle zuweisen.
alter table member_roles enable row level security;

drop policy if exists member_roles_select on member_roles;
create policy member_roles_select on member_roles for select
  using (exists (
    select 1 from members m
    where m.id = member_roles.member_id and m.tenant_id = auth_tenant_id()
  ));

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

-- --- members / protocols: Policies aus dem Basisschema neu setzen, weil dort
--     has_perm() in der with-check-Klausel fehlte (INSERT war ungeschützt).
drop policy if exists members_write on members;
create policy members_write on members for all
  using      (tenant_id = auth_tenant_id() and has_perm('members.edit'))
  with check (tenant_id = auth_tenant_id() and has_perm('members.edit'));

drop policy if exists proto_write on protocols;
create policy proto_write on protocols for all
  using      (tenant_id = auth_tenant_id() and has_perm('protokoll.edit'))
  with check (tenant_id = auth_tenant_id() and has_perm('protokoll.edit'));

-- --- key_chips: im Basisschema komplett ohne RLS. Die Mitgliederliste zeigt ein
--     🔑 neben Personen mit Schlüsselchip; ohne Policy wären die Chipnummern
--     ALLER Vereine für jeden Eingeloggten lesbar und änderbar.
--     Lesen: jedes Vereinsmitglied, sofern Modul 'schluessel' gebucht (wie im
--     Prototyp). Schreiben: nur mit 'keys.manage'.
alter table key_chips enable row level security;

drop policy if exists key_chips_select on key_chips;
create policy key_chips_select on key_chips for select
  using (tenant_id = auth_tenant_id() and module_active('schluessel'));

drop policy if exists key_chips_write on key_chips;
create policy key_chips_write on key_chips for all
  using      (tenant_id = auth_tenant_id() and module_active('schluessel') and has_perm('keys.manage'))
  with check (tenant_id = auth_tenant_id() and module_active('schluessel') and has_perm('keys.manage'));

-- --- Kataloge: für Eingeloggte lesbar, nicht beschreibbar
alter table modules enable row level security;
drop policy if exists modules_select on modules;
create policy modules_select on modules for select to authenticated using (true);

alter table permissions enable row level security;
drop policy if exists permissions_select on permissions;
create policy permissions_select on permissions for select to authenticated using (true);

-- --- Eigenes Profilbild setzen dürfen alle.
--     BEWUSST als Funktion, NICHT als update-Policy auf der eigenen Zeile:
--     RLS wirkt zeilen-, nicht spaltenweise. Eine Policy "id = auth_member_id()"
--     würde jedem Mitglied erlauben, an der eigenen Zeile ALLE Spalten zu ändern –
--     auch funktion oder status. Diese Funktion schreibt nur photo_path.
create or replace function set_own_avatar(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update members set photo_path = p_path where id = auth_member_id();
  if not found then
    raise exception 'Kein Mitglied mit dem eigenen Login verknüpft';
  end if;
end
$$;

revoke all on function set_own_avatar(text) from public;
grant execute on function set_own_avatar(text) to authenticated;

-- --- Storage: Bucket für Profilbilder, Pfad {tenant_id}/{member_id}.{ext}
--     Falls hier "must be owner of table objects" kommt: Bucket und Policies
--     stattdessen im Dashboard unter Storage anlegen.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth_tenant_id()::text);

drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth_tenant_id()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth_tenant_id()::text);


-- =====================================================================
-- 2) SEED
-- =====================================================================

-- --- 2.1 Modul-Katalog
insert into modules (key, label, is_core) values
  ('core',      'Basis (Mitglieder, Termine, Mitteilungen, Aufgaben, Protokolle)', true),
  ('kassa',     'Kassa & Rechnungswesen', false),
  ('events',    'Events & Projekte', false),
  ('inventar',  'Inventar & QR-Etiketten', false),
  ('dokumente', 'Dokumentenablage', false),
  ('schluessel','Schlüsselverwaltung', false),
  ('umfragen',  'Umfragen', false),
  ('chat',      'Vereins-Chat', false),
  ('mitarbeit', 'Mitarbeitspunkte', false)
on conflict (key) do nothing;

-- --- 2.2 Rechte-Katalog (jedes Recht gehört zu einem Modul → Modul-Gating)
insert into permissions (key, label, module_key) values
  ('members.edit',   'Mitglieder anlegen & bearbeiten',              'core'),
  ('news.post',      'Mitteilungen veröffentlichen',                 'core'),
  ('event.create',   'Termine, Events & Projekte anlegen',           'core'),
  ('protokoll.edit', 'Protokolle verfassen',                         'core'),
  ('tasks.viewall',  'Aufgabenübersicht einsehen',                   'core'),
  ('tasks.create',   'Aufgaben erfassen & zuteilen',                 'core'),
  ('roles.view',     'Rollen-Matrix einsehen',                       'core'),
  ('roles.manage',   'Rollen & Einstellungen verwalten',             'core'),
  ('kassa.view',     'Kassa einsehen',                               'kassa'),
  ('kassa.edit',     'Buchungen erfassen',                           'kassa'),
  ('invoice.viewall','Alle eingereichten Belege sehen',              'kassa'),
  ('invoice.approve','Rechnungen freigeben & Auszahlung bestätigen', 'kassa'),
  ('survey.create',  'Umfragen erstellen',                           'umfragen'),
  ('inventar.manage','Inventar verwalten',                           'inventar'),
  ('reserve.approve','Leihartikel/Reservierungen freigeben',         'inventar'),
  ('docs.view',      'Dokumentenablage einsehen',                    'dokumente'),
  ('docs.manage',    'Dokumente hochladen & löschen',                'dokumente'),
  ('keys.view',      'Schlüsselverwaltung einsehen',                 'schluessel'),
  ('keys.manage',    'Schlüsselchips verwalten',                     'schluessel'),
  ('keylog.view',    'Zutrittsprotokoll einsehen',                   'schluessel'),
  ('keylog.upload',  'Zutrittsprotokoll hochladen',                  'schluessel')
on conflict (key) do nothing;

-- --- 2.3 Verein
insert into tenants (name, slug, dekade)
values ('Dorfgemeinschaft Gödersdorf', 'goedersdorf', '2023 – 2028')
on conflict (slug) do nothing;

-- --- 2.4 Gebuchte Module. Hier steuerst du das Modul-Gating der App:
--         Zeile entfernen = der Navigationspunkt verschwindet.
insert into tenant_modules (tenant_id, module_key)
select t.id, m.key
from tenants t
cross join (values
  ('core'),('kassa'),('events'),('inventar'),('dokumente'),
  ('schluessel'),('umfragen'),('chat'),('mitarbeit')
) as m(key)
where t.slug = 'goedersdorf'
on conflict (tenant_id, module_key) do nothing;

-- --- 2.5 Rollen (pro Verein). is_locked = in der Matrix gesperrt.
insert into roles (tenant_id, key, label, sort_order, is_locked)
select t.id, r.key, r.label, r.sort_order, r.is_locked
from tenants t
cross join (values
  ('obmann',         'Obmann',            1, false),
  ('obmann_stv',     'Obmann Stv.',       2, false),
  ('schriftfuehrer', 'Schriftführer',     3, false),
  ('schriftf_stv',   'Schriftf. Stv.',    4, false),
  ('kassier',        'Kassier',           5, false),
  ('kassier_stv',    'Kassier Stv.',      6, false),
  ('ausschuss',      'Ausschussmitglied', 7, false),
  ('mitglied',       'Mitglied',          8, false),
  ('admin',          'Systemadmin',       9, true)
) as r(key, label, sort_order, is_locked)
where t.slug = 'goedersdorf'
on conflict (tenant_id, key) do nothing;

-- --- 2.6 Rolle → Rechte (Rechteverteilung aus dem Prototyp).
--         Das ist die EINZIGE Quelle der Wahrheit: dieselben Zeilen steuern
--         die Anzeige im Frontend und has_perm() in den RLS-Policies.
--         Änderbar zur Laufzeit über die Rollen-Matrix unter /rollen.
with rp(role_key, perm) as (values
  ('obmann','kassa.view'),('obmann','invoice.viewall'),('obmann','reserve.approve'),
  ('obmann','tasks.viewall'),('obmann','docs.view'),('obmann','roles.view'),
  ('obmann','keys.view'),('obmann','keylog.view'),

  ('obmann_stv','kassa.view'),('obmann_stv','invoice.viewall'),('obmann_stv','reserve.approve'),
  ('obmann_stv','tasks.viewall'),('obmann_stv','docs.view'),('obmann_stv','roles.view'),
  ('obmann_stv','keys.view'),('obmann_stv','keylog.view'),

  ('schriftfuehrer','protokoll.edit'),('schriftfuehrer','event.create'),('schriftfuehrer','news.post'),
  ('schriftfuehrer','survey.create'),('schriftfuehrer','reserve.approve'),('schriftfuehrer','tasks.viewall'),
  ('schriftfuehrer','tasks.create'),('schriftfuehrer','docs.view'),('schriftfuehrer','docs.manage'),
  ('schriftfuehrer','roles.view'),('schriftfuehrer','keys.view'),('schriftfuehrer','keylog.view'),

  ('schriftf_stv','protokoll.edit'),('schriftf_stv','event.create'),('schriftf_stv','news.post'),
  ('schriftf_stv','survey.create'),('schriftf_stv','reserve.approve'),('schriftf_stv','tasks.viewall'),
  ('schriftf_stv','tasks.create'),('schriftf_stv','docs.view'),('schriftf_stv','docs.manage'),
  ('schriftf_stv','roles.view'),('schriftf_stv','keys.view'),('schriftf_stv','keylog.view'),

  ('kassier','kassa.view'),('kassier','kassa.edit'),('kassier','invoice.approve'),
  ('kassier','invoice.viewall'),('kassier','reserve.approve'),('kassier','tasks.viewall'),
  ('kassier','tasks.create'),('kassier','docs.view'),('kassier','roles.view'),
  ('kassier','keys.view'),('kassier','keylog.view'),

  ('kassier_stv','kassa.view'),('kassier_stv','kassa.edit'),('kassier_stv','invoice.approve'),
  ('kassier_stv','invoice.viewall'),('kassier_stv','reserve.approve'),('kassier_stv','tasks.viewall'),
  ('kassier_stv','tasks.create'),('kassier_stv','docs.view'),('kassier_stv','roles.view'),
  ('kassier_stv','keys.view'),('kassier_stv','keylog.view'),

  ('admin','members.edit'),('admin','kassa.view'),('admin','kassa.edit'),('admin','event.create'),
  ('admin','protokoll.edit'),('admin','survey.create'),('admin','invoice.approve'),
  ('admin','invoice.viewall'),('admin','news.post'),('admin','tasks.viewall'),('admin','tasks.create'),
  ('admin','inventar.manage'),('admin','reserve.approve'),('admin','docs.view'),('admin','docs.manage'),
  ('admin','keys.view'),('admin','keys.manage'),('admin','keylog.view'),('admin','keylog.upload'),
  ('admin','roles.view'),('admin','roles.manage')
  -- 'ausschuss' und 'mitglied' haben bewusst keine Zusatzrechte.
)
insert into role_permissions (role_id, permission_key)
select r.id, rp.perm
from rp
join tenants t on t.slug = 'goedersdorf'
join roles r on r.tenant_id = t.id and r.key = rp.role_key
on conflict (role_id, permission_key) do nothing;

-- --- 2.7 Die acht Demo-Mitglieder aus dem Prototyp.
--         Existenz-Check über Vor-/Nachname statt on conflict: members hat
--         keinen Unique-Constraint auf (tenant_id, name).
insert into members (tenant_id, first_name, last_name, email, phone, joined_at, status, funktion)
select t.id, m.first_name, m.last_name, m.email, m.phone, m.joined_at::date, 'aktiv', m.funktion
from tenants t
cross join (values
  ('Markus',    'Smole',    'm.smole@example.at',      '0664 1234567', '2008-03-01', 'Obmann'),
  ('Christoph', 'Kovac',    'c.kovac@example.at',      '0676 2345678', '2012-06-15', 'Kassier'),
  ('Sandro',    'Omann',    's.omann@example.at',      '0699 3456789', '2019-01-20', 'Schriftführer'),
  ('Florian',   'Franzl',   'f.franzl@example.at',     '0660 4567890', '2021-07-05', null),
  ('Markus',    'Gelbmann', 'm.gelbmann@example.at',   '0664 5678901', '2016-07-11', 'Obmann Stv.'),
  ('Aileen',    'Umele',    'a.umele@example.at',      '0676 6789012', '2023-02-28', 'Schriftführer Stv.'),
  ('Stefan',    'Giefer',   's.giefer@example.at',     '0650 7890123', '2005-11-30', 'Ausschussmitglied'),
  ('Stefan',    'Franzl',   'stefan.franzl@example.at','0664 8901234', '2010-09-14', 'Kassier Stv.')
) as m(first_name, last_name, email, phone, joined_at, funktion)
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from members ex
    where ex.tenant_id = t.id
      and ex.first_name = m.first_name
      and ex.last_name  = m.last_name
  );

-- --- 2.8 Mitglied → Rolle, abgeleitet aus der Funktion
insert into member_roles (member_id, role_id)
select m.id, r.id
from members m
join tenants t on t.id = m.tenant_id and t.slug = 'goedersdorf'
join roles r on r.tenant_id = t.id and r.key = case m.funktion
    when 'Obmann'             then 'obmann'
    when 'Obmann Stv.'        then 'obmann_stv'
    when 'Schriftführer'      then 'schriftfuehrer'
    when 'Schriftführer Stv.' then 'schriftf_stv'
    when 'Kassier'            then 'kassier'
    when 'Kassier Stv.'       then 'kassier_stv'
    when 'Ausschussmitglied'  then 'ausschuss'
    else 'mitglied'
  end
on conflict (member_id, role_id) do nothing;


-- --- 2.9 Schlüsselchips (aus dem Prototyp). Sie erzeugen das 🔑 in der
--         Mitgliederliste. chip_nr ist unique je Verein → on conflict greift.
insert into key_chips (tenant_id, member_id, chip_nr, issued_at)
select t.id, m.id, c.chip_nr, c.issued_at::date
from tenants t
join (values
  ('Markus',    'Smole',  'CHIP-001', '2026-03-10'),
  ('Christoph', 'Kovac',  'CHIP-002', '2026-03-10'),
  ('Stefan',    'Franzl', 'CHIP-003', '2026-03-10'),
  ('Stefan',    'Giefer', 'CHIP-004', '2026-04-02'),
  ('Florian',   'Franzl', 'CHIP-005', '2026-05-20')
) as c(first_name, last_name, chip_nr, issued_at) on true
join members m on m.tenant_id = t.id
              and m.first_name = c.first_name
              and m.last_name  = c.last_name
where t.slug = 'goedersdorf'
on conflict (tenant_id, chip_nr) do nothing;


-- =====================================================================
-- 3) PROFIL – Auth-Benutzer ↔ Verein ↔ Mitglied
--
-- Das Mitglied wird über VOR- UND NACHNAME gematcht, NICHT über die E-Mail:
-- Der Auth-Login lautet stefanfranzl88@gmail.com, der Seed legt Stefan Franzl
-- mit stefan.franzl@example.at an (so steht es im Prototyp). Ein Join über
-- E-Mail-Gleichheit fände null Zeilen und würde kommentarlos nichts einfügen –
-- die App meldete weiter "Kein Vereinszugang", ohne Fehler.
--
-- is_sysadmin = true: hat unabhängig von der Rollen-Matrix alle Rechte
-- (so wie has_perm() es in der DB auch auswertet).
-- =====================================================================
insert into profiles (id, tenant_id, member_id, is_sysadmin)
select u.id, t.id, m.id, true
from auth.users u
join tenants t on t.slug = 'goedersdorf'
join members m on m.tenant_id = t.id
              and m.first_name = 'Stefan'
              and m.last_name  = 'Franzl'
where u.email = 'stefanfranzl88@gmail.com'
on conflict (id) do update
  set tenant_id   = excluded.tenant_id,
      member_id   = excluded.member_id,
      is_sysadmin = excluded.is_sysadmin;

-- Stefan zusätzlich die Systemadmin-Rolle geben. is_sysadmin deckt die Rechte
-- ohnehin ab; die Rolle macht es in der Rollen-Matrix sichtbar.
insert into member_roles (member_id, role_id)
select m.id, r.id
from tenants t
join members m on m.tenant_id = t.id and m.first_name = 'Stefan' and m.last_name = 'Franzl'
join roles r on r.tenant_id = t.id and r.key = 'admin'
where t.slug = 'goedersdorf'
on conflict (member_id, role_id) do nothing;


-- =====================================================================
-- 4) KONTROLLABFRAGEN
-- =====================================================================

-- --- 4.1 Zeilenzahlen. Erwartet nach dem ersten Lauf:
--         module 9 · rechte 21 · vereine 1 · gebuchte_module 9 · rollen 9
--         rollenrechte 83 · mitglieder 8 · mitglied_rollen 9 · profile 1
--
--         rollenrechte 83 = obmann 8 + obmann_stv 8 + schriftführer 12
--                         + schriftf_stv 12 + kassier 11 + kassier_stv 11
--                         + admin 21   (ausschuss und mitglied: 0)
--         mitglied_rollen 9 = 8 Mitglieder je 1 Rolle + Stefan zusätzlich 'admin'
select 'NACHHER' as phase,
       (select count(*) from modules)           as module,
       (select count(*) from permissions)       as rechte,
       (select count(*) from tenants)           as vereine,
       (select count(*) from tenant_modules)    as gebuchte_module,
       (select count(*) from roles)             as rollen,
       (select count(*) from role_permissions)  as rollenrechte,
       (select count(*) from members)           as mitglieder,
       (select count(*) from member_roles)      as mitglied_rollen,
       (select count(*) from profiles)          as profile;

-- --- 4.2 Dein Profil. MUSS GENAU EINE ZEILE liefern.
--         Kommt nichts zurück, existiert kein Auth-Benutzer mit dieser E-Mail
--         → Dashboard → Authentication → Users prüfen.
select
  u.email                            as auth_login,
  t.name                             as verein,
  m.first_name || ' ' || m.last_name as mitglied,
  m.funktion,
  p.is_sysadmin,
  p.consented_at,
  (select string_agg(r.label, ', ' order by r.sort_order)
     from member_roles mr join roles r on r.id = mr.role_id
    where mr.member_id = m.id)       as rollen
from profiles p
join auth.users u on u.id = p.id
join tenants t    on t.id = p.tenant_id
left join members m on m.id = p.member_id
where u.email = 'stefanfranzl88@gmail.com';

-- --- 4.3 Rechte pro Rolle – die Matrix, wie /rollen sie anzeigen wird.
select r.label as rolle, count(rp.permission_key) as anzahl_rechte
from roles r
join tenants t on t.id = r.tenant_id and t.slug = 'goedersdorf'
left join role_permissions rp on rp.role_id = r.id
group by r.label, r.sort_order
order by r.sort_order;

-- --- 4.4 Sicherheitscheck: Jede Schreib-Policy muss die Rechteprüfung in
--         BEIDEN Klauseln tragen. Beide Spalten müssen 'true' sein.
--         'qual' = using (greift bei UPDATE/DELETE)
--         'with_check' = with check (greift bei INSERT)
select
  tablename,
  policyname,
  qual       is not null and qual       like '%has_perm%' as using_geprueft,
  with_check is not null and with_check like '%has_perm%' as check_geprueft
from pg_policies
where schemaname = 'public'
  and policyname in (
    'role_permissions_write','member_roles_write','roles_write',
    'members_write','proto_write','tenants_update'
  )
order by tablename;

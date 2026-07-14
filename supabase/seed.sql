-- =====================================================================
-- SEED – Grunddaten für einen Verein
-- Idempotent: kann gefahrlos mehrfach im Supabase SQL-Editor laufen.
--
-- Setzt voraus, dass vereinsverwaltung_schema.sql bereits eingespielt ist.
-- Reihenfolge: Katalogdaten → Verein → Module → Rollen → Rechte → Mitglieder.
-- =====================================================================

-- ---------------------------------------------------------------
-- 1) Katalogdaten (im Schema enthalten, hier zur Sicherheit nachgezogen)
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- 2) Verein
-- ---------------------------------------------------------------
insert into tenants (name, slug, dekade)
values ('Dorfgemeinschaft Gödersdorf', 'goedersdorf', '2023 – 2028')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------
-- 3) Gebuchte Module
-- Hier steuerst du das Modul-Gating: Zeile löschen = Bereich verschwindet
-- aus der App. 'core' ist immer aktiv, auch ohne Zeile.
-- ---------------------------------------------------------------
insert into tenant_modules (tenant_id, module_key)
select t.id, m.key
from tenants t
cross join (values ('core'),('kassa'),('events'),('inventar'),('dokumente'),('schluessel'),('umfragen'),('chat'),('mitarbeit')) as m(key)
where t.slug = 'goedersdorf'
on conflict (tenant_id, module_key) do nothing;

-- ---------------------------------------------------------------
-- 4) Rollen (pro Verein) – Schlüssel identisch zu src/auth/roles.ts
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- 5) Rolle → Rechte
-- MUSS mit der ROLES-Map in src/auth/roles.ts übereinstimmen. Sonst zeigt das
-- Frontend Aktionen an, die die RLS-Policy (has_perm) anschließend ablehnt.
-- ---------------------------------------------------------------
with rp(role_key, perm) as (values
  -- Obmann / Obmann Stv.
  ('obmann','kassa.view'),('obmann','invoice.viewall'),('obmann','reserve.approve'),
  ('obmann','tasks.viewall'),('obmann','docs.view'),('obmann','roles.view'),
  ('obmann','keys.view'),('obmann','keylog.view'),
  ('obmann_stv','kassa.view'),('obmann_stv','invoice.viewall'),('obmann_stv','reserve.approve'),
  ('obmann_stv','tasks.viewall'),('obmann_stv','docs.view'),('obmann_stv','roles.view'),
  ('obmann_stv','keys.view'),('obmann_stv','keylog.view'),

  -- Schriftführer / Stv.
  ('schriftfuehrer','protokoll.edit'),('schriftfuehrer','event.create'),('schriftfuehrer','news.post'),
  ('schriftfuehrer','survey.create'),('schriftfuehrer','reserve.approve'),('schriftfuehrer','tasks.viewall'),
  ('schriftfuehrer','tasks.create'),('schriftfuehrer','docs.view'),('schriftfuehrer','docs.manage'),
  ('schriftfuehrer','roles.view'),('schriftfuehrer','keys.view'),('schriftfuehrer','keylog.view'),
  ('schriftf_stv','protokoll.edit'),('schriftf_stv','event.create'),('schriftf_stv','news.post'),
  ('schriftf_stv','survey.create'),('schriftf_stv','reserve.approve'),('schriftf_stv','tasks.viewall'),
  ('schriftf_stv','tasks.create'),('schriftf_stv','docs.view'),('schriftf_stv','docs.manage'),
  ('schriftf_stv','roles.view'),('schriftf_stv','keys.view'),('schriftf_stv','keylog.view'),

  -- Kassier / Stv.
  ('kassier','kassa.view'),('kassier','kassa.edit'),('kassier','invoice.approve'),
  ('kassier','invoice.viewall'),('kassier','reserve.approve'),('kassier','tasks.viewall'),
  ('kassier','tasks.create'),('kassier','docs.view'),('kassier','roles.view'),
  ('kassier','keys.view'),('kassier','keylog.view'),
  ('kassier_stv','kassa.view'),('kassier_stv','kassa.edit'),('kassier_stv','invoice.approve'),
  ('kassier_stv','invoice.viewall'),('kassier_stv','reserve.approve'),('kassier_stv','tasks.viewall'),
  ('kassier_stv','tasks.create'),('kassier_stv','docs.view'),('kassier_stv','roles.view'),
  ('kassier_stv','keys.view'),('kassier_stv','keylog.view'),

  -- Systemadmin: alle Rechte
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

-- ---------------------------------------------------------------
-- 6) Mitglieder (aus dem Prototyp)
-- ---------------------------------------------------------------
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
    where ex.tenant_id = t.id and ex.email = m.email
  );

-- ---------------------------------------------------------------
-- 7) Mitglied → Rolle (leitet sich aus der Funktion ab)
-- ---------------------------------------------------------------
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

-- =====================================================================
-- DEMO-INHALTE EVENTS & PROJEKTE
--
-- Ergänzt die beiden big_events aus seed_demo_content.sql um Beschreibung,
-- Zeitraum, Kostenstelle, Subtermine, Abteilungen und Einteilung.
--
-- Voraussetzung: setup_complete.sql, seed_demo_content.sql und – für die
-- Verknüpfung der Kostenstellen – seed_demo_kassa.sql sind gelaufen.
--
-- Idempotent: Existenz-Checks; mehrfach ausführbar.
-- =====================================================================


-- ---------------------------------------------------------------
-- 1) Beide Einträge ergänzen (Zeitraum, Beschreibung)
--    seed_demo_content.sql hat sie bereits angelegt – hier nur nachziehen.
-- ---------------------------------------------------------------
update big_events be
   set date_from   = '2026-08-18',
       date_to     = '2026-08-23',
       description = 'Unser größtes Fest im Jahr: 3 Tage Aufbau, dann 3 Tage Kirchtagsbetrieb am Festgelände Dorfplatz. Anlieferung Getränke am 19.08., Behördenabnahme (Elektrik & Brandschutz) am 20.08. um 15 Uhr.'
  from tenants t
 where t.id = be.tenant_id and t.slug = 'goedersdorf'
   and be.name = 'Jahreskirchtag 2026';

update big_events be
   set date_from   = '2026-04-01',
       date_to     = '2027-06-30',
       description = 'Errichtung eines neuen Lagerraums (ca. 40 m²) hinter dem Vereinsheim, großteils in Eigenleistung. Förderansuchen bei Land und Gemeinde laufen, Einreichplan liegt bei der Gemeinde.'
  from tenants t
 where t.id = be.tenant_id and t.slug = 'goedersdorf'
   and be.name = 'Neubau Lagerraum';


-- ---------------------------------------------------------------
-- 2) Kostenstelle verknüpfen – Basis für "Zur Nachkalkulation".
--    Läuft ins Leere, wenn seed_demo_kassa.sql nicht eingespielt wurde;
--    das ist unkritisch, der Button erscheint dann einfach nicht.
-- ---------------------------------------------------------------
update big_events be
   set cost_center_id = cc.id
  from tenants t, cost_centers cc
 where t.id = be.tenant_id and t.slug = 'goedersdorf'
   and cc.tenant_id = t.id
   and cc.name = be.name          -- "Jahreskirchtag 2026", "Neubau Lagerraum"
   and be.cost_center_id is null;


-- ---------------------------------------------------------------
-- 3) Subtermine
-- ---------------------------------------------------------------
insert into big_event_subs (big_event_id, sub_date, sub_time, title)
select be.id, s.sub_date::date, s.sub_time::time, s.title
from tenants t
join big_events be on be.tenant_id = t.id
join (values
  ('Jahreskirchtag 2026', '2026-08-18', '16:00', 'Aufbau Tag 1 – Festzelt & Boden'),
  ('Jahreskirchtag 2026', '2026-08-19', '16:00', 'Aufbau Tag 2 – Bierbude, Kühlung, Strom'),
  ('Jahreskirchtag 2026', '2026-08-20', '16:00', 'Aufbau Tag 3 – Deko & Endkontrolle'),
  ('Jahreskirchtag 2026', '2026-08-21', '18:00', 'Kirchtag Tag 1 – Eröffnung & Livemusik'),
  ('Jahreskirchtag 2026', '2026-08-22', '14:00', 'Kirchtag Tag 2 – Familiennachmittag'),
  ('Jahreskirchtag 2026', '2026-08-23', '10:00', 'Kirchtag Tag 3 – Frühschoppen & Abbau'),
  ('Neubau Lagerraum',    '2026-09-05', '08:00', 'Fundament betonieren (Helfertag)'),
  ('Neubau Lagerraum',    '2026-10-17', '08:00', 'Rohbau / Mauern (Helfertag)'),
  ('Neubau Lagerraum',    '2027-04-10', '08:00', 'Innenausbau & Regale')
) as s(event_name, sub_date, sub_time, title) on s.event_name = be.name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from big_event_subs ex
    where ex.big_event_id = be.id and ex.title = s.title
  );


-- ---------------------------------------------------------------
-- 4) Abteilungen
-- ---------------------------------------------------------------
insert into departments (big_event_id, name)
select be.id, d.dept_name
from tenants t
join big_events be on be.tenant_id = t.id
join (values
  ('Jahreskirchtag 2026', 'Bierbude'),
  ('Jahreskirchtag 2026', 'Küche & Grill'),
  ('Jahreskirchtag 2026', 'Kassa & Eintritt'),
  ('Neubau Lagerraum',    'Bauleitung'),
  ('Neubau Lagerraum',    'Finanzierung & Förderungen')
) as d(event_name, dept_name) on d.event_name = be.name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from departments ex
    where ex.big_event_id = be.id and ex.name = d.dept_name
  );


-- ---------------------------------------------------------------
-- 5) Einteilung – Vereinsmitglieder
--    member_id gesetzt, external_name null (das Schema erzwingt genau eines).
-- ---------------------------------------------------------------
insert into dept_assignments (department_id, member_id, external_name, role, note)
select dep.id, m.id, null, a.role, nullif(a.note, '')
from tenants t
join big_events be on be.tenant_id = t.id
join departments dep on dep.big_event_id = be.id
join (values
  ('Jahreskirchtag 2026', 'Bierbude',                   'Stefan',    'Giefer',   'lead', 'hat Schlüssel für Kühlanhänger'),
  ('Jahreskirchtag 2026', 'Bierbude',                   'Florian',   'Franzl',   'crew', 'Schicht Fr + Sa'),
  ('Jahreskirchtag 2026', 'Küche & Grill',              'Aileen',    'Umele',    'lead', 'Einkauf mit C. Kovac abstimmen'),
  ('Jahreskirchtag 2026', 'Küche & Grill',              'Markus',    'Gelbmann', 'crew', ''),
  ('Jahreskirchtag 2026', 'Kassa & Eintritt',           'Christoph', 'Kovac',    'lead', 'Wechselgeld bis 20.08. besorgen'),
  ('Jahreskirchtag 2026', 'Kassa & Eintritt',           'Stefan',    'Franzl',   'crew', 'Ablöse ab 21 Uhr'),
  ('Neubau Lagerraum',    'Bauleitung',                 'Markus',    'Gelbmann', 'lead', 'Ansprechpartner Gemeinde & Statiker'),
  ('Neubau Lagerraum',    'Bauleitung',                 'Stefan',    'Giefer',   'crew', 'Bagger für Aushub organisieren'),
  ('Neubau Lagerraum',    'Finanzierung & Förderungen', 'Christoph', 'Kovac',    'lead', 'Landesförderung eingereicht 05/2026'),
  ('Neubau Lagerraum',    'Finanzierung & Förderungen', 'Stefan',    'Franzl',   'crew', 'Kostenverfolgung über Kostenstelle')
) as a(event_name, dept_name, first_name, last_name, role, note)
  on a.event_name = be.name and a.dept_name = dep.name
join members m on m.tenant_id = t.id
              and m.first_name = a.first_name
              and m.last_name  = a.last_name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from dept_assignments ex
    where ex.department_id = dep.id and ex.member_id = m.id
  );


-- ---------------------------------------------------------------
-- 6) Einteilung – externe Helfer
--    Kein Vereinsmitglied, kein Login: member_id null, external_name gesetzt.
-- ---------------------------------------------------------------
insert into dept_assignments (department_id, member_id, external_name, role, note)
select dep.id, null, x.person, 'crew', nullif(x.note, '')
from tenants t
join big_events be on be.tenant_id = t.id
join departments dep on dep.big_event_id = be.id
join (values
  ('Jahreskirchtag 2026', 'Bierbude',      'Hans Wieser',    'externer Helfer, ab 17 Uhr'),
  ('Jahreskirchtag 2026', 'Bierbude',      'Julia Prasser',  'externe Helferin, nur Samstag'),
  ('Jahreskirchtag 2026', 'Küche & Grill', 'Gerhard Malle',  'extern, bringt eigenen Griller mit')
) as x(event_name, dept_name, person, note)
  on x.event_name = be.name and x.dept_name = dep.name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from dept_assignments ex
    where ex.department_id = dep.id and ex.external_name = x.person
  );


-- ---------------------------------------------------------------
-- KONTROLLE
-- Erwartet: 2 Events/Projekte · 9 Subtermine · 5 Abteilungen
--           13 Einteilungen (10 Mitglieder + 3 Externe)
-- ---------------------------------------------------------------
select
  (select count(*) from big_events be join tenants t on t.id = be.tenant_id
    where t.slug='goedersdorf')                                          as events_projekte,
  (select count(*) from big_event_subs s join big_events be on be.id = s.big_event_id
    join tenants t on t.id = be.tenant_id where t.slug='goedersdorf')    as subtermine,
  (select count(*) from departments d join big_events be on be.id = d.big_event_id
    join tenants t on t.id = be.tenant_id where t.slug='goedersdorf')    as abteilungen,
  (select count(*) from dept_assignments a
     join departments d on d.id = a.department_id
     join big_events be on be.id = d.big_event_id
     join tenants t on t.id = be.tenant_id where t.slug='goedersdorf')   as einteilungen,
  (select count(*) from dept_assignments a
     join departments d on d.id = a.department_id
     join big_events be on be.id = d.big_event_id
     join tenants t on t.id = be.tenant_id
    where t.slug='goedersdorf' and a.external_name is not null)          as davon_extern;

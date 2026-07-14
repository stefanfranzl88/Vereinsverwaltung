-- =====================================================================
-- DEMO-INHALTE PROTOKOLLE: Protokolle, Anwesenheit, Aufgaben-Verknüpfung
--
-- Optional. Voraussetzung: setup_complete.sql und 0010_protokolle.sql.
-- Idempotent: Existenz-Checks; mehrfach ausführbar.
--
-- Zwei der Protokolle haben Sichtbarkeit 'vorstand' – damit lässt sich prüfen,
-- dass RLS sie für ein normales Mitglied (z. B. Florian Franzl) ausblendet.
-- =====================================================================


-- ---------------------------------------------------------------
-- 1) Protokolle
-- ---------------------------------------------------------------
insert into protocols (tenant_id, title, proto_date, time_from, time_to, location,
                       proto_type, visibility, author_id, body)
select t.id, p.title, p.proto_date::date, p.time_from::time, p.time_to::time, p.location,
       p.proto_type, p.visibility, a.id, p.body
from tenants t
cross join (values
  ('Vorstandssitzung Juni', '2026-06-26', '19:30', '21:40', 'Vereinsheim', 'Sitzung', 'vorstand',
   E'Anwesend: Smole, Kovac, Omann, Gelbmann.\n\nTOP 1 – Sommerfest: Aufbau am 17.07. ab 16 Uhr, Getränkebestellung übernimmt C. Kovac.\nTOP 2 – Kassastand: Bericht des Kassiers, aktueller Saldo positiv, keine offenen Posten.\nTOP 3 – Jahreskirchtag: Abteilungseinteilung fixiert, Behördenabnahme am 20.08. beantragt.\nTOP 4 – Lagerraum: Fundament-Helfertag am 05.09. angesetzt.\n\nNächste Sitzung: 24.07.2026, 19:30 Uhr.'),

  ('Vorstandssitzung Mai', '2026-05-22', '19:30', '21:05', 'Vereinsheim', 'Sitzung', 'vorstand',
   E'Anwesend: Smole, Kovac, Omann.\n\nTOP 1 – Rückblick Frühjahrskonzert: positives Feedback, Reinerlös € 412,50.\nTOP 2 – Vereinszeitung: Sommerausgabe geht Mitte Juni in Druck.\nTOP 3 – Lagerraum: Förderansuchen beim Land eingereicht.'),

  ('Auf- & Abbau Frühjahrskonzert', '2026-05-16', '14:00', '17:30', 'Kultursaal', 'Aufbau', 'alle',
   E'Aufbau Samstag ab 14 Uhr (Bühne, Bestuhlung, Ausschank), Abbau Sonntag ab 9 Uhr.\n\nDanke an alle Helferinnen und Helfer – in 2,5 Stunden war alles erledigt!')
) as p(title, proto_date, time_from, time_to, location, proto_type, visibility, body)
join members a on a.tenant_id = t.id
              and a.first_name = 'Sandro'
              and a.last_name  = 'Omann'          -- Schriftführer
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from protocols ex
    where ex.tenant_id = t.id and ex.title = p.title
  );


-- ---------------------------------------------------------------
-- 2) Anwesenheit
--    Basis für die Mitarbeitspunkte: Sitzung 1 P, Aufbau/Abbau/
--    Veranstaltung 2 P.
-- ---------------------------------------------------------------
insert into protocol_attendance (protocol_id, member_id)
select pr.id, m.id
from tenants t
join protocols pr on pr.tenant_id = t.id
join (values
  ('Vorstandssitzung Juni',          'Markus',    'Smole'),
  ('Vorstandssitzung Juni',          'Christoph', 'Kovac'),
  ('Vorstandssitzung Juni',          'Sandro',    'Omann'),
  ('Vorstandssitzung Juni',          'Markus',    'Gelbmann'),

  ('Vorstandssitzung Mai',           'Markus',    'Smole'),
  ('Vorstandssitzung Mai',           'Christoph', 'Kovac'),
  ('Vorstandssitzung Mai',           'Sandro',    'Omann'),

  ('Auf- & Abbau Frühjahrskonzert',  'Markus',    'Smole'),
  ('Auf- & Abbau Frühjahrskonzert',  'Christoph', 'Kovac'),
  ('Auf- & Abbau Frühjahrskonzert',  'Sandro',    'Omann'),
  ('Auf- & Abbau Frühjahrskonzert',  'Florian',   'Franzl'),
  ('Auf- & Abbau Frühjahrskonzert',  'Markus',    'Gelbmann'),
  ('Auf- & Abbau Frühjahrskonzert',  'Aileen',    'Umele'),
  ('Auf- & Abbau Frühjahrskonzert',  'Stefan',    'Franzl')
) as a(proto_title, first_name, last_name) on a.proto_title = pr.title
join members m on m.tenant_id = t.id
              and m.first_name = a.first_name
              and m.last_name  = a.last_name
where t.slug = 'goedersdorf'
on conflict (protocol_id, member_id) do nothing;


-- ---------------------------------------------------------------
-- 3) Bestehende Aufgaben dem Protokoll zuordnen
--
--    seed_demo_content.sql hat die Sitzungs-Aufgaben mangels Protokoll-Modul
--    als 'manual' angelegt. Jetzt, wo die Protokolle existieren, werden sie
--    korrekt verknüpft – dann erscheinen sie im Protokoll-Detail unter
--    "Aufgabenverteilung" und in der Aufgabenübersicht mit dem Protokolltitel
--    als Zuordnung.
-- ---------------------------------------------------------------
update tasks tk
   set source_type = 'protocol',
       source_id   = pr.id
  from tenants t, protocols pr
 where t.slug = 'goedersdorf'
   and tk.tenant_id = t.id
   and pr.tenant_id = t.id
   and pr.title = 'Vorstandssitzung Juni'
   and tk.source_type = 'manual'
   and tk.title in (
     'Getränkebestellung Sommerfest aufgeben',
     'Aufbauplan Sommerfest erstellen und verteilen',
     'Deko-Material für Sommerfest besorgen',
     'Einladung Generalversammlung entwerfen'
   );


-- ---------------------------------------------------------------
-- KONTROLLE
-- Erwartet: 3 Protokolle (2 davon "nur Vorstand") · 14 Anwesenheiten
--           · 4 Aufgaben mit Protokoll-Zuordnung
-- ---------------------------------------------------------------
select
  (select count(*) from protocols p join tenants t on t.id = p.tenant_id
    where t.slug='goedersdorf')                                            as protokolle,
  (select count(*) from protocols p join tenants t on t.id = p.tenant_id
    where t.slug='goedersdorf' and p.visibility = 'vorstand')              as nur_vorstand,
  (select count(*) from protocol_attendance a
     join protocols p on p.id = a.protocol_id
     join tenants t on t.id = p.tenant_id where t.slug='goedersdorf')      as anwesenheiten,
  (select count(*) from tasks k join tenants t on t.id = k.tenant_id
    where t.slug='goedersdorf' and k.source_type = 'protocol')             as protokoll_aufgaben;

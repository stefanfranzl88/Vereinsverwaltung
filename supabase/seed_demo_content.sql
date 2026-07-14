-- =====================================================================
-- DEMO-INHALTE: Termine, Zu-/Absagen, Mitteilungen, Aufgaben
--
-- Optional. Ohne diese Daten sind Dashboard, Terminkalender und
-- Aufgabenübersicht funktionsfähig, aber leer.
--
-- Voraussetzung: setup_complete.sql ist gelaufen (Verein + Mitglieder).
-- Idempotent: Existenz-Checks über Titel; mehrfach ausführbar.
-- =====================================================================


-- ---------------------------------------------------------------
-- 1) Termine (Tabelle events)
-- ---------------------------------------------------------------
insert into events (tenant_id, title, event_date, event_time, location)
select t.id, e.title, e.event_date::date, e.event_time::time, e.location
from tenants t
cross join (values
  ('Sommerfest am Dorfplatz',     '2026-07-18', '14:00', 'Dorfplatz'),
  ('Vorstandssitzung Juli',       '2026-07-24', '19:30', 'Vereinsheim'),
  ('Ausflug Wörthersee',          '2026-08-09', '09:00', 'Treffpunkt Vereinsheim'),
  ('Herbst-Generalversammlung',   '2026-09-12', '18:00', 'Gasthof Post')
) as e(title, event_date, event_time, location)
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from events ex
    where ex.tenant_id = t.id and ex.title = e.title
  );


-- ---------------------------------------------------------------
-- 2) Zu- und Absagen (Tabelle event_rsvps)
-- ---------------------------------------------------------------
insert into event_rsvps (event_id, member_id, answer)
select ev.id, m.id, r.answer
from tenants t
join events ev on ev.tenant_id = t.id
join (values
  ('Sommerfest am Dorfplatz',   'Markus',    'Smole',    'yes'),
  ('Sommerfest am Dorfplatz',   'Christoph', 'Kovac',    'yes'),
  ('Sommerfest am Dorfplatz',   'Sandro',    'Omann',    'yes'),
  ('Sommerfest am Dorfplatz',   'Markus',    'Gelbmann', 'yes'),
  ('Sommerfest am Dorfplatz',   'Stefan',    'Giefer',   'no'),
  ('Vorstandssitzung Juli',     'Markus',    'Smole',    'yes'),
  ('Vorstandssitzung Juli',     'Christoph', 'Kovac',    'yes'),
  ('Ausflug Wörthersee',        'Christoph', 'Kovac',    'yes'),
  ('Ausflug Wörthersee',        'Florian',   'Franzl',   'yes'),
  ('Ausflug Wörthersee',        'Aileen',    'Umele',    'yes'),
  ('Ausflug Wörthersee',        'Markus',    'Smole',    'no')
) as r(event_title, first_name, last_name, answer) on r.event_title = ev.title
join members m on m.tenant_id = t.id
              and m.first_name = r.first_name
              and m.last_name  = r.last_name
where t.slug = 'goedersdorf'
on conflict (event_id, member_id) do nothing;


-- ---------------------------------------------------------------
-- 3) Events & Projekte (Tabelle big_events) – Zuordnung für Aufgaben
-- ---------------------------------------------------------------
insert into big_events (tenant_id, kind, name, date_from, date_to, description)
select t.id, b.kind, b.name, b.date_from::date, b.date_to::date, b.description
from tenants t
cross join (values
  ('Event',   'Jahreskirchtag 2026', '2026-08-21', '2026-08-23', 'Kirchtag mit Bierbude, Küche und Kassa'),
  ('Projekt', 'Neubau Lagerraum',    '2026-03-01', '2026-12-31', 'Errichtung des neuen Vereinslagers')
) as b(kind, name, date_from, date_to, description)
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from big_events ex
    where ex.tenant_id = t.id and ex.name = b.name
  );


-- ---------------------------------------------------------------
-- 4) Mitteilungen (Tabelle news)
-- ---------------------------------------------------------------
insert into news (tenant_id, author_id, title, body, expires_at, created_at)
select t.id, a.id, n.title, n.body, n.expires_at::date, n.created_at::timestamptz
from tenants t
cross join (values
  ('Helfer für das Sommerfest gesucht!',
   'Für Aufbau (Fr ab 16 Uhr) und Ausschank am Samstag brauchen wir noch Freiwillige. Bitte bei Markus melden oder direkt beim Termin zusagen.',
   '2026-07-19', '2026-07-10', 'Markus', 'Smole'),
  ('Protokoll der Juni-Sitzung online',
   'Das Sitzungsprotokoll vom 26.06. ist ab sofort im Bereich Protokolle abrufbar.',
   null, '2026-07-06', 'Sandro', 'Omann'),
  ('Kirchtags-Einteilung steht',
   'Die Abteilungen für den Jahreskirchtag (Bierbude, Küche & Grill, Kassa) sind eingeteilt – Details unter Events & Projekte. Danke an alle, die mithelfen!',
   null, '2026-06-29', 'Markus', 'Smole')
) as n(title, body, expires_at, created_at, first_name, last_name)
join members a on a.tenant_id = t.id
              and a.first_name = n.first_name
              and a.last_name  = n.last_name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from news ex
    where ex.tenant_id = t.id and ex.title = n.title
  );


-- ---------------------------------------------------------------
-- 5) Aufgaben (Tabelle tasks)
--    source_type 'big_event' verweist auf big_events.id, 'manual' auf nichts.
--    Aufgaben aus Sitzungsprotokollen ('protocol') gibt es noch nicht –
--    das Protokoll-Modul ist nicht gebaut.
-- ---------------------------------------------------------------
insert into tasks (tenant_id, title, assignee_id, due_date, done, done_at,
                   source_type, source_id, created_by, created_at)
select
  t.id,
  x.title,
  asg.id,
  nullif(x.due_date, '')::date,
  x.done,
  nullif(x.done_at, '')::date,
  x.source_type,
  be.id,                                 -- null, wenn source_event leer
  crt.id,
  x.created_at::timestamptz
from tenants t
cross join (values
  ('Getränkebestellung Sommerfest aufgeben',
   'Christoph','Kovac','2026-07-08', true,  '2026-07-07', 'manual',    '',                    'Sandro','Omann',    '2026-06-26'),
  ('Aufbauplan Sommerfest erstellen und verteilen',
   'Markus','Smole','2026-07-15',    false, '',           'manual',    '',                    'Sandro','Omann',    '2026-06-26'),
  ('Deko-Material für Sommerfest besorgen',
   'Florian','Franzl','2026-07-10',  false, '',           'manual',    '',                    'Sandro','Omann',    '2026-06-26'),
  ('Einladung Generalversammlung entwerfen',
   'Sandro','Omann','2026-08-20',    false, '',           'manual',    '',                    'Sandro','Omann',    '2026-06-26'),
  ('Behördenabnahme Kirchtag koordinieren (Elektrik, Brandschutz)',
   'Markus','Gelbmann','2026-08-14', false, '',           'big_event', 'Jahreskirchtag 2026', 'Sandro','Omann',    '2026-06-26'),
  ('Wechselgeld & Kassastand Kirchtag vorbereiten',
   'Stefan','Franzl','2026-08-19',   false, '',           'big_event', 'Jahreskirchtag 2026', 'Christoph','Kovac', '2026-07-02'),
  ('Angebote für Sektionaltor Lagerraum einholen',
   'Markus','Gelbmann','',           false, '',           'big_event', 'Neubau Lagerraum',    'Stefan','Franzl',   '2026-07-05')
) as x(title, asg_first, asg_last, due_date, done, done_at,
       source_type, source_event, crt_first, crt_last, created_at)
join members asg on asg.tenant_id = t.id
                and asg.first_name = x.asg_first
                and asg.last_name  = x.asg_last
join members crt on crt.tenant_id = t.id
                and crt.first_name = x.crt_first
                and crt.last_name  = x.crt_last
left join big_events be on be.tenant_id = t.id and be.name = nullif(x.source_event, '')
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from tasks ex
    where ex.tenant_id = t.id and ex.title = x.title
  );


-- ---------------------------------------------------------------
-- KONTROLLE
-- ---------------------------------------------------------------
select
  (select count(*) from events      e join tenants t on t.id = e.tenant_id where t.slug='goedersdorf') as termine,
  (select count(*) from event_rsvps r join events  e on e.id = r.event_id
                                      join tenants t on t.id = e.tenant_id where t.slug='goedersdorf') as zu_absagen,
  (select count(*) from big_events  b join tenants t on t.id = b.tenant_id where t.slug='goedersdorf') as events_projekte,
  (select count(*) from news        n join tenants t on t.id = n.tenant_id where t.slug='goedersdorf') as mitteilungen,
  (select count(*) from tasks       k join tenants t on t.id = k.tenant_id where t.slug='goedersdorf') as aufgaben;

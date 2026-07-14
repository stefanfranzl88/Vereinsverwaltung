-- =====================================================================
-- DEMO-INHALTE INVENTAR: Standorte, Artikel, Ausleihen, Reservierungen, Historie
--
-- Optional. Voraussetzung: setup_complete.sql und 0009_inventar.sql sind gelaufen.
-- Idempotent: Existenz-Checks; mehrfach ausführbar.
--
-- HINWEIS: Dieses Skript schreibt DIREKT in die Tabellen und umgeht damit die
-- Funktionen aus 0009 (borrow_item, change_stock, …). Das ist hier korrekt –
-- der SQL-Editor läuft als 'postgres' und setzt einen historischen Ausgangs-
-- zustand. In der App führt jede Aktion über die Funktionen, weil dort
-- Nebenläufigkeit und Historie eine Rolle spielen.
-- =====================================================================


-- ---------------------------------------------------------------
-- 1) Standorte
-- ---------------------------------------------------------------
insert into locations (tenant_id, name)
select t.id, l.name
from tenants t
cross join (values ('Vereinslager'), ('Feuerwehrhaus'), ('beim Obmann')) as l(name)
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from locations ex where ex.tenant_id = t.id and ex.name = l.name
  );


-- ---------------------------------------------------------------
-- 2) Artikel
--    Gerät: total_qty = Gesamtbestand · Vorrat: total_qty = aktueller Bestand
-- ---------------------------------------------------------------
insert into items (tenant_id, inv_nr, name, kind, total_qty, unit, location_id, defect, note)
select t.id, x.inv_nr, x.name, x.kind, x.qty, x.unit, l.id, x.defect, nullif(x.note, '')
from tenants t
cross join (values
  ('DG-0001', 'Partyzelt 6×12 m',               'geraet', 1,  'Stk',    'Vereinslager',  false, ''),
  ('DG-0002', 'Partyzelt 3×3 m (Faltpavillon)', 'geraet', 1,  'Stk',    'Vereinslager',  false, ''),
  ('DG-0003', 'Heizstrahler Gas',               'geraet', 1,  'Stk',    'Feuerwehrhaus', false, 'Gasflasche fast leer – vor nächstem Einsatz tauschen'),
  ('DG-0004', 'Kühlschrank groß (Getränke)',    'geraet', 1,  'Stk',    'Vereinslager',  false, ''),
  ('DG-0005', 'Biertischgarnituren',            'geraet', 8,  'Stk',    'Feuerwehrhaus', false, ''),
  ('DG-0006', 'Musikanlage mit Mikrofon',       'geraet', 1,  'Stk',    'beim Obmann',   true,  'Mikrofonkabel defekt – Ersatz bestellt'),
  ('DG-0007', 'Bier 0,5 l (Kisten)',            'vorrat', 6,  'Kisten', 'Vereinslager',  false, ''),
  ('DG-0008', 'Limonade / AF-Getränke',         'vorrat', 4,  'Kisten', 'Vereinslager',  false, ''),
  ('DG-0009', 'Wein weiß (Flaschen)',           'vorrat', 18, 'Fl.',    'Feuerwehrhaus', false, '')
) as x(inv_nr, name, kind, qty, unit, loc_name, defect, note)
join locations l on l.tenant_id = t.id and l.name = x.loc_name
where t.slug = 'goedersdorf'
on conflict (tenant_id, inv_nr) do nothing;


-- ---------------------------------------------------------------
-- 3) Laufende Ausleihen
--    DG-0005: 2 von 8 Biertischgarnituren – Teilmenge, wie im Prototyp.
-- ---------------------------------------------------------------
insert into item_borrows (item_id, member_id, qty, borrowed_at)
select i.id, m.id, b.qty, b.since::timestamptz
from tenants t
join items i on i.tenant_id = t.id
join (values
  ('DG-0002', 'Markus', 'Gelbmann', 1, '2026-07-04'),
  ('DG-0005', 'Stefan', 'Giefer',   2, '2026-07-06')
) as b(inv_nr, first_name, last_name, qty, since) on b.inv_nr = i.inv_nr
join members m on m.tenant_id = t.id
              and m.first_name = b.first_name
              and m.last_name  = b.last_name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from item_borrows ex where ex.item_id = i.id and ex.member_id = m.id
  );


-- ---------------------------------------------------------------
-- 4) Reservierungen
-- ---------------------------------------------------------------
insert into item_reservations (item_id, member_id, date_from, date_to, purpose, status, decided_by)
select i.id, m.id, r.date_from::date, r.date_to::date, r.purpose, r.status,
       case when r.status = 'bestätigt' then m.id else null end
from tenants t
join items i on i.tenant_id = t.id
join (values
  ('DG-0001', 'Markus',  'Smole',  '2026-07-17', '2026-07-19', 'Sommerfest (Vereinsveranstaltung)', 'bestätigt'),
  ('DG-0005', 'Florian', 'Franzl', '2026-08-09', '2026-08-10', 'Privater Geburtstag',               'angefragt')
) as r(inv_nr, first_name, last_name, date_from, date_to, purpose, status) on r.inv_nr = i.inv_nr
join members m on m.tenant_id = t.id
              and m.first_name = r.first_name
              and m.last_name  = r.last_name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from item_reservations ex
    where ex.item_id = i.id and ex.member_id = m.id and ex.date_from = r.date_from::date
  );


-- ---------------------------------------------------------------
-- 5) Historie
-- ---------------------------------------------------------------
insert into item_history (item_id, member_id, action, created_at)
select i.id, m.id, h.action, h.created_at::timestamptz
from tenants t
join items i on i.tenant_id = t.id
join (values
  ('DG-0002', 'Markus',    'Gelbmann', '2026-07-04', 'Ausgeborgt'),
  ('DG-0006', 'Sandro',    'Omann',    '2026-06-28', 'Defekt gemeldet: Mikrofonkabel defekt'),
  ('DG-0001', 'Christoph', 'Kovac',    '2026-06-22', 'Zurückgebracht → Vereinslager (nach Frühjahrskonzert)'),
  ('DG-0001', 'Christoph', 'Kovac',    '2026-05-15', 'Ausgeborgt'),
  ('DG-0003', 'Markus',    'Smole',    '2026-04-30', 'Zurückgebracht → Feuerwehrhaus, Vermerk: Gasflasche fast leer')
) as h(inv_nr, first_name, last_name, created_at, action) on h.inv_nr = i.inv_nr
join members m on m.tenant_id = t.id
              and m.first_name = h.first_name
              and m.last_name  = h.last_name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from item_history ex
    where ex.item_id = i.id and ex.action = h.action and ex.member_id = m.id
  );


-- ---------------------------------------------------------------
-- KONTROLLE
-- Erwartet: 3 Standorte · 9 Artikel (6 Geräte, 3 Vorräte) · 2 Ausleihen
--           2 Reservierungen (1 offen) · 5 Historieneinträge
--
-- DG-0005 muss danach "6 von 8 verfügbar" zeigen (8 gesamt − 2 ausgeborgt).
-- ---------------------------------------------------------------
select
  (select count(*) from locations l join tenants t on t.id = l.tenant_id
    where t.slug='goedersdorf')                                              as standorte,
  (select count(*) from items i join tenants t on t.id = i.tenant_id
    where t.slug='goedersdorf')                                              as artikel,
  (select count(*) from item_borrows b join items i on i.id = b.item_id
    join tenants t on t.id = i.tenant_id where t.slug='goedersdorf')         as ausleihen,
  (select count(*) from item_reservations r join items i on i.id = r.item_id
    join tenants t on t.id = i.tenant_id
   where t.slug='goedersdorf' and r.status = 'angefragt')                    as offene_anfragen,
  (select count(*) from item_history h join items i on i.id = h.item_id
    join tenants t on t.id = i.tenant_id where t.slug='goedersdorf')         as historie;

-- =====================================================================
-- DEMO-INHALTE SCHLÜSSELVERWALTUNG: Einstellungen, Upload, Zutrittsprotokoll
--
-- Die Chips selbst legt bereits setup_complete.sql an (Abschnitt 2.9).
-- Hier kommen die Einstellungen und ein importiertes Protokoll dazu.
--
-- Voraussetzung: setup_complete.sql und 0013_schluessel.sql sind gelaufen.
-- Idempotent: Existenz-Checks; mehrfach ausführbar.
-- =====================================================================


-- ---------------------------------------------------------------
-- 1) Einstellungen: Erinnerungsintervall + letztes Auslesen
--    last_key_log liegt bewusst >30 Tage zurück, damit die
--    "Schloss auslesen fällig"-Erinnerung sichtbar ist.
-- ---------------------------------------------------------------
update tenants
   set settings = jsonb_set(
         jsonb_set(coalesce(settings, '{}'::jsonb),
                   '{key_interval_days}', to_jsonb(30), true),
         '{last_key_log}', to_jsonb('2026-06-05'::text), true)
 where slug = 'goedersdorf'
   and coalesce(settings, '{}'::jsonb) -> 'last_key_log' is null;


-- ---------------------------------------------------------------
-- 2) Upload-Datensatz (Metadaten des EVVA-Imports)
-- ---------------------------------------------------------------
insert into key_log_uploads (tenant_id, file_name, row_count, uploaded_by, created_at)
select t.id, 'evva_protokoll_mai.xlsx', 5, m.id, '2026-06-05T09:00:00+00'::timestamptz
from tenants t
join members m on m.tenant_id = t.id
             and m.first_name = 'Stefan' and m.last_name = 'Franzl'   -- Systemadmin
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from key_log_uploads ex
    where ex.tenant_id = t.id and ex.file_name = 'evva_protokoll_mai.xlsx'
  );


-- ---------------------------------------------------------------
-- 3) Zutrittsprotokoll (verknüpft mit dem Upload)
--    chip_info bleibt Rohtext aus dem Export – so sieht es das Schema vor.
-- ---------------------------------------------------------------
insert into key_log_entries (tenant_id, entry_date, entry_time, chip_info, event, upload_id)
select t.id, e.d::date, e.tm::time, e.chip, e.ev, u.id
from tenants t
join key_log_uploads u on u.tenant_id = t.id and u.file_name = 'evva_protokoll_mai.xlsx'
join (values
  ('2026-06-04', '18:42', 'CHIP-003 · Stefan Franzl',  'Tür geöffnet'),
  ('2026-06-04', '17:15', 'CHIP-004 · Stefan Giefer',  'Tür geöffnet'),
  ('2026-06-01', '09:03', 'CHIP-001 · Markus Smole',   'Tür geöffnet'),
  ('2026-05-28', '19:30', 'CHIP-005 · Florian Franzl', 'Tür geöffnet'),
  ('2026-05-28', '19:29', 'CHIP-005 · Florian Franzl', 'Zutritt verweigert (außerhalb Zeitfenster)')
) as e(d, tm, chip, ev) on true
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from key_log_entries ex
    where ex.tenant_id = t.id and ex.chip_info = e.chip
      and ex.entry_date = e.d::date and ex.entry_time = e.tm::time
  );


-- ---------------------------------------------------------------
-- KONTROLLE
-- Erwartet: 5 Chips (aus setup_complete) · 1 Upload · 5 Zutritte
--           · 1 davon "verweigert"
-- ---------------------------------------------------------------
select
  (select count(*) from key_chips k join tenants t on t.id = k.tenant_id
    where t.slug='goedersdorf')                                        as chips,
  (select count(*) from key_log_uploads u join tenants t on t.id = u.tenant_id
    where t.slug='goedersdorf')                                        as uploads,
  (select count(*) from key_log_entries e join tenants t on t.id = e.tenant_id
    where t.slug='goedersdorf')                                        as zutritte,
  (select settings ->> 'last_key_log' from tenants where slug='goedersdorf') as last_key_log;

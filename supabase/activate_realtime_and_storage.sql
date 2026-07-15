-- =====================================================================
-- REALTIME & STORAGE AKTIVIEREN + PRÜFEN
--
-- Im Supabase SQL-Editor ausführen (läuft dort als 'postgres').
-- Idempotent, mehrfach ausführbar, nichts wird gelöscht.
--
-- Teil A stellt die reine Infrastruktur sicher: die Bucket-Zeilen und die
-- Realtime-Publication. Das sind einfache inserts/adds ohne Rechtelogik.
--
-- Die STORAGE-POLICIES (wer in welchen Bucket lesen/schreiben darf) gehören
-- zu den jeweiligen Migrationen und werden hier NICHT dupliziert – sonst gäbe
-- es zwei Quellen der Wahrheit. Teil B meldet, ob sie vorhanden sind; fehlt
-- eine, die zugehörige Migration einspielen (siehe Hinweis in der Ausgabe).
-- =====================================================================


-- =====================================================================
-- TEIL A – AKTIVIEREN
-- =====================================================================

-- --- A1: Alle fünf Buckets (privat) sicherstellen
insert into storage.buckets (id, name, public) values
  ('avatars',   'avatars',   false),
  ('news',      'news',      false),
  ('receipts',  'receipts',  false),
  ('exports',   'exports',   false),
  ('documents', 'documents', false)
on conflict (id) do nothing;

-- --- A2: Chat in die Realtime-Publication aufnehmen (mit Guard)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table chat_messages;
    end if;
  else
    raise notice 'Publication supabase_realtime fehlt – Realtime ist im Projekt evtl. nicht initialisiert.';
  end if;
end
$$;


-- =====================================================================
-- TEIL B – PRÜFEN (nur Anzeige)
-- =====================================================================

-- --- B1: Buckets vorhanden?
select '1. Buckets' as pruefung, id as objekt,
       'vorhanden' as status
from storage.buckets
where id in ('avatars','news','receipts','exports','documents')
order by id;

-- --- B2: Storage-Policies je Bucket. Erwartet:
--     avatars 3 · news 3 · receipts 2 · exports 2 · documents 3
--     Zeigt eine Zeile 0 an, fehlt die Policy → zugehörige Migration einspielen:
--       avatars → setup_complete.sql · news → 0005 · receipts/exports → 0006+0007
--       documents → 0014
select '2. Storage-Policies' as pruefung,
       bucket as objekt,
       anzahl::text as status
from (
  select 'avatars'   as bucket, count(*) filter (where policyname like 'avatars%')   as anzahl from pg_policies where schemaname='storage' and tablename='objects'
  union all select 'news',      count(*) filter (where policyname like 'news%')       from pg_policies where schemaname='storage' and tablename='objects'
  union all select 'receipts',  count(*) filter (where policyname like 'receipts%')   from pg_policies where schemaname='storage' and tablename='objects'
  union all select 'exports',   count(*) filter (where policyname like 'exports%')    from pg_policies where schemaname='storage' and tablename='objects'
  union all select 'documents', count(*) filter (where policyname like 'documents%')  from pg_policies where schemaname='storage' and tablename='objects'
) s
order by bucket;

-- --- B3: Realtime – ist der Chat in der Publication?
select '3. Realtime' as pruefung,
       'chat_messages' as objekt,
       case when exists (
         select 1 from pg_publication_tables
         where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages'
       ) then 'aktiv' else 'FEHLT – 0015 einspielen' end as status;

-- --- B4: RLS auf allen Modul-Tabellen aktiv? Jede Zeile muss 'an' zeigen.
--     Ist eine 'AUS', fehlt die entsprechende Migration (0002–0015).
select '4. RLS' as pruefung,
       c.relname as objekt,
       case when c.relrowsecurity then 'an' else 'AUS – Migration fehlt' end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'profiles','tenants','tenant_modules','roles','role_permissions','member_roles',
    'members','key_chips','events','event_rsvps','news','tasks',
    'cost_centers','transactions','invoices','month_closings',
    'big_events','big_event_subs','departments','dept_assignments',
    'locations','items','item_borrows','item_reservations','item_history',
    'protocols','protocol_attendance','surveys','survey_options','survey_votes',
    'key_log_entries','key_log_uploads','documents','chat_messages'
  )
order by c.relname;

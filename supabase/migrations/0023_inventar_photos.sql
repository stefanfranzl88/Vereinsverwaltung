-- =====================================================================
-- INVENTAR: Artikelfotos
--
-- Neue Spalte items.photo_path + privater Storage-Bucket "item-photos".
-- Pfad im bestehenden Muster: {tenant_id}/{item_id}-<ts>.jpg
--
-- Policies (Muster wie news-Bucket in 0005):
--   Lesen   : jedes Vereinsmitglied bei aktivem Modul 'inventar'.
--   Schreiben: nur 'inventar.manage' (insert/update/delete).
--
-- Das Setzen von items.photo_path läuft über die bestehende items_write-Policy
-- (0009, 'inventar.manage') – kein zusätzliches DB-Objekt nötig.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

alter table items add column if not exists photo_path text;


-- =====================================================================
-- Bucket "item-photos" (privat – Anzeige über kurzlebige signierte URLs,
-- wie bei avatars/news/documents).
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', false)
on conflict (id) do nothing;

drop policy if exists item_photos_read on storage.objects;
create policy item_photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and module_active('inventar')
  );

drop policy if exists item_photos_write on storage.objects;
create policy item_photos_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and module_active('inventar')
    and has_perm('inventar.manage')
  );

-- upsert beim Ersetzen eines Fotos geht über UPDATE – deshalb auch hier abdecken.
drop policy if exists item_photos_update on storage.objects;
create policy item_photos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and module_active('inventar')
    and has_perm('inventar.manage')
  )
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and module_active('inventar')
    and has_perm('inventar.manage')
  );

drop policy if exists item_photos_delete on storage.objects;
create policy item_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and module_active('inventar')
    and has_perm('inventar.manage')
  );


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'items' and column_name = 'photo_path';

select id, public from storage.buckets where id = 'item-photos';

select policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'item_photos%'
order by policyname;

-- =====================================================================
-- DOKUMENTENABLAGE (Modul 'dokumente')
--
-- documents hat im Basisschema KEINE RLS – Verträge, Polizzen und Bescheide
-- aller Vereine wären les- und schreibbar.
--
-- Rechte:
--   docs.view   – Ablage einsehen (Nav-Gate) und Dateien öffnen
--   docs.manage – Dokumente hochladen und löschen
--
-- Anders als bei Kassa/Inventar sind hier keine Datenbankfunktionen nötig:
-- Ein Dokument ist eine einzelne Zeile plus eine Datei im Storage, es gibt
-- keinen mehrstufigen Zustand und keine Nebenläufigkeit. Die RLS-Policies
-- reichen; das Aufräumen einer verwaisten Datei erledigt der Client.
--
-- has_perm() steht in BEIDEN Klauseln der Schreib-Policy (beim INSERT wertet
-- Postgres ausschließlich with check aus, nicht using).
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) RLS auf documents
-- =====================================================================
alter table documents enable row level security;

drop policy if exists documents_select on documents;
create policy documents_select on documents for select
  using (
    tenant_id = auth_tenant_id()
    and module_active('dokumente')
    and has_perm('docs.view')
  );

drop policy if exists documents_write on documents;
create policy documents_write on documents for all
  using (
    tenant_id = auth_tenant_id()
    and module_active('dokumente')
    and has_perm('docs.manage')
  )
  with check (
    tenant_id = auth_tenant_id()
    and module_active('dokumente')
    and has_perm('docs.manage')
  );


-- =====================================================================
-- 2) STORAGE-BUCKET "documents"
--    Pfad: {tenant_id}/{kategorie-slug}/{uuid}.{ext}
--
--    Lesen mit docs.view, Hochladen/Löschen mit docs.manage. Der Tenant-
--    Ordner (Segment 1) trennt die Vereine – analog zu avatars/receipts/news.
--    Falls "must be owner of table objects" kommt: Bucket und Policies
--    stattdessen im Dashboard unter Storage anlegen.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists documents_read on storage.objects;
create policy documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('docs.view')
  );

drop policy if exists documents_upload on storage.objects;
create policy documents_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('docs.manage')
  );

drop policy if exists documents_delete on storage.objects;
create policy documents_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('docs.manage')
  );


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select tablename, policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public' and tablename = 'documents'
order by policyname;

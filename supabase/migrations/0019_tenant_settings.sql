-- =====================================================================
-- GRUNDEINSTELLUNGEN: Logo-Bucket + Login-Branding + tenants-Update
--
-- Vereinsname, ZVR-Zahl, Dekade und logo_url sind Spalten auf tenants; das
-- Erinnerungsintervall liegt in settings.key_interval_days (Funktion
-- set_key_interval aus 0013). Geändert wird über die tenants_update-Policy
-- (roles.manage) – hier nur erneut abgesichert.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) tenants_update-Policy erneut absichern (roles.manage, with check!)
--    Deckt name, zvr_zahl, dekade, logo_url und settings ab.
-- =====================================================================
alter table tenants enable row level security;

drop policy if exists tenants_update on tenants;
create policy tenants_update on tenants for update
  using      (id = auth_tenant_id() and has_perm('roles.manage'))
  with check (id = auth_tenant_id() and has_perm('roles.manage'));


-- =====================================================================
-- 2) STORAGE-BUCKET "logos" (ÖFFENTLICH)
--
--    Bewusst public: Das Logo wird auch auf der LOGIN-Seite gezeigt, wo es noch
--    keine Session und keinen Tenant-Kontext gibt. Ein Vereinslogo ist nicht
--    schützenswert. Lesen also über die öffentliche URL; Schreiben/Löschen nur
--    mit roles.manage im eigenen Tenant-Ordner ({tenant_id}/logo.<ext>).
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do update set public = true;

drop policy if exists logos_write on storage.objects;
create policy logos_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('roles.manage')
  );

drop policy if exists logos_update on storage.objects;
create policy logos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('roles.manage')
  );

drop policy if exists logos_delete on storage.objects;
create policy logos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('roles.manage')
  );


-- =====================================================================
-- 3) LOGIN-BRANDING für die (unauthentifizierte) Login-Seite
--
--    Die Login-Seite kennt den Verein noch nicht. Diese Funktion gibt Name und
--    Logo-URL zurück – NUR diese beiden, öffentliche Branding-Felder, nichts
--    Sensibles. Annahme: EIN Verein pro Deployment (Single-Tenant); bei mehreren
--    käme der zuerst angelegte zurück.
-- =====================================================================
create or replace function login_branding()
returns table (name text, logo_url text)
language sql stable security definer set search_path = public as $$
  select name, logo_url from tenants order by created_at limit 1
$$;

revoke all on function login_branding() from public;
grant execute on function login_branding() to anon, authenticated;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select id, public from storage.buckets where id = 'logos';
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_update';

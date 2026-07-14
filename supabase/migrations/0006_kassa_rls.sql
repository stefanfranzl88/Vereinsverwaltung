-- =====================================================================
-- RLS + Storage für das Kassa-Modul
--
-- Das Basisschema (Abschnitt 9) sichert transactions und invoices ab,
-- lässt aber cost_centers und month_closings völlig ohne RLS – beide wären
-- über alle Vereine hinweg les- und schreibbar.
--
-- Zusätzlich fehlt der Anfangsbestand als Feld. Er liegt in tenants.settings
-- (jsonb) und wird über set_opening_balance() gesetzt: Das darf die Kassenführung
-- ('kassa.edit'), NICHT nur 'roles.manage' – und die Funktion schreibt genau
-- diesen einen Schlüssel, nicht das ganze settings-Objekt.
--
-- has_perm() steht überall in BEIDEN Klauseln (beim INSERT wertet Postgres
-- ausschließlich with check aus, nicht using).
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) COST_CENTERS (Kostenstellen)
-- =====================================================================
alter table cost_centers enable row level security;

drop policy if exists cost_centers_select on cost_centers;
create policy cost_centers_select on cost_centers for select
  using (
    tenant_id = auth_tenant_id()
    and module_active('kassa')
    and has_perm('kassa.view')
  );

drop policy if exists cost_centers_write on cost_centers;
create policy cost_centers_write on cost_centers for all
  using (
    tenant_id = auth_tenant_id()
    and module_active('kassa')
    and has_perm('kassa.edit')
  )
  with check (
    tenant_id = auth_tenant_id()
    and module_active('kassa')
    and has_perm('kassa.edit')
  );


-- =====================================================================
-- 2) MONTH_CLOSINGS (Monatsabschluss-Historie)
--    Kein DELETE: Ein abgeschlossener Monat bleibt abgeschlossen.
-- =====================================================================
alter table month_closings enable row level security;

drop policy if exists month_closings_select on month_closings;
create policy month_closings_select on month_closings for select
  using (
    tenant_id = auth_tenant_id()
    and module_active('kassa')
    and has_perm('kassa.view')
  );

drop policy if exists month_closings_insert on month_closings;
create policy month_closings_insert on month_closings for insert
  with check (
    tenant_id = auth_tenant_id()
    and module_active('kassa')
    and has_perm('kassa.edit')
  );


-- =====================================================================
-- 3) TRANSACTIONS – Ergänzung zum Basisschema
--
--    Das Basisschema hat tx_select (lesen) und tx_write NUR FÜR INSERT.
--    Das ist bewusst so und bleibt: Eine erfasste Buchung wird nicht
--    nachträglich verändert. Eine falsche Buchung wird storniert, indem
--    eine Gegenbuchung erfasst wird – das ist auch buchhalterisch korrekt.
--
--    Hier wird nur sichergestellt, dass RLS überhaupt aktiv ist (falls das
--    Basisschema nicht vollständig gelaufen ist).
-- =====================================================================
alter table transactions enable row level security;


-- =====================================================================
-- 4) ANFANGSBESTAND (tenants.settings -> opening_balance_cents)
--
--    Im Prototyp eine Konstante (start = 1250). Hier pro Verein gespeichert.
--    jsonb_set schreibt genau diesen Schlüssel; die übrigen Settings
--    (z.B. key_interval_days) bleiben unangetastet.
-- =====================================================================
create or replace function set_opening_balance(p_cents bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('kassa.edit') then
    raise exception 'Keine Berechtigung (kassa.edit erforderlich)';
  end if;

  update tenants
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{opening_balance_cents}',
           to_jsonb(p_cents),
           true
         )
   where id = auth_tenant_id();

  if not found then
    raise exception 'Verein nicht gefunden';
  end if;
end
$$;

revoke all on function set_opening_balance(bigint) from public;
grant execute on function set_opening_balance(bigint) to authenticated;


-- =====================================================================
-- 5) STORAGE
--    receipts/ – Kassabelege       {tenant_id}/{yyyy-mm}/{uuid}.{ext}
--    exports/  – Monatsabschlüsse  {tenant_id}/{yyyy-mm}.zip
--
--    Lesen: nur mit 'kassa.view' – Belege sind nicht für alle Mitglieder.
--    Falls "must be owner of table objects" kommt: Buckets und Policies
--    stattdessen im Dashboard unter Storage anlegen.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false), ('exports', 'exports', false)
on conflict (id) do nothing;

drop policy if exists receipts_read on storage.objects;
create policy receipts_read on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('kassa.view')
  );

drop policy if exists receipts_write on storage.objects;
create policy receipts_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('kassa.edit')
  );

drop policy if exists exports_read on storage.objects;
create policy exports_read on storage.objects for select to authenticated
  using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('kassa.view')
  );

drop policy if exists exports_write on storage.objects;
create policy exports_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('kassa.edit')
  );


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select tablename, policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('cost_centers', 'month_closings', 'transactions')
order by tablename, policyname;

-- =====================================================================
-- SCHLÜSSELVERWALTUNG (Modul 'schluessel')
--
-- key_chips ist bereits abgesichert (0004: lesen = jedes Mitglied bei
-- gebuchtem Modul, schreiben = keys.manage). Hier fehlen noch:
--
--   * key_log_entries und key_log_uploads – beide OHNE RLS im Basisschema.
--     Das Zutrittsprotokoll (wer wann die Tür geöffnet hat) ist ein sensibles
--     Bewegungsprofil und war über alle Vereine hinweg les- und schreibbar.
--
--   * Der Upload eines EVVA-Exports schreibt in ZWEI Tabellen
--     (key_log_uploads + key_log_entries) UND setzt last_key_log in den
--     tenant.settings. Aus dem Browser wären das mehrere Requests – bräche
--     einer ab, stünde eine Upload-Zeile ohne Einträge da, oder die
--     Erinnerung würde nicht zurückgesetzt. import_key_log() macht alles in
--     einer Transaktion.
--
-- Rechte (aus dem Berechtigungskatalog):
--   keys.view     – Schlüsselverwaltung/Chipliste einsehen (Nav-Gate)
--   keys.manage   – Chips zuweisen/entziehen
--   keylog.view   – Zutrittsprotokoll einsehen
--   keylog.upload – Protokoll hochladen & Erinnerungsintervall einstellen
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) RLS
-- =====================================================================

-- --- key_log_uploads: Metadaten der Importe (Dateiname, Zeilenzahl).
--     Lesen mit keylog.view, schreiben nur über import_key_log().
alter table key_log_uploads enable row level security;

drop policy if exists key_log_uploads_select on key_log_uploads;
create policy key_log_uploads_select on key_log_uploads for select
  using (
    tenant_id = auth_tenant_id()
    and module_active('schluessel')
    and has_perm('keylog.view')
  );

-- --- key_log_entries: die einzelnen Zutritte – das eigentliche Bewegungsprofil.
alter table key_log_entries enable row level security;

drop policy if exists key_log_entries_select on key_log_entries;
create policy key_log_entries_select on key_log_entries for select
  using (
    tenant_id = auth_tenant_id()
    and module_active('schluessel')
    and has_perm('keylog.view')
  );


-- =====================================================================
-- 2) PROTOKOLL IMPORTIEREN
--
--    p_entries: jsonb-Array [{"date":"2026-06-04"|null, "time":"18:42"|null,
--               "chip_info":"CHIP-003 · Stefan Franzl", "event":"Tür geöffnet"}, ...]
--
--    Datum/Zeit parst der Client aus dem EVVA-Export und liefert ISO oder null;
--    chip_info bleibt Rohtext (so sieht es das Schema vor). Die Funktion setzt
--    zusätzlich settings.last_key_log = heute, damit die Erinnerung nachrückt.
-- =====================================================================
create or replace function import_key_log(p_file_name text, p_entries jsonb)
returns key_log_uploads
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_upload key_log_uploads%rowtype;
  v_count  int;
begin
  if not has_perm('keylog.upload') then
    raise exception 'Keine Berechtigung (keylog.upload erforderlich)';
  end if;
  if not module_active('schluessel') then
    raise exception 'Modul "schluessel" ist nicht gebucht';
  end if;

  v_count := jsonb_array_length(coalesce(p_entries, '[]'::jsonb));

  insert into key_log_uploads (tenant_id, file_name, row_count, uploaded_by)
  values (v_tenant, p_file_name, v_count, auth_member_id())
  returning * into v_upload;

  insert into key_log_entries (tenant_id, entry_date, entry_time, chip_info, event, upload_id)
  select
    v_tenant,
    nullif(e ->> 'date', '')::date,
    nullif(e ->> 'time', '')::time,
    e ->> 'chip_info',
    e ->> 'event',
    v_upload.id
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as e;

  -- Erinnerung zurücksetzen: last_key_log = heute.
  update tenants
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{last_key_log}',
           to_jsonb(current_date::text),
           true
         )
   where id = v_tenant;

  return v_upload;
end
$$;

revoke all on function import_key_log(text, jsonb) from public;
grant execute on function import_key_log(text, jsonb) to authenticated;


-- =====================================================================
-- 3) ERINNERUNGSINTERVALL EINSTELLEN
--    Schreibt genau settings.key_interval_days, nichts anderes.
-- =====================================================================
create or replace function set_key_interval(p_days int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('keylog.upload') then
    raise exception 'Keine Berechtigung (keylog.upload erforderlich)';
  end if;
  if p_days < 1 then
    raise exception 'Das Intervall muss mindestens 1 Tag sein';
  end if;

  update tenants
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{key_interval_days}',
           to_jsonb(p_days),
           true
         )
   where id = auth_tenant_id();

  if not found then
    raise exception 'Verein nicht gefunden';
  end if;
end
$$;

revoke all on function set_key_interval(int) from public;
grant execute on function set_key_interval(int) to authenticated;


-- =====================================================================
-- 4) CHIP ZUWEISEN / ENTZIEHEN als Funktionen
--
--    Ginge auch über die key_chips_write-Policy aus 0004 (direktes insert/
--    delete). Als Funktion, weil "eine Person – ein Chip" sonst nur der
--    unique(tenant_id, chip_nr)-Constraint prüft, nicht aber, dass dieselbe
--    Person nicht zwei Chips bekommt. Und die Fehlermeldung wird sprechend.
-- =====================================================================
create or replace function assign_chip(p_member_id uuid, p_chip_nr text)
returns key_chips
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_chip   key_chips%rowtype;
begin
  if not has_perm('keys.manage') then
    raise exception 'Keine Berechtigung (keys.manage erforderlich)';
  end if;
  if not module_active('schluessel') then
    raise exception 'Modul "schluessel" ist nicht gebucht';
  end if;
  if coalesce(trim(p_chip_nr), '') = '' then
    raise exception 'Chip-Nummer fehlt';
  end if;

  if not exists (
    select 1 from members m where m.id = p_member_id and m.tenant_id = v_tenant
  ) then
    raise exception 'Mitglied gehört nicht zu diesem Verein';
  end if;

  if exists (
    select 1 from key_chips k where k.tenant_id = v_tenant and k.member_id = p_member_id
  ) then
    raise exception 'Diese Person hat bereits einen Chip';
  end if;

  insert into key_chips (tenant_id, member_id, chip_nr)
  values (v_tenant, p_member_id, trim(p_chip_nr))
  returning * into v_chip;

  return v_chip;
exception
  when unique_violation then
    raise exception 'Chip-Nummer "%" ist bereits vergeben', trim(p_chip_nr);
end
$$;

revoke all on function assign_chip(uuid, text) from public;
grant execute on function assign_chip(uuid, text) to authenticated;

create or replace function revoke_chip(p_chip_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('keys.manage') then
    raise exception 'Keine Berechtigung (keys.manage erforderlich)';
  end if;

  delete from key_chips
   where id = p_chip_id and tenant_id = auth_tenant_id();

  if not found then
    raise exception 'Chip nicht gefunden';
  end if;
end
$$;

revoke all on function revoke_chip(uuid) from public;
grant execute on function revoke_chip(uuid) to authenticated;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('key_chips', 'key_log_entries', 'key_log_uploads')
order by tablename, policyname;

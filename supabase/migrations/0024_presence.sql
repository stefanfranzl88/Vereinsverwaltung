-- =====================================================================
-- ONLINE-PRÄSENZ
--
-- Wer JETZT online ist, läuft über Supabase Realtime Presence (ephemer, rein
-- im Client/Realtime-Server – keine DB). Persistiert wird hier NUR "zuletzt
-- online" als Verwaltungsinfo (z. B. um inaktive Zugänge zu erkennen). Dieser
-- Zeitstempel ist ausschließlich für 'roles.manage'/Systemadmin lesbar, nicht
-- für die ganze Mannschaft.
--
-- Vereinsweiter Schalter: settings.presence_enabled (Default = an). Jeder
-- Kundenverein entscheidet selbst, ob Präsenz überhaupt angezeigt wird.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

create table if not exists member_presence (
  member_id    uuid primary key references members(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table member_presence enable row level security;
-- Bewusst KEINE Policies: Zugriff ausschließlich über die security-definer-
-- Funktionen unten (die als Eigentümer laufen und RLS umgehen). Ohne Policy ist
-- die Tabelle für die authenticated-Rolle vollständig dicht.


-- =====================================================================
-- Eigenen "zuletzt online"-Zeitstempel setzen. Respektiert den Schalter:
-- ist Präsenz vereinsweit deaktiviert, wird nichts gespeichert.
-- =====================================================================
create or replace function touch_presence()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := auth_member_id();
  v_tenant uuid := auth_tenant_id();
begin
  if v_member is null or v_tenant is null then
    return;
  end if;

  if coalesce(
       (select (settings->>'presence_enabled')::boolean from tenants where id = v_tenant),
       true) = false then
    return;
  end if;

  insert into member_presence (member_id, tenant_id, last_seen_at)
  values (v_member, v_tenant, now())
  on conflict (member_id) do update set last_seen_at = now();
end
$$;

revoke all on function touch_presence() from public;
grant execute on function touch_presence() to authenticated;


-- =====================================================================
-- "Zuletzt online" je Mitglied – NUR für roles.manage/Systemadmin.
-- has_perm() liest den JWT des Aufrufers (auch in security definer), die
-- Mandantentrennung bleibt also erhalten. Für alle anderen liefert die
-- Funktion nichts.
-- =====================================================================
create or replace function member_last_seen()
returns table (member_id uuid, last_seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select mp.member_id, mp.last_seen_at
  from member_presence mp
  where mp.tenant_id = auth_tenant_id()
    and has_perm('roles.manage')
$$;

revoke all on function member_last_seen() from public;
grant execute on function member_last_seen() to authenticated;


-- =====================================================================
-- Vereinsweiten Präsenz-Schalter setzen (roles.manage). Lässt andere
-- settings-Schlüssel unangetastet.
-- =====================================================================
create or replace function set_presence_enabled(p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('roles.manage') then
    raise exception 'Keine Berechtigung (roles.manage erforderlich)';
  end if;

  update tenants
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb), '{presence_enabled}', to_jsonb(p_enabled), true)
   where id = auth_tenant_id();

  if not found then
    raise exception 'Verein nicht gefunden';
  end if;
end
$$;

revoke all on function set_presence_enabled(boolean) from public;
grant execute on function set_presence_enabled(boolean) to authenticated;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in ('touch_presence', 'member_last_seen', 'set_presence_enabled')
order by proname;

-- =====================================================================
-- MITARBEITSPUNKTE: konfigurierbar im tenants.settings-jsonb
--
-- settings.mitarbeit = {
--   "point_values": { "Sitzung": 1, "Aufbau": 2, "Abbau": 2,
--                     "Veranstaltung": 2, "Sonstiges": 1, "Arbeitseinsatz": 3 },
--   "reward_tiers":  [ {"threshold": 4, "label": "…"},
--                      {"threshold": 6, "label": "…"} ],
--   "count_from":    "2026-01-01"
-- }
--
-- Fehlt die Config, greifen sinnvolle Defaults (Sitzung 1, Auf-/Abbau/
-- Veranstaltung 2, Sonstiges 1) – neue Vereine starten sofort lauffähig.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) KONFIG SCHREIBEN (roles.manage) – ersetzt settings.mitarbeit komplett,
--    lässt andere settings-Schlüssel (opening_balance_cents, key_interval_days,
--    last_key_log) unangetastet.
-- =====================================================================
create or replace function set_mitarbeit_config(p_config jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('roles.manage') then
    raise exception 'Keine Berechtigung (roles.manage erforderlich)';
  end if;

  update tenants
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{mitarbeit}', p_config, true)
   where id = auth_tenant_id();

  if not found then
    raise exception 'Verein nicht gefunden';
  end if;
end
$$;

revoke all on function set_mitarbeit_config(jsonb) from public;
grant execute on function set_mitarbeit_config(jsonb) to authenticated;


-- =====================================================================
-- 2) ANWESENHEITSART UMBENENNEN
--    Benennt den Schlüssel in point_values um UND zieht bestehende Protokolle
--    mit (proto_type). Beides in einer Transaktion, sonst zeigten alte
--    Protokolle nach dem Umbenennen ins Leere.
-- =====================================================================
create or replace function rename_attendance_type(p_old text, p_new text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_pv     jsonb;
  v_val    jsonb;
begin
  if not has_perm('roles.manage') then
    raise exception 'Keine Berechtigung (roles.manage erforderlich)';
  end if;
  if coalesce(trim(p_new), '') = '' then
    raise exception 'Neuer Name fehlt';
  end if;
  if p_old = p_new then
    return;
  end if;

  select settings->'mitarbeit'->'point_values' into v_pv
    from tenants where id = v_tenant;
  v_pv := coalesce(v_pv, '{}'::jsonb);

  if not (v_pv ? p_old) then
    raise exception 'Art "%" gibt es nicht', p_old;
  end if;
  if v_pv ? p_new then
    raise exception 'Art "%" gibt es bereits', p_new;
  end if;

  -- Wert unter neuem Schlüssel führen, alten entfernen
  v_val := v_pv -> p_old;
  v_pv := (v_pv - p_old) || jsonb_build_object(p_new, v_val);

  update tenants
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb), '{mitarbeit,point_values}', v_pv, true)
   where id = v_tenant;

  -- bestehende Protokolle mitziehen
  update protocols
     set proto_type = p_new
   where tenant_id = v_tenant and proto_type = p_old;
end
$$;

revoke all on function rename_attendance_type(text, text) from public;
grant execute on function rename_attendance_type(text, text) to authenticated;


-- =====================================================================
-- 3) member_points() NEU – rechnet aus der Config
--    Punkte = Σ point_values[proto_type] über Anwesenheiten ab count_from.
--    Punkte sind numeric (Kommazahlen erlaubt). sitzungen/einsaetze bleiben
--    reine Zählwerte (Sitzung vs. alles andere).
--
--    Die alte Signatur member_points(int) wird entfernt.
-- =====================================================================
drop function if exists member_points(int);

create or replace function member_points()
returns table (
  member_id  uuid,
  sitzungen  bigint,
  einsaetze  bigint,
  punkte     numeric
)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(settings->'mitarbeit', '{}'::jsonb) as m
    from tenants where id = auth_tenant_id()
  )
  select
    m.id,
    count(*) filter (where p.proto_type = 'Sitzung'),
    count(*) filter (where p.proto_type is not null and p.proto_type <> 'Sitzung'),
    coalesce(sum(
      coalesce(
        nullif((select cfg.m->'point_values'->>p.proto_type from cfg), '')::numeric,
        case p.proto_type
          when 'Sitzung'       then 1
          when 'Aufbau'        then 2
          when 'Abbau'         then 2
          when 'Veranstaltung' then 2
          when 'Sonstiges'     then 1
          else 0
        end
      )
    ), 0)
  from members m
  left join protocol_attendance a on a.member_id = m.id
  left join protocols p
         on p.id = a.protocol_id
        and p.tenant_id = m.tenant_id
        and p.proto_date >= coalesce(
              (select nullif(cfg.m->>'count_from', '')::date from cfg),
              '0001-01-01'::date)
  where m.tenant_id = auth_tenant_id()
    and m.status = 'aktiv'
    and module_active('mitarbeit')
  group by m.id
$$;

revoke all on function member_points() from public;
grant execute on function member_points() to authenticated;


-- =====================================================================
-- 4) create_protocol() NEU – erlaubt konfigurierte Arten
--    Statt der fixen 5 Arten: Standard-5 ODER ein Schlüssel in
--    settings.mitarbeit.point_values. Sonst unverändert.
-- =====================================================================
create or replace function create_protocol(
  p_title      text,
  p_date       date,
  p_time_from  time,
  p_time_to    time,
  p_location   text,
  p_type       text,
  p_visibility text,
  p_body       text,
  p_attendees  uuid[]  default '{}',
  p_tasks      jsonb   default '[]'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_author uuid := auth_member_id();
  v_id     uuid;
  v_task   jsonb;
  v_asg    uuid;
begin
  if not has_perm('protokoll.edit') then
    raise exception 'Keine Berechtigung (protokoll.edit erforderlich)';
  end if;
  if p_visibility not in ('alle', 'vorstand') then
    raise exception 'Ungültige Sichtbarkeit: %', p_visibility;
  end if;
  -- Standardarten ODER konfigurierte eigene Art
  if not (
    p_type in ('Sitzung', 'Aufbau', 'Abbau', 'Veranstaltung', 'Sonstiges')
    or coalesce(
         (select settings->'mitarbeit'->'point_values' ? p_type
            from tenants where id = v_tenant),
         false)
  ) then
    raise exception 'Ungültige Art: %', p_type;
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Titel fehlt';
  end if;

  insert into protocols (
    tenant_id, title, proto_date, time_from, time_to, location,
    proto_type, visibility, author_id, body
  ) values (
    v_tenant, trim(p_title), p_date, p_time_from, p_time_to, nullif(trim(p_location), ''),
    p_type, p_visibility, v_author, p_body
  )
  returning id into v_id;

  insert into protocol_attendance (protocol_id, member_id)
  select distinct v_id, m.id
    from members m
   where m.id = any(p_attendees) and m.tenant_id = v_tenant
  on conflict (protocol_id, member_id) do nothing;

  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    if coalesce(trim(v_task ->> 'title'), '') = '' then
      continue;
    end if;
    v_asg := nullif(v_task ->> 'assignee_id', '')::uuid;
    if v_asg is not null and not exists (
      select 1 from members m where m.id = v_asg and m.tenant_id = v_tenant
    ) then
      raise exception 'Zugeteilte Person gehört nicht zu diesem Verein';
    end if;
    insert into tasks (
      tenant_id, title, assignee_id, due_date, done, source_type, source_id, created_by
    ) values (
      v_tenant, trim(v_task ->> 'title'), v_asg,
      nullif(v_task ->> 'due_date', '')::date, false, 'protocol', v_id, v_author
    );
  end loop;

  return v_id;
end
$$;

revoke all on function create_protocol(text, date, time, time, text, text, text, text, uuid[], jsonb) from public;
grant execute on function create_protocol(text, date, time, time, text, text, text, text, uuid[], jsonb) to authenticated;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in ('member_points', 'set_mitarbeit_config', 'rename_attendance_type')
order by proname;

-- =====================================================================
-- PROTOKOLLE: RLS für die Anwesenheit + atomares Speichern
--
-- protocols selbst ist im Basisschema bereits abgesichert (proto_select /
-- proto_write, letzteres in 0003 korrigiert). ABER:
--
--   * protocol_attendance hat KEINE RLS – die Anwesenheitslisten aller Vereine
--     wären les- und schreibbar. Sie sind zugleich die Basis für die
--     Mitarbeitspunkte, also nichts, was der Client frei setzen darf.
--
--   * Ein Protokoll zu speichern schreibt in DREI Tabellen: protocols,
--     protocol_attendance und tasks. Aus dem Browser wären das drei Requests.
--     Bricht der zweite ab, steht ein Protokoll ohne Anwesenheitsliste in der
--     Datenbank – und niemand merkt es, weil das Protokoll ja da ist.
--     → create_protocol() macht alles in EINER Transaktion.
--
-- "Vorstand" ist weiterhin has_perm('roles.view') – so definiert es das
-- Basisschema selbst im Kommentar bei proto_select.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) PROTOCOL_ATTENDANCE
--    Lesbar, wenn das zugehörige Protokoll lesbar ist – dieselbe Bedingung
--    wie in proto_select, damit die Anwesenheit nicht an einem Protokoll
--    vorbei sichtbar wird, das man gar nicht sehen darf.
--    Geschrieben wird ausschließlich über create_protocol().
-- =====================================================================
alter table protocol_attendance enable row level security;

drop policy if exists protocol_attendance_select on protocol_attendance;
create policy protocol_attendance_select on protocol_attendance for select
  using (exists (
    select 1 from protocols p
    where p.id = protocol_attendance.protocol_id
      and p.tenant_id = auth_tenant_id()
      and (p.visibility = 'alle' or has_perm('roles.view'))
  ));


-- =====================================================================
-- 2) TASKS: Aufgaben aus einem Protokoll sind sichtbar, wenn das Protokoll
--    sichtbar ist.
--
--    Die bisherige Policy (0005, erweitert in 0008) lässt nur die EIGENEN
--    Aufgaben durch – plus alle für 'tasks.viewall' und plus Event-Aufgaben.
--    Im Protokoll-Detail steht aber die komplette Aufgabenverteilung, und ein
--    Protokoll mit Sichtbarkeit "alle" darf jedes Mitglied lesen.
--
--    Die Bedingung spiegelt exakt proto_select – ein Protokoll "nur Vorstand"
--    gibt seine Aufgaben also auch nur dem Vorstand preis.
-- =====================================================================
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select
  using (
    tenant_id = auth_tenant_id()
    and (
      assignee_id = auth_member_id()
      or has_perm('tasks.viewall')
      or (source_type = 'big_event' and module_active('events'))
      or (
        source_type = 'protocol'
        and exists (
          select 1 from protocols p
          where p.id = tasks.source_id
            and p.tenant_id = auth_tenant_id()
            and (p.visibility = 'alle' or has_perm('roles.view'))
        )
      )
    )
  );


-- =====================================================================
-- 3) PROTOKOLL SPEICHERN – Kopf, Anwesenheit und Aufgaben in einer Transaktion
--
--    p_attendees: uuid[] der anwesenden Mitglieder
--    p_tasks:     jsonb-Array [{"title": "...", "assignee_id": "...",
--                               "due_date": "2026-08-01" | null}, ...]
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
  if p_type not in ('Sitzung', 'Aufbau', 'Abbau', 'Veranstaltung', 'Sonstiges') then
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

  -- Anwesenheit. Fremde member_id werden hier verworfen, nicht stillschweigend
  -- übernommen: distinct + Prüfung auf denselben Verein.
  insert into protocol_attendance (protocol_id, member_id)
  select distinct v_id, m.id
    from members m
   where m.id = any(p_attendees)
     and m.tenant_id = v_tenant
  on conflict (protocol_id, member_id) do nothing;

  -- Aufgabenverteilung
  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    if coalesce(trim(v_task ->> 'title'), '') = '' then
      continue;                         -- leere Zeilen im Formular ignorieren
    end if;

    v_asg := nullif(v_task ->> 'assignee_id', '')::uuid;

    if v_asg is not null and not exists (
      select 1 from members m where m.id = v_asg and m.tenant_id = v_tenant
    ) then
      raise exception 'Zugeteilte Person gehört nicht zu diesem Verein';
    end if;

    insert into tasks (
      tenant_id, title, assignee_id, due_date, done,
      source_type, source_id, created_by
    ) values (
      v_tenant,
      trim(v_task ->> 'title'),
      v_asg,
      nullif(v_task ->> 'due_date', '')::date,
      false,
      'protocol',
      v_id,
      v_author
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
select tablename, policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('protocols', 'protocol_attendance', 'tasks')
order by tablename, policyname;

-- =====================================================================
-- RLS für Events & Projekte (Modul 'events')
--
-- big_events, big_event_subs, departments und dept_assignments haben im
-- Basisschema KEINE RLS – sie wären über alle Vereine hinweg les- und
-- schreibbar.
--
-- Die drei Kindtabellen tragen selbst KEIN tenant_id. Ihre Zugehörigkeit
-- ergibt sich über die Kette:
--   dept_assignments → departments → big_events → tenant_id
-- Genau diese Kette prüfen die Policies unten – sonst könnte man eine
-- Abteilung an ein fremdes Event hängen.
--
-- Lesen: jedes Vereinsmitglied (Einteilungen sind für alle sichtbar,
--        Eingeteilte sehen ihren Einsatz am Dashboard).
-- Schreiben: 'event.create'.
--
-- has_perm() steht überall in BEIDEN Klauseln – beim INSERT wertet Postgres
-- ausschließlich with check aus, nicht using.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) BIG_EVENTS
-- =====================================================================
alter table big_events enable row level security;

drop policy if exists big_events_select on big_events;
create policy big_events_select on big_events for select
  using (tenant_id = auth_tenant_id() and module_active('events'));

drop policy if exists big_events_write on big_events;
create policy big_events_write on big_events for all
  using (
    tenant_id = auth_tenant_id()
    and module_active('events')
    and has_perm('event.create')
  )
  with check (
    tenant_id = auth_tenant_id()
    and module_active('events')
    and has_perm('event.create')
  );


-- =====================================================================
-- 2) BIG_EVENT_SUBS (Subtermine)
-- =====================================================================
alter table big_event_subs enable row level security;

drop policy if exists big_event_subs_select on big_event_subs;
create policy big_event_subs_select on big_event_subs for select
  using (exists (
    select 1 from big_events e
    where e.id = big_event_subs.big_event_id
      and e.tenant_id = auth_tenant_id()
      and module_active('events')
  ));

drop policy if exists big_event_subs_write on big_event_subs;
create policy big_event_subs_write on big_event_subs for all
  using (
    has_perm('event.create')
    and exists (
      select 1 from big_events e
      where e.id = big_event_subs.big_event_id
        and e.tenant_id = auth_tenant_id()
        and module_active('events')
    )
  )
  with check (
    has_perm('event.create')
    and exists (
      select 1 from big_events e
      where e.id = big_event_subs.big_event_id
        and e.tenant_id = auth_tenant_id()
        and module_active('events')
    )
  );


-- =====================================================================
-- 3) DEPARTMENTS (Abteilungen)
-- =====================================================================
alter table departments enable row level security;

drop policy if exists departments_select on departments;
create policy departments_select on departments for select
  using (exists (
    select 1 from big_events e
    where e.id = departments.big_event_id
      and e.tenant_id = auth_tenant_id()
      and module_active('events')
  ));

drop policy if exists departments_write on departments;
create policy departments_write on departments for all
  using (
    has_perm('event.create')
    and exists (
      select 1 from big_events e
      where e.id = departments.big_event_id
        and e.tenant_id = auth_tenant_id()
        and module_active('events')
    )
  )
  with check (
    has_perm('event.create')
    and exists (
      select 1 from big_events e
      where e.id = departments.big_event_id
        and e.tenant_id = auth_tenant_id()
        and module_active('events')
    )
  );


-- =====================================================================
-- 4) DEPT_ASSIGNMENTS (Einteilung – Mitglieder UND externe Helfer)
--
--    Zusätzlich zur Abteilungskette wird geprüft, dass ein zugewiesenes
--    Mitglied auch WIRKLICH zum eigenen Verein gehört. Ohne diese Prüfung
--    könnte man eine fremde member_id eintragen – die Person würde den
--    Einsatz dann nirgends sehen, stünde aber im Helferplan.
-- =====================================================================
alter table dept_assignments enable row level security;

drop policy if exists dept_assignments_select on dept_assignments;
create policy dept_assignments_select on dept_assignments for select
  using (exists (
    select 1
    from departments d
    join big_events e on e.id = d.big_event_id
    where d.id = dept_assignments.department_id
      and e.tenant_id = auth_tenant_id()
      and module_active('events')
  ));

drop policy if exists dept_assignments_write on dept_assignments;
create policy dept_assignments_write on dept_assignments for all
  using (
    has_perm('event.create')
    and exists (
      select 1
      from departments d
      join big_events e on e.id = d.big_event_id
      where d.id = dept_assignments.department_id
        and e.tenant_id = auth_tenant_id()
        and module_active('events')
    )
  )
  with check (
    has_perm('event.create')
    and exists (
      select 1
      from departments d
      join big_events e on e.id = d.big_event_id
      where d.id = dept_assignments.department_id
        and e.tenant_id = auth_tenant_id()
        and module_active('events')
    )
    -- Externe haben keine member_id; eine gesetzte member_id muss aus dem
    -- eigenen Verein stammen.
    and (
      member_id is null
      or exists (
        select 1 from members m
        where m.id = dept_assignments.member_id
          and m.tenant_id = auth_tenant_id()
      )
    )
  );


-- =====================================================================
-- 5) TASKS: Aufgaben zu einem Event sind für ALLE Mitglieder sichtbar
--
--    Der Prototyp zeigt im Event-Detail alle Aufgaben des Events, unabhängig
--    von der Rolle ("Sichtbar für alle Mitglieder · Erfassen und Zuteilen je
--    nach Rolle"). Die bisherige tasks_select-Policy (aus 0005) lässt aber nur
--    die EIGENEN Aufgaben durch, sofern man nicht 'tasks.viewall' hat.
--
--    Deshalb hier erweitert: Aufgaben mit source_type = 'big_event' sind für
--    jedes Vereinsmitglied lesbar. Das ist kein neues Leck – wer in einer
--    Abteilung eingeteilt ist, steht ohnehin für alle sichtbar im Helferplan.
--    Die allgemeine Aufgabenübersicht (/aufgaben) bleibt unverändert an
--    'tasks.viewall' gebunden.
-- =====================================================================
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select
  using (
    tenant_id = auth_tenant_id()
    and (
      assignee_id = auth_member_id()
      or has_perm('tasks.viewall')
      or (source_type = 'big_event' and module_active('events'))
    )
  );


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select tablename, policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('big_events', 'big_event_subs', 'departments', 'dept_assignments', 'tasks')
order by tablename, policyname;

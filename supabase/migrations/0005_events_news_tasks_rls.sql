-- =====================================================================
-- RLS + Hilfsfunktionen für Termine, Mitteilungen und Aufgaben
--
-- events, event_rsvps, news und tasks haben im Basisschema KEINE RLS
-- (Abschnitt 9 deckt nur members/transactions/invoices/protocols ab).
-- Ohne dieses Skript wären sie über alle Vereine hinweg les- und schreibbar.
--
-- "Vorstand" ist im Datenmodell keine eigene Größe. Das Basisschema verwendet
-- dafür has_perm('roles.view') als Marker (siehe Kommentar bei proto_select).
-- Diese Konvention wird hier fortgeführt: Wer die Rollen-Matrix einsehen darf,
-- gilt als Vorstand – und sieht damit auch, WER zu-/abgesagt hat.
--
-- has_perm() steht überall in BEIDEN Klauseln: bei einer for-all-Policy wertet
-- Postgres beim INSERT ausschließlich with check aus, nicht using.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) EVENTS (Termine, Modul 'core')
--    Lesen: jedes Vereinsmitglied. Anlegen/Ändern: 'event.create'.
-- =====================================================================
alter table events enable row level security;

drop policy if exists events_select on events;
create policy events_select on events for select
  using (tenant_id = auth_tenant_id());

drop policy if exists events_write on events;
create policy events_write on events for all
  using      (tenant_id = auth_tenant_id() and has_perm('event.create'))
  with check (tenant_id = auth_tenant_id() and has_perm('event.create'));


-- =====================================================================
-- 2) EVENT_RSVPS (Zu-/Absagen)
--
--    Jeder darf nur seine EIGENE Antwort schreiben – member_id ist an
--    auth_member_id() gebunden, sonst könnte man für andere zusagen.
--
--    Lesen: die eigene Antwort, plus für den Vorstand (roles.view) alle.
--    Die ZAHLEN (x Zusagen / y Absagen) sollen aber alle sehen, ohne die
--    NAMEN zu kennen. Spaltenweise Sichtbarkeit kann RLS nicht – deshalb
--    liefert die security-definer-Funktion event_rsvp_counts() weiter unten
--    nur Aggregate.
-- =====================================================================
alter table event_rsvps enable row level security;

drop policy if exists event_rsvps_select on event_rsvps;
create policy event_rsvps_select on event_rsvps for select
  using (
    exists (
      select 1 from events e
      where e.id = event_rsvps.event_id and e.tenant_id = auth_tenant_id()
    )
    and (
      member_id = auth_member_id()      -- die eigene Antwort
      or has_perm('roles.view')         -- Vorstand sieht alle Namen
    )
  );

drop policy if exists event_rsvps_write on event_rsvps;
create policy event_rsvps_write on event_rsvps for all
  using (
    member_id = auth_member_id()
    and exists (
      select 1 from events e
      where e.id = event_rsvps.event_id and e.tenant_id = auth_tenant_id()
    )
  )
  with check (
    member_id = auth_member_id()
    and exists (
      select 1 from events e
      where e.id = event_rsvps.event_id and e.tenant_id = auth_tenant_id()
    )
  );

-- Zusagen/Absagen als reine Zahlen – für jedes Mitglied sichtbar, ohne Namen.
create or replace function event_rsvp_counts()
returns table (event_id uuid, yes_count bigint, no_count bigint)
language sql stable security definer set search_path = public as $$
  select e.id,
         count(*) filter (where r.answer = 'yes'),
         count(*) filter (where r.answer = 'no')
  from events e
  left join event_rsvps r on r.event_id = e.id
  where e.tenant_id = auth_tenant_id()
  group by e.id
$$;

revoke all on function event_rsvp_counts() from public;
grant execute on function event_rsvp_counts() to authenticated;

-- Anzahl aktiver Mitglieder – Basis für "Noch keine Antwort: n".
create or replace function active_member_count()
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from members
  where tenant_id = auth_tenant_id() and status = 'aktiv'
$$;

revoke all on function active_member_count() from public;
grant execute on function active_member_count() to authenticated;


-- =====================================================================
-- 3) NEWS (Mitteilungen, Modul 'core')
--
--    Abgelaufene Mitteilungen (expires_at < heute) verschwinden für normale
--    Mitglieder bereits auf DB-Ebene. Wer veröffentlichen darf ('news.post'),
--    sieht auch die abgelaufenen – sonst wären sie unauffindbar.
-- =====================================================================
alter table news enable row level security;

drop policy if exists news_select on news;
create policy news_select on news for select
  using (
    tenant_id = auth_tenant_id()
    and (
      expires_at is null
      or expires_at >= current_date
      or has_perm('news.post')
    )
  );

drop policy if exists news_write on news;
create policy news_write on news for all
  using      (tenant_id = auth_tenant_id() and has_perm('news.post'))
  with check (tenant_id = auth_tenant_id() and has_perm('news.post'));


-- =====================================================================
-- 4) TASKS (Aufgaben, Modul 'core')
--
--    Lesen: die eigenen Aufgaben – plus ALLE für 'tasks.viewall' (Vorstand).
--    Anlegen/Ändern/Löschen: 'tasks.create'.
--
--    Abhaken darf zusätzlich die zugeteilte Person. Das geht BEWUSST über eine
--    Funktion und nicht über eine update-Policy auf der eigenen Zeile: RLS wirkt
--    zeilen-, nicht spaltenweise. Eine Policy "assignee_id = auth_member_id()"
--    würde erlauben, an der eigenen Aufgabe AUCH Titel, Fälligkeit oder die
--    Zuständigkeit zu ändern. set_task_done() schreibt nur done und done_at.
-- =====================================================================
alter table tasks enable row level security;

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select
  using (
    tenant_id = auth_tenant_id()
    and (
      assignee_id = auth_member_id()
      or has_perm('tasks.viewall')
    )
  );

drop policy if exists tasks_write on tasks;
create policy tasks_write on tasks for all
  using      (tenant_id = auth_tenant_id() and has_perm('tasks.create'))
  with check (tenant_id = auth_tenant_id() and has_perm('tasks.create'));

create or replace function set_task_done(p_task_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update tasks
     set done    = p_done,
         done_at = case when p_done then current_date else null end
   where id = p_task_id
     and tenant_id = auth_tenant_id()
     -- Nur die zugeteilte Person – oder wer Aufgaben verwalten darf.
     and (assignee_id = auth_member_id() or has_perm('tasks.create'));

  if not found then
    raise exception 'Aufgabe nicht gefunden oder keine Berechtigung';
  end if;
end
$$;

revoke all on function set_task_done(uuid, boolean) from public;
grant execute on function set_task_done(uuid, boolean) to authenticated;


-- =====================================================================
-- 5) STORAGE: Bucket "news" für Mitteilungsfotos
--    Pfad: {tenant_id}/{uuid}.{ext} – analog zu avatars.
--    Falls "must be owner of table objects" kommt: Bucket und Policies
--    stattdessen im Dashboard unter Storage anlegen.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('news', 'news', false)
on conflict (id) do nothing;

drop policy if exists news_read on storage.objects;
create policy news_read on storage.objects for select to authenticated
  using (bucket_id = 'news' and (storage.foldername(name))[1] = auth_tenant_id()::text);

drop policy if exists news_upload on storage.objects;
create policy news_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'news'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('news.post')
  );

drop policy if exists news_delete on storage.objects;
create policy news_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'news'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and has_perm('news.post')
  );


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select tablename, policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('events', 'event_rsvps', 'news', 'tasks')
order by tablename, policyname;

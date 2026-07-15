-- =====================================================================
-- UMFRAGEN (Modul 'umfragen')
--
-- surveys, survey_options und survey_votes haben im Basisschema KEINE RLS.
--
-- GEHEIME ABSTIMMUNG – die wichtigste Entscheidung hier:
--
-- survey_votes enthält member_id UND option_id. Wäre die Tabelle frei lesbar,
-- könnte jedes Mitglied per API auslesen, WER WAS gewählt hat – auch wenn die
-- Oberfläche nur Balken zeigt. Der Prototyp zeigt nie, wer wie gestimmt hat;
-- genau das wird hier auch technisch durchgesetzt:
--
--   * survey_votes: jeder sieht NUR die eigene Stimme.
--   * Die Ergebnisse kommen als Aggregat aus survey_results() –
--     Stimmen pro Option, ohne Personenbezug.
--
-- Das ist dasselbe Muster wie bei den Zusagen zu Terminen (0005), mit einem
-- Unterschied: Dort darf der Vorstand die Namen sehen ("Wer kommt?"), weil er
-- planen muss. Bei einer Abstimmung gibt es dafür keinen Grund – niemand,
-- auch nicht der Obmann, sieht das Stimmverhalten.
--
-- EINE STIMME PRO PERSON erzwingt bereits der Primärschlüssel
-- (survey_id, member_id). Eine abgegebene Stimme ist endgültig: Es gibt weder
-- eine update- noch eine delete-Policy auf survey_votes.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) RLS
-- =====================================================================

-- --- surveys: lesen alle. Anlegen/Schließen nur mit 'survey.create'.
alter table surveys enable row level security;

drop policy if exists surveys_select on surveys;
create policy surveys_select on surveys for select
  using (tenant_id = auth_tenant_id() and module_active('umfragen'));

drop policy if exists surveys_write on surveys;
create policy surveys_write on surveys for all
  using      (tenant_id = auth_tenant_id() and module_active('umfragen') and has_perm('survey.create'))
  with check (tenant_id = auth_tenant_id() and module_active('umfragen') and has_perm('survey.create'));

-- --- survey_options: lesen alle (man muss ja wissen, worüber abgestimmt wird).
alter table survey_options enable row level security;

drop policy if exists survey_options_select on survey_options;
create policy survey_options_select on survey_options for select
  using (exists (
    select 1 from surveys s
    where s.id = survey_options.survey_id
      and s.tenant_id = auth_tenant_id()
      and module_active('umfragen')
  ));

drop policy if exists survey_options_write on survey_options;
create policy survey_options_write on survey_options for all
  using (
    has_perm('survey.create')
    and exists (
      select 1 from surveys s
      where s.id = survey_options.survey_id
        and s.tenant_id = auth_tenant_id()
        and module_active('umfragen')
    )
  )
  with check (
    has_perm('survey.create')
    and exists (
      select 1 from surveys s
      where s.id = survey_options.survey_id
        and s.tenant_id = auth_tenant_id()
        and module_active('umfragen')
    )
  );

-- --- survey_votes: NUR die eigene Stimme ist lesbar. Kein insert/update/delete
--     über die Tabelle – geschrieben wird ausschließlich über vote_survey().
alter table survey_votes enable row level security;

drop policy if exists survey_votes_select on survey_votes;
create policy survey_votes_select on survey_votes for select
  using (
    member_id = auth_member_id()
    and exists (
      select 1 from surveys s
      where s.id = survey_votes.survey_id
        and s.tenant_id = auth_tenant_id()
        and module_active('umfragen')
    )
  );


-- =====================================================================
-- 2) ERGEBNISSE – Aggregate ohne Personenbezug
--
--    Liefert für jede Option die Stimmenzahl. Optionen ohne Stimme kommen
--    mit 0 zurück (left join), sonst fehlten sie im Balkendiagramm.
-- =====================================================================
create or replace function survey_results()
returns table (survey_id uuid, option_id uuid, votes bigint)
language sql stable security definer set search_path = public as $$
  select o.survey_id, o.id, count(v.member_id)
  from surveys s
  join survey_options o on o.survey_id = s.id
  left join survey_votes v on v.option_id = o.id
  where s.tenant_id = auth_tenant_id()
    and module_active('umfragen')
  group by o.survey_id, o.id
$$;

revoke all on function survey_results() from public;
grant execute on function survey_results() to authenticated;


-- =====================================================================
-- 3) ABSTIMMEN
--
--    Als Funktion und nicht als insert-Policy, damit die Ablehnungsgründe
--    beim Namen genannt werden können. Eine verletzte Policy liefert nur ein
--    nacktes 42501 – "Umfrage ist bereits beendet" ist deutlich hilfreicher.
--
--    Geprüft wird: Verein, Modul, Umfrage offen, Option gehört zu DIESER
--    Umfrage (sonst könnte man auf eine Option einer anderen Umfrage stimmen).
-- =====================================================================
create or replace function vote_survey(p_survey_id uuid, p_option_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := auth_member_id();
  v_open   boolean;
begin
  if v_member is null then
    raise exception 'Dein Login ist mit keinem Mitglied verknüpft';
  end if;

  select s.is_open into v_open
    from surveys s
   where s.id = p_survey_id
     and s.tenant_id = auth_tenant_id()
     and module_active('umfragen');

  if not found then
    raise exception 'Umfrage nicht gefunden';
  end if;
  if not v_open then
    raise exception 'Diese Umfrage ist bereits beendet';
  end if;

  if not exists (
    select 1 from survey_options o
    where o.id = p_option_id and o.survey_id = p_survey_id
  ) then
    raise exception 'Diese Antwortoption gehört nicht zu dieser Umfrage';
  end if;

  -- Der Primärschlüssel (survey_id, member_id) lässt nur eine Stimme zu.
  -- Ein zweiter Versuch soll klar scheitern, nicht still die erste ersetzen.
  if exists (
    select 1 from survey_votes v
    where v.survey_id = p_survey_id and v.member_id = v_member
  ) then
    raise exception 'Du hast bei dieser Umfrage bereits abgestimmt';
  end if;

  insert into survey_votes (survey_id, member_id, option_id)
  values (p_survey_id, v_member, p_option_id);
end
$$;

revoke all on function vote_survey(uuid, uuid) from public;
grant execute on function vote_survey(uuid, uuid) to authenticated;


-- =====================================================================
-- 4) UMFRAGE ANLEGEN – Frage und Optionen in einer Transaktion
-- =====================================================================
create or replace function create_survey(p_question text, p_options text[])
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_opt text;
  v_i   int := 0;
  v_n   int := 0;
begin
  if not has_perm('survey.create') then
    raise exception 'Keine Berechtigung (survey.create erforderlich)';
  end if;
  if coalesce(trim(p_question), '') = '' then
    raise exception 'Frage fehlt';
  end if;

  -- Mindestens zwei echte Optionen – eine Umfrage mit einer Antwort ist keine.
  foreach v_opt in array coalesce(p_options, '{}')
  loop
    if coalesce(trim(v_opt), '') <> '' then
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n < 2 then
    raise exception 'Mindestens zwei Antwortoptionen nötig';
  end if;

  insert into surveys (tenant_id, question, is_open, created_by)
  values (auth_tenant_id(), trim(p_question), true, auth_member_id())
  returning id into v_id;

  foreach v_opt in array p_options
  loop
    if coalesce(trim(v_opt), '') = '' then
      continue;
    end if;
    insert into survey_options (survey_id, label, sort_order)
    values (v_id, trim(v_opt), v_i);
    v_i := v_i + 1;
  end loop;

  return v_id;
end
$$;

revoke all on function create_survey(text, text[]) from public;
grant execute on function create_survey(text, text[]) to authenticated;


-- =====================================================================
-- 5) BEENDEN / WIEDER ÖFFNEN
--    Der Prototyp kennt den Zustand "beendet", aber keinen Weg dorthin.
--    Hier ist er – bestehende Stimmen bleiben unangetastet.
-- =====================================================================
create or replace function set_survey_open(p_survey_id uuid, p_open boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('survey.create') then
    raise exception 'Keine Berechtigung (survey.create erforderlich)';
  end if;

  update surveys
     set is_open = p_open
   where id = p_survey_id
     and tenant_id = auth_tenant_id()
     and module_active('umfragen');

  if not found then
    raise exception 'Umfrage nicht gefunden';
  end if;
end
$$;

revoke all on function set_survey_open(uuid, boolean) from public;
grant execute on function set_survey_open(uuid, boolean) to authenticated;


-- =====================================================================
-- KONTROLLE
--
-- survey_votes darf GENAU EINE Policy haben (select), und keine für
-- insert/update/delete – sonst wäre die Stimmabgabe an vote_survey() vorbei
-- möglich oder das Stimmverhalten lesbar.
-- =====================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('surveys', 'survey_options', 'survey_votes')
order by tablename, policyname;

select count(*) as votes_policies_ausser_select
from pg_policies
where schemaname = 'public' and tablename = 'survey_votes' and cmd <> 'SELECT';

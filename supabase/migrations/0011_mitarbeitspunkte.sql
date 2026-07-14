-- =====================================================================
-- MITARBEITSPUNKTE (Modul 'mitarbeit')
--
-- Die Punkte leiten sich vollständig aus protocol_attendance ab – es gibt
-- keine eigene Tabelle. Punktewert je Protokollart:
--
--   Sitzung        1 Punkt
--   Aufbau         2 Punkte
--   Abbau          2 Punkte
--   Veranstaltung  2 Punkte
--   Sonstiges      1 Punkt
--
-- WARUM EINE FUNKTION UND KEINE ABFRAGE IM FRONTEND?
--
-- protocol_attendance ist an die Sichtbarkeit des Protokolls gekoppelt
-- (siehe 0010): Ein Protokoll mit visibility = 'vorstand' – und damit auch
-- seine Anwesenheitsliste – ist für normale Mitglieder unsichtbar.
--
-- Würde die Rangliste im Browser aus den sichtbaren Zeilen gerechnet, bekäme
-- jedes Mitglied ein ANDERES Ergebnis: Der Vorstand sähe die Punkte aus
-- Vorstandssitzungen, alle anderen nicht. Dieselbe Tabelle zeigte je nach
-- Betrachter andere Zahlen – und niemand könnte sagen, welche stimmt.
--
-- Diese Funktion läuft als security definer und zählt über ALLE Protokolle
-- des Vereins. Nach außen gibt sie ausschließlich Aggregate: Anzahl und
-- Punkte. Weder Titel noch Inhalt noch die Existenz einzelner Protokolle
-- werden dadurch preisgegeben – genau das, was das Modul veröffentlichen soll.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

create or replace function member_points(p_year int default null)
returns table (
  member_id  uuid,
  sitzungen  bigint,
  einsaetze  bigint,   -- Aufbau, Abbau, Veranstaltung, Sonstiges
  punkte     bigint
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    count(*) filter (where p.proto_type = 'Sitzung'),
    count(*) filter (where p.proto_type is not null and p.proto_type <> 'Sitzung'),
    coalesce(sum(
      case p.proto_type
        when 'Sitzung'       then 1
        when 'Aufbau'        then 2
        when 'Abbau'         then 2
        when 'Veranstaltung' then 2
        when 'Sonstiges'     then 1
        else 0
      end
    ), 0)
  from members m
  -- left join: Mitglieder ohne jede Anwesenheit erscheinen mit 0 Punkten,
  -- so wie im Prototyp ("wer fast nie kommt, sieht das hier auch").
  left join protocol_attendance a on a.member_id = m.id
  left join protocols p
         on p.id = a.protocol_id
        and p.tenant_id = m.tenant_id
        and (p_year is null or extract(year from p.proto_date) = p_year)
  where m.tenant_id = auth_tenant_id()
    and m.status = 'aktiv'
    and module_active('mitarbeit')
  group by m.id
$$;

revoke all on function member_points(int) from public;
grant execute on function member_points(int) to authenticated;


-- =====================================================================
-- KONTROLLE
--
-- ACHTUNG: member_points() lässt sich hier NICHT direkt aufrufen. Die Funktion
-- filtert über auth_tenant_id(), und das ist im SQL-Editor null – dort läuft man
-- als 'postgres' und nicht als eingeloggter Benutzer. Der Aufruf käme leer
-- zurück, was wie ein Fehler aussähe, aber keiner ist.
--
-- Die folgende Abfrage rechnet dasselbe ohne Auth-Kontext, über den Vereins-Slug.
--
-- Erwartet mit seed_demo_protokolle.sql (Vereinsjahr 2026):
--   Vorstandssitzung Juni  (Sitzung, 1 P): Smole, Kovac, Omann, Gelbmann
--   Vorstandssitzung Mai   (Sitzung, 1 P): Smole, Kovac, Omann
--   Auf-/Abbau Frühjahr    (Aufbau,  2 P): Smole, Kovac, Omann, F. Franzl,
--                                          Gelbmann, Umele, S. Franzl
--
--   → Smole / Kovac / Omann:          2 Sitzungen + 1 Einsatz = 4 Punkte
--   → Gelbmann:                       1 Sitzung   + 1 Einsatz = 3 Punkte
--   → F. Franzl / Umele / S. Franzl:                1 Einsatz = 2 Punkte
--   → Giefer:                         nie anwesend            = 0 Punkte
-- =====================================================================
select
  m.first_name || ' ' || m.last_name                                    as mitglied,
  count(*) filter (where p.proto_type = 'Sitzung')                      as sitzungen,
  count(*) filter (where p.proto_type is not null
                     and p.proto_type <> 'Sitzung')                     as einsaetze,
  coalesce(sum(
    case p.proto_type
      when 'Sitzung'       then 1
      when 'Aufbau'        then 2
      when 'Abbau'         then 2
      when 'Veranstaltung' then 2
      when 'Sonstiges'     then 1
      else 0
    end
  ), 0)                                                                 as punkte
from tenants t
join members m on m.tenant_id = t.id and m.status = 'aktiv'
left join protocol_attendance a on a.member_id = m.id
left join protocols p on p.id = a.protocol_id
                     and p.tenant_id = t.id
                     and extract(year from p.proto_date) = 2026
where t.slug = 'goedersdorf'
group by m.id, m.first_name, m.last_name
order by punkte desc, m.last_name;

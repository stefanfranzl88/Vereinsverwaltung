-- =====================================================================
-- MITGLIEDER-EINLADUNGEN: Account-Status je Mitglied
--
-- Die Einladung selbst läuft über die Edge Function 'invite-member'
-- (service_role, nur im Backend). Sie legt bei Annahme die profiles-Zeile an.
--
-- Für die Anzeige in der Mitgliederliste braucht das Frontend pro Mitglied:
--   'aktiv'      – Zugang existiert und die E-Mail wurde bestätigt
--   'eingeladen' – Zugang existiert, Einladung noch nicht angenommen
--   (kein Eintrag) – noch kein Zugang → einladbar
--
-- Das steht in profiles (Zugang ja/nein) und auth.users (E-Mail bestätigt).
-- auth.users ist für die authenticated-Rolle NICHT lesbar – deshalb eine
-- security-definer-Funktion, die NUR den Status-Enum zurückgibt, keine
-- E-Mails oder Auth-Details, und streng auf den eigenen Verein gefiltert.
--
-- auth.uid() (und damit auth_tenant_id()) liest den JWT des Aufrufers, nicht
-- den Funktionseigentümer – die Mandantentrennung bleibt also erhalten.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

create or replace function member_account_states()
returns table (member_id uuid, status text)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    case
      when u.email_confirmed_at is not null then 'aktiv'
      else 'eingeladen'
    end
  from members m
  join profiles p on p.member_id = m.id
  join auth.users u on u.id = p.id
  where m.tenant_id = auth_tenant_id()
$$;

revoke all on function member_account_states() from public;
grant execute on function member_account_states() to authenticated;


-- =====================================================================
-- KONTROLLE (im SQL-Editor null, da auth.uid() dort fehlt – siehe 0011).
-- Ersatzweise direkt über den Slug prüfen:
-- =====================================================================
select
  m.first_name || ' ' || m.last_name as mitglied,
  m.email,
  case
    when p.id is null                        then 'kein Zugang'
    when u.email_confirmed_at is not null    then 'aktiv'
    else 'eingeladen'
  end as account_status
from tenants t
join members m on m.tenant_id = t.id
left join profiles p on p.member_id = m.id
left join auth.users u on u.id = p.id
where t.slug = 'goedersdorf'
order by m.last_name;

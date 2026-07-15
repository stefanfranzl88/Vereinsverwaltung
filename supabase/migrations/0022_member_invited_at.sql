-- =====================================================================
-- member_account_states() um invited_at erweitern
--
-- Für den „↻ Erneut einladen"-Button braucht die Mitgliederliste zusätzlich,
-- WANN zuletzt eingeladen wurde. Das steht in auth.users.invited_at (setzt
-- inviteUserByEmail). Weiterhin nur der Status-Enum + dieser Zeitstempel,
-- nichts Sensibles, streng auf den eigenen Verein gefiltert.
--
-- Rückgabetyp ändert sich → drop + create (create or replace reicht nicht).
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

drop function if exists member_account_states();

create function member_account_states()
returns table (member_id uuid, status text, invited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    case
      when u.email_confirmed_at is not null then 'aktiv'
      else 'eingeladen'
    end,
    u.invited_at
  from members m
  join profiles p on p.member_id = m.id
  join auth.users u on u.id = p.id
  where m.tenant_id = auth_tenant_id()
$$;

revoke all on function member_account_states() from public;
grant execute on function member_account_states() to authenticated;

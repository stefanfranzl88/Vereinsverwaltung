-- =====================================================================
-- VEREINS-CHAT (Modul 'chat')
--
-- chat_messages hat im Basisschema KEINE RLS – die Nachrichten aller Vereine
-- wären les- und schreibbar.
--
-- Zwei Dinge sind hier anders als bei den übrigen Modulen:
--
--   1. ECHTZEIT. Ein Chat, bei dem man neu laden muss, ist keiner. Die Tabelle
--      wird der supabase_realtime-Publication hinzugefügt, damit der Client
--      neue Nachrichten per Postgres-Changes empfängt. Realtime wendet dabei
--      die SELECT-Policy an – ein Benutzer bekommt also nur die Nachrichten
--      SEINES Vereins geliefert, nicht die anderer Mandanten.
--
--   2. Kein Bearbeiten. Eine gesendete Nachricht ist gesagt. Es gibt eine
--      insert-Policy (nur im eigenen Namen) und – bewusst – keine update-
--      Policy. Löschen darf man die EIGENE Nachricht (Tippfehler, Versehen).
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) RLS
-- =====================================================================
alter table chat_messages enable row level security;

drop policy if exists chat_messages_select on chat_messages;
create policy chat_messages_select on chat_messages for select
  using (tenant_id = auth_tenant_id() and module_active('chat'));

-- Senden nur im eigenen Namen: member_id ist an auth_member_id() gebunden,
-- sonst könnte man Nachrichten unter fremdem Namen absetzen.
drop policy if exists chat_messages_insert on chat_messages;
create policy chat_messages_insert on chat_messages for insert
  with check (
    tenant_id = auth_tenant_id()
    and module_active('chat')
    and member_id = auth_member_id()
  );

-- Die eigene Nachricht darf gelöscht werden.
drop policy if exists chat_messages_delete on chat_messages;
create policy chat_messages_delete on chat_messages for delete
  using (tenant_id = auth_tenant_id() and member_id = auth_member_id());


-- =====================================================================
-- 2) REALTIME
--    Tabelle zur supabase_realtime-Publication hinzufügen – mit Guard, weil
--    ein erneutes "add table" auf eine bereits enthaltene Tabelle fehlschlägt.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table chat_messages;
    end if;
  end if;
end
$$;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'chat_messages'
order by policyname;

-- Muss eine Zeile liefern: chat_messages ist in der Realtime-Publication.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'chat_messages';

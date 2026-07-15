-- =====================================================================
-- DEMO-INHALTE VEREINS-CHAT
--
-- Optional. Voraussetzung: setup_complete.sql und 0015_chat.sql.
-- Idempotent: Existenz-Check über den Nachrichtentext; mehrfach ausführbar.
-- =====================================================================

insert into chat_messages (tenant_id, member_id, body, created_at)
select t.id, m.id, c.body, c.ts::timestamptz
from tenants t
join (values
  ('Christoph', 'Kovac', 'Getränkebestellung fürs Sommerfest ist raus – Lieferung Freitag Vormittag.', '2026-07-14T14:22:00+00'),
  ('Markus',    'Smole', 'Super, danke Christoph! Wer kann Freitag beim Abladen helfen?',              '2026-07-14T15:03:00+00'),
  ('Sandro',    'Omann', 'Ich bin ab 16 Uhr da 👍',                                                    '2026-07-14T15:41:00+00')
) as c(first_name, last_name, body, ts) on true
join members m on m.tenant_id = t.id
              and m.first_name = c.first_name
              and m.last_name  = c.last_name
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from chat_messages ex
    where ex.tenant_id = t.id and ex.body = c.body
  );


-- ---------------------------------------------------------------
-- KONTROLLE
-- ---------------------------------------------------------------
select
  m.first_name || ' ' || m.last_name as absender,
  c.body,
  c.created_at
from chat_messages c
join tenants t on t.id = c.tenant_id and t.slug = 'goedersdorf'
join members m on m.id = c.member_id
order by c.created_at;

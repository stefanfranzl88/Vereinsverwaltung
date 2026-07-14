-- =====================================================================
-- RLS für key_chips
--
-- Die Mitgliederliste zeigt ein 🔑 neben Personen mit Schlüsselchip (wie im
-- Prototyp). Dafür liest die App key_chips – eine Tabelle, die im Basisschema
-- KEINE RLS hat. Ohne dieses Skript könnte jeder eingeloggte Benutzer die
-- Chipnummern ALLER Vereine lesen und ändern.
--
-- Lesen: alle Mitglieder des eigenen Vereins, sofern das Modul 'schluessel'
--        gebucht ist. Das entspricht dem Prototyp, wo das Schlüssel-Symbol für
--        jeden sichtbar war (nur die Schlüssel-VERWALTUNG war rechtebeschränkt).
-- Schreiben: nur mit 'keys.manage'.
--
-- has_perm() steht bewusst in BEIDEN Klauseln – bei einer for-all-Policy wertet
-- Postgres beim INSERT ausschließlich with check aus, nicht using.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

alter table key_chips enable row level security;

drop policy if exists key_chips_select on key_chips;
create policy key_chips_select on key_chips for select
  using (
    tenant_id = auth_tenant_id()
    and module_active('schluessel')
  );

drop policy if exists key_chips_write on key_chips;
create policy key_chips_write on key_chips for all
  using (
    tenant_id = auth_tenant_id()
    and module_active('schluessel')
    and has_perm('keys.manage')
  )
  with check (
    tenant_id = auth_tenant_id()
    and module_active('schluessel')
    and has_perm('keys.manage')
  );

-- Kontrolle
select tablename, policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public' and tablename = 'key_chips'
order by policyname;

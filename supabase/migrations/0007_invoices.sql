-- =====================================================================
-- Rechnungseinreichung: RLS-Korrekturen, Storage und Statuswechsel
--
-- Das Basisschema hat für invoices bereits Policies – zwei davon sind zu weit
-- bzw. unvollständig:
--
--   1. inv_update: "for update using (tenant and has_perm('invoice.approve'))"
--      RLS wirkt ZEILEN-, nicht spaltenweise. Wer freigeben darf, könnte damit
--      an einer fremden Rechnung AUCH amount_cents, submitted_by oder
--      cost_center_id ändern – also den Betrag der eigenen Auszahlung.
--      → Policy wird entfernt. Statuswechsel laufen ausschließlich über die
--        beiden Funktionen unten, die genau die erlaubten Spalten schreiben.
--
--   2. inv_insert prüft das Modul nicht (module_active('kassa') fehlt).
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) POLICIES auf invoices neu setzen
-- =====================================================================
alter table invoices enable row level security;

-- Lesen: die eigenen Belege – alle nur mit 'invoice.viewall' (Kassa).
drop policy if exists inv_select on invoices;
create policy inv_select on invoices for select
  using (
    tenant_id = auth_tenant_id()
    and module_active('kassa')
    and (submitted_by = auth_member_id() or has_perm('invoice.viewall'))
  );

-- Einreichen darf jedes Mitglied – aber nur im eigenen Namen.
drop policy if exists inv_insert on invoices;
create policy inv_insert on invoices for insert
  with check (
    tenant_id = auth_tenant_id()
    and module_active('kassa')
    and submitted_by = auth_member_id()
    and status = 'offen'            -- niemand reicht etwas gleich als "bezahlt" ein
  );

-- Kein UPDATE über die Tabelle. Siehe Kopfkommentar.
drop policy if exists inv_update on invoices;


-- =====================================================================
-- 2) FREIGEBEN / ABLEHNEN
--    Schreibt nur status und decided_by, und nur aus dem Zustand 'offen'.
-- =====================================================================
create or replace function decide_invoice(p_invoice_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('freigegeben', 'abgelehnt') then
    raise exception 'Ungültiger Status: %', p_status;
  end if;

  if not has_perm('invoice.approve') then
    raise exception 'Keine Berechtigung (invoice.approve erforderlich)';
  end if;

  update invoices
     set status     = p_status,
         decided_by = auth_member_id()
   where id = p_invoice_id
     and tenant_id = auth_tenant_id()
     and status = 'offen';          -- eine entschiedene Rechnung wird nicht neu entschieden

  if not found then
    raise exception 'Rechnung nicht gefunden oder nicht mehr offen';
  end if;
end
$$;

revoke all on function decide_invoice(uuid, text) from public;
grant execute on function decide_invoice(uuid, text) to authenticated;


-- =====================================================================
-- 3) BEZAHLT MARKIEREN + IN DIE KASSA VERBUCHEN
--
--    Beides passiert in EINER Transaktion. Zwei getrennte Requests aus dem
--    Browser könnten sonst halb durchlaufen: Rechnung "bezahlt", aber die
--    Ausgabe fehlt in der Kassa (oder umgekehrt). Die Funktion ist die einzige
--    Stelle, die transactions.invoice_id setzt.
--
--    Die Buchung entsteht als Folge der Freigabe – gefordert wird deshalb
--    'invoice.approve', nicht 'kassa.edit'. (Die tx_write-Policy verlangt
--    kassa.edit; security definer umgeht sie hier bewusst.)
-- =====================================================================
create or replace function pay_invoice(p_invoice_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv     invoices%rowtype;
  v_name    text;
begin
  if not has_perm('invoice.approve') then
    raise exception 'Keine Berechtigung (invoice.approve erforderlich)';
  end if;

  select * into v_inv
    from invoices
   where id = p_invoice_id
     and tenant_id = auth_tenant_id()
     and status = 'freigegeben'
   for update;                       -- sperrt die Zeile: kein doppeltes Verbuchen

  if not found then
    raise exception 'Rechnung nicht gefunden oder nicht im Status "freigegeben"';
  end if;

  -- Doppelte Buchung ausschließen, auch wenn der Status je inkonsistent wäre.
  if exists (select 1 from transactions where invoice_id = v_inv.id) then
    raise exception 'Zu dieser Rechnung existiert bereits eine Buchung';
  end if;

  select m.first_name || ' ' || m.last_name into v_name
    from members m where m.id = v_inv.submitted_by;

  insert into transactions (
    tenant_id, tx_date, description, category, amount_cents, direction,
    cost_center_id, receipt_path, invoice_id, created_by
  ) values (
    v_inv.tenant_id,
    current_date,
    'Rückerstattung: ' || v_inv.description || ' (' || coalesce(v_name, 'Unbekannt') || ')',
    'Sonstiges',
    v_inv.amount_cents,
    'out',
    v_inv.cost_center_id,
    v_inv.file_path,                 -- derselbe Beleg landet im Monatsabschluss-ZIP
    v_inv.id,
    auth_member_id()
  );

  update invoices
     set status     = 'bezahlt',
         paid_at    = current_date,
         decided_by = auth_member_id()
   where id = v_inv.id;
end
$$;

revoke all on function pay_invoice(uuid) from public;
grant execute on function pay_invoice(uuid) to authenticated;


-- =====================================================================
-- 4) STORAGE
--
--    Rechnungsbelege liegen im BESTEHENDEN receipts-Bucket unter
--    {tenant_id}/invoices/{uuid}.{ext}. Grund: Wird eine Rechnung bezahlt,
--    übernimmt die Buchung genau diesen Pfad als receipt_path – und der
--    Monatsabschluss zieht seine Belege aus receipts. Ein eigener Bucket
--    hätte dort ins Leere gegriffen.
--
--    Die bestehende receipts_read-Policy verlangt 'kassa.view'. Damit könnte
--    ein einreichendes Mitglied den EIGENEN Beleg nicht mehr öffnen – deshalb
--    wird sie hier erweitert.
-- =====================================================================
drop policy if exists receipts_read on storage.objects;
create policy receipts_read on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and (
      has_perm('kassa.view')
      -- ... oder es ist der Beleg einer selbst eingereichten Rechnung.
      or exists (
        select 1 from invoices i
        where i.file_path = storage.objects.name
          and i.submitted_by = auth_member_id()
      )
    )
  );

-- Hochladen darf jedes Mitglied (Beleg zur eigenen Einreichung) ODER die
-- Kassenführung (Beleg zu einer Buchung).
drop policy if exists receipts_write on storage.objects;
create policy receipts_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
    and (
      has_perm('kassa.edit')
      or (storage.foldername(name))[2] = 'invoices'
    )
  );


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select policyname, cmd,
       qual       is not null as hat_using,
       with_check is not null as hat_with_check
from pg_policies
where schemaname = 'public' and tablename = 'invoices'
order by policyname;

-- Muss leer sein: es darf keine UPDATE-Policy auf invoices geben.
select count(*) as verbleibende_update_policies
from pg_policies
where schemaname = 'public' and tablename = 'invoices' and cmd = 'UPDATE';

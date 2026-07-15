-- =====================================================================
-- INVENTAR: Bearbeiten + Ausscheiden (Soft Delete) + Reaktivieren
--
-- Ausscheiden ist ein Soft Delete (retired_at gesetzt), KEIN echtes Löschen –
-- sonst würden item_history/item_borrows/item_reservations ins Leere zeigen.
-- Ausgeschiedene Artikel bleiben mit voller Historie einsehbar (Archiv-Reiter)
-- und lassen sich reaktivieren.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================

-- Soft-Delete-Markierung. null = aktiv, Datum = ausgeschieden an diesem Tag.
alter table items add column if not exists retired_at date;


-- =====================================================================
-- _inv_lock_item um retired-Prüfung erweitern.
--
-- Neuer Default-Parameter p_allow_retired. Alle BESTEHENDEN Aufrufer aus 0009
-- (borrow_item, return_item, change_stock, report_defect, move_item,
-- set_item_note, create_reservation) rufen _inv_lock_item(p_item_id) auf und
-- lehnen damit ab jetzt ausgeschiedene Artikel automatisch ab – genau richtig:
-- an einem ausgeschiedenen Artikel wird nicht mehr ausgeborgt/gebucht.
-- Nur reactivate_item darf einen ausgeschiedenen Artikel sperren (true).
-- =====================================================================
create or replace function _inv_lock_item(p_item_id uuid, p_allow_retired boolean default false)
returns items
language plpgsql security definer set search_path = public as $$
declare
  v_item items%rowtype;
begin
  if not module_active('inventar') then
    raise exception 'Modul "inventar" ist nicht gebucht';
  end if;

  select * into v_item
    from items
   where id = p_item_id and tenant_id = auth_tenant_id()
   for update;

  if not found then
    raise exception 'Artikel nicht gefunden';
  end if;

  if v_item.retired_at is not null and not p_allow_retired then
    raise exception 'Artikel ist ausgeschieden (am %)', to_char(v_item.retired_at, 'DD.MM.YYYY');
  end if;

  return v_item;
end
$$;


-- =====================================================================
-- ARTIKEL BEARBEITEN
--
-- Immer möglich (inventar.manage), unabhängig von Ausleihen/Reservierungen.
-- Änderungen kommen mit Vorher/Nachher in die Historie. Die Stückzahl darf
-- NICHT unter die aktuell ausgeborgte Menge gesenkt werden.
-- =====================================================================
create or replace function update_item(
  p_item_id     uuid,
  p_name        text,
  p_inv_nr      text,
  p_total_qty   int,
  p_unit        text,
  p_location_id uuid,
  p_note        text
)
returns items
language plpgsql security definer set search_path = public as $$
declare
  v_item     items%rowtype;
  v_borrowed int;
  v_updated  items%rowtype;
  v_parts    text[] := '{}';
  v_from_loc text;
  v_to_loc   text;
begin
  if not has_perm('inventar.manage') then
    raise exception 'Keine Berechtigung (inventar.manage erforderlich)';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Bezeichnung fehlt';
  end if;
  if coalesce(trim(p_inv_nr), '') = '' then
    raise exception 'Inventarnummer fehlt';
  end if;
  if p_total_qty < 1 then
    raise exception 'Stückzahl muss mindestens 1 sein';
  end if;

  v_item := _inv_lock_item(p_item_id);   -- aktive Artikel; ausgeschiedene nicht editierbar

  -- Stückzahl nicht unter die ausgeborgte Menge senken.
  select coalesce(sum(qty), 0) into v_borrowed from item_borrows where item_id = p_item_id;
  if p_total_qty < v_borrowed then
    raise exception 'Stückzahl (%) darf nicht unter die ausgeborgte Menge (%) sinken',
      p_total_qty, v_borrowed;
  end if;

  -- Diff für die Historie zusammenbauen
  if trim(p_name) is distinct from v_item.name then
    v_parts := v_parts || format('Name %L → %L', v_item.name, trim(p_name));
  end if;
  if trim(p_inv_nr) is distinct from v_item.inv_nr then
    v_parts := v_parts || format('Nr. %s → %s', v_item.inv_nr, trim(p_inv_nr));
  end if;
  if p_total_qty is distinct from v_item.total_qty then
    v_parts := v_parts || format('Bestand %s → %s', v_item.total_qty, p_total_qty);
  end if;
  if coalesce(trim(p_unit), '') is distinct from coalesce(v_item.unit, '') then
    v_parts := v_parts || format('Einheit %s → %s', coalesce(v_item.unit, '–'), coalesce(nullif(trim(p_unit), ''), '–'));
  end if;
  if p_location_id is distinct from v_item.location_id then
    select name into v_from_loc from locations where id = v_item.location_id;
    select name into v_to_loc   from locations where id = p_location_id and tenant_id = auth_tenant_id();
    if p_location_id is not null and v_to_loc is null then
      raise exception 'Standort nicht gefunden';
    end if;
    v_parts := v_parts || format('Standort %s → %s', coalesce(v_from_loc, '–'), coalesce(v_to_loc, '–'));
  end if;
  if coalesce(trim(p_note), '') is distinct from coalesce(v_item.note, '') then
    v_parts := v_parts || 'Notiz geändert';
  end if;

  begin
    update items
       set name        = trim(p_name),
           inv_nr      = trim(p_inv_nr),
           total_qty   = p_total_qty,
           unit        = nullif(trim(p_unit), ''),
           location_id = p_location_id,
           note        = nullif(trim(p_note), '')
     where id = p_item_id
    returning * into v_updated;
  exception
    when unique_violation then
      raise exception 'Inventarnummer % ist bereits vergeben', trim(p_inv_nr);
  end;

  if array_length(v_parts, 1) is not null then
    perform _inv_log(p_item_id, 'Bearbeitet: ' || array_to_string(v_parts, '; '));
  end if;

  return v_updated;
end
$$;


-- =====================================================================
-- ARTIKEL AUSSCHEIDEN (Soft Delete)
--
-- Nur ohne aktive Ausleihen UND ohne aktive Reservierungen. Aktiv =
-- Reservierung nicht abgelehnt und noch nicht vorbei (date_to >= heute).
-- =====================================================================
create or replace function retire_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_borrows int;
  v_res     int;
begin
  if not has_perm('inventar.manage') then
    raise exception 'Keine Berechtigung (inventar.manage erforderlich)';
  end if;

  perform _inv_lock_item(p_item_id);   -- muss aktiv sein

  select coalesce(sum(qty), 0) into v_borrows from item_borrows where item_id = p_item_id;
  if v_borrows > 0 then
    raise exception 'Artikel ist noch ausgeborgt (% Stück) – erst zurücknehmen', v_borrows;
  end if;

  select count(*) into v_res
    from item_reservations
   where item_id = p_item_id and status <> 'abgelehnt' and date_to >= current_date;
  if v_res > 0 then
    raise exception 'Es gibt noch % offene/aktive Reservierung(en) – erst klären', v_res;
  end if;

  update items set retired_at = current_date where id = p_item_id;
  perform _inv_log(p_item_id, 'Ausgeschieden');
end
$$;


-- =====================================================================
-- ARTIKEL REAKTIVIEREN
-- =====================================================================
create or replace function reactivate_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item items%rowtype;
begin
  if not has_perm('inventar.manage') then
    raise exception 'Keine Berechtigung (inventar.manage erforderlich)';
  end if;

  v_item := _inv_lock_item(p_item_id, true);   -- darf ausgeschieden sein
  if v_item.retired_at is null then
    raise exception 'Artikel ist nicht ausgeschieden';
  end if;

  update items set retired_at = null where id = p_item_id;
  perform _inv_log(p_item_id, 'Reaktiviert');
end
$$;


-- =====================================================================
-- Rechte auf die neuen Funktionen
-- =====================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'update_item(uuid, text, text, int, text, uuid, text)',
    'retire_item(uuid)',
    'reactivate_item(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'items' and column_name = 'retired_at';

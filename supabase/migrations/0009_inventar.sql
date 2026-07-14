-- =====================================================================
-- INVENTAR: RLS + Funktionen (Modul 'inventar')
--
-- locations, items, item_borrows, item_reservations und item_history haben im
-- Basisschema KEINE RLS.
--
-- WARUM SO VIELE FUNKTIONEN?
-- Fast jede Inventar-Aktion ist ein Lese-Ändern-Schreiben-Zyklus über mehrere
-- Tabellen. Im Prototyp (ein Array im Browser) ist das harmlos. Gegen eine echte
-- Datenbank sind es zwei getrennte HTTP-Requests – und dann gilt:
--
--   * AUSBORGEN: "verfügbar = total_qty − Σ borrows" im Client zu prüfen und
--     danach zu schreiben, ist eine klassische Race Condition. Zwei Mitglieder
--     sehen gleichzeitig "1 verfügbar" und borgen beide aus → Bestand negativ.
--   * BESTAND (Vorrat): "qty − 1" im Client zu rechnen ist ein Lost Update.
--     Zwei gleichzeitige Entnahmen ergeben nur eine.
--   * HISTORIE: Jede Aktion muss protokolliert werden. Zwei Requests könnten
--     halb durchlaufen – Aktion ohne Protokolleintrag oder umgekehrt.
--
-- Alle Funktionen sperren die Artikelzeile (select ... for update) und schreiben
-- Änderung + Historie in EINER Transaktion.
--
-- Idempotent: mehrfach ausführbar.
-- =====================================================================


-- =====================================================================
-- 1) RLS
-- =====================================================================

-- --- locations: lesen alle, verwalten 'inventar.manage'
alter table locations enable row level security;

drop policy if exists locations_select on locations;
create policy locations_select on locations for select
  using (tenant_id = auth_tenant_id() and module_active('inventar'));

drop policy if exists locations_write on locations;
create policy locations_write on locations for all
  using      (tenant_id = auth_tenant_id() and module_active('inventar') and has_perm('inventar.manage'))
  with check (tenant_id = auth_tenant_id() and module_active('inventar') and has_perm('inventar.manage'));

-- --- items: lesen alle. Direktes Schreiben nur mit 'inventar.manage' – die
--     Funktionen unten laufen als security definer und umgehen das bewusst,
--     damit auch normale Mitglieder ausborgen und Defekte melden können.
alter table items enable row level security;

drop policy if exists items_select on items;
create policy items_select on items for select
  using (tenant_id = auth_tenant_id() and module_active('inventar'));

drop policy if exists items_write on items;
create policy items_write on items for all
  using      (tenant_id = auth_tenant_id() and module_active('inventar') and has_perm('inventar.manage'))
  with check (tenant_id = auth_tenant_id() and module_active('inventar') and has_perm('inventar.manage'));

-- --- item_borrows: lesen alle (man sieht, bei wem etwas ist).
--     Geschrieben wird AUSSCHLIESSLICH über borrow_item()/return_item().
alter table item_borrows enable row level security;

drop policy if exists item_borrows_select on item_borrows;
create policy item_borrows_select on item_borrows for select
  using (exists (
    select 1 from items i
    where i.id = item_borrows.item_id
      and i.tenant_id = auth_tenant_id()
      and module_active('inventar')
  ));

-- --- item_reservations: lesen alle. Schreiben über die Funktionen.
alter table item_reservations enable row level security;

drop policy if exists item_reservations_select on item_reservations;
create policy item_reservations_select on item_reservations for select
  using (exists (
    select 1 from items i
    where i.id = item_reservations.item_id
      and i.tenant_id = auth_tenant_id()
      and module_active('inventar')
  ));

-- --- item_history: nur lesen. Ein Protokoll, das der Client beschreiben kann,
--     ist kein Protokoll.
alter table item_history enable row level security;

drop policy if exists item_history_select on item_history;
create policy item_history_select on item_history for select
  using (exists (
    select 1 from items i
    where i.id = item_history.item_id
      and i.tenant_id = auth_tenant_id()
      and module_active('inventar')
  ));


-- =====================================================================
-- 2) HILFSFUNKTIONEN (intern)
-- =====================================================================

-- Artikel des eigenen Vereins holen UND sperren. Wirft, wenn er nicht existiert,
-- zu einem anderen Verein gehört oder das Modul nicht gebucht ist.
create or replace function _inv_lock_item(p_item_id uuid)
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

  return v_item;
end
$$;

create or replace function _inv_log(p_item_id uuid, p_action text)
returns void
language sql security definer set search_path = public as $$
  insert into item_history (item_id, member_id, action)
  values (p_item_id, auth_member_id(), p_action)
$$;


-- =====================================================================
-- 3) ARTIKEL ANLEGEN
--    Die Inventarnummer (DG-0005) wird SERVERSEITIG vergeben. Im Client
--    berechnet ("max + 1") würden zwei gleichzeitige Anlagen dieselbe Nummer
--    ziehen – die Unique-Constraint würde eine davon abweisen.
-- =====================================================================
create or replace function create_item(
  p_name        text,
  p_kind        text,          -- 'geraet' | 'vorrat'
  p_qty         int,           -- Gerät: Gesamtbestand · Vorrat: Anfangsbestand
  p_unit        text,
  p_location_id uuid,
  p_prefix      text default 'DG'
)
returns items
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_next   int;
  v_nr     text;
  v_item   items%rowtype;
begin
  if not has_perm('inventar.manage') then
    raise exception 'Keine Berechtigung (inventar.manage erforderlich)';
  end if;
  if p_kind not in ('geraet', 'vorrat') then
    raise exception 'Ungültige Art: %', p_kind;
  end if;
  if p_qty < 1 then
    raise exception 'Bestand muss mindestens 1 sein';
  end if;

  -- Serialisiert die Nummernvergabe pro Verein. Ein "select max(...) for update"
  -- geht hier NICHT: Postgres erlaubt keine Zeilensperre auf einem Aggregat.
  -- Der Advisory Lock gilt bis zum Ende der Transaktion und lässt zwei
  -- gleichzeitige Anlagen nacheinander laufen, statt dieselbe Nummer zu ziehen.
  perform pg_advisory_xact_lock(hashtext('items:' || v_tenant::text));

  select coalesce(max(nullif(regexp_replace(inv_nr, '^\D+', ''), '')::int), 0) + 1
    into v_next
    from items
   where tenant_id = v_tenant;

  v_nr := p_prefix || '-' || lpad(v_next::text, 4, '0');

  insert into items (tenant_id, inv_nr, name, kind, total_qty, unit, location_id, defect)
  values (v_tenant, v_nr, p_name, p_kind, p_qty, coalesce(p_unit, 'Stk'), p_location_id, false)
  returning * into v_item;

  perform _inv_log(v_item.id, 'Angelegt (' || v_nr || ', ' || p_qty || ' ' || coalesce(p_unit, 'Stk') || ')');
  return v_item;
end
$$;


-- =====================================================================
-- 4) AUSBORGEN
--    Verfügbarkeit wird UNTER DER SPERRE geprüft – erst dann geschrieben.
-- =====================================================================
create or replace function borrow_item(p_item_id uuid, p_qty int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item      items%rowtype;
  v_member    uuid := auth_member_id();
  v_borrowed  int;
  v_available int;
begin
  if v_member is null then
    raise exception 'Dein Login ist mit keinem Mitglied verknüpft';
  end if;
  if p_qty < 1 then
    raise exception 'Stückzahl muss mindestens 1 sein';
  end if;

  v_item := _inv_lock_item(p_item_id);

  if v_item.kind <> 'geraet' then
    raise exception 'Nur Geräte können ausgeborgt werden';
  end if;
  if v_item.defect then
    raise exception 'Artikel ist als defekt gemeldet';
  end if;

  select coalesce(sum(qty), 0) into v_borrowed
    from item_borrows where item_id = p_item_id;

  v_available := v_item.total_qty - v_borrowed;

  if p_qty > v_available then
    raise exception 'Nur % Stück verfügbar', v_available;
  end if;

  -- Bestehende Ausleihe derselben Person aufstocken statt zweite Zeile anlegen.
  if exists (select 1 from item_borrows where item_id = p_item_id and member_id = v_member) then
    update item_borrows set qty = qty + p_qty
     where item_id = p_item_id and member_id = v_member;
  else
    insert into item_borrows (item_id, member_id, qty) values (p_item_id, v_member, p_qty);
  end if;

  perform _inv_log(
    p_item_id,
    case when p_qty > 1 then p_qty || ' Stk ausgeborgt' else 'Ausgeborgt' end
  );
end
$$;


-- =====================================================================
-- 5) ZURÜCKBRINGEN
--    Optional mit Standortwechsel und Defektmeldung – wie im Prototyp.
--    p_member_id: nur mit 'inventar.manage' darf für jemand anderen
--    zurückgegeben werden.
-- =====================================================================
create or replace function return_item(
  p_item_id     uuid,
  p_qty         int,
  p_member_id   uuid default null,
  p_location_id uuid default null,
  p_defect_note text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item     items%rowtype;
  v_target   uuid := coalesce(p_member_id, auth_member_id());
  v_borrow   item_borrows%rowtype;
  v_who      text;
  v_loc_name text;
  v_msg      text;
begin
  v_item := _inv_lock_item(p_item_id);

  if v_target <> auth_member_id() and not has_perm('inventar.manage') then
    raise exception 'Rückgabe für andere Personen erfordert inventar.manage';
  end if;

  select * into v_borrow
    from item_borrows
   where item_id = p_item_id and member_id = v_target
   for update;

  if not found then
    raise exception 'Keine passende Ausleihe gefunden';
  end if;
  if p_qty < 1 or p_qty > v_borrow.qty then
    raise exception 'Ungültige Stückzahl (ausgeborgt: %)', v_borrow.qty;
  end if;

  if p_qty = v_borrow.qty then
    delete from item_borrows where item_id = p_item_id and member_id = v_target;
  else
    update item_borrows set qty = qty - p_qty
     where item_id = p_item_id and member_id = v_target;
  end if;

  if p_location_id is not null then
    update items set location_id = p_location_id where id = p_item_id;
  end if;

  if p_defect_note is not null and length(trim(p_defect_note)) > 0 then
    update items set defect = true, note = p_defect_note where id = p_item_id;
  end if;

  select m.first_name || ' ' || m.last_name into v_who from members m where m.id = v_target;
  select l.name into v_loc_name from locations l where l.id = coalesce(p_location_id, v_item.location_id);

  v_msg := case when p_qty > 1 then p_qty || ' Stk zurückgebracht' else 'Zurückgebracht' end
        || ' (' || coalesce(v_who, '?') || ')'
        || coalesce(' → ' || v_loc_name, '')
        || case
             when p_defect_note is not null and length(trim(p_defect_note)) > 0
             then ', Defekt: ' || p_defect_note
             else ''
           end;

  perform _inv_log(p_item_id, v_msg);
end
$$;


-- =====================================================================
-- 6) VORRATSBESTAND ÄNDERN
--    Delta statt absolutem Wert – sonst überschreiben sich zwei gleichzeitige
--    Entnahmen gegenseitig (Lost Update).
-- =====================================================================
create or replace function change_stock(p_item_id uuid, p_delta int)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_item items%rowtype;
  v_new  int;
begin
  v_item := _inv_lock_item(p_item_id);

  if v_item.kind <> 'vorrat' then
    raise exception 'Bestandsänderung nur bei Vorratsartikeln';
  end if;

  v_new := v_item.total_qty + p_delta;

  if v_new < 0 then
    raise exception 'Bestand kann nicht unter 0 fallen (aktuell: %)', v_item.total_qty;
  end if;

  update items set total_qty = v_new where id = p_item_id;

  perform _inv_log(
    p_item_id,
    case when p_delta < 0
         then 'Entnahme ' || abs(p_delta) || ' ' || coalesce(v_item.unit, 'Stk')
         else 'Zugang ' || p_delta || ' ' || coalesce(v_item.unit, 'Stk')
    end || ' → Bestand: ' || v_new
  );

  return v_new;
end
$$;


-- =====================================================================
-- 7) DEFEKT / REPARIERT / STANDORT / NOTIZ
-- =====================================================================
create or replace function report_defect(p_item_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _inv_lock_item(p_item_id);        -- Defekt melden darf jedes Mitglied
  update items set defect = true, note = p_note where id = p_item_id;
  perform _inv_log(p_item_id, 'Defekt gemeldet: ' || p_note);
end
$$;

create or replace function fix_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('inventar.manage') then
    raise exception 'Keine Berechtigung (inventar.manage erforderlich)';
  end if;
  perform _inv_lock_item(p_item_id);
  update items set defect = false, note = null where id = p_item_id;
  perform _inv_log(p_item_id, 'Repariert / wieder einsatzbereit');
end
$$;

create or replace function move_item(p_item_id uuid, p_location_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item items%rowtype;
  v_from text;
  v_to   text;
begin
  if not has_perm('inventar.manage') then
    raise exception 'Keine Berechtigung (inventar.manage erforderlich)';
  end if;

  v_item := _inv_lock_item(p_item_id);

  select name into v_from from locations where id = v_item.location_id;
  select name into v_to   from locations where id = p_location_id and tenant_id = auth_tenant_id();

  if v_to is null then
    raise exception 'Standort nicht gefunden';
  end if;

  update items set location_id = p_location_id where id = p_item_id;
  perform _inv_log(p_item_id, 'Standort geändert: ' || coalesce(v_from, '?') || ' → ' || v_to);
end
$$;

create or replace function set_item_note(p_item_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _inv_lock_item(p_item_id);
  update items set note = nullif(trim(p_note), '') where id = p_item_id;
  perform _inv_log(p_item_id, 'Notiz: ' || coalesce(nullif(trim(p_note), ''), '(gelöscht)'));
end
$$;


-- =====================================================================
-- 8) RESERVIERUNGEN
--    Wer selbst freigeben darf ('reserve.approve'), trägt direkt eine
--    bestätigte Blockung ein – alle anderen stellen eine Anfrage.
-- =====================================================================
create or replace function create_reservation(
  p_item_id uuid,
  p_from    date,
  p_to      date,
  p_purpose text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := auth_member_id();
  v_direct boolean := has_perm('reserve.approve');
  v_status text;
begin
  if v_member is null then
    raise exception 'Dein Login ist mit keinem Mitglied verknüpft';
  end if;
  if p_to < p_from then
    raise exception 'Das Ende darf nicht vor dem Beginn liegen';
  end if;

  perform _inv_lock_item(p_item_id);

  v_status := case when v_direct then 'bestätigt' else 'angefragt' end;

  insert into item_reservations (item_id, member_id, date_from, date_to, purpose, status, decided_by)
  values (p_item_id, v_member, p_from, p_to, p_purpose, v_status,
          case when v_direct then v_member else null end);

  perform _inv_log(
    p_item_id,
    case when v_direct then 'Reservierung/Blockung eingetragen: ' else 'Reservierung angefragt: ' end
      || to_char(p_from, 'DD.MM.YYYY') || ' – ' || to_char(p_to, 'DD.MM.YYYY')
      || ' (' || coalesce(p_purpose, '–') || ')'
  );
end
$$;

create or replace function decide_reservation(p_reservation_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res  item_reservations%rowtype;
  v_who  text;
begin
  if p_status not in ('bestätigt', 'abgelehnt') then
    raise exception 'Ungültiger Status: %', p_status;
  end if;
  if not has_perm('reserve.approve') then
    raise exception 'Keine Berechtigung (reserve.approve erforderlich)';
  end if;

  select r.* into v_res
    from item_reservations r
    join items i on i.id = r.item_id
   where r.id = p_reservation_id
     and i.tenant_id = auth_tenant_id()
     and r.status = 'angefragt'
   for update of r;

  if not found then
    raise exception 'Reservierung nicht gefunden oder nicht mehr offen';
  end if;

  update item_reservations
     set status = p_status, decided_by = auth_member_id()
   where id = p_reservation_id;

  select m.first_name || ' ' || m.last_name into v_who
    from members m where m.id = v_res.member_id;

  perform _inv_log(
    v_res.item_id,
    'Reservierung von ' || coalesce(v_who, '?') || ' ' || p_status
      || ' (' || to_char(v_res.date_from, 'DD.MM.YYYY') || ' – '
      || to_char(v_res.date_to, 'DD.MM.YYYY') || ')'
  );
end
$$;


-- =====================================================================
-- 9) RECHTE AUF DIE FUNKTIONEN
--    Die internen Helfer (_inv_*) bleiben dem Client verschlossen.
-- =====================================================================
revoke all on function _inv_lock_item(uuid) from public;
revoke all on function _inv_log(uuid, text) from public;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'create_item(text, text, int, text, uuid, text)',
    'borrow_item(uuid, int)',
    'return_item(uuid, int, uuid, uuid, text)',
    'change_stock(uuid, int)',
    'report_defect(uuid, text)',
    'fix_item(uuid)',
    'move_item(uuid, uuid)',
    'set_item_note(uuid, text)',
    'create_reservation(uuid, date, date, text)',
    'decide_reservation(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;


-- =====================================================================
-- KONTROLLE
-- =====================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('locations', 'items', 'item_borrows', 'item_reservations', 'item_history')
order by tablename, policyname;

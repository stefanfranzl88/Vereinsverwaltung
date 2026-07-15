import { supabase } from '@/lib/supabase'
import type {
  Item,
  ItemBorrow,
  ItemHistoryEntry,
  ItemKind,
  ItemReservation,
  Location,
  ReservationStatus,
} from '@/types'

export const itemsKey = (tenantId: string) => ['items', tenantId] as const
export const locationsKey = (tenantId: string) => ['locations', tenantId] as const
export const borrowsKey = (tenantId: string) => ['item-borrows', tenantId] as const
export const reservationsKey = (tenantId: string) => ['item-reservations', tenantId] as const
export const historyKey = (itemId: string) => ['item-history', itemId] as const

export async function fetchLocations(tenantId: string): Promise<Location[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('id, tenant_id, name')
    .eq('tenant_id', tenantId)
    .order('name')
    .returns<Location[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchItems(tenantId: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select(
      'id, tenant_id, inv_nr, name, kind, total_qty, unit, location_id, defect, note, retired_at',
    )
    .eq('tenant_id', tenantId)
    .order('inv_nr')
    .returns<Item[]>()

  if (error) throw error
  return data ?? []
}

/** Alle aktiven Ausleihen des Vereins – die Verfügbarkeit ergibt sich daraus. */
export async function fetchBorrows(): Promise<ItemBorrow[]> {
  const { data, error } = await supabase
    .from('item_borrows')
    .select('id, item_id, member_id, qty, borrowed_at, members(first_name, last_name)')
    .returns<ItemBorrow[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchReservations(): Promise<ItemReservation[]> {
  const { data, error } = await supabase
    .from('item_reservations')
    .select(
      // Expliziter FK-Name nötig: item_reservations hat zwei FKs zu members
      // (member_id = Anfrager, decided_by = Freigeber) → sonst PGRST201.
      'id, item_id, member_id, date_from, date_to, purpose, status, members!item_reservations_member_id_fkey(first_name, last_name)',
    )
    .order('date_from')
    .returns<ItemReservation[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchHistory(itemId: string): Promise<ItemHistoryEntry[]> {
  const { data, error } = await supabase
    .from('item_history')
    .select('id, item_id, action, created_at, members(first_name, last_name)')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .returns<ItemHistoryEntry[]>()

  if (error) throw error
  return data ?? []
}

export async function createLocation(tenantId: string, name: string): Promise<void> {
  const { error } = await supabase.from('locations').insert({ tenant_id: tenantId, name })
  if (error) throw error
}

// ---------------------------------------------------------------
// Alles Folgende läuft über Datenbankfunktionen, nicht über direkte
// Tabellen-Updates. Grund: Verfügbarkeitsprüfung, Bestandsänderung und
// Historien-Eintrag müssen atomar und unter Zeilensperre passieren –
// sonst borgen zwei Personen gleichzeitig das letzte Stück aus.
// Siehe supabase/migrations/0009_inventar.sql.
// ---------------------------------------------------------------

export async function createItem(input: {
  name: string
  kind: ItemKind
  qty: number
  unit: string
  location_id: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('create_item', {
    p_name: input.name,
    p_kind: input.kind,
    p_qty: input.qty,
    p_unit: input.unit,
    p_location_id: input.location_id,
  })
  if (error) throw error
}

/** Bearbeiten (inventar.manage). Änderungen kommen mit Diff in die Historie. */
export async function updateItem(input: {
  itemId: string
  name: string
  invNr: string
  totalQty: number
  unit: string
  locationId: string | null
  note: string
}): Promise<void> {
  const { error } = await supabase.rpc('update_item', {
    p_item_id: input.itemId,
    p_name: input.name,
    p_inv_nr: input.invNr,
    p_total_qty: input.totalQty,
    p_unit: input.unit,
    p_location_id: input.locationId,
    p_note: input.note,
  })
  if (error) throw error
}

/** Ausscheiden (Soft Delete). Nur ohne aktive Ausleihen/Reservierungen. */
export async function retireItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('retire_item', { p_item_id: itemId })
  if (error) throw error
}

export async function reactivateItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('reactivate_item', { p_item_id: itemId })
  if (error) throw error
}

export async function borrowItem(itemId: string, qty: number): Promise<void> {
  const { error } = await supabase.rpc('borrow_item', { p_item_id: itemId, p_qty: qty })
  if (error) throw error
}

export async function returnItem(input: {
  itemId: string
  qty: number
  memberId: string | null
  locationId: string | null
  defectNote: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('return_item', {
    p_item_id: input.itemId,
    p_qty: input.qty,
    p_member_id: input.memberId,
    p_location_id: input.locationId,
    p_defect_note: input.defectNote,
  })
  if (error) throw error
}

/** Delta, nicht Absolutwert – sonst gehen gleichzeitige Entnahmen verloren. */
export async function changeStock(itemId: string, delta: number): Promise<void> {
  const { error } = await supabase.rpc('change_stock', { p_item_id: itemId, p_delta: delta })
  if (error) throw error
}

export async function reportDefect(itemId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('report_defect', { p_item_id: itemId, p_note: note })
  if (error) throw error
}

export async function fixItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('fix_item', { p_item_id: itemId })
  if (error) throw error
}

export async function moveItem(itemId: string, locationId: string): Promise<void> {
  const { error } = await supabase.rpc('move_item', {
    p_item_id: itemId,
    p_location_id: locationId,
  })
  if (error) throw error
}

export async function setItemNote(itemId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('set_item_note', { p_item_id: itemId, p_note: note })
  if (error) throw error
}

export async function createReservation(input: {
  itemId: string
  from: string
  to: string
  purpose: string
}): Promise<void> {
  const { error } = await supabase.rpc('create_reservation', {
    p_item_id: input.itemId,
    p_from: input.from,
    p_to: input.to,
    p_purpose: input.purpose,
  })
  if (error) throw error
}

export async function decideReservation(
  reservationId: string,
  status: Exclude<ReservationStatus, 'angefragt'>,
): Promise<void> {
  const { error } = await supabase.rpc('decide_reservation', {
    p_reservation_id: reservationId,
    p_status: status,
  })
  if (error) throw error
}

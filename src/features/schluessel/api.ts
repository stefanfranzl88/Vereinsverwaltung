import { supabase } from '@/lib/supabase'
import type { KeyChipWithMember, KeyLogEntry, KeyLogRow, KeyLogUpload } from '@/types'

export const keyChipsFullKey = (tenantId: string) => ['key-chips-full', tenantId] as const
export const keyLogKey = (tenantId: string) => ['key-log', tenantId] as const
export const keyUploadsKey = (tenantId: string) => ['key-uploads', tenantId] as const

export async function fetchKeyChips(tenantId: string): Promise<KeyChipWithMember[]> {
  const { data, error } = await supabase
    .from('key_chips')
    .select('id, member_id, chip_nr, issued_at, members(first_name, last_name, funktion, photo_path)')
    .eq('tenant_id', tenantId)
    .order('issued_at')
    .returns<KeyChipWithMember[]>()

  if (error) throw error
  return data ?? []
}

/** Zutrittsprotokoll. RLS liefert nur mit keylog.view etwas zurück. */
export async function fetchKeyLog(tenantId: string, limit = 100): Promise<KeyLogEntry[]> {
  const { data, error } = await supabase
    .from('key_log_entries')
    .select('id, entry_date, entry_time, chip_info, event')
    .eq('tenant_id', tenantId)
    .order('entry_date', { ascending: false, nullsFirst: false })
    .order('entry_time', { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<KeyLogEntry[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchKeyUploads(tenantId: string): Promise<KeyLogUpload[]> {
  const { data, error } = await supabase
    .from('key_log_uploads')
    .select('id, file_name, row_count, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<KeyLogUpload[]>()

  if (error) throw error
  return data ?? []
}

export async function assignChip(memberId: string, chipNr: string): Promise<void> {
  const { error } = await supabase.rpc('assign_chip', {
    p_member_id: memberId,
    p_chip_nr: chipNr,
  })
  if (error) throw error
}

export async function revokeChip(chipId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_chip', { p_chip_id: chipId })
  if (error) throw error
}

export async function setKeyInterval(days: number): Promise<void> {
  const { error } = await supabase.rpc('set_key_interval', { p_days: days })
  if (error) throw error
}

/** Upload + Einträge + Zurücksetzen der Erinnerung – alles in einer Transaktion. */
export async function importKeyLog(fileName: string, rows: KeyLogRow[]): Promise<number> {
  const { error } = await supabase.rpc('import_key_log', {
    p_file_name: fileName,
    p_entries: rows,
  })
  if (error) throw error
  return rows.length
}

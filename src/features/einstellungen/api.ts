import { supabase } from '@/lib/supabase'
import type { MitarbeitConfig } from '@/features/mitarbeit/config'

/**
 * Vereins-Stammdaten. name/zvr_zahl/dekade sind Spalten auf tenants und werden
 * direkt geändert – die RLS-Policy tenants_update (roles.manage) lässt das zu.
 */
export async function updateTenantBasics(
  tenantId: string,
  input: { name: string; zvr_zahl: string | null; dekade: string | null },
): Promise<void> {
  const { data, error } = await supabase
    .from('tenants')
    .update({ name: input.name, zvr_zahl: input.zvr_zahl, dekade: input.dekade })
    .eq('id', tenantId)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Nicht gespeichert – fehlende Berechtigung (roles.manage).')
  }
}

/**
 * Logo in den öffentlichen Bucket "logos" ({tenant}/logo.<ext>), dann die
 * öffentliche URL in tenants.logo_url ablegen (upsert überschreibt ein altes).
 */
export async function uploadLogo(tenantId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${tenantId}/logo.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from('logos')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (uploadErr) throw uploadErr

  const { data: pub } = supabase.storage.from('logos').getPublicUrl(path)
  // Cache-Buster, damit ein ersetztes Logo sofort neu geladen wird.
  const url = `${pub.publicUrl}?v=${Date.now()}`

  const { error } = await supabase.from('tenants').update({ logo_url: url }).eq('id', tenantId)
  if (error) throw error
  return url
}

export async function removeLogo(tenantId: string): Promise<void> {
  const { error } = await supabase.from('tenants').update({ logo_url: null }).eq('id', tenantId)
  if (error) throw error
}

/** Erinnerungsintervall (settings.key_interval_days). */
export async function setKeyInterval(days: number): Promise<void> {
  const { error } = await supabase.rpc('set_key_interval', { p_days: days })
  if (error) throw error
}

/** Mitarbeitspunkte-Konfiguration (settings.mitarbeit) komplett setzen. */
export async function setMitarbeitConfig(config: MitarbeitConfig): Promise<void> {
  const { error } = await supabase.rpc('set_mitarbeit_config', { p_config: config })
  if (error) throw error
}

/** Anwesenheitsart umbenennen (zieht bestehende Protokolle mit). */
export async function renameAttendanceType(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase.rpc('rename_attendance_type', {
    p_old: oldName,
    p_new: newName,
  })
  if (error) throw error
}

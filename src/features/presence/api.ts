import { supabase } from '@/lib/supabase'

export const lastSeenKey = (tenantId: string) => ['member-last-seen', tenantId] as const

/** Eigenen „zuletzt online"-Zeitstempel setzen (no-op, wenn Präsenz aus ist). */
export async function touchPresence(): Promise<void> {
  const { error } = await supabase.rpc('touch_presence')
  if (error) throw error
}

/**
 * „Zuletzt online" je Mitglied. Die DB-Funktion liefert nur etwas, wenn der
 * Aufrufer roles.manage/Systemadmin ist – sonst eine leere Map.
 */
export async function fetchLastSeen(): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('member_last_seen')
  if (error) throw error

  const map = new Map<string, string>()
  for (const r of (data ?? []) as { member_id: string; last_seen_at: string }[]) {
    map.set(r.member_id, r.last_seen_at)
  }
  return map
}

/** Vereinsweiten Präsenz-Schalter setzen (roles.manage). */
export async function setPresenceEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_presence_enabled', { p_enabled: enabled })
  if (error) throw error
}

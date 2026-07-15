import { supabase } from '@/lib/supabase'

export const pointsKey = (tenantId: string) => ['member-points', tenantId] as const

export interface MemberPoints {
  member_id: string
  sitzungen: number
  einsaetze: number
  punkte: number
}

/**
 * Punktestand je Mitglied. Läuft über die Datenbankfunktion member_points()
 * und NICHT über eine Abfrage auf protocol_attendance: Anwesenheitszeilen sind
 * an die Sichtbarkeit des Protokolls gekoppelt – Vorstandssitzungen sieht ein
 * normales Mitglied nicht. Im Browser gerechnet bekäme jeder eine andere
 * Rangliste. Die Punktwerte und der Zeitraum kommen aus der Vereins-Config
 * (settings.mitarbeit). Siehe migrations 0011 + 0021.
 */
export async function fetchMemberPoints(): Promise<MemberPoints[]> {
  const { data, error } = await supabase.rpc('member_points')
  if (error) throw error

  return ((data ?? []) as MemberPoints[]).map((r) => ({
    member_id: r.member_id,
    sitzungen: Number(r.sitzungen),
    einsaetze: Number(r.einsaetze),
    punkte: Number(r.punkte),
  }))
}

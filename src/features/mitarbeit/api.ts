import { supabase } from '@/lib/supabase'

export const pointsKey = (tenantId: string, year: number) =>
  ['member-points', tenantId, year] as const

export interface MemberPoints {
  member_id: string
  sitzungen: number
  einsaetze: number
  punkte: number
}

/**
 * Punktestand je Mitglied für ein Vereinsjahr.
 *
 * Läuft über die Datenbankfunktion member_points() und NICHT über eine Abfrage
 * auf protocol_attendance. Grund: Anwesenheitszeilen sind an die Sichtbarkeit
 * des Protokolls gekoppelt – Vorstandssitzungen sieht ein normales Mitglied
 * nicht. Im Browser gerechnet bekäme jeder eine andere Rangliste.
 * Siehe supabase/migrations/0011_mitarbeitspunkte.sql.
 */
export async function fetchMemberPoints(year: number): Promise<MemberPoints[]> {
  const { data, error } = await supabase.rpc('member_points', { p_year: year })
  if (error) throw error

  return ((data ?? []) as MemberPoints[]).map((r) => ({
    member_id: r.member_id,
    sitzungen: Number(r.sitzungen),
    einsaetze: Number(r.einsaetze),
    punkte: Number(r.punkte),
  }))
}

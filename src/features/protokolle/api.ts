import { supabase } from '@/lib/supabase'
import type { Protocol, ProtocolInput } from '@/types'

export const protocolsKey = (tenantId: string) => ['protocols', tenantId] as const
export const attendanceKey = (protocolId: string) => ['protocol-attendance', protocolId] as const

/**
 * RLS blendet Protokolle mit Sichtbarkeit "vorstand" für normale Mitglieder
 * bereits aus (proto_select). Das Frontend filtert deshalb NICHT zusätzlich –
 * sonst gäbe es zwei Wahrheiten.
 */
export async function fetchProtocols(tenantId: string): Promise<Protocol[]> {
  const { data, error } = await supabase
    .from('protocols')
    .select(
      // Expliziter FK-Name nötig: protocols hat ZWEI Beziehungen zu members
      // (author_id-FK und die Verknüpfungstabelle protocol_attendance). Ohne
      // Disambiguierung → PGRST201 "more than one relationship".
      'id, tenant_id, title, proto_date, time_from, time_to, location, proto_type, visibility, author_id, body, members!protocols_author_id_fkey(first_name, last_name)',
    )
    .eq('tenant_id', tenantId)
    .order('proto_date', { ascending: false })
    .returns<Protocol[]>()

  if (error) throw error
  return data ?? []
}

/** Anwesende eines Protokolls. */
export async function fetchAttendance(protocolId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('protocol_attendance')
    .select('member_id')
    .eq('protocol_id', protocolId)
    .returns<{ member_id: string }[]>()

  if (error) throw error
  return (data ?? []).map((r) => r.member_id)
}

/**
 * Speichert Kopf, Anwesenheitsliste und Aufgabenverteilung in EINER Transaktion.
 * Aus dem Browser wären das drei Requests – bräche der zweite ab, stünde ein
 * Protokoll ohne Anwesenheitsliste in der Datenbank.
 * Siehe supabase/migrations/0010_protokolle.sql.
 */
export async function createProtocol(input: ProtocolInput): Promise<string> {
  const tasks = input.tasks
    .filter((t) => t.title.trim().length > 0)
    .map((t) => ({
      title: t.title.trim(),
      assignee_id: t.assignee_id || null,
      due_date: t.due_date || null,
    }))

  const { data, error } = await supabase.rpc('create_protocol', {
    p_title: input.title,
    p_date: input.proto_date,
    p_time_from: input.time_from,
    p_time_to: input.time_to,
    p_location: input.location,
    p_type: input.proto_type,
    p_visibility: input.visibility,
    p_body: input.body,
    p_attendees: input.attendees,
    p_tasks: tasks,
  })

  if (error) throw error
  return data as string
}

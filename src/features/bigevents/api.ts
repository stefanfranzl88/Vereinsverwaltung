import { supabase } from '@/lib/supabase'
import type {
  AssignmentRole,
  BigEvent,
  BigEventInput,
  BigEventSub,
  Department,
  DeptAssignment,
} from '@/types'

export const bigEventsFullKey = (tenantId: string) => ['big-events-full', tenantId] as const
export const subsKey = (eventId: string) => ['big-event-subs', eventId] as const
export const deptsKey = (eventId: string) => ['departments', eventId] as const
export const assignmentsKey = (eventId: string) => ['assignments', eventId] as const
export const myAssignmentsKey = (memberId: string) => ['my-assignments', memberId] as const

const EVENT_COLUMNS =
  'id, tenant_id, kind, name, date_from, date_to, description, cost_center_id, status, report, closed_at'

export async function fetchBigEvents(tenantId: string): Promise<BigEvent[]> {
  const { data, error } = await supabase
    .from('big_events')
    .select(EVENT_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('date_from', { ascending: false, nullsFirst: false })
    .returns<BigEvent[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchSubs(eventId: string): Promise<BigEventSub[]> {
  const { data, error } = await supabase
    .from('big_event_subs')
    .select('id, big_event_id, sub_date, sub_time, title')
    .eq('big_event_id', eventId)
    .order('sub_date')
    .returns<BigEventSub[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchDepartments(eventId: string): Promise<Department[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('id, big_event_id, name')
    .eq('big_event_id', eventId)
    .order('name')
    .returns<Department[]>()

  if (error) throw error
  return data ?? []
}

/**
 * Alle Einteilungen eines Events. dept_assignments trägt kein big_event_id –
 * die Zuordnung läuft über die Abteilungen, deren IDs hier hereingereicht werden.
 */
export async function fetchAssignments(departmentIds: string[]): Promise<DeptAssignment[]> {
  if (departmentIds.length === 0) return []

  const { data, error } = await supabase
    .from('dept_assignments')
    .select('id, department_id, member_id, external_name, role, note, members(first_name, last_name, photo_path)')
    .in('department_id', departmentIds)
    .returns<DeptAssignment[]>()

  if (error) throw error
  return data ?? []
}

/** „Meine Event-Einsätze" fürs Dashboard – nur aus nicht archivierten Events. */
export interface MyAssignment {
  role: AssignmentRole
  note: string | null
  department: { name: string }
  event: { id: string; name: string; kind: string; date_from: string | null; date_to: string | null }
}

export async function fetchMyAssignments(memberId: string): Promise<MyAssignment[]> {
  const { data, error } = await supabase
    .from('dept_assignments')
    .select(
      'role, note, departments(name, big_events(id, name, kind, status, date_from, date_to))',
    )
    .eq('member_id', memberId)
    .returns<
      {
        role: AssignmentRole
        note: string | null
        departments: {
          name: string
          big_events: {
            id: string
            name: string
            kind: string
            status: string
            date_from: string | null
            date_to: string | null
          } | null
        } | null
      }[]
    >()

  if (error) throw error

  return (data ?? [])
    .filter((r) => r.departments?.big_events && r.departments.big_events.status !== 'archiviert')
    .map((r) => ({
      role: r.role,
      note: r.note,
      department: { name: r.departments!.name },
      event: r.departments!.big_events!,
    }))
}

export async function createBigEvent(tenantId: string, input: BigEventInput): Promise<void> {
  const { error } = await supabase.from('big_events').insert({ ...input, tenant_id: tenantId })
  if (error) throw error
}

/**
 * Stammdaten eines Events ändern (Name, Zeitraum, Beschreibung, Kostenstelle).
 * Status/Nachbericht/closed_at bleiben unberührt – die laufen über
 * closeBigEvent/reopenBigEvent/updateReport.
 */
export async function updateBigEvent(id: string, input: BigEventInput): Promise<void> {
  const { data, error } = await supabase
    .from('big_events')
    .update(input)
    .eq('id', id)
    .select('id')

  if (error) throw error
  // Ein per RLS blockiertes UPDATE wirft keinen Fehler – es trifft keine Zeile.
  if (!data || data.length === 0) {
    throw new Error('Nicht gespeichert – fehlende Berechtigung (event.create).')
  }
}

/** Abschließen: Nachbericht speichern und archivieren. */
export async function closeBigEvent(eventId: string, report: string): Promise<void> {
  const { data, error } = await supabase
    .from('big_events')
    .update({
      status: 'archiviert',
      report: report || null,
      closed_at: new Date().toISOString().slice(0, 10),
    })
    .eq('id', eventId)
    .select('id')

  if (error) throw error
  // Ein per RLS blockiertes UPDATE wirft keinen Fehler – es trifft keine Zeile.
  if (!data || data.length === 0) {
    throw new Error('Nicht abgeschlossen – fehlende Berechtigung (event.create).')
  }
}

export async function reopenBigEvent(eventId: string): Promise<void> {
  const { data, error } = await supabase
    .from('big_events')
    .update({ status: 'aktiv', closed_at: null })
    .eq('id', eventId)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Nicht aktiviert – fehlende Berechtigung (event.create).')
  }
}

export async function updateReport(eventId: string, report: string): Promise<void> {
  const { data, error } = await supabase
    .from('big_events')
    .update({ report: report || null })
    .eq('id', eventId)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Nicht gespeichert – fehlende Berechtigung (event.create).')
  }
}

export async function createSub(
  eventId: string,
  sub: { title: string; sub_date: string; sub_time: string | null },
): Promise<void> {
  const { error } = await supabase.from('big_event_subs').insert({
    big_event_id: eventId,
    ...sub,
  })
  if (error) throw error
}

export async function updateSub(
  subId: string,
  sub: { title: string; sub_date: string; sub_time: string | null },
): Promise<void> {
  const { error } = await supabase.from('big_event_subs').update(sub).eq('id', subId)
  if (error) throw error
}

export async function deleteSub(subId: string): Promise<void> {
  const { error } = await supabase.from('big_event_subs').delete().eq('id', subId)
  if (error) throw error
}

export async function createDepartment(eventId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('departments')
    .insert({ big_event_id: eventId, name })
  if (error) throw error
}

export async function updateDepartment(deptId: string, name: string): Promise<void> {
  const { error } = await supabase.from('departments').update({ name }).eq('id', deptId)
  if (error) throw error
}

export async function deleteDepartment(deptId: string): Promise<void> {
  const { error } = await supabase.from('departments').delete().eq('id', deptId)
  if (error) throw error
}

export interface AssignmentInput {
  department_id: string
  /** Genau eines von beiden – das Schema erzwingt es per CHECK. */
  member_id: string | null
  external_name: string | null
  role: AssignmentRole
  note: string | null
}

export async function createAssignment(input: AssignmentInput): Promise<void> {
  const { error } = await supabase.from('dept_assignments').insert(input)
  if (error) throw error
}

export async function updateAssignmentNote(id: string, note: string): Promise<void> {
  const { error } = await supabase
    .from('dept_assignments')
    .update({ note: note || null })
    .eq('id', id)
  if (error) throw error
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('dept_assignments').delete().eq('id', id)
  if (error) throw error
}

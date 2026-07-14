import { supabase } from '@/lib/supabase'
import type { BigEventRef, Task, TaskInput } from '@/types'

export const tasksKey = (tenantId: string) => ['tasks', tenantId] as const
export const myTasksKey = (memberId: string) => ['my-tasks', memberId] as const
export const bigEventsKey = (tenantId: string) => ['big-events', tenantId] as const

const COLUMNS =
  'id, tenant_id, title, assignee_id, due_date, done, done_at, source_type, source_id, created_by, created_at'

/**
 * Alle Aufgaben des Vereins. RLS liefert nur die eigenen zurück, wenn der
 * Benutzer 'tasks.viewall' NICHT hat – die Vorstandsübersicht ist zusätzlich
 * per Route gegated.
 */
export async function fetchTasks(tenantId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .returns<Task[]>()

  if (error) throw error
  return data ?? []
}

export const eventTasksKey = (eventId: string) => ['event-tasks', eventId] as const

/** Aufgaben zu einem Event/Projekt – für alle Mitglieder sichtbar (siehe 0008). */
export async function fetchEventTasks(tenantId: string, eventId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('source_type', 'big_event')
    .eq('source_id', eventId)
    .returns<Task[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchMyTasks(tenantId: string, memberId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('assignee_id', memberId)
    .returns<Task[]>()

  if (error) throw error
  return data ?? []
}

/** Events/Projekte als Zuordnung. Nur sinnvoll, wenn Modul 'events' gebucht ist. */
export async function fetchBigEvents(tenantId: string): Promise<BigEventRef[]> {
  const { data, error } = await supabase
    .from('big_events')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('name')
    .returns<BigEventRef[]>()

  if (error) throw error
  return data ?? []
}

/**
 * Abhaken läuft über set_task_done(). Ein direktes UPDATE bräuchte 'tasks.create'
 * und würde der zugeteilten Person nebenbei erlauben, an der eigenen Aufgabe auch
 * Titel, Fälligkeit oder Zuständigkeit zu ändern – RLS wirkt zeilen-, nicht
 * spaltenweise. Die Funktion schreibt nur done und done_at.
 */
export async function setTaskDone(taskId: string, done: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_task_done', { p_task_id: taskId, p_done: done })
  if (error) throw error
}

export async function createTask(
  tenantId: string,
  createdBy: string | null,
  input: TaskInput,
): Promise<void> {
  const { error } = await supabase.from('tasks').insert({
    tenant_id: tenantId,
    title: input.title,
    assignee_id: input.assignee_id,
    due_date: input.due_date,
    source_type: input.source_type,
    source_id: input.source_id,
    created_by: createdBy,
  })

  if (error) throw error
}

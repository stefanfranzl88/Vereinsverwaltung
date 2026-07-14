import { supabase } from '@/lib/supabase'
import type {
  EventInput,
  RsvpAnswer,
  RsvpCounts,
  RsvpWithMember,
  VereinsEvent,
} from '@/types'

export const eventsKey = (tenantId: string) => ['events', tenantId] as const
export const rsvpCountsKey = (tenantId: string) => ['rsvp-counts', tenantId] as const
export const myRsvpsKey = (memberId: string) => ['my-rsvps', memberId] as const
export const rsvpNamesKey = (eventId: string) => ['rsvp-names', eventId] as const

export async function fetchEvents(tenantId: string): Promise<VereinsEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, tenant_id, title, event_date, event_time, location')
    .eq('tenant_id', tenantId)
    .order('event_date')
    .returns<VereinsEvent[]>()

  if (error) throw error
  return data ?? []
}

/**
 * Zusagen/Absagen als Zahlen. Läuft über eine security-definer-Funktion, weil
 * jedes Mitglied die ZAHLEN sehen soll, die NAMEN aber nur der Vorstand – und
 * RLS spaltenweise Sichtbarkeit nicht kann.
 */
export async function fetchRsvpCounts(): Promise<RsvpCounts[]> {
  // Ohne generierte DB-Typen kennt supabase-js die Signatur der Funktion nicht –
  // deshalb hier explizit casten statt .returns<T>().
  const { data, error } = await supabase.rpc('event_rsvp_counts')
  if (error) throw error
  return (data ?? []) as RsvpCounts[]
}

export async function fetchActiveMemberCount(): Promise<number> {
  const { data, error } = await supabase.rpc('active_member_count')
  if (error) throw error
  return Number(data ?? 0)
}

/** Die eigenen Antworten – Basis für den Filter „zugesagt / abgesagt". */
export async function fetchMyRsvps(memberId: string): Promise<Map<string, RsvpAnswer>> {
  const { data, error } = await supabase
    .from('event_rsvps')
    .select('event_id, answer')
    .eq('member_id', memberId)
    .returns<{ event_id: string; answer: RsvpAnswer }[]>()

  if (error) throw error
  return new Map((data ?? []).map((r) => [r.event_id, r.answer]))
}

/** „Wer kommt?" – nur für den Vorstand (RLS: has_perm('roles.view')). */
export async function fetchRsvpNames(eventId: string): Promise<RsvpWithMember[]> {
  const { data, error } = await supabase
    .from('event_rsvps')
    .select('member_id, answer, members(first_name, last_name)')
    .eq('event_id', eventId)
    .returns<RsvpWithMember[]>()

  if (error) throw error
  return data ?? []
}

/** Zu- oder Absagen. Primary key ist (event_id, member_id) → upsert. */
export async function setRsvp(
  eventId: string,
  memberId: string,
  answer: RsvpAnswer,
): Promise<void> {
  const { error } = await supabase
    .from('event_rsvps')
    .upsert(
      { event_id: eventId, member_id: memberId, answer, answered_at: new Date().toISOString() },
      { onConflict: 'event_id,member_id' },
    )

  if (error) throw error
}

export async function createEvent(tenantId: string, input: EventInput): Promise<void> {
  const { error } = await supabase.from('events').insert({ ...input, tenant_id: tenantId })
  if (error) throw error
}

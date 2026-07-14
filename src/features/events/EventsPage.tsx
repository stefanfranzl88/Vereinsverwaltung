import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { fdate, ftime, monthShort, today } from '@/lib/format'
import type { EventInput, RsvpAnswer, VereinsEvent } from '@/types'
import {
  createEvent,
  eventsKey,
  fetchActiveMemberCount,
  fetchEvents,
  fetchMyRsvps,
  fetchRsvpCounts,
  fetchRsvpNames,
  myRsvpsKey,
  rsvpCountsKey,
  rsvpNamesKey,
  setRsvp,
} from './api'
import { EventFormDialog } from './EventFormDialog'

type ViewMode = 'liste' | 'monat' | 'jahr'
type Filter = 'alle' | 'zugesagt' | 'abgesagt'

export function EventsPage() {
  const { tenant, member: me, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const [view, setView] = useState<ViewMode>('liste')
  const [filter, setFilter] = useState<Filter>('alle')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [openRsvp, setOpenRsvp] = useState<string | null>(null)

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())

  const tenantId = tenant?.id ?? ''
  const mayCreate = can('event.create')
  // Das Basisschema nutzt roles.view als Vorstands-Marker (siehe proto_select).
  const isVorstand = can('roles.view')

  const eventsQuery = useQuery({
    queryKey: eventsKey(tenantId),
    queryFn: () => fetchEvents(tenantId),
    enabled: Boolean(tenantId),
  })

  const countsQuery = useQuery({
    queryKey: rsvpCountsKey(tenantId),
    queryFn: fetchRsvpCounts,
    enabled: Boolean(tenantId),
  })

  const myRsvpsQuery = useQuery({
    queryKey: myRsvpsKey(me?.id ?? ''),
    queryFn: () => fetchMyRsvps(me!.id),
    enabled: Boolean(me?.id),
  })

  const activeCountQuery = useQuery({
    queryKey: ['active-member-count', tenantId],
    queryFn: fetchActiveMemberCount,
    enabled: Boolean(tenantId) && isVorstand,
  })

  const namesQuery = useQuery({
    queryKey: rsvpNamesKey(openRsvp ?? ''),
    queryFn: () => fetchRsvpNames(openRsvp!),
    enabled: Boolean(openRsvp) && isVorstand,
  })

  const rsvpMutation = useMutation({
    mutationFn: ({ eventId, answer }: { eventId: string; answer: RsvpAnswer }) =>
      setRsvp(eventId, me!.id, answer),
    onSuccess: async (_d, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myRsvpsKey(me?.id ?? '') }),
        queryClient.invalidateQueries({ queryKey: rsvpCountsKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: rsvpNamesKey(vars.eventId) }),
      ])
      toast(vars.answer === 'yes' ? 'Zusage gespeichert' : 'Absage gespeichert')
    },
    onError: (e: Error) => toastError(`Antwort nicht gespeichert: ${e.message}`),
  })

  const createMutation = useMutation({
    mutationFn: (input: EventInput) => createEvent(tenantId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: eventsKey(tenantId) })
      setDialogOpen(false)
      toast('Termin angelegt')
    },
    onError: (e: Error) => toastError(`Termin nicht angelegt: ${e.message}`),
  })

  const counts = useMemo(() => {
    const map = new Map<string, { yes: number; no: number }>()
    for (const c of countsQuery.data ?? []) {
      map.set(c.event_id, { yes: Number(c.yes_count), no: Number(c.no_count) })
    }
    return map
  }, [countsQuery.data])

  const myRsvps = myRsvpsQuery.data ?? new Map<string, RsvpAnswer>()

  const events = useMemo(() => {
    const all = eventsQuery.data ?? []
    if (filter === 'alle') return all
    const want: RsvpAnswer = filter === 'zugesagt' ? 'yes' : 'no'
    return all.filter((e) => myRsvps.get(e.id) === want)
  }, [eventsQuery.data, filter, myRsvps])

  if (eventsQuery.error) {
    return (
      <>
        <h2 className="view-title">Terminkalender</h2>
        <div className="error-box">
          Termine konnten nicht geladen werden: {eventsQuery.error.message}
        </div>
      </>
    )
  }

  const renderRsvpButtons = (e: VereinsEvent) => {
    const mine = myRsvps.get(e.id)
    const busy = rsvpMutation.isPending
    return (
      <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <button
          className={`btn small${mine === 'yes' ? '' : ' ghost'}`}
          disabled={busy || !me}
          onClick={() => rsvpMutation.mutate({ eventId: e.id, answer: 'yes' })}
        >
          Zusagen
        </button>
        <button
          className={`btn small${mine === 'no' ? ' danger' : ' ghost'}`}
          disabled={busy || !me}
          onClick={() => rsvpMutation.mutate({ eventId: e.id, answer: 'no' })}
        >
          Absagen
        </button>
      </div>
    )
  }

  const listView = () => {
    if (events.length === 0) {
      return (
        <div className="card">
          <p className="meta">
            {eventsQuery.isPending ? 'Wird geladen…' : 'Keine Termine für diesen Filter.'}
          </p>
        </div>
      )
    }

    return events.map((e) => {
      const c = counts.get(e.id) ?? { yes: 0, no: 0 }
      const names = openRsvp === e.id ? (namesQuery.data ?? []) : []
      const yesNames = names.filter((n) => n.answer === 'yes')
      const noNames = names.filter((n) => n.answer === 'no')
      const active = activeCountQuery.data ?? 0
      const pending = Math.max(0, active - c.yes - c.no)

      return (
        <div className="card" key={e.id}>
          <div className="list-item" style={{ border: 'none', padding: 0, flexWrap: 'wrap' }}>
            <div className="date-chip">
              <div className="d">{e.event_date.slice(8)}</div>
              <div className="m">{monthShort(e.event_date)}</div>
            </div>

            <div style={{ flex: 1, minWidth: 200 }}>
              <b>{e.title}</b>
              <div className="meta">
                {fdate(e.event_date)}
                {e.event_time && ` · ${ftime(e.event_time)} Uhr`}
                {e.location && ` · ${e.location}`}
              </div>
              <div className="meta" style={{ marginTop: 4 }}>
                <span className="pill green">{c.yes} Zusagen</span>{' '}
                <span className="pill red">{c.no} Absagen</span>
                {isVorstand && (
                  <button
                    className="btn ghost small"
                    style={{ marginLeft: 8 }}
                    onClick={() => setOpenRsvp(openRsvp === e.id ? null : e.id)}
                  >
                    Wer kommt?
                  </button>
                )}
              </div>
            </div>

            {renderRsvpButtons(e)}

            {isVorstand && openRsvp === e.id && (
              <div
                style={{
                  flexBasis: '100%',
                  background: '#F6F8F4',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginTop: 8,
                  fontSize: 13.5,
                }}
              >
                {namesQuery.isPending ? (
                  <span className="meta">Wird geladen…</span>
                ) : (
                  <>
                    <div>
                      <b style={{ color: 'var(--pine)' }}>✓ Zugesagt ({yesNames.length}):</b>{' '}
                      {yesNames.length > 0
                        ? yesNames
                            .map((n) =>
                              n.members ? `${n.members.first_name} ${n.members.last_name}` : '?',
                            )
                            .join(', ')
                        : '–'}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <b style={{ color: 'var(--red)' }}>✗ Abgesagt ({noNames.length}):</b>{' '}
                      {noNames.length > 0
                        ? noNames
                            .map((n) =>
                              n.members ? `${n.members.first_name} ${n.members.last_name}` : '?',
                            )
                            .join(', ')
                        : '–'}
                    </div>
                    <div className="meta" style={{ marginTop: 4 }}>
                      Noch keine Antwort: {pending} aktive Mitglieder
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )
    })
  }

  const monthView = () => {
    const first = new Date(calYear, calMonth, 1)
    const monthName = first.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })
    // Montag = 0 (Postgres/DE-Woche), getDay() liefert Sonntag = 0.
    const startDow = (first.getDay() + 6) % 7
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const daysInPrev = new Date(calYear, calMonth, 0).getDate()
    const iso = today()

    const cells = []
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startDow + 1
      const isOther = dayNum < 1 || dayNum > daysInMonth
      const shown = dayNum < 1 ? daysInPrev + dayNum : dayNum > daysInMonth ? dayNum - daysInMonth : dayNum

      const date = isOther
        ? null
        : `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
      const dayEvents = date ? events.filter((e) => e.event_date === date) : []

      cells.push(
        <div
          key={i}
          className={`day${isOther ? ' other' : ''}${date === iso ? ' today' : ''}`}
        >
          <div className="n">{shown}</div>
          {dayEvents.map((e) => (
            <div
              className="ev"
              key={e.id}
              title={`${e.title}${e.event_time ? ` · ${ftime(e.event_time)} Uhr` : ''}`}
            >
              {e.title}
            </div>
          ))}
          {dayEvents.length > 0 && <div className="dot" />}
        </div>,
      )

      // Sechste Zeile nur zeigen, wenn der Monat sie wirklich braucht.
      if (i >= 34 && i - startDow + 2 > daysInMonth) break
    }

    const prevMonth = () => {
      if (calMonth === 0) {
        setCalMonth(11)
        setCalYear(calYear - 1)
      } else setCalMonth(calMonth - 1)
    }
    const nextMonth = () => {
      if (calMonth === 11) {
        setCalMonth(0)
        setCalYear(calYear + 1)
      } else setCalMonth(calMonth + 1)
    }

    return (
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn ghost small" onClick={prevMonth}>
            ‹
          </button>
          <h3 style={{ margin: 0, flex: 1, textAlign: 'center' }}>{monthName}</h3>
          <button className="btn ghost small" onClick={nextMonth}>
            ›
          </button>
        </div>
        <div className="cal">
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
            <div className="dow" key={d}>
              {d}
            </div>
          ))}
          {cells}
        </div>
      </div>
    )
  }

  const yearView = () => {
    const inYear = events.filter((e) => e.event_date.startsWith(String(calYear)))

    const months = Array.from({ length: 12 }, (_, m) => {
      const monthEvents = inYear
        .filter((e) => Number(e.event_date.slice(5, 7)) === m + 1)
        .sort((a, b) => a.event_date.localeCompare(b.event_date))
      if (monthEvents.length === 0) return null

      return (
        <div key={m} style={{ marginBottom: 14 }}>
          <div
            style={{
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              marginBottom: 4,
            }}
          >
            {new Date(calYear, m, 1).toLocaleDateString('de-AT', { month: 'long' })}
          </div>
          {monthEvents.map((e) => {
            const mine = myRsvps.get(e.id)
            return (
              <div className="list-item" key={e.id} style={{ padding: '8px 0' }}>
                <div className="date-chip" style={{ width: 44 }}>
                  <div className="d">{e.event_date.slice(8)}</div>
                  <div className="m">{monthShort(e.event_date)}</div>
                </div>
                <div>
                  <b>{e.title}</b>
                  <div className="meta">
                    {e.event_time && `${ftime(e.event_time)} Uhr · `}
                    {e.location && `${e.location} · `}
                    {mine === 'yes' ? '✓ zugesagt' : mine === 'no' ? '✗ abgesagt' : 'noch offen'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )
    }).filter(Boolean)

    return (
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn ghost small" onClick={() => setCalYear(calYear - 1)}>
            ‹
          </button>
          <h3 style={{ margin: 0, flex: 1, textAlign: 'center' }}>Jahresübersicht {calYear}</h3>
          <button className="btn ghost small" onClick={() => setCalYear(calYear + 1)}>
            ›
          </button>
        </div>
        {months.length > 0 ? (
          months
        ) : (
          <p className="meta">Keine Termine in {calYear} für diesen Filter.</p>
        )}
      </div>
    )
  }

  return (
    <>
      <h2 className="view-title">Terminkalender</h2>
      <p className="view-sub">Zu- und Absagen sind für alle Mitglieder möglich</p>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">
          {(['liste', 'monat', 'jahr'] as ViewMode[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'liste' ? 'Liste' : v === 'monat' ? 'Monat' : 'Jahr'}
            </button>
          ))}
        </div>

        <div className="seg">
          {(['alle', 'zugesagt', 'abgesagt'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'alle' ? 'Alle' : f === 'zugesagt' ? 'Von mir zugesagt' : 'Abgesagt'}
            </button>
          ))}
        </div>

        <div className="spacer" />
        {mayCreate && (
          <button className="btn small" onClick={() => setDialogOpen(true)}>
            + Termin anlegen
          </button>
        )}
      </div>

      {view === 'liste' ? listView() : view === 'monat' ? monthView() : yearView()}

      {dialogOpen && (
        <EventFormDialog
          saving={createMutation.isPending}
          onSave={(input) => createMutation.mutate(input)}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}

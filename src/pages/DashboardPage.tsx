import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { Avatar } from '@/components/Avatar'
import { fdate, ftime, fullName, jubilee, monthShort, today } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import { eventsKey, fetchEvents, fetchRsvpCounts, rsvpCountsKey } from '@/features/events/api'
import { fetchMyTasks, myTasksKey } from '@/features/tasks/api'
import { MyTasksCard } from '@/features/tasks/MyTasksCard'
import { NewsCard } from '@/features/news/NewsCard'
import { MyAssignmentsCard } from '@/features/bigevents/MyAssignmentsCard'

export function DashboardPage() {
  const { tenant, member: me, roleLabel } = useAuth()
  const tenantId = tenant?.id ?? ''
  const memberId = me?.id ?? ''
  const iso = today()

  const { data: members = [] } = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  const { data: events = [] } = useQuery({
    queryKey: eventsKey(tenantId),
    queryFn: () => fetchEvents(tenantId),
    enabled: Boolean(tenantId),
  })

  const { data: counts = [] } = useQuery({
    queryKey: rsvpCountsKey(tenantId),
    queryFn: fetchRsvpCounts,
    enabled: Boolean(tenantId),
  })

  const { data: myTasks = [] } = useQuery({
    queryKey: myTasksKey(memberId),
    queryFn: () => fetchMyTasks(tenantId, memberId),
    enabled: Boolean(tenantId && memberId),
  })

  const yesByEvent = useMemo(
    () => new Map(counts.map((c) => [c.event_id, Number(c.yes_count)])),
    [counts],
  )

  const upcoming = useMemo(
    () =>
      events
        .filter((e) => e.event_date >= iso)
        .sort((a, b) => a.event_date.localeCompare(b.event_date))
        .slice(0, 3),
    [events, iso],
  )

  // Jubilare des laufenden Monats – wie im Prototyp ("Unsere Jubilare im Juli").
  const jubilars = useMemo(
    () =>
      members
        .filter((m) => m.status !== 'ruhend')
        .map((m) => ({ m, jub: jubilee(m) }))
        .filter((x) => x.jub.thisMonth),
    [members],
  )

  const activeCount = members.filter((m) => m.status === 'aktiv').length
  const openTasks = myTasks.filter((t) => !t.done).length
  const next = upcoming[0]
  const monthName = new Date().toLocaleDateString('de-AT', { month: 'long' })

  return (
    <>
      <h2 className="view-title">Servus{me ? `, ${me.first_name}` : ''}!</h2>
      <p className="view-sub">
        {new Date().toLocaleDateString('de-AT', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}{' '}
        · Angemeldet als {roleLabel}
      </p>

      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="k">Aktive Mitglieder</div>
          <div className="v">{activeCount}</div>
        </div>
        <div className="stat">
          <div className="k">Nächster Termin</div>
          <div className="v" style={{ fontSize: 16, fontFamily: 'var(--font-body)' }}>
            {next ? next.title : '–'}
          </div>
          {next && (
            <div className="meta">
              {fdate(next.event_date)}
              {next.event_time && ` · ${ftime(next.event_time)} Uhr`}
            </div>
          )}
        </div>
        <div className="stat">
          <div className="k">Meine offenen Aufgaben</div>
          <div className="v">{openTasks}</div>
        </div>
      </div>

      <div className="grid2">
        <div>
          <MyTasksCard />
          <MyAssignmentsCard />
          <NewsCard />
        </div>

        <div>
          {jubilars.length > 0 && (
            <div
              className="card"
              style={{
                borderColor: 'var(--amber)',
                background: 'linear-gradient(180deg,#FFFDF6,#fff)',
              }}
            >
              <h3>🏆 Unsere Jubilare im {monthName}</h3>
              {jubilars.map(({ m, jub }) => (
                <div className="list-item" key={m.id}>
                  <Avatar member={m} size={42} showMedal />
                  <div>
                    <b>{fullName(m)}</b>
                    <div className="meta">
                      {jub.years} Jahre Mitgliedschaft · dabei seit {fdate(m.joined_at)}
                    </div>
                  </div>
                </div>
              ))}
              <p className="meta" style={{ marginTop: 8 }}>
                Herzliche Gratulation! 🎉
              </p>
            </div>
          )}

          <div className="card">
            <h3>📅 Nächste Termine</h3>
            {upcoming.length === 0 ? (
              <p className="meta">Keine anstehenden Termine.</p>
            ) : (
              upcoming.map((e) => (
                <div className="list-item" key={e.id}>
                  <div className="date-chip">
                    <div className="d">{e.event_date.slice(8)}</div>
                    <div className="m">{monthShort(e.event_date)}</div>
                  </div>
                  <div>
                    <b>{e.title}</b>
                    <div className="meta">
                      {e.event_time && `${ftime(e.event_time)} Uhr · `}
                      {e.location && `${e.location} · `}
                      {yesByEvent.get(e.id) ?? 0} Zusagen
                    </div>
                  </div>
                </div>
              ))
            )}
            <Link to="/termine">
              <button className="btn ghost small" style={{ marginTop: 10 }}>
                Alle Termine ansehen
              </button>
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

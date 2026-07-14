import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { fdate } from '@/lib/format'
import { fetchMyAssignments, myAssignmentsKey } from './api'

/**
 * „Meine Event-Einsätze" am Dashboard. Zeigt nur Einsätze aus nicht archivierten
 * Events – ein abgeschlossenes Fest muss niemanden mehr beschäftigen.
 *
 * Rendert gar nichts, wenn es keine Einsätze gibt (oder das Modul fehlt).
 */
export function MyAssignmentsCard() {
  const { member: me, hasModule } = useAuth()
  const memberId = me?.id ?? ''

  const { data: assignments = [] } = useQuery({
    queryKey: myAssignmentsKey(memberId),
    queryFn: () => fetchMyAssignments(memberId),
    enabled: Boolean(memberId) && hasModule('events'),
  })

  if (assignments.length === 0) return null

  return (
    <div className="card">
      <h3>🎪 Meine Event-Einsätze</h3>

      {assignments.map((a, i) => (
        <div className="list-item" key={`${a.event.id}-${a.department.name}-${i}`}>
          <div className="avatar" style={{ fontSize: 16 }}>
            {a.event.kind === 'Event' ? '🎪' : '🏗️'}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{a.event.name}</b> – {a.department.name}
            <div className="meta">
              <span className={`pill ${a.role === 'lead' ? 'amber' : 'grey'}`}>
                {a.role === 'lead' ? 'Leitung' : 'Team'}
              </span>{' '}
              {fdate(a.event.date_from)} – {fdate(a.event.date_to)}
              {a.note && ` · 📝 ${a.note}`}
            </div>
          </div>

          <Link to={`/events?id=${a.event.id}`}>
            <button className="btn ghost small">Details</button>
          </Link>
        </div>
      ))}
    </div>
  )
}

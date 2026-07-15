import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { fetchMyVotes, fetchSurveys, myVotesKey, surveysKey } from './api'

/**
 * Dashboard-Hinweis: laufende Umfragen, bei denen die eigene Stimme fehlt.
 * Rendert nichts, wenn das Modul nicht gebucht ist oder alles abgestimmt ist.
 */
export function OpenSurveysNotice() {
  const { tenant, member: me, hasModule } = useAuth()
  const tenantId = tenant?.id ?? ''
  const memberId = me?.id ?? ''
  const active = hasModule('umfragen') && Boolean(tenantId && memberId)

  const { data: surveys = [] } = useQuery({
    queryKey: surveysKey(tenantId),
    queryFn: () => fetchSurveys(tenantId),
    enabled: active,
  })

  const { data: myVotes = new Map<string, string>() } = useQuery({
    queryKey: myVotesKey(memberId),
    queryFn: () => fetchMyVotes(memberId),
    enabled: active,
  })

  const pending = surveys.filter((s) => s.is_open && !myVotes.has(s.id))
  if (pending.length === 0) return null

  return (
    <div className="notice">
      📊 Es gibt{' '}
      <b>
        {pending.length} offene Umfrage{pending.length > 1 ? 'n' : ''}
      </b>
      , bei {pending.length > 1 ? 'denen' : 'der'} deine Stimme noch fehlt.{' '}
      <Link to="/umfragen">Jetzt abstimmen</Link>
    </div>
  )
}

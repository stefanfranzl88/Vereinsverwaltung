import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { Avatar } from '@/components/Avatar'
import { fdate, fullName } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import { fetchMemberPoints, pointsKey } from './api'
import { highestTier, readMitarbeitConfig } from './config'

const MEDALS = ['🥇', '🥈', '🥉']

/** Punkte hübsch: ganze Zahlen ohne Nachkomma, sonst mit Komma. */
const fmtPoints = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')

export function MitarbeitPage() {
  const { tenant } = useAuth()
  const tenantId = tenant?.id ?? ''
  const config = useMemo(() => readMitarbeitConfig(tenant?.settings), [tenant?.settings])

  const pointsQuery = useQuery({
    queryKey: pointsKey(tenantId),
    queryFn: fetchMemberPoints,
    enabled: Boolean(tenantId),
  })

  const { data: members = [] } = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  const rows = useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m]))
    return (pointsQuery.data ?? [])
      .map((p) => ({ ...p, member: byId.get(p.member_id) }))
      .filter((r) => r.member !== undefined)
      .sort(
        (a, b) =>
          b.punkte - a.punkte || a.member!.last_name.localeCompare(b.member!.last_name, 'de'),
      )
  }, [pointsQuery.data, members])

  const max = Math.max(1, ...rows.map((r) => r.punkte))

  if (pointsQuery.error) {
    return (
      <>
        <h2 className="view-title">Mitarbeit &amp; Punkte</h2>
        <div className="error-box">
          Punkte konnten nicht geladen werden: {pointsQuery.error.message}
        </div>
      </>
    )
  }

  // Legende der Punktwerte aus der Config.
  const pointValueList = Object.entries(config.point_values)
    .map(([type, v]) => `${type} = ${fmtPoints(v)}`)
    .join(' · ')

  return (
    <>
      <h2 className="view-title">Mitarbeit &amp; Punkte</h2>
      <p className="view-sub">
        Anwesenheiten aus allen Protokollen – automatisch gezählt
        {config.count_from ? ` · gezählt ab ${fdate(config.count_from)}` : ''}
      </p>

      <div
        className="card"
        style={{ borderColor: 'var(--amber)', background: 'linear-gradient(180deg,#FFFDF6,#fff)' }}
      >
        <h3>🎁 Punkte &amp; Belohnungen</h3>
        <p style={{ fontSize: 14 }}>
          <b>Punkte:</b> {pointValueList || 'keine konfiguriert'}
        </p>
        {config.reward_tiers.length > 0 ? (
          <ul style={{ fontSize: 14, margin: '6px 0 0', paddingLeft: 18 }}>
            {config.reward_tiers.map((t) => (
              <li key={`${t.threshold}-${t.label}`}>
                <b>Ab {fmtPoints(t.threshold)} Punkten:</b> {t.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta" style={{ marginTop: 6 }}>
            Noch keine Belohnungsstufen konfiguriert (unter Einstellungen → Mitarbeitspunkte).
          </p>
        )}
      </div>

      <div className="card">
        {pointsQuery.isPending ? (
          <p className="meta">Wird geladen…</p>
        ) : rows.length === 0 ? (
          <p className="meta">Keine aktiven Mitglieder.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Mitglied</th>
                  <th style={{ textAlign: 'center' }}>Sitzungen</th>
                  <th style={{ textAlign: 'center' }}>Einsätze</th>
                  <th>Punkte</th>
                  <th>Belohnung</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const tier = highestTier(config, r.punkte)
                  return (
                    <tr key={r.member_id}>
                      <td className="mono">{i + 1}.</td>
                      <td>
                        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <Avatar member={r.member!} size={32} showMedal />
                          <b>{fullName(r.member!)}</b>
                          {r.punkte > 0 && i < MEDALS.length && <span>{MEDALS[i]}</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }} className="mono">
                        {r.sitzungen}
                      </td>
                      <td style={{ textAlign: 'center' }} className="mono">
                        {r.einsaetze}
                      </td>
                      <td style={{ minWidth: 130 }}>
                        <span className="mono" style={{ fontWeight: 600 }}>
                          {fmtPoints(r.punkte)} P
                        </span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${(r.punkte / max) * 100}%` }} />
                        </div>
                      </td>
                      <td>
                        {tier ? (
                          <span className="pill green">{tier.label}</span>
                        ) : (
                          <span className="pill grey">–</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="meta" style={{ marginTop: 10 }}>
          Gezählt werden alle Protokolle – auch die, deren Inhalt nur der Vorstand sieht. Die
          Punktestände sind für alle Mitglieder gleich. Werte und Belohnungen unter Einstellungen →
          Mitarbeitspunkte.
        </p>
      </div>
    </>
  )
}

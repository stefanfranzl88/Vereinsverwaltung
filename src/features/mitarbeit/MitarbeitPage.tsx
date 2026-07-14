import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { Avatar } from '@/components/Avatar'
import { fullName } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import { fetchMemberPoints, pointsKey } from './api'

/**
 * Schwellen aus dem Prototyp. Dort als „Belohnungssystem (Beispiel)"
 * gekennzeichnet – die Werte legt jeder Verein selbst fest. Sie stehen bewusst
 * hier und nicht in der Punkte-Funktion: Die Datenbank zählt nur, sie belohnt
 * nicht.
 */
const THRESHOLD_FULL = 6
const THRESHOLD_HALF = 4

const MEDALS = ['🥇', '🥈', '🥉']

export function MitarbeitPage() {
  const { tenant } = useAuth()
  const tenantId = tenant?.id ?? ''

  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)

  const pointsQuery = useQuery({
    queryKey: pointsKey(tenantId, year),
    queryFn: () => fetchMemberPoints(year),
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
          b.punkte - a.punkte ||
          a.member!.last_name.localeCompare(b.member!.last_name, 'de'),
      )
  }, [pointsQuery.data, members])

  // Nenner für die Balken. Mindestens 1, sonst Division durch 0.
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

  return (
    <>
      <h2 className="view-title">Mitarbeit &amp; Punkte</h2>
      <p className="view-sub">
        Anwesenheiten aus allen Protokollen (Sitzungen, Auf-/Abbau, Veranstaltungen) – automatisch
        gezählt
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn ghost small" onClick={() => setYear(year - 1)}>
          ‹
        </button>
        <h3 style={{ margin: 0 }}>Vereinsjahr {year}</h3>
        <button
          className="btn ghost small"
          disabled={year >= currentYear}
          onClick={() => setYear(year + 1)}
        >
          ›
        </button>
      </div>

      <div
        className="card"
        style={{
          borderColor: 'var(--amber)',
          background: 'linear-gradient(180deg,#FFFDF6,#fff)',
        }}
      >
        <h3>🎁 Belohnungssystem (Beispiel)</h3>
        <p style={{ fontSize: 14 }}>
          Sitzung = 1 Punkt · Auf-/Abbau &amp; Veranstaltung = 2 Punkte.{' '}
          <b>Ab {THRESHOLD_HALF} Punkten:</b> −50 % Selbstbehalt beim Vereinsausflug ·{' '}
          <b>Ab {THRESHOLD_FULL} Punkten:</b> Selbstbehalt entfällt komplett. Die Schwellen und
          Belohnungen legt der Vorstand fest.
        </p>
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
                {rows.map((r, i) => (
                  <tr key={r.member_id}>
                    <td className="mono">{i + 1}.</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <Avatar member={r.member!} size={32} showMedal />
                        <b>{fullName(r.member!)}</b>
                        {/* Medaille nur, wenn überhaupt Punkte da sind – sonst
                            wäre der Erste einer Nullrunde "Sieger". */}
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
                        {r.punkte} P
                      </span>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${(r.punkte / max) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td>
                      {r.punkte >= THRESHOLD_FULL ? (
                        <span className="pill green">Selbstbehalt entfällt</span>
                      ) : r.punkte >= THRESHOLD_HALF ? (
                        <span className="pill amber">−50 % Selbstbehalt</span>
                      ) : (
                        <span className="pill grey">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="meta" style={{ marginTop: 10 }}>
          Gezählt werden alle Protokolle des Vereinsjahres {year} – auch die, deren Inhalt nur der
          Vorstand sieht. Die Punktestände sind für alle Mitglieder gleich.
        </p>
      </div>
    </>
  )
}

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { fdate, ftime, fullName } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import { fetchTasks, tasksKey } from '@/features/tasks/api'
import type { Protocol, ProtocolInput } from '@/types'
import {
  attendanceKey,
  createProtocol,
  fetchAttendance,
  fetchProtocols,
  protocolsKey,
} from './api'
import { ProtocolEditor } from './ProtocolEditor'
import { exportProtocolTxt } from './export'

/**
 * Archiv = älter als 12 Monate. Das Schema hält dafür bewusst kein Feld vor
 * ("Archiv = proto_date < now() - interval '12 months'") – es wird gerechnet.
 */
function archiveCutoff(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 12)
  return d.toISOString().slice(0, 10)
}

export function ProtokollePage() {
  const { tenant, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const tenantId = tenant?.id ?? ''
  const mayEdit = can('protokoll.edit')
  // Das Basisschema nutzt roles.view als Vorstands-Marker (siehe proto_select).
  const isVorstand = can('roles.view')

  const openId = searchParams.get('id')
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<'aktuell' | 'archiv'>('aktuell')

  const protocolsQuery = useQuery({
    queryKey: protocolsKey(tenantId),
    queryFn: () => fetchProtocols(tenantId),
    enabled: Boolean(tenantId),
  })

  const { data: members = [] } = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  // Aufgaben zum offenen Protokoll. RLS liefert sie nur, wenn das Protokoll
  // selbst lesbar ist – dieselbe Bedingung wie bei proto_select.
  const { data: allTasks = [] } = useQuery({
    queryKey: tasksKey(tenantId),
    queryFn: () => fetchTasks(tenantId),
    enabled: Boolean(tenantId),
  })

  const attendanceQuery = useQuery({
    queryKey: attendanceKey(openId ?? ''),
    queryFn: () => fetchAttendance(openId!),
    enabled: Boolean(openId),
  })

  const saveM = useMutation({
    mutationFn: (input: ProtocolInput) => createProtocol(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: protocolsKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: tasksKey(tenantId) }),
      ])
      setEditing(false)
      toast('Protokoll gespeichert')
    },
    onError: (e: Error) => toastError(`Nicht gespeichert: ${e.message}`),
  })

  const protocols = protocolsQuery.data ?? []
  const cutoff = archiveCutoff()

  const { current, archived } = useMemo(() => {
    const isArchived = (p: Protocol) => p.proto_date < cutoff
    return {
      current: protocols.filter((p) => !isArchived(p)),
      archived: protocols.filter(isArchived),
    }
  }, [protocols, cutoff])

  const open = openId ? protocols.find((p) => p.id === openId) : undefined

  if (protocolsQuery.error) {
    return (
      <>
        <h2 className="view-title">Sitzungsprotokolle</h2>
        <div className="error-box">
          Protokolle konnten nicht geladen werden: {protocolsQuery.error.message}
        </div>
      </>
    )
  }

  // ===============================================================
  // Editor
  // ===============================================================
  if (editing) {
    return (
      <ProtocolEditor
        members={members}
        saving={saveM.isPending}
        onSave={(input) => saveM.mutate(input)}
        onCancel={() => setEditing(false)}
      />
    )
  }

  // ===============================================================
  // Detail
  // ===============================================================
  if (openId && open) {
    const attendeeIds = attendanceQuery.data ?? []
    const attendees = members.filter((m) => attendeeIds.includes(m.id))
    const protoTasks = allTasks.filter(
      (t) => t.source_type === 'protocol' && t.source_id === open.id,
    )
    const isArchived = open.proto_date < cutoff

    return (
      <>
        <button
          className="btn ghost small"
          style={{ marginBottom: 14 }}
          onClick={() => setSearchParams({}, { replace: true })}
        >
          ← Zurück zur Übersicht
        </button>

        <div className="card">
          <h3>
            {open.title}
            {isArchived && (
              <span className="pill grey" style={{ marginLeft: 6 }}>
                🗄 archiviert
              </span>
            )}
          </h3>

          <p className="meta" style={{ marginBottom: 8 }}>
            {fdate(open.proto_date)}
            {open.time_from && ` · ${ftime(open.time_from)} – ${ftime(open.time_to) ?? '?'} Uhr`}
            {open.location && ` · 📍 ${open.location}`}
            {' · Schriftführung: '}
            {open.members ? `${open.members.first_name} ${open.members.last_name}` : '–'}{' '}
            <span className="pill grey">{open.proto_type}</span>{' '}
            <span className={`pill ${open.visibility === 'alle' ? 'green' : 'amber'}`}>
              {open.visibility === 'alle' ? '👥 alle Mitglieder' : '🔒 nur Vorstand'}
            </span>
          </p>

          <div style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13.5 }}>Anwesend ({attendees.length}):</b>
            <div className="row" style={{ marginTop: 6, gap: 8 }}>
              {attendanceQuery.isPending ? (
                <span className="meta">Wird geladen…</span>
              ) : attendees.length === 0 ? (
                <span className="meta">Keine Anwesenheit erfasst.</span>
              ) : (
                attendees.map((m) => (
                  <span
                    key={m.id}
                    className="row"
                    style={{
                      gap: 6,
                      background: '#F1F4EF',
                      borderRadius: 999,
                      padding: '3px 10px 3px 4px',
                      fontSize: 13,
                      flexWrap: 'nowrap',
                    }}
                  >
                    <Avatar member={m} size={22} />
                    {fullName(m)}
                  </span>
                ))
              )}
            </div>
          </div>

          <div style={{ whiteSpace: 'pre-line', fontSize: 14.5, marginBottom: 14 }}>
            {open.body || 'Kein Inhalt erfasst.'}
          </div>

          {protoTasks.length > 0 && (
            <>
              <b style={{ fontSize: 13.5 }}>Aufgabenverteilung:</b>
              {protoTasks.map((t) => {
                const assignee = members.find((m) => m.id === t.assignee_id)
                return (
                  <div className="list-item" key={t.id}>
                    {assignee ? (
                      <Avatar member={assignee} size={30} />
                    ) : (
                      <div className="avatar">?</div>
                    )}
                    <div className={t.done ? 'task-done' : ''}>
                      <b>{t.title}</b>
                      <div className="meta">
                        {assignee ? fullName(assignee) : '–'} ·{' '}
                        {t.due_date ? `fällig ${fdate(t.due_date)}` : 'ohne Fälligkeit'} ·{' '}
                        {t.done ? '✓ erledigt' : 'offen'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn small"
              onClick={() =>
                exportProtocolTxt(
                  open,
                  attendees,
                  protoTasks,
                  members,
                  tenant?.name ?? 'Verein',
                )
              }
            >
              ⬇ Exportieren (TXT)
            </button>
            <button className="btn ghost small" onClick={() => window.print()}>
              🖨 Drucken / PDF
            </button>
          </div>
        </div>
      </>
    )
  }

  // ===============================================================
  // Übersicht
  // ===============================================================
  const list = tab === 'aktuell' ? current : archived

  return (
    <>
      <h2 className="view-title">Sitzungsprotokolle</h2>
      <p className="view-sub">
        Mit Ort, Zeitraum, Anwesenheit und Aufgabenverteilung · Protokolle wandern nach 12 Monaten
        automatisch ins Archiv
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">
          <button className={tab === 'aktuell' ? 'on' : ''} onClick={() => setTab('aktuell')}>
            Aktuell ({current.length})
          </button>
          <button className={tab === 'archiv' ? 'on' : ''} onClick={() => setTab('archiv')}>
            🗄 Archiv ({archived.length})
          </button>
        </div>
        <div className="spacer" />
        {mayEdit && (
          <button className="btn small" onClick={() => setEditing(true)}>
            + Protokoll verfassen (Vorlage)
          </button>
        )}
      </div>

      <div className="card">
        {protocolsQuery.isPending ? (
          <p className="meta">Wird geladen…</p>
        ) : list.length === 0 ? (
          <p className="meta">Keine Protokolle in dieser Ansicht.</p>
        ) : (
          list.map((p) => (
            <div className="list-item" key={p.id}>
              <div className="avatar">{tab === 'archiv' ? '🗄' : '📄'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{p.title}</b>
                <div className="meta">
                  {fdate(p.proto_date)}
                  {p.time_from && ` · ${ftime(p.time_from)}–${ftime(p.time_to) ?? '?'} Uhr`}
                  {p.location && ` · ${p.location}`}
                  {' · '}
                  {p.members ? `${p.members.first_name} ${p.members.last_name}` : '–'}
                </div>
                <div style={{ marginTop: 3 }}>
                  <span className="pill grey">{p.proto_type}</span>{' '}
                  <span className={`pill ${p.visibility === 'alle' ? 'green' : 'amber'}`}>
                    {p.visibility === 'alle' ? '👥 alle Mitglieder' : '🔒 nur Vorstand'}
                  </span>
                </div>
              </div>
              <button className="btn ghost small" onClick={() => setSearchParams({ id: p.id })}>
                Lesen
              </button>
            </div>
          ))
        )}

        {!isVorstand && (
          <p className="meta" style={{ marginTop: 10 }}>
            🔒 Protokolle mit Sichtbarkeit „nur Vorstand" werden dir nicht angezeigt.
          </p>
        )}
      </div>
    </>
  )
}

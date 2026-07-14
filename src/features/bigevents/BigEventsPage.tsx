import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { fdate, ftime, fullName, monthShort, today } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import { eventTasksKey, fetchEventTasks } from '@/features/tasks/api'
import { costCentersKey, fetchCostCenters } from '@/features/kassa/api'
import type { BigEvent, BigEventInput, DeptAssignment, Task } from '@/types'
import {
  assignmentsKey,
  bigEventsFullKey,
  closeBigEvent,
  createAssignment,
  createBigEvent,
  createDepartment,
  createSub,
  deleteAssignment,
  deleteDepartment,
  deleteSub,
  deptsKey,
  fetchAssignments,
  fetchBigEvents,
  fetchDepartments,
  fetchSubs,
  reopenBigEvent,
  subsKey,
  updateAssignmentNote,
  type AssignmentInput,
} from './api'
import {
  BigEventDialog,
  CloseDialog,
  DepartmentDialog,
  NoteDialog,
  PersonDialog,
  SubDialog,
} from './dialogs'

const icon = (ev: BigEvent) =>
  ev.status === 'archiviert' ? '🗄' : ev.kind === 'Event' ? '🎪' : '🏗️'

/** Person in einer Abteilung – Mitglied mit Avatar, Externe abgesetzt in Beige. */
function PersonChip({ a }: { a: DeptAssignment }) {
  const isExternal = a.member_id === null
  const name = a.members
    ? `${a.members.first_name} ${a.members.last_name}`
    : (a.external_name ?? '?')

  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <span
      className="row"
      style={{
        gap: 6,
        background: isExternal ? '#F3EFE6' : '#F1F4EF',
        borderRadius: 999,
        padding: '3px 10px 3px 4px',
        fontSize: 13,
        flexWrap: 'nowrap',
      }}
    >
      {a.members && a.member_id ? (
        <Avatar member={a.members} size={22} />
      ) : (
        <div
          className="avatar"
          style={{ width: 22, height: 22, fontSize: 10, background: '#E8E2D2', color: '#8A7A4E' }}
        >
          {initials}
        </div>
      )}
      {name}
      {isExternal && (
        <span className="pill grey" style={{ fontSize: 10.5 }}>
          extern
        </span>
      )}
    </span>
  )
}

export function BigEventsPage() {
  const { tenant, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const tenantId = tenant?.id ?? ''
  const mayEdit = can('event.create')
  const mayCreateTasks = can('tasks.create')
  const mayViewKassa = can('kassa.view')

  // Das offene Event steht in der URL – so funktioniert der "Details"-Link
  // vom Dashboard und der Zurück-Button des Browsers.
  const openId = searchParams.get('id')
  const [tab, setTab] = useState<'aktiv' | 'archiv'>('aktiv')

  const [dialog, setDialog] = useState<
    | { kind: 'event' }
    | { kind: 'sub' }
    | { kind: 'dept' }
    | { kind: 'person'; deptId: string; deptName: string }
    | { kind: 'note'; id: string; current: string; name: string }
    | { kind: 'close' }
    | null
  >(null)

  const eventsQuery = useQuery({
    queryKey: bigEventsFullKey(tenantId),
    queryFn: () => fetchBigEvents(tenantId),
    enabled: Boolean(tenantId),
  })

  const events = eventsQuery.data ?? []
  const current = openId ? events.find((e) => e.id === openId) : undefined

  const subsQuery = useQuery({
    queryKey: subsKey(openId ?? ''),
    queryFn: () => fetchSubs(openId!),
    enabled: Boolean(openId),
  })

  const deptsQuery = useQuery({
    queryKey: deptsKey(openId ?? ''),
    queryFn: () => fetchDepartments(openId!),
    enabled: Boolean(openId),
  })

  const departments = useMemo(() => deptsQuery.data ?? [], [deptsQuery.data])

  const assignmentsQuery = useQuery({
    queryKey: assignmentsKey(openId ?? ''),
    queryFn: () => fetchAssignments(departments.map((d) => d.id)),
    enabled: Boolean(openId) && departments.length > 0,
  })

  const eventTasksQuery = useQuery({
    queryKey: eventTasksKey(openId ?? ''),
    queryFn: () => fetchEventTasks(tenantId, openId!),
    enabled: Boolean(openId && tenantId),
  })

  const { data: members = [] } = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  const { data: costCenters = [] } = useQuery({
    queryKey: costCentersKey(tenantId),
    queryFn: () => fetchCostCenters(tenantId),
    enabled: Boolean(tenantId) && mayViewKassa,
  })

  // ---------------------------------------------------------------
  // Mutationen
  // ---------------------------------------------------------------
  const invalidateEvent = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: bigEventsFullKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: subsKey(openId ?? '') }),
      queryClient.invalidateQueries({ queryKey: deptsKey(openId ?? '') }),
      queryClient.invalidateQueries({ queryKey: assignmentsKey(openId ?? '') }),
    ])
  }

  const fail = (e: Error) => toastError(e.message)

  const createEventM = useMutation({
    mutationFn: (input: BigEventInput) => createBigEvent(tenantId, input),
    onSuccess: async (_d, vars) => {
      await queryClient.invalidateQueries({ queryKey: bigEventsFullKey(tenantId) })
      setDialog(null)
      setTab('aktiv')
      toast(`${vars.kind} angelegt – jetzt Abteilungen und Subtermine ergänzen`)
    },
    onError: fail,
  })

  const subM = useMutation({
    mutationFn: (sub: { title: string; sub_date: string; sub_time: string | null }) =>
      createSub(openId!, sub),
    onSuccess: async () => {
      await invalidateEvent()
      setDialog(null)
      toast('Subtermin angelegt')
    },
    onError: fail,
  })

  const delSubM = useMutation({
    mutationFn: (id: string) => deleteSub(id),
    onSuccess: async () => {
      await invalidateEvent()
      toast('Subtermin entfernt')
    },
    onError: fail,
  })

  const deptM = useMutation({
    mutationFn: (name: string) => createDepartment(openId!, name),
    onSuccess: async () => {
      await invalidateEvent()
      setDialog(null)
      toast('Abteilung angelegt')
    },
    onError: fail,
  })

  const delDeptM = useMutation({
    mutationFn: (id: string) => deleteDepartment(id),
    onSuccess: async () => {
      await invalidateEvent()
      toast('Abteilung entfernt')
    },
    onError: fail,
  })

  const personM = useMutation({
    mutationFn: (input: AssignmentInput) => createAssignment(input),
    onSuccess: async (_d, vars) => {
      await invalidateEvent()
      setDialog(null)
      toast(
        vars.member_id
          ? 'Mitglied eingeteilt – erscheint am Dashboard'
          : 'Externe/r Helfer/in eingeteilt',
      )
    },
    onError: fail,
  })

  const noteM = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => updateAssignmentNote(id, note),
    onSuccess: async () => {
      await invalidateEvent()
      setDialog(null)
      toast('Vermerk gespeichert')
    },
    onError: fail,
  })

  const delPersonM = useMutation({
    mutationFn: (id: string) => deleteAssignment(id),
    onSuccess: async () => {
      await invalidateEvent()
      toast('Entfernt')
    },
    onError: fail,
  })

  const closeM = useMutation({
    mutationFn: (report: string) => closeBigEvent(openId!, report),
    onSuccess: async () => {
      await invalidateEvent()
      setDialog(null)
      setTab('archiv')
      setSearchParams({}, { replace: true })
      toast('Abgeschlossen & archiviert')
    },
    onError: fail,
  })

  const reopenM = useMutation({
    mutationFn: (id: string) => reopenBigEvent(id),
    onSuccess: async () => {
      await invalidateEvent()
      setTab('aktiv')
      toast('Wieder aktiviert')
    },
    onError: fail,
  })

  if (eventsQuery.error) {
    return (
      <>
        <h2 className="view-title">Events &amp; Projekte</h2>
        <div className="error-box">
          Konnte nicht geladen werden: {eventsQuery.error.message}
        </div>
      </>
    )
  }

  // ===============================================================
  // Detailansicht
  // ===============================================================
  if (openId && current) {
    const ev = current
    const editable = mayEdit && ev.status !== 'archiviert'
    const subs = subsQuery.data ?? []
    const assignments = assignmentsQuery.data ?? []
    const tasks = eventTasksQuery.data ?? []
    const iso = today()

    const cc = costCenters.find((c) => c.id === ev.cost_center_id)
    const openTasks = tasks.filter((t) => !t.done).length

    const byDept = (deptId: string) => assignments.filter((a) => a.department_id === deptId)

    const sortedTasks = [...tasks].sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
    )

    const taskRow = (t: Task) => {
      const assignee = members.find((m) => m.id === t.assignee_id)
      const creator = members.find((m) => m.id === t.created_by)
      const overdue = !t.done && t.due_date !== null && t.due_date < iso

      return (
        <div className="list-item" key={t.id}>
          {assignee ? <Avatar member={assignee} size={30} /> : <div className="avatar">?</div>}
          <div style={{ flex: 1 }} className={t.done ? 'task-done' : ''}>
            <b>{t.title}</b>
            <div className="meta">
              {assignee ? fullName(assignee) : '–'} ·{' '}
              {t.due_date ? `fällig ${fdate(t.due_date)}` : 'ohne Fälligkeit'}
              {overdue && (
                <span className="pill red" style={{ marginLeft: 6 }}>
                  überfällig
                </span>
              )}{' '}
              · erstellt von {creator ? fullName(creator) : '–'}
            </div>
          </div>
          {t.done ? (
            <span className="pill green">✓ {t.done_at ? fdate(t.done_at) : 'erledigt'}</span>
          ) : (
            <span className="pill amber">offen</span>
          )}
        </div>
      )
    }

    return (
      <>
        <button
          className="btn ghost small"
          style={{ marginBottom: 14 }}
          onClick={() => setSearchParams({}, { replace: true })}
        >
          ← Zurück zur Übersicht
        </button>

        <div className="row" style={{ marginBottom: 4 }}>
          <h2 className="view-title" style={{ margin: 0 }}>
            {icon(ev)} {ev.name}
          </h2>
          <div className="spacer" />
          {mayEdit &&
            (ev.status === 'archiviert' ? (
              <button
                className="btn ghost small"
                disabled={reopenM.isPending}
                onClick={() => reopenM.mutate(ev.id)}
              >
                ↩ Wieder aktivieren
              </button>
            ) : (
              <button className="btn small amber" onClick={() => setDialog({ kind: 'close' })}>
                ✔ Abschließen / Nachbericht
              </button>
            ))}
        </div>

        <p className="view-sub">
          {fdate(ev.date_from)} – {fdate(ev.date_to)} ·{' '}
          <span className={`pill ${ev.kind === 'Event' ? 'green' : 'amber'}`}>{ev.kind}</span>
          {ev.status === 'archiviert' && (
            <span className="pill grey" style={{ marginLeft: 6 }}>
              abgeschlossen{ev.closed_at && ` am ${fdate(ev.closed_at)}`}
            </span>
          )}
        </p>

        {ev.status === 'archiviert' && (
          <div
            className="card"
            style={{
              borderColor: 'var(--amber)',
              background: 'linear-gradient(180deg,#FFFDF6,#fff)',
            }}
          >
            <h3>📝 Nachbericht</h3>
            <p style={{ fontSize: 14.5, whiteSpace: 'pre-line' }}>
              {ev.report || 'Kein Nachbericht hinterlegt.'}
            </p>
          </div>
        )}

        <div className="card">
          <h3>ℹ️ Information</h3>
          <p style={{ fontSize: 14.5, whiteSpace: 'pre-line' }}>
            {ev.description || 'Keine Beschreibung hinterlegt.'}
          </p>
          {cc && mayViewKassa && (
            <button
              className="btn ghost small"
              style={{ marginTop: 10 }}
              onClick={() => navigate(`/kassa?cc=${cc.id}`)}
            >
              💶 Zur Nachkalkulation (Kostenstelle „{cc.name}")
            </button>
          )}
        </div>

        <div className="grid2">
          <div className="card">
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>📅 Subtermine</h3>
              <div className="spacer" />
              {editable && (
                <button className="btn ghost small" onClick={() => setDialog({ kind: 'sub' })}>
                  + Subtermin
                </button>
              )}
            </div>

            {subs.length === 0 ? (
              <p className="meta">Keine Subtermine.</p>
            ) : (
              subs.map((s) => (
                <div className="list-item" key={s.id}>
                  <div className="date-chip">
                    <div className="d">{s.sub_date.slice(8)}</div>
                    <div className="m">{monthShort(s.sub_date)}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <b>{s.title}</b>
                    <div className="meta">
                      {fdate(s.sub_date)}
                      {s.sub_time && ` · ${ftime(s.sub_time)} Uhr`}
                    </div>
                  </div>
                  {editable && (
                    <button
                      className="btn ghost small"
                      title="Subtermin entfernen"
                      onClick={() => delSubM.mutate(s.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16 }}>
                👷 Abteilungen &amp; Einteilung
              </h3>
              <div className="spacer" />
              {editable && (
                <button className="btn ghost small" onClick={() => setDialog({ kind: 'dept' })}>
                  + Abteilung
                </button>
              )}
            </div>

            {departments.length === 0 ? (
              <div className="card">
                <p className="meta">Noch keine Abteilungen angelegt.</p>
              </div>
            ) : (
              departments.map((d) => {
                const people = byDept(d.id)
                const leads = people.filter((p) => p.role === 'lead')
                const crew = people.filter((p) => p.role === 'crew')

                return (
                  <div className="card" key={d.id} style={{ padding: 14 }}>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <b style={{ fontFamily: 'var(--font-display)' }}>{d.name}</b>
                      <div className="spacer" />
                      {editable && (
                        <>
                          <button
                            className="btn ghost small"
                            onClick={() =>
                              setDialog({ kind: 'person', deptId: d.id, deptName: d.name })
                            }
                          >
                            + Person
                          </button>
                          <button
                            className="btn ghost small"
                            title="Abteilung entfernen"
                            onClick={() => delDeptM.mutate(d.id)}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>

                    {people.length === 0 && (
                      <p className="meta">Noch niemand eingeteilt.</p>
                    )}

                    {[...leads, ...crew].map((a) => (
                      <div className="list-item" key={a.id} style={{ padding: '6px 0' }}>
                        <PersonChip a={a} />
                        <div style={{ flex: 1 }}>
                          {a.role === 'lead' && <span className="pill amber">Leitung</span>}
                          {a.note && (
                            <div className="meta" style={{ marginTop: 2 }}>
                              📝 {a.note}
                            </div>
                          )}
                        </div>
                        {editable && (
                          <>
                            <button
                              className="btn ghost small"
                              title="Vermerk bearbeiten"
                              onClick={() =>
                                setDialog({
                                  kind: 'note',
                                  id: a.id,
                                  current: a.note ?? '',
                                  name: a.members
                                    ? `${a.members.first_name} ${a.members.last_name}`
                                    : (a.external_name ?? ''),
                                })
                              }
                            >
                              ✎
                            </button>
                            <button
                              className="btn ghost small"
                              title="Aus Abteilung entfernen"
                              onClick={() => delPersonM.mutate(a.id)}
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })
            )}

            <p className="meta">
              Leitung und Team können Vereinsmitglieder <b>oder externe Helfer</b> sein – Externe
              sind mit „extern" gekennzeichnet. Eingeteilte Mitglieder sehen ihren Einsatz am
              Dashboard.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>✅ Aufgaben zu diesem {ev.kind}</h3>
            <div className="spacer" />
            {mayCreateTasks && ev.status !== 'archiviert' && (
              <button className="btn small" onClick={() => navigate('/aufgaben')}>
                + Aufgabe erfassen
              </button>
            )}
          </div>

          {sortedTasks.length === 0 ? (
            <p className="meta">Noch keine Aufgaben zu diesem {ev.kind}.</p>
          ) : (
            sortedTasks.map(taskRow)
          )}

          <p className="meta" style={{ marginTop: 8 }}>
            Sichtbar für alle Mitglieder · Erfassen und Zuteilen je nach Rolle (unter „Aufgaben",
            Zuordnung „{ev.name}").
          </p>
        </div>

        {dialog?.kind === 'sub' && (
          <SubDialog
            defaultDate={ev.date_from ?? today()}
            saving={subM.isPending}
            onSave={(sub) => subM.mutate(sub)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'dept' && (
          <DepartmentDialog
            saving={deptM.isPending}
            onSave={(name) => deptM.mutate(name)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'person' && (
          <PersonDialog
            departmentId={dialog.deptId}
            departmentName={dialog.deptName}
            members={members}
            saving={personM.isPending}
            onSave={(input) => personM.mutate(input)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'note' && (
          <NoteDialog
            title={`Vermerk für ${dialog.name}`}
            current={dialog.current}
            saving={noteM.isPending}
            onSave={(note) => noteM.mutate({ id: dialog.id, note })}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'close' && (
          <CloseDialog
            kind={ev.kind}
            current={ev.report ?? ''}
            openTasks={openTasks}
            saving={closeM.isPending}
            onSave={(report) => closeM.mutate(report)}
            onClose={() => setDialog(null)}
          />
        )}
      </>
    )
  }

  // ===============================================================
  // Übersicht
  // ===============================================================
  const active = events.filter((e) => e.status !== 'archiviert')
  const archived = events.filter((e) => e.status === 'archiviert')
  const list = tab === 'aktiv' ? active : archived

  return (
    <>
      <h2 className="view-title">Events &amp; Projekte</h2>
      <p className="view-sub">
        Mehrtägige Feste und laufende Projekte – mit Abteilungen, Verantwortlichen und
        Helferplanung
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">
          <button className={tab === 'aktiv' ? 'on' : ''} onClick={() => setTab('aktiv')}>
            Aktiv ({active.length})
          </button>
          <button className={tab === 'archiv' ? 'on' : ''} onClick={() => setTab('archiv')}>
            🗄 Archiv ({archived.length})
          </button>
        </div>
        <div className="spacer" />
        {mayEdit && (
          <button className="btn small" onClick={() => setDialog({ kind: 'event' })}>
            + Event / Projekt anlegen
          </button>
        )}
      </div>

      {eventsQuery.isPending ? (
        <p className="meta">Wird geladen…</p>
      ) : list.length === 0 ? (
        <p className="meta">Keine {tab === 'aktiv' ? 'aktiven' : 'archivierten'} Einträge.</p>
      ) : (
        list.map((ev) => (
          <div className="card" key={ev.id}>
            <div className="list-item" style={{ border: 'none', padding: 0 }}>
              <div className="avatar" style={{ fontSize: 18 }}>
                {icon(ev)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{ev.name}</b>{' '}
                <span className={`pill ${ev.kind === 'Event' ? 'green' : 'amber'}`}>
                  {ev.kind}
                </span>
                {ev.status === 'archiviert' && (
                  <span className="pill grey" style={{ marginLeft: 6 }}>
                    abgeschlossen {ev.closed_at ? fdate(ev.closed_at) : ''}
                  </span>
                )}
                <div className="meta">
                  {fdate(ev.date_from)} – {fdate(ev.date_to)}
                </div>
                {ev.status === 'archiviert' && ev.report && (
                  <div className="meta" style={{ marginTop: 3 }}>
                    📝 {ev.report.slice(0, 110)}
                    {ev.report.length > 110 && '…'}
                  </div>
                )}
              </div>
              <button
                className="btn ghost small"
                onClick={() => setSearchParams({ id: ev.id })}
              >
                Öffnen
              </button>
            </div>
          </div>
        ))
      )}

      {dialog?.kind === 'event' && (
        <BigEventDialog
          saving={createEventM.isPending}
          onSave={(input) => createEventM.mutate(input)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { daysSince, fdate, fullName, today } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import { fetchProtocols, protocolsKey } from '@/features/protokolle/api'
import type { Task, TaskInput, TaskSource } from '@/types'
import {
  bigEventsKey,
  createTask,
  fetchBigEvents,
  fetchTasks,
  myTasksKey,
  tasksKey,
} from './api'

type Tab = 'offen' | 'erledigt'

const GENERAL = 'Allgemeine Aufgabe'

export function TasksPage() {
  const { tenant, member: me, can, hasModule } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const mayCreate = can('tasks.create')
  const hasEvents = hasModule('events')

  const [tab, setTab] = useState<Tab>('offen')
  const [fSource, setFSource] = useState('')
  const [fWho, setFWho] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  const [naTitle, setNaTitle] = useState('')
  const [naWho, setNaWho] = useState('')
  const [naSource, setNaSource] = useState('')
  const [naDue, setNaDue] = useState('')

  const tasksQuery = useQuery({
    queryKey: tasksKey(tenantId),
    queryFn: () => fetchTasks(tenantId),
    enabled: Boolean(tenantId),
  })

  const membersQuery = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  // Zuordnung zu Events/Projekten nur, wenn das Modul gebucht ist.
  const bigEventsQuery = useQuery({
    queryKey: bigEventsKey(tenantId),
    queryFn: () => fetchBigEvents(tenantId),
    enabled: Boolean(tenantId) && hasEvents,
  })

  // Für Aufgaben aus Sitzungen: Zuordnung ist der Protokolltitel.
  const protocolsQuery = useQuery({
    queryKey: protocolsKey(tenantId),
    queryFn: () => fetchProtocols(tenantId),
    enabled: Boolean(tenantId),
  })

  const createMutation = useMutation({
    mutationFn: (input: TaskInput) => createTask(tenantId, me?.id ?? null, input),
    onSuccess: async (_d, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tasksKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: myTasksKey(vars.assignee_id) }),
      ])
      setNaTitle('')
      setNaDue('')
      toast('Aufgabe zugeteilt')
    },
    onError: (e: Error) => toastError(`Nicht zugeteilt: ${e.message}`),
  })

  const members = membersQuery.data ?? []
  const activeMembers = members.filter((m) => m.status === 'aktiv')
  const bigEvents = bigEventsQuery.data ?? []
  const tasks = tasksQuery.data ?? []
  const iso = today()

  const protocols = protocolsQuery.data ?? []

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const bigEventById = useMemo(() => new Map(bigEvents.map((e) => [e.id, e])), [bigEvents])
  const protocolById = useMemo(() => new Map(protocols.map((p) => [p.id, p])), [protocols])

  /**
   * Anzeigename der Zuordnung: Event-Name, Protokolltitel – sonst
   * "Allgemeine Aufgabe". Ein Protokoll "nur Vorstand" liefert RLS an
   * normale Mitglieder gar nicht aus; dann bleibt es beim neutralen
   * "Sitzung", statt den Titel zu erraten.
   */
  const sourceLabel = (t: Task): string => {
    if (t.source_type === 'big_event' && t.source_id) {
      return bigEventById.get(t.source_id)?.name ?? 'Event'
    }
    if (t.source_type === 'protocol' && t.source_id) {
      return protocolById.get(t.source_id)?.title ?? 'Sitzung'
    }
    return GENERAL
  }

  const sourceOptions = useMemo(() => {
    const set = new Set(tasks.map(sourceLabel))
    return [...set].sort((a, b) => a.localeCompare(b, 'de'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, bigEventById, protocolById])

  const filtered = useMemo(() => {
    const matches = (t: Task) =>
      (!fSource || sourceLabel(t) === fSource) &&
      (!fWho || t.assignee_id === fWho) &&
      (!fFrom || (t.due_date !== null && t.due_date >= fFrom)) &&
      (!fTo || (t.due_date !== null && t.due_date <= fTo))

    const open = tasks
      .filter((t) => !t.done && matches(t))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    const done = tasks
      .filter((t) => t.done && matches(t))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))

    return { open, done }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, fSource, fWho, fFrom, fTo, bigEventById, protocolById])

  const list = tab === 'offen' ? filtered.open : filtered.done
  const openCount = tasks.filter((t) => !t.done).length
  const doneCount = tasks.filter((t) => t.done).length
  const overdueCount = filtered.open.filter(
    (t) => t.due_date !== null && t.due_date < iso,
  ).length

  const hasFilter = Boolean(fSource || fWho || fFrom || fTo)
  const resetFilters = () => {
    setFSource('')
    setFWho('')
    setFFrom('')
    setFTo('')
  }

  const submitNew = () => {
    const title = naTitle.trim()
    if (!title) {
      toastError('Bitte eine Aufgabe eingeben')
      return
    }
    const assignee = naWho || activeMembers[0]?.id
    if (!assignee) {
      toastError('Keine aktiven Mitglieder zum Zuteilen')
      return
    }

    const isEvent = naSource !== '' && naSource !== GENERAL
    const source_type: TaskSource = isEvent ? 'big_event' : 'manual'

    createMutation.mutate({
      title,
      assignee_id: assignee,
      due_date: naDue || null,
      source_type,
      source_id: isEvent ? naSource : null,
    })
  }

  if (tasksQuery.error) {
    return (
      <>
        <h2 className="view-title">Aufgabenübersicht</h2>
        <div className="error-box">
          Aufgaben konnten nicht geladen werden: {tasksQuery.error.message}
        </div>
      </>
    )
  }

  const statusCell = (t: Task) => {
    if (tab === 'erledigt') {
      return (
        <span className="pill green mono">✓ {t.done_at ? fdate(t.done_at) : '–'}</span>
      )
    }
    if (!t.due_date) return <span className="pill grey">ohne Fälligkeit</span>
    if (t.due_date < iso) {
      return <span className="pill red">überfällig ({daysSince(t.due_date)} Tage)</span>
    }
    // "diese Woche" = innerhalb der nächsten 7 Tage
    const inAWeek = new Date()
    inAWeek.setDate(inAWeek.getDate() + 7)
    if (t.due_date <= inAWeek.toISOString().slice(0, 10)) {
      return <span className="pill amber">diese Woche</span>
    }
    return <span className="pill grey">geplant</span>
  }

  return (
    <>
      <h2 className="view-title">Aufgabenübersicht</h2>
      <p className="view-sub">
        Alle verteilten Aufgaben aus Sitzungen, Events und Projekten · chronologisch nach
        Fälligkeit
      </p>

      {mayCreate && (
        <div className="card">
          <h3>➕ Neue Aufgabe erfassen</h3>
          <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div>
              <label htmlFor="na-text">Aufgabe</label>
              <input
                id="na-text"
                placeholder="z. B. Bierbank-Transport organisieren"
                value={naTitle}
                onChange={(e) => setNaTitle(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="na-who">Zuständig</label>
              <select id="na-who" value={naWho} onChange={(e) => setNaWho(e.target.value)}>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {fullName(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="na-src">Zuordnung</label>
              <select
                id="na-src"
                value={naSource}
                onChange={(e) => setNaSource(e.target.value)}
                disabled={!hasEvents}
                title={hasEvents ? undefined : 'Modul „Events & Projekte" ist nicht gebucht'}
              >
                <option value="">{GENERAL}</option>
                {bigEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="na-due">Fällig bis (optional)</label>
              <input
                id="na-due"
                type="date"
                value={naDue}
                onChange={(e) => setNaDue(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn small"
            style={{ marginTop: 4 }}
            disabled={createMutation.isPending}
            onClick={submitNew}
          >
            {createMutation.isPending ? 'Wird zugeteilt…' : 'Aufgabe zuteilen'}
          </button>
          <p className="meta" style={{ marginTop: 8 }}>
            Die Aufgabe erscheint sofort am Dashboard der zugeteilten Person.
          </p>
        </div>
      )}

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">
          <button className={tab === 'offen' ? 'on' : ''} onClick={() => setTab('offen')}>
            Offen ({openCount}
            {overdueCount > 0 && ` · ${overdueCount} überfällig`})
          </button>
          <button className={tab === 'erledigt' ? 'on' : ''} onClick={() => setTab('erledigt')}>
            ✓ Erledigt ({doneCount})
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div>
            <label htmlFor="f-src">Event / Quelle</label>
            <select id="f-src" value={fSource} onChange={(e) => setFSource(e.target.value)}>
              <option value="">Alle</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-who">Person</label>
            <select id="f-who" value={fWho} onChange={(e) => setFWho(e.target.value)}>
              <option value="">Alle</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {fullName(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-from">Fällig von</label>
            <input
              id="f-from"
              type="date"
              value={fFrom}
              onChange={(e) => setFFrom(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="f-to">Fällig bis</label>
            <input id="f-to" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </div>
        </div>
        {hasFilter && (
          <button className="btn ghost small" style={{ marginTop: 10 }} onClick={resetFilters}>
            ✕ Filter zurücksetzen
          </button>
        )}
      </div>

      <div className="card">
        {tasksQuery.isPending ? (
          <p className="meta">Wird geladen…</p>
        ) : list.length === 0 ? (
          <p className="meta">
            Keine {tab === 'offen' ? 'offenen' : 'erledigten'} Aufgaben für diese Filter.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fällig</th>
                  <th>Aufgabe</th>
                  <th>Person</th>
                  <th>Zuordnung</th>
                  <th>{tab === 'offen' ? 'Status' : 'Erledigt am'}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const assignee = t.assignee_id ? memberById.get(t.assignee_id) : undefined
                  const creator = t.created_by ? memberById.get(t.created_by) : undefined

                  return (
                    <tr key={t.id}>
                      <td className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                        {t.due_date ? fdate(t.due_date) : '–'}
                      </td>
                      <td className={t.done ? 'task-done' : ''}>
                        <b>{t.title}</b>
                        <div className="meta">
                          erstellt von {creator ? fullName(creator) : '–'} am{' '}
                          {fdate(t.created_at.slice(0, 10))}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 7, flexWrap: 'nowrap' }}>
                          {assignee && <Avatar member={assignee} size={28} />}
                          <span>{assignee ? fullName(assignee) : '–'}</span>
                        </div>
                      </td>
                      <td>
                        <span className="pill grey">{sourceLabel(t)}</span>
                      </td>
                      <td>{statusCell(t)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="meta" style={{ marginTop: 10 }}>
          Abgehakt werden Aufgaben von der zugeteilten Person am eigenen Dashboard – hier behält
          der Vorstand den Gesamtüberblick.
        </p>
      </div>
    </>
  )
}

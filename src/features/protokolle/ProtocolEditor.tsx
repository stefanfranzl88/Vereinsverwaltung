import { useMemo, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { useAuth } from '@/auth/context'
import { fullName, today } from '@/lib/format'
import { attendanceTypes, pointValueFor, readMitarbeitConfig } from '@/features/mitarbeit/config'
import type {
  Member,
  ProtocolInput,
  ProtocolTaskInput,
  ProtocolType,
  ProtocolVisibility,
} from '@/types'

interface Props {
  members: Member[]
  saving: boolean
  onSave: (input: ProtocolInput) => void
  onCancel: () => void
}

export function ProtocolEditor({ members, saving, onSave, onCancel }: Props) {
  const { tenant } = useAuth()
  // Anwesenheitsarten samt Punktwerten kommen aus der Vereins-Konfiguration.
  const config = useMemo(() => readMitarbeitConfig(tenant?.settings), [tenant?.settings])
  const types = useMemo(() => attendanceTypes(config), [config])

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today())
  const [location, setLocation] = useState('Vereinsheim')
  const [timeFrom, setTimeFrom] = useState('19:30')
  const [timeTo, setTimeTo] = useState('')
  const [type, setType] = useState<ProtocolType>(types[0] ?? 'Sitzung')
  const [visibility, setVisibility] = useState<ProtocolVisibility>('alle')
  const [body, setBody] = useState('')

  const [attendees, setAttendees] = useState<Set<string>>(new Set())
  const [attFilter, setAttFilter] = useState('')
  const [tasks, setTasks] = useState<ProtocolTaskInput[]>([])

  const active = useMemo(() => members.filter((m) => m.status === 'aktiv'), [members])

  const shown = useMemo(() => {
    const q = attFilter.trim().toLowerCase()
    if (!q) return active
    return active.filter((m) => fullName(m).toLowerCase().includes(q))
  }, [active, attFilter])

  const toggleAttendee = (id: string) => {
    setAttendees((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addTaskRow = () =>
    setTasks((prev) => [
      ...prev,
      { title: '', assignee_id: active[0]?.id ?? '', due_date: '' },
    ])

  const setTask = (i: number, patch: Partial<ProtocolTaskInput>) =>
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))

  const removeTask = (i: number) => setTasks((prev) => prev.filter((_, idx) => idx !== i))

  const submit = () => {
    onSave({
      title: title.trim(),
      proto_date: date,
      time_from: timeFrom || null,
      time_to: timeTo || null,
      location: location.trim(),
      proto_type: type,
      visibility,
      body,
      attendees: [...attendees],
      // Leere Zeilen filtert auch die Datenbankfunktion – hier nur fürs Zählen.
      tasks: tasks.filter((t) => t.title.trim().length > 0),
    })
  }

  const filledTasks = tasks.filter((t) => t.title.trim().length > 0).length

  return (
    <>
      <button className="btn ghost small" style={{ marginBottom: 14 }} onClick={onCancel}>
        ← Abbrechen
      </button>

      <h2 className="view-title">Protokoll verfassen</h2>
      <p className="view-sub">Zum Mittippen während der Sitzung oder zum Nachtragen danach</p>

      <div className="card">
        <div className="form-grid">
          <div>
            <label htmlFor="p-title">Titel</label>
            <input
              id="p-title"
              required
              autoFocus
              placeholder="z. B. Vorstandssitzung Juli"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="p-date">Datum</label>
            <input
              id="p-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="p-loc">Ort</label>
            <input
              id="p-loc"
              placeholder="z. B. Vereinsheim"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="form-grid" style={{ gap: 8 }}>
            <div>
              <label htmlFor="p-from">Beginn</label>
              <input
                id="p-from"
                type="time"
                value={timeFrom}
                onChange={(e) => setTimeFrom(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="p-to">Ende</label>
              <input
                id="p-to"
                type="time"
                value={timeTo}
                onChange={(e) => setTimeTo(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="p-type">Art</label>
            <select id="p-type" value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t} ({pointValueFor(config, t)} P)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="p-vis">Sichtbarkeit</label>
            <select
              id="p-vis"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as ProtocolVisibility)}
            >
              <option value="alle">👥 Alle Mitglieder</option>
              <option value="vorstand">🔒 Nur Vorstand</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Anwesenheitsliste</h3>
          <span className="pill green">{attendees.size} ausgewählt</span>
          <div className="spacer" />
          <input
            className="search"
            style={{ minWidth: 170 }}
            placeholder="🔍 Mitglied suchen…"
            value={attFilter}
            onChange={(e) => setAttFilter(e.target.value)}
          />
        </div>

        <div
          style={{
            maxHeight: 220,
            overflowY: 'auto',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 6,
            background: '#FBFCFA',
          }}
        >
          {shown.length === 0 ? (
            <p className="meta" style={{ padding: 8 }}>
              Keine Treffer.
            </p>
          ) : (
            shown.map((m) => (
              <label
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={attendees.has(m.id)}
                  onChange={() => toggleAttendee(m.id)}
                  style={{ accentColor: 'var(--pine)' }}
                />
                <Avatar member={m} size={24} />
                {fullName(m)}
                {m.funktion && (
                  <span className="pill amber" style={{ fontSize: 10.5 }}>
                    {m.funktion}
                  </span>
                )}
              </label>
            ))
          )}
        </div>

        <p className="meta" style={{ marginTop: 8 }}>
          Tippen zum Filtern. ⭐ Anwesenheit zählt automatisch für die Mitarbeitspunkte (Sitzung
          1 P, Auf-/Abbau &amp; Veranstaltung 2 P).
        </p>
      </div>

      <div className="card">
        <h3>Inhalt / Tagesordnungspunkte</h3>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ width: '100%', minHeight: 180 }}
          placeholder={
            'TOP 1 – …\nTOP 2 – …\n\nBeschlüsse, Diskussionen, Allfälliges – einfach mittippen.'
          }
        />
      </div>

      <div className="card">
        <h3>Aufgabenverteilung</h3>

        {tasks.map((t, i) => (
          <div className="form-grid" key={i} style={{ marginBottom: 10 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Aufgabe</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  style={{ flex: 1 }}
                  placeholder="z. B. Getränke bestellen"
                  value={t.title}
                  onChange={(e) => setTask(i, { title: e.target.value })}
                />
                <button
                  className="btn ghost small"
                  type="button"
                  title="Zeile entfernen"
                  onClick={() => removeTask(i)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div>
              <label>Zuständig</label>
              <select
                value={t.assignee_id}
                onChange={(e) => setTask(i, { assignee_id: e.target.value })}
              >
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {fullName(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Fällig bis (optional)</label>
              <input
                type="date"
                value={t.due_date}
                onChange={(e) => setTask(i, { due_date: e.target.value })}
              />
            </div>
          </div>
        ))}

        <button className="btn ghost small" type="button" onClick={addTaskRow}>
          + Aufgabe hinzufügen
        </button>

        <p className="meta" style={{ marginTop: 8 }}>
          Zugeteilte Aufgaben erscheinen den Personen direkt am Dashboard.
        </p>
      </div>

      <button className="btn" disabled={saving || !title.trim()} onClick={submit}>
        {saving
          ? 'Wird gespeichert…'
          : `Protokoll speichern (${attendees.size} anwesend${
              filledTasks > 0 ? `, ${filledTasks} Aufgabe${filledTasks > 1 ? 'n' : ''}` : ''
            })`}
      </button>
    </>
  )
}

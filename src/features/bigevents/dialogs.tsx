import { useState, type FormEvent } from 'react'
import { fullName } from '@/lib/format'
import type { AssignmentRole, BigEventInput, BigEventKind, Member } from '@/types'
import type { AssignmentInput } from './api'

interface Shell {
  title: string
  saving: boolean
  onClose: () => void
  onSubmit: (e: FormEvent) => void
  disabled?: boolean
  submitLabel?: string
  children: React.ReactNode
}

function DialogShell({
  title,
  saving,
  onClose,
  onSubmit,
  disabled,
  submitLabel = 'Speichern',
  children,
}: Shell) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <form onSubmit={onSubmit}>
          <div className="head">
            <h3>{title}</h3>
          </div>
          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>{children}</div>
          </div>
          <div className="foot">
            <div className="row">
              <button className="btn ghost small" type="button" onClick={onClose}>
                Abbrechen
              </button>
              <div className="spacer" />
              <button className="btn" type="submit" disabled={saving || disabled}>
                {saving ? 'Speichern…' : submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Event / Projekt anlegen
// ---------------------------------------------------------------
export function BigEventDialog({
  saving,
  onSave,
  onClose,
}: {
  saving: boolean
  onSave: (input: BigEventInput) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<BigEventKind>('Event')
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [description, setDescription] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      kind,
      name: name.trim(),
      date_from: from || null,
      // Kein Enddatum angegeben: einteiliges Event → Ende = Beginn.
      date_to: to || from || null,
      description: description.trim() || null,
    })
  }

  return (
    <DialogShell
      title="🎪 Event / Projekt anlegen"
      saving={saving}
      onClose={onClose}
      onSubmit={submit}
      disabled={!name.trim()}
      submitLabel="Anlegen"
    >
      <div>
        <label htmlFor="be-kind">Art</label>
        <select
          id="be-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as BigEventKind)}
        >
          <option value="Event">🎪 Event (Fest, Veranstaltung)</option>
          <option value="Projekt">🏗️ Projekt (längerfristig)</option>
        </select>
      </div>

      <div>
        <label htmlFor="be-name">Name</label>
        <input
          id="be-name"
          required
          autoFocus
          placeholder="z. B. Jahreskirchtag 2027"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="form-grid">
        <div>
          <label htmlFor="be-from">Beginn</label>
          <input
            id="be-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="be-to">Ende</label>
          <input id="be-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div>
        <label htmlFor="be-desc">Kurzbeschreibung</label>
        <textarea
          id="be-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Subtermin
// ---------------------------------------------------------------
export function SubDialog({
  defaultDate,
  saving,
  onSave,
  onClose,
}: {
  defaultDate: string
  saving: boolean
  onSave: (sub: { title: string; sub_date: string; sub_time: string | null }) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('16:00')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({ title: title.trim(), sub_date: date, sub_time: time || null })
  }

  return (
    <DialogShell
      title="📅 Subtermin anlegen"
      saving={saving}
      onClose={onClose}
      onSubmit={submit}
      disabled={!title.trim() || !date}
      submitLabel="Anlegen"
    >
      <div>
        <label htmlFor="sub-title">Titel</label>
        <input
          id="sub-title"
          required
          autoFocus
          placeholder="z. B. Aufbau Tag 1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="form-grid">
        <div>
          <label htmlFor="sub-date">Datum</label>
          <input
            id="sub-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="sub-time">Uhrzeit</label>
          <input
            id="sub-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Abteilung
// ---------------------------------------------------------------
export function DepartmentDialog({
  saving,
  onSave,
  onClose,
}: {
  saving: boolean
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')

  return (
    <DialogShell
      title="👷 Abteilung anlegen"
      saving={saving}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(name.trim())
      }}
      disabled={!name.trim()}
      submitLabel="Anlegen"
    >
      <div>
        <label htmlFor="dept-name">Name</label>
        <input
          id="dept-name"
          required
          autoFocus
          placeholder="z. B. Bierbude"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="hint">Leitung und Team teilst du danach in der Abteilung ein.</p>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Person einteilen (Mitglied oder externe/r Helfer/in)
// ---------------------------------------------------------------
export function PersonDialog({
  departmentId,
  departmentName,
  members,
  saving,
  onSave,
  onClose,
}: {
  departmentId: string
  departmentName: string
  members: Member[]
  saving: boolean
  onSave: (input: AssignmentInput) => void
  onClose: () => void
}) {
  const [isExternal, setIsExternal] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [externalName, setExternalName] = useState('')
  const [role, setRole] = useState<AssignmentRole>('crew')
  const [note, setNote] = useState('')

  const active = members.filter((m) => m.status === 'aktiv')
  const valid = isExternal ? externalName.trim().length > 0 : memberId.length > 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Das Schema erzwingt per CHECK genau eines von beidem.
    onSave({
      department_id: departmentId,
      member_id: isExternal ? null : memberId,
      external_name: isExternal ? externalName.trim() : null,
      role,
      note: note.trim() || null,
    })
  }

  return (
    <DialogShell
      title={`Person einteilen – ${departmentName}`}
      saving={saving}
      onClose={onClose}
      onSubmit={submit}
      disabled={!valid}
      submitLabel="Einteilen"
    >
      <div>
        <div className="seg" style={{ width: '100%' }}>
          <button
            type="button"
            className={!isExternal ? 'on' : ''}
            style={{ flex: 1 }}
            onClick={() => setIsExternal(false)}
          >
            Vereinsmitglied
          </button>
          <button
            type="button"
            className={isExternal ? 'on' : ''}
            style={{ flex: 1 }}
            onClick={() => setIsExternal(true)}
          >
            Externe/r Helfer/in
          </button>
        </div>
      </div>

      {isExternal ? (
        <div>
          <label htmlFor="pers-ext">Name</label>
          <input
            id="pers-ext"
            required
            autoFocus
            placeholder="z. B. Hans Wieser"
            value={externalName}
            onChange={(e) => setExternalName(e.target.value)}
          />
          <p className="hint">
            Externe sehen ihren Einsatz nicht in der App – sie haben keinen Zugang.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="pers-member">Mitglied</label>
          <select
            id="pers-member"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">– bitte wählen –</option>
            {active.map((m) => (
              <option key={m.id} value={m.id}>
                {fullName(m)}
              </option>
            ))}
          </select>
          <p className="hint">Eingeteilte Mitglieder sehen ihren Einsatz am Dashboard.</p>
        </div>
      )}

      <div>
        <label htmlFor="pers-role">Rolle</label>
        <select
          id="pers-role"
          value={role}
          onChange={(e) => setRole(e.target.value as AssignmentRole)}
        >
          <option value="crew">Team</option>
          <option value="lead">Leitung</option>
        </select>
      </div>

      <div>
        <label htmlFor="pers-note">Vermerk (optional)</label>
        <input
          id="pers-note"
          placeholder="z. B. Schicht ab 18 Uhr, bringt Kühlbox mit"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Einzeiliger Text (Vermerk bearbeiten)
// ---------------------------------------------------------------
export function NoteDialog({
  title,
  current,
  saving,
  onSave,
  onClose,
}: {
  title: string
  current: string
  saving: boolean
  onSave: (note: string) => void
  onClose: () => void
}) {
  const [note, setNote] = useState(current)

  return (
    <DialogShell
      title={title}
      saving={saving}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(note.trim())
      }}
    >
      <div>
        <label htmlFor="note-text">Vermerk</label>
        <input
          id="note-text"
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="hint">Leer lassen entfernt den Vermerk.</p>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Abschließen mit Nachbericht
// ---------------------------------------------------------------
export function CloseDialog({
  kind,
  current,
  openTasks,
  saving,
  onSave,
  onClose,
}: {
  kind: string
  current: string
  openTasks: number
  saving: boolean
  onSave: (report: string) => void
  onClose: () => void
}) {
  const [report, setReport] = useState(current)

  return (
    <DialogShell
      title={`✔ ${kind} abschließen`}
      saving={saving}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(report.trim())
      }}
      submitLabel="Abschließen & archivieren"
    >
      {openTasks > 0 && (
        <div className="notice">
          ⚠️ Achtung: Es {openTasks === 1 ? 'ist' : 'sind'} noch <b>{openTasks} Aufgabe
          {openTasks === 1 ? '' : 'n'}</b> zu diesem {kind} offen. Der Abschluss ist trotzdem
          möglich – die Aufgaben bleiben bestehen.
        </div>
      )}

      <div>
        <label htmlFor="close-report">Nachbericht / Notizen (optional)</label>
        <textarea
          id="close-report"
          autoFocus
          placeholder="Besucherzahlen, was gut lief, Lernpunkte fürs nächste Mal …"
          value={report}
          onChange={(e) => setReport(e.target.value)}
          style={{ minHeight: 130 }}
        />
      </div>
    </DialogShell>
  )
}

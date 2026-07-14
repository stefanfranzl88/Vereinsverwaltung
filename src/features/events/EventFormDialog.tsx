import { useState, type FormEvent } from 'react'
import type { EventInput } from '@/types'

interface Props {
  saving: boolean
  onSave: (input: EventInput) => void
  onClose: () => void
}

/** Im Prototyp zwei prompt()-Aufrufe – hier ein Formular mit allen Feldern der Tabelle. */
export function EventFormDialog({ saving, onSave, onClose }: Props) {
  const [form, setForm] = useState<EventInput>({
    title: '',
    event_date: new Date().toISOString().slice(0, 10),
    event_time: '19:00',
    location: '',
  })

  const set = <K extends keyof EventInput>(key: K, value: EventInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      ...form,
      title: form.title.trim(),
      location: form.location?.trim() || null,
      event_time: form.event_time || null,
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>📅 Termin anlegen</h3>
          </div>

          <div className="body">
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="ev-title">Titel</label>
                <input
                  id="ev-title"
                  required
                  autoFocus
                  placeholder="z. B. Monatssitzung"
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="ev-date">Datum</label>
                <input
                  id="ev-date"
                  type="date"
                  required
                  value={form.event_date}
                  onChange={(e) => set('event_date', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="ev-time">Uhrzeit</label>
                <input
                  id="ev-time"
                  type="time"
                  value={form.event_time ?? ''}
                  onChange={(e) => set('event_time', e.target.value)}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="ev-loc">Ort</label>
                <input
                  id="ev-loc"
                  placeholder="z. B. Vereinsheim"
                  value={form.location ?? ''}
                  onChange={(e) => set('location', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="foot">
            <div className="row">
              <button className="btn ghost small" type="button" onClick={onClose}>
                Abbrechen
              </button>
              <div className="spacer" />
              <button className="btn" type="submit" disabled={saving || !form.title.trim()}>
                {saving ? 'Speichern…' : 'Termin anlegen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

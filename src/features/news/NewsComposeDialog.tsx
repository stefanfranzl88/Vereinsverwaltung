import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { NewsInput } from './api'

interface Props {
  saving: boolean
  onSave: (input: NewsInput) => void
  onClose: () => void
}

const VISIBILITY = [
  { days: 7, label: '7 Tage' },
  { days: 14, label: '14 Tage' },
  { days: 30, label: '30 Tage' },
  { days: 0, label: 'Unbegrenzt' },
]

export function NewsComposeDialog({ saving, onSave, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [days, setDays] = useState(14)
  const [photo, setPhoto] = useState<File | null>(null)

  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    setPhoto(e.target.files?.[0] ?? null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({ title: title.trim(), body: body.trim(), days, photo })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>📢 Mitteilung veröffentlichen</h3>
          </div>

          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="nw-title">Titel</label>
                <input
                  id="nw-title"
                  required
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="nw-body">Text</label>
                <textarea id="nw-body" value={body} onChange={(e) => setBody(e.target.value)} />
              </div>

              <div>
                <label>Foto (optional)</label>
                <label
                  className={`upload-zone${photo ? ' hasfile' : ''}`}
                  style={{ display: 'block', cursor: 'pointer', padding: 12 }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={onPhoto}
                  />
                  {photo ? `✓ ${photo.name}` : '📷 Foto auswählen'}
                </label>
              </div>

              <div>
                <label htmlFor="nw-days">Sichtbar für</label>
                <select
                  id="nw-days"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {VISIBILITY.map((v) => (
                    <option key={v.days} value={v.days}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="foot">
            <div className="row">
              <button className="btn ghost small" type="button" onClick={onClose}>
                Abbrechen
              </button>
              <div className="spacer" />
              <button className="btn" type="submit" disabled={saving || !title.trim()}>
                {saving ? 'Wird veröffentlicht…' : 'Veröffentlichen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

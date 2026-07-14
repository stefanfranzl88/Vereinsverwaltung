import { useState, type FormEvent } from 'react'

interface Props {
  current: string
  saving: boolean
  onSave: (dekade: string) => void
  onClose: () => void
}

/**
 * Funktionsperiode des Vorstands (tenants.dekade), z.B. "2023 – 2028".
 * Im Prototyp ein prompt() – hier ein Dialog, damit Abbrechen und Validierung
 * sauber funktionieren.
 */
export function DekadeDialog({ current, saving, onSave, onClose }: Props) {
  const [value, setValue] = useState(current)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed) onSave(trimmed)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>Funktionsperiode</h3>
            <p className="meta" style={{ marginTop: 2 }}>
              Aktuelle Vorstandsperiode des Vereins
            </p>
          </div>

          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="dekade">Zeitraum</label>
                <input
                  id="dekade"
                  required
                  autoFocus
                  placeholder="2023 – 2028"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
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
              <button className="btn" type="submit" disabled={saving || !value.trim()}>
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

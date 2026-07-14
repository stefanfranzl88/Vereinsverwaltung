import { useState, type FormEvent } from 'react'
import type { CostCenterType } from '@/types'

const TYPES: CostCenterType[] = ['Event', 'Projekt', 'laufend']

interface Props {
  saving: boolean
  onSave: (name: string, ccType: CostCenterType) => void
  onClose: () => void
}

export function CostCenterDialog({ saving, onSave, onClose }: Props) {
  const [name, setName] = useState('')
  const [ccType, setCcType] = useState<CostCenterType>('Event')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) onSave(name.trim(), ccType)
  }

  // Reihen für den Jahresvergleich entstehen über den Namen: "Name JJJJ".
  const willGroup = /^(.*)\s(20\d\d)$/.test(name.trim())

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>🏷️ Kostenstelle anlegen</h3>
          </div>

          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="cc-name">Name</label>
                <input
                  id="cc-name"
                  required
                  autoFocus
                  placeholder="z. B. Adventmarkt 2026"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="hint">
                  {willGroup
                    ? '✓ Endet auf eine Jahreszahl – wird im Jahresvergleich automatisch mit gleichnamigen Kostenstellen anderer Jahre zusammengefasst.'
                    : 'Tipp: Mit Jahreszahl am Ende („Adventmarkt 2026") erscheint die Kostenstelle später im Jahresvergleich.'}
                </p>
              </div>

              <div>
                <label htmlFor="cc-type">Art</label>
                <select
                  id="cc-type"
                  value={ccType}
                  onChange={(e) => setCcType(e.target.value as CostCenterType)}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
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
              <button className="btn" type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Speichern…' : 'Anlegen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

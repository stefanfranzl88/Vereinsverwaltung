import { useState, type FormEvent } from 'react'
import { fullName } from '@/lib/format'
import type { Member } from '@/types'

interface Props {
  /** Mitglieder, die noch keinen Chip haben. */
  members: Member[]
  /** Vorschlag für die nächste Chip-Nummer. */
  suggestedNr: string
  saving: boolean
  onSave: (memberId: string, chipNr: string) => void
  onClose: () => void
}

export function ChipDialog({ members, suggestedNr, saving, onSave, onClose }: Props) {
  const [memberId, setMemberId] = useState('')
  const [chipNr, setChipNr] = useState(suggestedNr)

  const valid = memberId.length > 0 && chipNr.trim().length > 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave(memberId, chipNr.trim())
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>🔑 Chip zuweisen</h3>
          </div>

          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="chip-member">Mitglied</label>
                <select
                  id="chip-member"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                >
                  <option value="">– bitte wählen –</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {fullName(m)}
                      {m.funktion ? ` (${m.funktion})` : ''}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  Chips können auch an Mitglieder ohne Vorstandsfunktion vergeben werden.
                </p>
              </div>

              <div>
                <label htmlFor="chip-nr">Chip-Nummer</label>
                <input
                  id="chip-nr"
                  required
                  value={chipNr}
                  onChange={(e) => setChipNr(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
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
              <button className="btn" type="submit" disabled={saving || !valid}>
                {saving ? 'Speichern…' : 'Chip ausgeben'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

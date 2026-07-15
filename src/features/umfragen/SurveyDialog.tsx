import { useState, type FormEvent } from 'react'

interface Props {
  saving: boolean
  onSave: (question: string, options: string[]) => void
  onClose: () => void
}

export function SurveyDialog({ saving, onSave, onClose }: Props) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['Ja', 'Nein'])

  const setOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)))

  const addOption = () => setOptions((prev) => [...prev, ''])
  const removeOption = (i: number) => setOptions((prev) => prev.filter((_, idx) => idx !== i))

  const filled = options.filter((o) => o.trim().length > 0)
  // Dieselbe Regel prüft auch create_survey() in der Datenbank.
  const valid = question.trim().length > 0 && filled.length >= 2

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave(question.trim(), filled)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>📊 Umfrage erstellen</h3>
          </div>

          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="sv-q">Frage</label>
                <input
                  id="sv-q"
                  required
                  autoFocus
                  placeholder="z. B. Wann soll der Vereinsausflug stattfinden?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </div>

              <div>
                <label>Antwortoptionen</label>
                {options.map((o, i) => (
                  <div className="row" style={{ marginBottom: 6, flexWrap: 'nowrap' }} key={i}>
                    <input
                      style={{ flex: 1 }}
                      placeholder={`Option ${i + 1}`}
                      value={o}
                      onChange={(e) => setOption(i, e.target.value)}
                    />
                    <button
                      className="btn ghost small"
                      type="button"
                      title="Option entfernen"
                      disabled={options.length <= 2}
                      onClick={() => removeOption(i)}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button className="btn ghost small" type="button" onClick={addOption}>
                  + Option
                </button>

                <p className="hint">
                  Mindestens zwei Optionen. Jede Person hat eine Stimme – abgegebene Stimmen sind
                  endgültig und für niemanden einer Person zuordenbar.
                </p>
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
                {saving ? 'Wird erstellt…' : 'Erstellen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

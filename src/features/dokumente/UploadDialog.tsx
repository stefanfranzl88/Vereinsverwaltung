import { useState, type ChangeEvent, type FormEvent } from 'react'
import { DOC_CATEGORIES } from '@/types'
import type { DocumentInput } from './api'

interface Props {
  saving: boolean
  onSave: (input: DocumentInput) => void
  onClose: () => void
}

export function UploadDialog({ saving, onSave, onClose }: Props) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(DOC_CATEGORIES[0])
  const [file, setFile] = useState<File | null>(null)

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    // Bezeichnung aus dem Dateinamen vorbelegen, wenn noch leer – wie im Prototyp.
    if (f && !name.trim()) {
      setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
    }
  }

  const valid = name.trim().length > 0 && file !== null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (file) onSave({ name: name.trim(), category, file })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>⬆️ Dokument ablegen</h3>
          </div>

          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>
              <div>
                <label>Datei (PDF, Foto, Office)</label>
                <label
                  className={`upload-zone${file ? ' hasfile' : ''}`}
                  style={{ display: 'block', cursor: 'pointer', padding: 14 }}
                >
                  <input
                    type="file"
                    accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                    style={{ display: 'none' }}
                    onChange={onFile}
                  />
                  {file ? `✓ ${file.name}` : '📎 Datei auswählen'}
                </label>
              </div>

              <div>
                <label htmlFor="doc-name">Bezeichnung</label>
                <input
                  id="doc-name"
                  required
                  placeholder="z. B. Versicherungspolizze 2027"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="doc-cat">Kategorie</label>
                <select
                  id="doc-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {DOC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
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
              <button className="btn" type="submit" disabled={saving || !valid}>
                {saving ? 'Wird abgelegt…' : 'Ablegen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

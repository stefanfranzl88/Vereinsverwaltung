import { useState, type FormEvent } from 'react'
import type { Role } from '@/auth/roles'
import type { Member, MemberInput, MemberStatus } from '@/types'

/** Reihenfolge des Vorstands – bestimmt auch die Sortierung in der Liste. */
export const FUNK_ORDER = [
  'Obmann',
  'Obmann Stv.',
  'Schriftführer',
  'Schriftführer Stv.',
  'Kassier',
  'Kassier Stv.',
  'Ausschussmitglied',
] as const

const STATUS: MemberStatus[] = ['aktiv', 'ruhend', 'ausgetreten']

interface Props {
  member: Member | null
  saving: boolean
  /**
   * Rollen zur Auswahl – NUR gesetzt, wenn der Bearbeiter roles.manage hat.
   * Ohne diese Prop erscheint keine Rollenauswahl (das Mitglied bleibt bei
   * seiner bisherigen bzw. der Standardrolle). Durchgesetzt zusätzlich per RLS.
   */
  roles?: Role[]
  currentRoleKey?: string
  onSave: (input: MemberInput, roleKey: string | null) => void
  onClose: () => void
}

/**
 * Ersetzt die prompt()-Ketten des Prototyps durch ein echtes Formular –
 * inklusive der Felder, die das Schema kennt (Status, Eintritt, Kontakt).
 */
export function MemberFormDialog({
  member,
  saving,
  roles,
  currentRoleKey,
  onSave,
  onClose,
}: Props) {
  const [form, setForm] = useState<MemberInput>({
    first_name: member?.first_name ?? '',
    last_name: member?.last_name ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    joined_at: member?.joined_at ?? new Date().toISOString().slice(0, 10),
    status: member?.status ?? 'aktiv',
    funktion: member?.funktion ?? null,
  })
  const [roleKey, setRoleKey] = useState(currentRoleKey ?? '')

  const set = <K extends keyof MemberInput>(key: K, value: MemberInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave(
      {
        ...form,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        // Leere Textfelder als NULL speichern statt als leeren String.
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        funktion: form.funktion || null,
      },
      // Rolle nur mitgeben, wenn die Auswahl überhaupt gezeigt wurde.
      roles ? roleKey : null,
    )
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="head">
            <h3>{member ? 'Mitglied bearbeiten' : 'Mitglied anlegen'}</h3>
          </div>

          <div className="body">
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="first_name">Vorname</label>
                <input
                  id="first_name"
                  required
                  value={form.first_name}
                  onChange={(e) => set('first_name', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="last_name">Nachname</label>
                <input
                  id="last_name"
                  required
                  value={form.last_name}
                  onChange={(e) => set('last_name', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="email">E-Mail</label>
                <input
                  id="email"
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="phone">Telefon</label>
                <input
                  id="phone"
                  value={form.phone ?? ''}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="joined_at">Eintritt</label>
                <input
                  id="joined_at"
                  type="date"
                  value={form.joined_at ?? ''}
                  onChange={(e) => set('joined_at', e.target.value || null)}
                />
              </div>
              <div>
                <label htmlFor="status">Status</label>
                <select
                  id="status"
                  value={form.status}
                  onChange={(e) => set('status', e.target.value as MemberStatus)}
                >
                  {STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="funktion">Funktion</label>
                <select
                  id="funktion"
                  value={form.funktion ?? ''}
                  onChange={(e) => set('funktion', e.target.value || null)}
                >
                  <option value="">– normales Mitglied –</option>
                  {FUNK_ORDER.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              {/* Rollenauswahl nur mit roles.manage – sonst gar nicht sichtbar. */}
              {roles && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="role">Rolle (Rechte)</label>
                  <select id="role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
                    <option value="">– Mitglied (keine Sonderrechte) –</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="hint">
                    Bestimmt die Rechte in der App. Getrennt von der Funktion (Anzeige).
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="foot">
            <div className="row">
              <button className="btn ghost small" type="button" onClick={onClose}>
                Abbrechen
              </button>
              <div className="spacer" />
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

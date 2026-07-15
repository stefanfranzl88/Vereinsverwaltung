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
  /** Zeigt den Gefahrenbereich (DSGVO-Löschung) – nur Systemadmin, fremdes Mitglied. */
  canGdprDelete?: boolean
  deleting?: boolean
  onGdprDelete?: () => void
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
  canGdprDelete,
  deleting,
  onGdprDelete,
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

  // Gefahrenbereich: eingeklappt, dann doppelte Bestätigung (Häkchen + Nachname).
  const [dangerOpen, setDangerOpen] = useState(false)
  const [ack, setAck] = useState(false)
  const [typed, setTyped] = useState('')
  const gdprReady = ack && member != null && typed.trim() === member.last_name

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

            {/* ---------- Gefahrenbereich: DSGVO-Löschung ---------- */}
            {canGdprDelete && (
              <div
                style={{
                  marginTop: 18,
                  borderTop: '1px solid var(--red-soft)',
                  paddingTop: 12,
                }}
              >
                <h4 style={{ fontSize: 13.5, color: 'var(--red)', margin: '0 0 6px' }}>
                  Gefahrenbereich
                </h4>

                {!dangerOpen ? (
                  <button
                    type="button"
                    className="btn ghost small danger"
                    onClick={() => setDangerOpen(true)}
                  >
                    🗑 DSGVO-Löschung…
                  </button>
                ) : (
                  <div className="notice" style={{ background: 'var(--red-soft)', borderColor: '#e8c4ba' }}>
                    ⚠️ <b>Endgültig.</b> Name, E-Mail, Telefon, Profilbild und Schlüsselchips von{' '}
                    <b>
                      {member?.first_name} {member?.last_name}
                    </b>{' '}
                    werden anonymisiert („Ehemaliges Mitglied"), der App-Zugang entfernt. Nicht
                    umkehrbar.
                    <label className="consent-check" style={{ marginTop: 10 }}>
                      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                      <span>Ich habe verstanden, dass diese Löschung endgültig ist.</span>
                    </label>
                    <div style={{ marginTop: 6 }}>
                      <label htmlFor="gdpr-confirm">
                        Zur Bestätigung den Nachnamen tippen: <b>{member?.last_name}</b>
                      </label>
                      <input
                        id="gdpr-confirm"
                        autoComplete="off"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                      />
                    </div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => {
                          setDangerOpen(false)
                          setAck(false)
                          setTyped('')
                        }}
                      >
                        Abbrechen
                      </button>
                      <div className="spacer" />
                      <button
                        type="button"
                        className="btn danger small"
                        disabled={!gdprReady || deleting}
                        onClick={() => onGdprDelete?.()}
                      >
                        {deleting ? 'Wird gelöscht…' : 'Endgültig löschen'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
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

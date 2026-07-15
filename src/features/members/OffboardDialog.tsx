import { useState } from 'react'
import { fullName } from '@/lib/format'
import type { Member } from '@/types'

interface Props {
  mode: 'exit' | 'gdpr'
  member: Member
  saving: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * Austritt: eine Bestätigung. DSGVO-Löschung: doppelte Bestätigung – Häkchen
 * PLUS Eintippen des Nachnamens, damit das nicht versehentlich passiert.
 */
export function OffboardDialog({ mode, member, saving, onConfirm, onClose }: Props) {
  const [ack, setAck] = useState(false)
  const [typed, setTyped] = useState('')

  const name = fullName(member)
  const gdprReady = mode === 'gdpr' ? ack && typed.trim() === member.last_name : true

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="head">
          <h3>{mode === 'exit' ? 'Austritt erfassen' : '🗑 DSGVO-Löschung'}</h3>
        </div>

        <div className="body">
          {mode === 'exit' ? (
            <p style={{ fontSize: 14 }}>
              <b>{name}</b> wird auf „ausgetreten" gesetzt und verschwindet aus den aktiven Listen.
              Der App-Zugang (Login) und die Rollen werden entfernt. Der Datensatz bleibt für die
              Historie erhalten – Anwesenheiten, Aufgaben und Buchungen bleiben gültig.
            </p>
          ) : (
            <>
              <div className="notice">
                ⚠️ <b>Endgültig.</b> Die personenbezogenen Daten von <b>{name}</b> (Name, E-Mail,
                Telefon, Profilbild, Schlüsselchips) werden gelöscht bzw. anonymisiert. In
                Protokollen, Aufgaben und Buchungen erscheint die Person danach als „Ehemaliges
                Mitglied". Der App-Zugang wird entfernt. Das lässt sich nicht rückgängig machen.
              </div>
              <label className="consent-check" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>Ich habe verstanden, dass diese Löschung endgültig ist.</span>
              </label>
              <div style={{ marginTop: 6 }}>
                <label htmlFor="gdpr-name">
                  Zur Bestätigung den Nachnamen tippen: <b>{member.last_name}</b>
                </label>
                <input
                  id="gdpr-name"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          )}
        </div>

        <div className="foot">
          <div className="row">
            <button className="btn ghost small" onClick={onClose}>
              Abbrechen
            </button>
            <div className="spacer" />
            <button
              className={mode === 'gdpr' ? 'btn danger' : 'btn'}
              disabled={saving || !gdprReady}
              onClick={onConfirm}
            >
              {saving
                ? 'Wird ausgeführt…'
                : mode === 'exit'
                  ? 'Austritt bestätigen'
                  : 'Endgültig löschen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

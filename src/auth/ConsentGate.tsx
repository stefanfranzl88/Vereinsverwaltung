import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './context'
import { useToast } from '@/components/Toast'

export const CONSENT_VERSION = '1.0'

/**
 * Beim ersten Login müssen Nutzungsbedingungen und Datenschutzerklärung bestätigt
 * werden. Der Prototyp merkte sich das nur im Speicher – hier wird es mit Zeitstempel
 * und Version in profiles.consented_at / consent_version gespeichert.
 *
 * Ältere Zustimmungen (andere Version) werden erneut eingeholt.
 */
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const { profile, member, refresh } = useAuth()
  const { toast, toastError } = useToast()
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)

  const needsConsent =
    profile !== null && (!profile.consented_at || profile.consent_version !== CONSENT_VERSION)

  if (!needsConsent) return <>{children}</>

  const accept = async () => {
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ consented_at: new Date().toISOString(), consent_version: CONSENT_VERSION })
      .eq('id', profile.id)

    if (error) {
      toastError(`Zustimmung konnte nicht gespeichert werden: ${error.message}`)
      setBusy(false)
      return
    }
    await refresh()
    toast(`Zustimmung gespeichert (Version ${CONSENT_VERSION})`)
  }

  return (
    <div className="overlay">
      <div className="dialog">
        <div className="head">
          <h3>Willkommen{member ? `, ${member.first_name}` : ''}!</h3>
          <p className="meta" style={{ marginTop: 2 }}>
            Erster Login – bitte einmalig bestätigen (Version {CONSENT_VERSION})
          </p>
        </div>

        <div className="body">
          <h4>Nutzungsbedingungen (Kurzfassung)</h4>
          <p>
            Diese Anwendung dient der internen Vereinsverwaltung. Deine Zugangsdaten sind persönlich
            und nicht an Dritte weiterzugeben. Inhalte (Mitteilungen, Chat, Belege) müssen rechtmäßig
            sein und den respektvollen Umgang im Verein wahren. Der Zugriff auf Daten ist durch das
            Rollensystem geregelt.
          </p>
          <h4>Datenschutzerklärung (Kurzfassung)</h4>
          <p>
            Verantwortlich ist der Verein; der technische Betrieb erfolgt als Auftragsverarbeitung.
            Verarbeitet werden deine Stammdaten (Name, Kontakt, Eintrittsdatum, Funktion),
            Vereinsdaten (Terminzusagen, Aufgaben, Anwesenheiten, Ausleihen, eingereichte Belege)
            sowie technische Logins – gespeichert auf Servern in der EU. Dein Profilbild und
            Push-Benachrichtigungen sind freiwillig und jederzeit widerrufbar. Die Kassa sehen nur
            berechtigte Funktionen; deine Belege siehst nur du und die Kassenverantwortlichen. Es
            gelten deine Rechte auf Auskunft, Berichtigung und Löschung nach DSGVO.
          </p>
          <p className="meta">
            Die vollständigen Texte sind jederzeit in der App unter „Rollen &amp; Einstellungen"
            abrufbar.
          </p>
        </div>

        <div className="foot">
          <label className="consent-check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>
              Ich habe die <b>Nutzungsbedingungen</b> gelesen und akzeptiere sie.
            </span>
          </label>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />
            <span>
              Ich habe die <b>Datenschutzerklärung</b> zur Kenntnis genommen.
            </span>
          </label>
          <div className="row">
            <button className="btn ghost small" onClick={() => void supabase.auth.signOut()}>
              Abbrechen
            </button>
            <div className="spacer" />
            <button
              className="btn"
              disabled={!terms || !privacy || busy}
              onClick={() => void accept()}
            >
              {busy ? 'Speichern…' : 'Bestätigen & loslegen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

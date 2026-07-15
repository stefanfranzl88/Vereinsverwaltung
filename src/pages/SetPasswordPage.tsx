import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

/**
 * Landeseite des Einladungslinks. Supabase legt die Session-Tokens beim Klick
 * in den URL-Hash; der Client (detectSessionInUrl) baut daraus automatisch eine
 * Sitzung. Hier setzt die Person ihr Passwort – danach geht es in die App, wo
 * der Consent-Dialog den ersten Login abfängt.
 *
 * Bewusst eine eigenständige Route (nicht unter RequireAuth/AppShell): Der
 * eingeladene Benutzer hat zwar eine Sitzung, soll aber erst das Passwort setzen.
 */
export function SetPasswordPage() {
  const navigate = useNavigate()

  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // getSession() löst erst auf, wenn der URL-Hash verarbeitet ist – danach
  // wissen wir, ob der Link eine gültige Sitzung mitgebracht hat.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session))
      setReady(true)
    })
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (password !== confirm) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    setBusy(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) {
      setError(updateErr.message)
      setBusy(false)
      return
    }
    // Sitzung besteht bereits – ab in die App (Consent-Dialog folgt dort).
    navigate('/', { replace: true })
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">DG</div>
          <div>
            <h1>Willkommen im Verein</h1>
          </div>
        </div>

        {!ready ? (
          <p className="login-sub">Einladung wird geprüft…</p>
        ) : !hasSession ? (
          <>
            <p className="login-sub">
              Dieser Einladungslink ist ungültig oder abgelaufen.
            </p>
            <div className="error-box">
              Bitte den Systemadmin um eine neue Einladung – oder, falls du schon ein Passwort
              hast, direkt anmelden.
            </div>
            <button className="btn block" onClick={() => navigate('/login', { replace: true })}>
              Zur Anmeldung
            </button>
          </>
        ) : (
          <>
            <p className="login-sub">Bitte lege ein Passwort für deinen Zugang fest.</p>
            <form onSubmit={submit}>
              <label htmlFor="pw">Passwort</label>
              <input
                id="pw"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <label htmlFor="pw2">Passwort wiederholen</label>
              <input
                id="pw2"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />

              {error && <div className="error-box">{error}</div>}

              <button className="btn block" type="submit" disabled={busy}>
                {busy ? 'Wird gespeichert…' : 'Passwort festlegen & loslegen'}
              </button>
            </form>
            <p className="hint">Mindestens 8 Zeichen. Danach bist du sofort angemeldet.</p>
          </>
        )}
      </div>
    </div>
  )
}

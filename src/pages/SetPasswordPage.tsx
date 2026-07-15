import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

/**
 * Landeseite des Einladungslinks.
 *
 * Supabase liefert die Sitzung je nach Flow unterschiedlich an:
 *  - Implicit-Flow: Tokens im URL-Hash (#access_token=…) – detectSessionInUrl
 *    verarbeitet das automatisch.
 *  - PKCE-Flow: ein Einmal-Code in der Query (?code=…) – der muss mit
 *    exchangeCodeForSession GENAU EINMAL eingelöst werden (der Code ist danach
 *    verbraucht; ein zweiter Versuch scheitert mit „code not found").
 *
 * Diese Seite deckt beide Fälle ab und loggt die ankommende URL, damit sich der
 * Flow-Typ im Zweifel an echten Daten ablesen lässt.
 *
 * Eigenständige Route (nicht unter RequireAuth/AppShell): der Eingeladene hat
 * zwar eine Sitzung, soll aber erst das Passwort setzen.
 */
export function SetPasswordPage() {
  const navigate = useNavigate()

  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guard: der Code darf nur ein einziges Mal eingelöst werden (StrictMode ruft
  // Effekte im Dev doppelt auf – das würde den Einmal-Code verbrennen).
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    async function init() {
      // Diagnose: was kommt tatsächlich in der URL an?
      // eslint-disable-next-line no-console
      console.info('[set-password] href:', window.location.href)
      // eslint-disable-next-line no-console
      console.info('[set-password] search:', window.location.search, '| hash:', window.location.hash)

      // 1. Hat detectSessionInUrl (Hash-Flow) bereits eine Sitzung gebaut?
      let session = (await supabase.auth.getSession()).data.session

      // 2. Sonst: liegt ein PKCE-Code vor? Dann genau einmal einlösen.
      if (!session) {
        const code = new URLSearchParams(window.location.search).get('code')
        if (code) {
          const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code)
          if (exchErr) {
            // eslint-disable-next-line no-console
            console.error('[set-password] exchangeCodeForSession:', exchErr.message)
            setError(`Link konnte nicht eingelöst werden: ${exchErr.message}`)
          } else {
            session = (await supabase.auth.getSession()).data.session
          }
        }
      }

      setHasSession(Boolean(session))
      setReady(true)
    }

    void init()
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

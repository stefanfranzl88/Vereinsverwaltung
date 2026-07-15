import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/context'

/**
 * Anders als der Prototyp (Dropdown mit Demo-Usern) läuft der Login über
 * echte Supabase-Auth. Die Optik der Login-Karte bleibt unverändert.
 */
export function LoginPage() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Branding (Name + Logo) für die noch unauthentifizierte Login-Seite über
  // die öffentliche Funktion login_branding(). Fehlt sie/das Logo, bleibt es
  // beim Standard.
  const [brand, setBrand] = useState<{ name: string; logo_url: string | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    supabase.rpc('login_branding').then(({ data }) => {
      const row = (data as { name: string; logo_url: string | null }[] | null)?.[0]
      if (!cancelled && row) setBrand(row)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (session && !loading) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'E-Mail oder Passwort stimmt nicht.'
          : signInError.message,
      )
      setBusy(false)
    }
    // Bei Erfolg übernimmt der AuthProvider; die Navigation passiert oben.
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">
            {brand?.logo_url ? (
              <img src={brand.logo_url} alt="" />
            ) : (
              (brand?.name ?? 'DG').slice(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <h1>{brand?.name ?? 'Vereinsverwaltung'}</h1>
          </div>
        </div>
        <p className="login-sub">Bitte mit deinen Vereins-Zugangsdaten anmelden.</p>

        <form onSubmit={onSubmit}>
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <div className="error-box">{error}</div>}

          <button className="btn block" type="submit" disabled={busy}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>

        <p className="hint">
          Noch kein Zugang? Der Systemadmin des Vereins legt Benutzer an und verknüpft sie mit dem
          Mitgliedseintrag.
        </p>
      </div>
    </div>
  )
}

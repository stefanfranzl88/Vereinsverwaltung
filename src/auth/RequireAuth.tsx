import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context'
import { ConsentGate } from './ConsentGate'
import { supabase } from '@/lib/supabase'
import type { ModuleKey } from '@/types'
import type { Permission } from './roles'

function Loading() {
  return (
    <div className="center-screen">
      <p>Vereinsdaten werden geladen…</p>
    </div>
  )
}

/** Login + geladener Mandanten-Kontext + erteilte Zustimmung. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading, error, profile } = useAuth()
  const location = useLocation()

  if (loading) return <Loading />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // Eingeloggt, aber der Mandanten-Kontext fehlt (z.B. kein profiles-Eintrag).
  // Kein Login-Problem – deshalb kein Redirect, sondern eine ehrliche Fehlermeldung.
  if (error || !profile) {
    return (
      <div className="center-screen">
        <h2 className="view-title">Kein Vereinszugang</h2>
        <p style={{ maxWidth: 460 }}>{error ?? 'Zu diesem Login gehört kein Profil.'}</p>
        <button className="btn ghost small" onClick={() => void supabase.auth.signOut()}>
          Abmelden
        </button>
      </div>
    )
  }

  return <ConsentGate>{children}</ConsentGate>
}

interface RequireAccessProps {
  module: ModuleKey
  perm?: Permission
  children: React.ReactNode
}

/**
 * Route-seitiges Modul- und Rechte-Gating. Ohne das würde ein Direktaufruf von
 * /kassa die Seite rendern, obwohl der Nav-Eintrag ausgeblendet ist.
 */
export function RequireAccess({ module, perm, children }: RequireAccessProps) {
  const { can, hasModule } = useAuth()

  if (!hasModule(module)) {
    return (
      <>
        <h2 className="view-title">Modul nicht aktiv</h2>
        <p className="view-sub">
          Dieser Bereich gehört zum Modul „{module}", das für deinen Verein nicht gebucht ist.
        </p>
        <div className="notice">
          Der Systemadmin kann das Modul in den Vereinseinstellungen hinzubuchen.
        </div>
      </>
    )
  }

  if (perm && !can(perm)) {
    return (
      <>
        <h2 className="view-title">Kein Zugriff</h2>
        <p className="view-sub">Für diesen Bereich fehlt dir das nötige Recht.</p>
        <div className="notice">🔒 Wende dich an den Systemadmin deines Vereins.</div>
      </>
    )
  }

  return <>{children}</>
}

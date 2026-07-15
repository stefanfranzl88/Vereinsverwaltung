import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/context'
import { daysSince } from '@/lib/format'

/**
 * Dashboard-Hinweis für die Schlüsselverwaltung: fällig, wenn das letzte
 * Auslesen länger her ist als das eingestellte Intervall. Alles kommt aus
 * tenant.settings (bereits im Auth-Kontext geladen) – keine eigene Abfrage.
 *
 * Rendert nichts ohne Modul oder ohne keylog.upload-Recht.
 */
export function KeyLogReminder() {
  const { tenant, can, hasModule } = useAuth()

  if (!hasModule('schluessel') || !can('keylog.upload')) return null

  const settings = tenant?.settings
  const intervalDays = typeof settings?.key_interval_days === 'number' ? settings.key_interval_days : 30
  const lastKeyLog = typeof settings?.last_key_log === 'string' ? settings.last_key_log : null

  const sinceLast = lastKeyLog ? daysSince(lastKeyLog) : null
  const due = sinceLast === null || sinceLast >= intervalDays
  if (!due) return null

  return (
    <div className="notice">
      🔑 <b>Schloss auslesen fällig:</b>{' '}
      {sinceLast === null
        ? 'Es wurde noch kein Zutrittsprotokoll hochgeladen.'
        : `Das letzte Protokoll wurde vor ${sinceLast} Tagen hochgeladen (Intervall: ${intervalDays} Tage).`}{' '}
      <Link to="/schluessel">Zur Schlüsselverwaltung</Link>
    </div>
  )
}

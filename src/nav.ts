import type { ModuleKey } from '@/types'
import type { Permission } from '@/auth/roles'

export interface NavItem {
  id: string
  path: string
  ico: string
  label: string
  /** Modul aus tenant_modules. Fehlt es dem Verein, verschwindet der Eintrag. */
  module: ModuleKey
  /** Zusätzlich nötiges Recht. Ohne Angabe: für alle Mitglieder sichtbar. */
  perm?: Permission
}

/**
 * Reihenfolge und Icons aus dem Prototyp (NAV-Array).
 * Neu gegenüber dem Prototyp: jeder Eintrag trägt sein Modul, damit ein Verein
 * ohne z.B. Kassa-Abo den Punkt gar nicht erst sieht (Modul-Gating).
 */
export const NAV: NavItem[] = [
  { id: 'dashboard', path: '/', ico: '⌂', label: 'Dashboard', module: 'core' },
  { id: 'mitglieder', path: '/mitglieder', ico: '👥', label: 'Mitglieder', module: 'core' },
  { id: 'kassa', path: '/kassa', ico: '€', label: 'Kassa', module: 'kassa', perm: 'kassa.view' },
  { id: 'termine', path: '/termine', ico: '📅', label: 'Termine', module: 'core' },
  { id: 'events', path: '/events', ico: '🎪', label: 'Events & Projekte', module: 'events' },
  { id: 'inventar', path: '/inventar', ico: '📦', label: 'Inventar', module: 'inventar' },
  { id: 'protokolle', path: '/protokolle', ico: '📄', label: 'Protokolle', module: 'core' },
  {
    id: 'aufgaben',
    path: '/aufgaben',
    ico: '✅',
    label: 'Aufgaben',
    module: 'core',
    perm: 'tasks.viewall',
  },
  { id: 'mitarbeit', path: '/mitarbeit', ico: '⭐', label: 'Mitarbeit', module: 'mitarbeit' },
  { id: 'umfragen', path: '/umfragen', ico: '📊', label: 'Umfragen', module: 'umfragen' },
  { id: 'rechnungen', path: '/rechnungen', ico: '🧾', label: 'Rechnungen', module: 'kassa' },
  { id: 'chat', path: '/chat', ico: '💬', label: 'Chat', module: 'chat' },
  {
    id: 'dokumente',
    path: '/dokumente',
    ico: '📁',
    label: 'Dokumente',
    module: 'dokumente',
    perm: 'docs.view',
  },
  {
    id: 'schluessel',
    path: '/schluessel',
    ico: '🔑',
    label: 'Schlüssel',
    module: 'schluessel',
    perm: 'keys.view',
  },
  {
    id: 'rollen',
    path: '/rollen',
    ico: '⚙️',
    label: 'Rollen',
    module: 'core',
    perm: 'roles.view',
  },
  {
    id: 'einstellungen',
    path: '/einstellungen',
    ico: '🏛',
    label: 'Einstellungen',
    module: 'core',
    perm: 'roles.manage',
  },
]

export function visibleNav(
  can: (p: Permission) => boolean,
  hasModule: (m: ModuleKey) => boolean,
): NavItem[] {
  return NAV.filter((n) => hasModule(n.module) && (!n.perm || can(n.perm)))
}

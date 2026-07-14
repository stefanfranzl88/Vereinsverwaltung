/**
 * Label-Katalog – KEINE Rechtelogik mehr.
 *
 * Einzige Quelle der Wahrheit für "welche Rolle darf was" ist die Datenbank
 * (role_permissions). Der AuthProvider lädt die Rechte des angemeldeten Benutzers
 * von dort, die RLS-Policies setzen sie über has_perm() durch. Dieselben Daten,
 * dieselbe Antwort – Frontend und Datenbank können nicht mehr auseinanderlaufen.
 *
 * Hier bleiben nur zwei Dinge:
 *   - der Permission-Typ, damit can('kassa.view') ein Tippfehler auffliegt
 *   - Fallback-Labels, falls ein Recht (noch) nicht im permissions-Katalog steht
 */

export type Permission =
  | 'members.edit'
  | 'news.post'
  | 'event.create'
  | 'protokoll.edit'
  | 'tasks.viewall'
  | 'tasks.create'
  | 'roles.view'
  | 'roles.manage'
  | 'kassa.view'
  | 'kassa.edit'
  | 'invoice.viewall'
  | 'invoice.approve'
  | 'survey.create'
  | 'inventar.manage'
  | 'reserve.approve'
  | 'docs.view'
  | 'docs.manage'
  | 'keys.view'
  | 'keys.manage'
  | 'keylog.view'
  | 'keylog.upload'

/** Nur Anzeige-Fallback. Maßgeblich ist permissions.label aus der DB. */
export const PERM_LABELS: Record<Permission, string> = {
  'members.edit': 'Mitglieder anlegen & bearbeiten',
  'kassa.view': 'Kassa einsehen',
  'kassa.edit': 'Buchungen erfassen',
  'event.create': 'Termine, Events & Projekte anlegen',
  'protokoll.edit': 'Protokolle verfassen',
  'survey.create': 'Umfragen erstellen',
  'tasks.viewall': 'Aufgabenübersicht einsehen',
  'tasks.create': 'Aufgaben erfassen & zuteilen',
  'invoice.viewall': 'Alle eingereichten Belege sehen',
  'invoice.approve': 'Rechnungen freigeben & Auszahlung bestätigen',
  'news.post': 'Mitteilungen veröffentlichen',
  'inventar.manage': 'Inventar verwalten',
  'reserve.approve': 'Leihartikel/Reservierungen freigeben',
  'docs.view': 'Dokumentenablage einsehen',
  'docs.manage': 'Dokumente hochladen & löschen',
  'keys.view': 'Schlüsselverwaltung einsehen',
  'keys.manage': 'Schlüsselchips verwalten',
  'keylog.view': 'Zutrittsprotokoll einsehen',
  'keylog.upload': 'Zutrittsprotokoll hochladen',
  'roles.view': 'Rollen-Matrix einsehen',
  'roles.manage': 'Rollen & Einstellungen verwalten',
}

/** Rolle, wie sie pro Verein in der DB steht. */
export interface Role {
  id: string
  key: string
  label: string
  sort_order: number
  /** Systemadmin-Rolle: Rechte nicht änderbar (Spalte in der Matrix gesperrt). */
  is_locked: boolean
}

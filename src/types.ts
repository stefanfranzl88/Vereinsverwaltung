/** Spiegelt vereinsverwaltung_schema.sql – nur die Tabellen, die die App bisher nutzt. */

export type ModuleKey =
  | 'core'
  | 'kassa'
  | 'events'
  | 'inventar'
  | 'dokumente'
  | 'schluessel'
  | 'umfragen'
  | 'chat'
  | 'mitarbeit'

export type MemberStatus = 'aktiv' | 'ruhend' | 'ausgetreten'

export interface Tenant {
  id: string
  name: string
  slug: string
  logo_url: string | null
  zvr_zahl: string | null
  dekade: string | null
  settings: Record<string, unknown>
}

export interface Profile {
  id: string
  tenant_id: string
  member_id: string | null
  is_sysadmin: boolean
  consented_at: string | null
  consent_version: string | null
}

export interface Member {
  id: string
  tenant_id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  joined_at: string | null
  status: MemberStatus
  funktion: string | null
  photo_path: string | null
  created_at: string
}

/** Eingabe für Anlegen/Bearbeiten – tenant_id setzt die App, nicht das Formular. */
export type MemberInput = Pick<
  Member,
  'first_name' | 'last_name' | 'email' | 'phone' | 'joined_at' | 'status' | 'funktion'
>

// ---------------------------------------------------------------
// Kassa
// ---------------------------------------------------------------

/**
 * ACHTUNG: Beträge sind durchgehend GANZZAHLIGE CENT (amount_cents bigint).
 * Der Prototyp rechnete mit Fließkomma-Euro – das ist bei Geld falsch
 * (0.1 + 0.2 !== 0.3). Umgerechnet wird nur an der Oberfläche, via eur().
 */
export type Direction = 'in' | 'out'

export type CostCenterType = 'Event' | 'Projekt' | 'laufend'

export interface CostCenter {
  id: string
  tenant_id: string
  name: string
  cc_type: CostCenterType
  base_name: string | null
  year: number | null
}

export interface Transaction {
  id: string
  tenant_id: string
  tx_date: string
  description: string
  category: string
  amount_cents: number
  direction: Direction
  cost_center_id: string | null
  receipt_path: string | null
  created_at: string
}

export interface TransactionInput {
  tx_date: string
  description: string
  category: string
  amount_cents: number
  direction: Direction
  cost_center_id: string | null
  receipt: File | null
}

export type InvoiceStatus = 'offen' | 'freigegeben' | 'bezahlt' | 'abgelehnt'

/** Eingereichter Beleg (Tabelle invoices). Beträge in Cent. */
export interface Invoice {
  id: string
  tenant_id: string
  submitted_by: string
  description: string
  amount_cents: number
  cost_center_id: string | null
  file_path: string
  status: InvoiceStatus
  paid_at: string | null
  created_at: string
  members: { first_name: string; last_name: string } | null
}

export interface InvoiceInput {
  description: string
  amount_cents: number
  cost_center_id: string | null
  file: File
}

export interface MonthClosing {
  tenant_id: string
  /** '2026-06' */
  month: string
  closed_at: string
  export_path: string | null
}

/** Summen einer Kostenstelle. */
export interface CcSums {
  ein: number
  aus: number
  erg: number
  count: number
}

/** Termin (Tabelle events, Modul 'core'). */
export interface VereinsEvent {
  id: string
  tenant_id: string
  title: string
  event_date: string
  event_time: string | null
  location: string | null
}

export type EventInput = Pick<VereinsEvent, 'title' | 'event_date' | 'event_time' | 'location'>

export type RsvpAnswer = 'yes' | 'no'

/** Zusagen/Absagen als reine Zahlen – Funktion event_rsvp_counts(). */
export interface RsvpCounts {
  event_id: string
  yes_count: number
  no_count: number
}

/** Eine Antwort samt Person – nur für den Vorstand lesbar (roles.view). */
export interface RsvpWithMember {
  member_id: string
  answer: RsvpAnswer
  members: { first_name: string; last_name: string } | null
}

/** Mitteilung (Tabelle news). */
export interface NewsItem {
  id: string
  tenant_id: string
  author_id: string | null
  title: string
  body: string | null
  photo_path: string | null
  expires_at: string | null
  created_at: string
  members: { first_name: string; last_name: string } | null
}

/** Aufgabe (Tabelle tasks). */
export type TaskSource = 'manual' | 'big_event' | 'protocol'

export interface Task {
  id: string
  tenant_id: string
  title: string
  assignee_id: string | null
  due_date: string | null
  done: boolean
  done_at: string | null
  source_type: TaskSource | null
  source_id: string | null
  created_by: string | null
  created_at: string
}

export interface TaskInput {
  title: string
  assignee_id: string
  due_date: string | null
  source_type: TaskSource
  source_id: string | null
}

// ---------------------------------------------------------------
// Events & Projekte (Modul 'events')
// ---------------------------------------------------------------

/** Schlanke Referenz – reicht für die Aufgaben-Zuordnung. */
export interface BigEventRef {
  id: string
  name: string
}

export type BigEventKind = 'Event' | 'Projekt'
export type BigEventStatus = 'aktiv' | 'archiviert'

export interface BigEvent {
  id: string
  tenant_id: string
  kind: BigEventKind
  name: string
  date_from: string | null
  date_to: string | null
  description: string | null
  cost_center_id: string | null
  status: BigEventStatus
  report: string | null
  closed_at: string | null
}

export type BigEventInput = Pick<
  BigEvent,
  'kind' | 'name' | 'date_from' | 'date_to' | 'description'
>

/** Subtermin (Aufbau Tag 1, Festbetrieb, …). */
export interface BigEventSub {
  id: string
  big_event_id: string
  sub_date: string
  sub_time: string | null
  title: string
}

export interface Department {
  id: string
  big_event_id: string
  name: string
}

export type AssignmentRole = 'lead' | 'crew'

/**
 * Einteilung. Entweder ein Vereinsmitglied (member_id) ODER eine externe
 * Person (external_name) – das Schema erzwingt genau eines von beidem.
 */
export interface DeptAssignment {
  id: string
  department_id: string
  member_id: string | null
  external_name: string | null
  role: AssignmentRole
  note: string | null
  members: { first_name: string; last_name: string; photo_path: string | null } | null
}

// ---------------------------------------------------------------
// Chat (Modul 'chat')
// ---------------------------------------------------------------

export interface ChatMessage {
  id: string
  tenant_id: string
  member_id: string
  body: string
  created_at: string
}

// ---------------------------------------------------------------
// Dokumente (Modul 'dokumente')
// ---------------------------------------------------------------

/** Kategorien aus dem Prototyp (DOC_CATS). */
export const DOC_CATEGORIES = [
  'Verträge',
  'Versicherungen',
  'Schadensmeldungen',
  'Bescheide & Behörden',
  'Sonstiges',
] as const

export type DocumentCategory = (typeof DOC_CATEGORIES)[number]

export interface VereinsDocument {
  id: string
  tenant_id: string
  name: string
  category: string
  file_path: string
  created_at: string
  members: { first_name: string; last_name: string } | null
}

// ---------------------------------------------------------------
// Umfragen (Modul 'umfragen')
// ---------------------------------------------------------------

export interface Survey {
  id: string
  tenant_id: string
  question: string
  is_open: boolean
  created_at: string
}

export interface SurveyOption {
  id: string
  survey_id: string
  label: string
  sort_order: number
}

/**
 * Ergebnis einer Option – reine Zahl, ohne Personenbezug.
 * Wer wie gestimmt hat, gibt die Datenbank niemandem preis (siehe 0012).
 */
export interface SurveyResult {
  survey_id: string
  option_id: string
  votes: number
}

// ---------------------------------------------------------------
// Protokolle (Modul 'core')
// ---------------------------------------------------------------

/** Die fünf Standardarten; eigene Arten (Config) sind zusätzlich als String erlaubt. */
export type StandardProtocolType = 'Sitzung' | 'Aufbau' | 'Abbau' | 'Veranstaltung' | 'Sonstiges'
/** proto_type ist frei (konfigurierbare Arten), deshalb string. */
export type ProtocolType = string
export type ProtocolVisibility = 'alle' | 'vorstand'

export interface Protocol {
  id: string
  tenant_id: string
  title: string
  proto_date: string
  time_from: string | null
  time_to: string | null
  location: string | null
  proto_type: ProtocolType
  visibility: ProtocolVisibility
  author_id: string | null
  body: string | null
  members: { first_name: string; last_name: string } | null
}

/** Eine Zeile aus der Aufgabenverteilung im Protokoll-Editor. */
export interface ProtocolTaskInput {
  title: string
  assignee_id: string
  due_date: string
}

export interface ProtocolInput {
  title: string
  proto_date: string
  time_from: string | null
  time_to: string | null
  location: string
  proto_type: ProtocolType
  visibility: ProtocolVisibility
  body: string
  attendees: string[]
  tasks: ProtocolTaskInput[]
}

// ---------------------------------------------------------------
// Inventar (Modul 'inventar')
// ---------------------------------------------------------------

export type ItemKind = 'geraet' | 'vorrat'
export type ReservationStatus = 'angefragt' | 'bestätigt' | 'abgelehnt'

export interface Location {
  id: string
  tenant_id: string
  name: string
}

export interface Item {
  id: string
  tenant_id: string
  inv_nr: string
  name: string
  kind: ItemKind
  /** Gerät: Gesamtbestand · Vorrat: aktueller Bestand. */
  total_qty: number
  unit: string | null
  location_id: string | null
  defect: boolean
  note: string | null
  /** Soft Delete: null = aktiv, Datum = ausgeschieden (Archiv). */
  retired_at: string | null
}

/** Aktive Ausleihe. Teilmengen sind möglich (3 von 8 Biertischgarnituren). */
export interface ItemBorrow {
  id: string
  item_id: string
  member_id: string
  qty: number
  borrowed_at: string
  members: { first_name: string; last_name: string } | null
}

export interface ItemReservation {
  id: string
  item_id: string
  member_id: string
  date_from: string
  date_to: string
  purpose: string | null
  status: ReservationStatus
  members: { first_name: string; last_name: string } | null
}

export interface ItemHistoryEntry {
  id: string
  item_id: string
  action: string
  created_at: string
  members: { first_name: string; last_name: string } | null
}

/** Schlüsselchip eines Mitglieds (Modul 'schluessel'). */
export interface KeyChip {
  id: string
  member_id: string
  chip_nr: string
  issued_at: string
}

/** Chip mit Personendaten – für die Schlüsselverwaltung. */
export interface KeyChipWithMember extends KeyChip {
  members: { first_name: string; last_name: string; funktion: string | null; photo_path: string | null } | null
}

/** Ein Zutritt aus dem EVVA-Export (Tabelle key_log_entries). */
export interface KeyLogEntry {
  id: string
  entry_date: string | null
  entry_time: string | null
  chip_info: string | null
  event: string | null
}

/** Metadaten eines Protokoll-Uploads (Tabelle key_log_uploads). */
export interface KeyLogUpload {
  id: string
  file_name: string | null
  row_count: number | null
  created_at: string
}

/** Eine geparste Zeile aus dem Export, wie sie an import_key_log() geht. */
export interface KeyLogRow {
  date: string | null
  time: string | null
  chip_info: string
  event: string
}

/** Globaler Rechte-Katalog (Tabelle permissions). Jedes Recht gehört zu einem Modul. */
export interface PermissionCatalogItem {
  key: string
  label: string
  module_key: ModuleKey | null
}

/** Zuordnung Rolle → Recht (Tabelle role_permissions). */
export interface RolePermission {
  role_id: string
  permission_key: string
}

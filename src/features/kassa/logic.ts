import type { CcSums, CostCenter, MonthClosing, Transaction } from '@/types'
import { today } from '@/lib/format'

export const KATEGORIEN = [
  'Spenden',
  'Veranstaltungen',
  'Förderungen',
  'Verwaltung',
  'Bau & Anschaffungen',
  'Öffentlichkeitsarbeit',
  'Sonstiges',
] as const

/** Alle Beträge in Cent – siehe Kommentar bei Transaction. */
export function sums(txs: Transaction[]): CcSums {
  let ein = 0
  let aus = 0
  for (const t of txs) {
    if (t.direction === 'in') ein += t.amount_cents
    else aus += t.amount_cents
  }
  return { ein, aus, erg: ein - aus, count: txs.length }
}

export const inYear = (txs: Transaction[], year: number) =>
  txs.filter((t) => t.tx_date.startsWith(String(year)))

export const ccSums = (txs: Transaction[], ccId: string): CcSums =>
  sums(txs.filter((t) => t.cost_center_id === ccId))

/** Anfangsbestand aus tenants.settings. Fehlt er, ist er 0. */
export function openingBalance(settings: Record<string, unknown> | undefined): number {
  const raw = settings?.opening_balance_cents
  return typeof raw === 'number' ? raw : 0
}

/**
 * Nächster noch nicht abgeschlossener Monat.
 *
 * Der Prototyp hielt das in einer Variable (clubInfo.lastMonthClosed). Hier wird
 * es aus month_closings abgeleitet: der Monat nach dem zuletzt abgeschlossenen.
 * Gibt es noch keinen Abschluss, ist es der Monat der ältesten Buchung – so
 * beginnt ein Verein sauber beim ersten Geschäftsvorfall und nicht im Januar.
 */
export function nextOpenMonth(
  closings: MonthClosing[],
  transactions: Transaction[],
): string | null {
  if (closings.length > 0) {
    const last = closings.map((c) => c.month).sort().at(-1)!
    const [y, m] = last.split('-').map(Number)
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }

  if (transactions.length === 0) return null
  const earliest = transactions.map((t) => t.tx_date).sort()[0]
  return earliest.slice(0, 7)
}

/**
 * Ist der Monatsabschluss fällig? Erinnerung ab dem 5. des Folgemonats –
 * so wie im Prototyp.
 */
export function monthCloseDue(openMonth: string | null): string | null {
  if (!openMonth) return null
  const [y, m] = openMonth.split('-').map(Number)
  const remindYear = m === 12 ? y + 1 : y
  const remindMonth = m === 12 ? 1 : m + 1
  const reminder = `${remindYear}-${String(remindMonth).padStart(2, '0')}-05`
  return today() >= reminder ? openMonth : null
}

export const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00`).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })

/** Übertrag: Anfangsbestand + alles, was vor dem Monat gebucht wurde. */
export function carryOver(
  transactions: Transaction[],
  month: string,
  opening: number,
): number {
  const before = transactions.filter((t) => t.tx_date < `${month}-01`)
  const s = sums(before)
  return opening + s.erg
}

/**
 * Wiederkehrende Events für den Jahresvergleich.
 * Zuordnung über base_name (aus "Jahreskirchtag 2026" abgeleitet) – nur Reihen
 * mit mindestens zwei Jahren sind ein Vergleich.
 */
export function recurringSeries(
  costCenters: CostCenter[],
): { base: string; entries: CostCenter[] }[] {
  const groups = new Map<string, CostCenter[]>()

  for (const cc of costCenters) {
    if (!cc.base_name || !cc.year) continue
    const list = groups.get(cc.base_name) ?? []
    list.push(cc)
    groups.set(cc.base_name, list)
  }

  return [...groups.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .map(([base, entries]) => ({
      base,
      entries: [...entries].sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
    }))
}

/** Kategorie-Auswertung für den Jahresabschluss. */
export function byCategory(txs: Transaction[]): { category: string; ein: number; aus: number }[] {
  const map = new Map<string, { ein: number; aus: number }>()

  for (const t of txs) {
    const entry = map.get(t.category) ?? { ein: 0, aus: 0 }
    if (t.direction === 'in') entry.ein += t.amount_cents
    else entry.aus += t.amount_cents
    map.set(t.category, entry)
  }

  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => a.category.localeCompare(b.category, 'de'))
}

/** "12,50" – deutsches Dezimalkomma für CSV/XLSX. */
export const centsToDecimal = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/**
 * Euro-Eingabe → ganzzahlige Cent. Akzeptiert "12,50" und "12.50".
 * Gibt null zurück, wenn die Eingabe kein gültiger Betrag ist.
 *
 * Es wird bewusst NICHT parseFloat auf den Rohwert losgelassen: "12,50" würde
 * dort zu 12 werden – also stillschweigend 50 Cent verschlucken.
 */
export function euroToCents(input: string): number | null {
  const normalized = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}

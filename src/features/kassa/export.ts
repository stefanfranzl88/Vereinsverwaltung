import { fdate } from '@/lib/format'
import type { CostCenter, Transaction } from '@/types'
import { byCategory, ccSums, centsToDecimal, monthLabel, sums } from './logic'
import { downloadReceipt } from './api'

type Cell = string | number

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Ohne revoke bleibt der Blob bis zum Reload im Speicher.
  URL.revokeObjectURL(url)
}

/** CSV mit BOM und Semikolon – öffnet in Excel (de-AT) ohne Importdialog. */
function toCsv(rows: Cell[][]): Blob {
  const escape = (f: Cell) => `"${String(f ?? '').replace(/"/g, '""')}"`
  const csv = '﻿' + rows.map((r) => r.map(escape).join(';')).join('\r\n')
  return new Blob([csv], { type: 'text/csv;charset=utf-8' })
}

const ccName = (costCenters: CostCenter[], id: string | null) =>
  costCenters.find((c) => c.id === id)?.name ?? '–'

function journalRows(txs: Transaction[], costCenters: CostCenter[]): Cell[][] {
  const rows: Cell[][] = [
    ['Datum', 'Buchungstext', 'Kategorie', 'Kostenstelle', 'Einnahme (EUR)', 'Ausgabe (EUR)', 'Beleg'],
  ]

  for (const t of [...txs].sort((a, b) => a.tx_date.localeCompare(b.tx_date))) {
    rows.push([
      fdate(t.tx_date),
      t.description,
      t.category,
      ccName(costCenters, t.cost_center_id),
      t.direction === 'in' ? centsToDecimal(t.amount_cents) : '',
      t.direction === 'out' ? centsToDecimal(t.amount_cents) : '',
      t.receipt_path ? 'ja' : '',
    ])
  }

  const s = sums(txs)
  rows.push([], ['Summe', '', '', '', centsToDecimal(s.ein), centsToDecimal(s.aus)])
  rows.push(['Ergebnis', '', '', '', centsToDecimal(s.erg), ''])
  return rows
}

/** Journal oder Nachkalkulation als CSV. */
export function exportJournalCsv(
  txs: Transaction[],
  costCenters: CostCenter[],
  filename: string,
): void {
  download(toCsv(journalRows(txs, costCenters)), filename)
}

/** Jahresabschluss als CSV: Eckdaten, Kategorien, Kostenstellen. */
export function exportYearCsv(
  year: number,
  tenantName: string,
  dekade: string | null,
  opening: number,
  txs: Transaction[],
  costCenters: CostCenter[],
): void {
  const s = sums(txs)

  const rows: Cell[][] = [
    [`Jahresabschluss ${year} – ${tenantName}`],
    ['Funktionsperiode', dekade ?? '–'],
    [],
    ['Anfangsbestand', '', '', centsToDecimal(opening)],
    ['Einnahmen gesamt', '', '', centsToDecimal(s.ein)],
    ['Ausgaben gesamt', '', '', centsToDecimal(s.aus)],
    ['Endbestand', '', '', centsToDecimal(opening + s.erg)],
    [],
    ['Kategorie', 'Einnahmen', 'Ausgaben', 'Saldo'],
  ]

  for (const c of byCategory(txs)) {
    rows.push([
      c.category,
      centsToDecimal(c.ein),
      centsToDecimal(c.aus),
      centsToDecimal(c.ein - c.aus),
    ])
  }

  rows.push([], ['Kostenstelle', 'Einnahmen', 'Ausgaben', 'Ergebnis'])
  for (const cc of costCenters) {
    const cs = ccSums(txs, cc.id)
    if (cs.count === 0) continue
    rows.push([cc.name, centsToDecimal(cs.ein), centsToDecimal(cs.aus), centsToDecimal(cs.erg)])
  }

  download(toCsv(rows), `jahresabschluss_${year}.csv`)
}

/**
 * Monatsabschluss: XLSX plus alle Belege des Monats in einem ZIP.
 *
 * Die Belege liegen im privaten receipts-Bucket und werden hier einzeln geladen.
 * Schlägt ein Download fehl (z.B. Datei gelöscht), wird das im ZIP dokumentiert
 * statt still weggelassen – ein unvollständiger Abschluss darf nicht wie ein
 * vollständiger aussehen.
 *
 * Gibt das ZIP zurück, damit der Aufrufer es zusätzlich in den exports-Bucket
 * legen kann.
 */
export async function buildMonthZip(
  month: string,
  tenantName: string,
  txs: Transaction[],
  costCenters: CostCenter[],
  carry: number,
): Promise<Blob> {
  // XLSX und JSZip sind zusammen ~700 kB und werden ausschließlich hier
  // gebraucht. Dynamisch geladen bleiben sie aus dem Haupt-Bundle heraus –
  // sonst zahlt jedes Mitglied beim ersten Seitenaufruf dafür, obwohl nur die
  // Kassenführung je einen Monatsabschluss macht.
  const [{ default: JSZip }, XLSX] = await Promise.all([import('jszip'), import('xlsx')])

  const s = sums(txs)

  const aoa: Cell[][] = [
    [`Monatsabschluss ${monthLabel(month)} – ${tenantName}`],
    [],
    ['Übertrag Vormonat', '', '', '', centsToDecimal(carry)],
    [],
    ['Datum', 'Buchungstext', 'Kategorie', 'Kostenstelle', 'Einnahme', 'Ausgabe', 'Beleg'],
  ]

  const sorted = [...txs].sort((a, b) => a.tx_date.localeCompare(b.tx_date))
  for (const t of sorted) {
    aoa.push([
      fdate(t.tx_date),
      t.description,
      t.category,
      ccName(costCenters, t.cost_center_id),
      t.direction === 'in' ? centsToDecimal(t.amount_cents) : '',
      t.direction === 'out' ? centsToDecimal(t.amount_cents) : '',
      t.receipt_path ? t.receipt_path.split('/').pop()! : '',
    ])
  }

  aoa.push([], ['Summe Monat', '', '', '', centsToDecimal(s.ein), centsToDecimal(s.aus)])
  aoa.push(['Kassastand Monatsende', '', '', '', centsToDecimal(carry + s.erg)])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, month)
  const xlsx = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  const zip = new JSZip()
  zip.file(`monatsabschluss_${month}.xlsx`, xlsx)

  const folder = zip.folder('belege')!
  const missing: string[] = []

  for (const t of sorted) {
    if (!t.receipt_path) continue
    const blob = await downloadReceipt(t.receipt_path)
    if (blob) {
      folder.file(t.receipt_path.split('/').pop()!, blob)
    } else {
      missing.push(`${t.receipt_path} (${t.description})`)
    }
  }

  const withReceipt = sorted.filter((t) => t.receipt_path).length

  zip.file(
    'hinweis.txt',
    [
      `Monatsabschluss ${monthLabel(month)} – ${tenantName}`,
      '',
      `Buchungen: ${sorted.length}`,
      `Belege verknüpft: ${withReceipt}`,
      `Belege im Archiv: ${withReceipt - missing.length}`,
      '',
      missing.length > 0
        ? `ACHTUNG – folgende Belege konnten NICHT geladen werden:\r\n- ${missing.join('\r\n- ')}`
        : 'Alle verknüpften Belege sind enthalten.',
    ].join('\r\n'),
  )

  return zip.generateAsync({ type: 'blob' })
}

export function downloadZip(zip: Blob, month: string): void {
  download(zip, `monatsabschluss_${month}.zip`)
}

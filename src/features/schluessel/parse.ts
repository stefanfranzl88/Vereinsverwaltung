import type { KeyLogRow } from '@/types'

/** "04.06.2026" oder "2026-06-04" → "2026-06-04". Sonst null. */
function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  // dd.mm.yyyy (EVVA/Österreich)
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (de) {
    const [, d, m, y] = de
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // yyyy-mm-dd (evtl. mit Uhrzeit dahinter)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  return null
}

/** "18:42" oder "18:42:37" → "18:42". Sonst null. */
function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * Parst einen EVVA-Export (.xls/.xlsx/.csv). Spalten wie im Prototyp:
 * 0 = Datum, 1 = Uhrzeit, 2 = Chip/Person, 3 = Ereignis.
 *
 * Es werden nur Zeilen übernommen, deren erste Spalte eine Ziffer enthält –
 * damit fallen Kopf- und Leerzeilen des Exports heraus. Datum und Uhrzeit
 * werden zu ISO normalisiert; was sich nicht parsen lässt, geht als null in
 * die Datenbank, der Rohtext (chip_info) bleibt erhalten.
 */
export async function parseKeyLog(file: File): Promise<KeyLogRow[]> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false })

  return rows
    .filter((r) => Array.isArray(r) && r.length >= 2 && /\d/.test(String(r[0] ?? '')))
    .map((r) => ({
      date: normalizeDate(String(r[0] ?? '')),
      time: normalizeTime(String(r[1] ?? '')),
      chip_info: String(r[2] ?? 'unbekannt').trim(),
      event: String(r[3] ?? 'Tür geöffnet').trim(),
    }))
}

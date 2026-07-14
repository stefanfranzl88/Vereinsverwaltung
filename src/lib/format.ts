import type { Member } from '@/types'

export const eur = (cents: number) =>
  new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export const fdate = (d: string | null) =>
  d ? new Date(`${d}T00:00`).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'

export const fullName = (m: Pick<Member, 'first_name' | 'last_name'>) =>
  `${m.first_name} ${m.last_name}`.trim()

/** Heutiges Datum als ISO-Tag (YYYY-MM-DD) – vergleichbar mit den date-Spalten. */
export const today = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "Jul" – für den Datums-Chip. */
export const monthShort = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString('de-AT', { month: 'short' }).replace('.', '')

/** "19:00" aus einer Postgres-time ("19:00:00"). */
export const ftime = (t: string | null) => (t ? t.slice(0, 5) : null)

/** Ganze Tage zwischen einem Datum und heute (positiv = liegt in der Vergangenheit). */
export const daysSince = (iso: string): number => {
  const then = new Date(`${iso}T00:00`).getTime()
  const now = new Date(`${today()}T00:00`).getTime()
  return Math.round((now - then) / 86_400_000)
}

export const initials = (m: Pick<Member, 'first_name' | 'last_name'>) =>
  `${m.first_name[0] ?? ''}${m.last_name[0] ?? ''}`.toUpperCase()

/**
 * Jubiläum: volle 5-Jahres-Schritte der Mitgliedschaft.
 *
 * `years` > 0 heißt: heuer ist ein Jubiläumsjahr (5, 10, 15 …). So macht es der
 * Prototyp in der Mitgliederliste – die Unterzeile dort lautet "🏅 = Jubiläum heuer".
 *
 * `thisMonth` sagt zusätzlich, ob der Eintrittsmonat der laufende Monat ist, das
 * Jubiläum also JETZT ansteht. Der Prototyp nutzt das auf dem Dashboard, um die
 * Jubilare des Monats hervorzuheben.
 *
 * Im Prototyp war 2026 fix verdrahtet – hier zählt das echte aktuelle Datum.
 */
export interface Jubilee {
  /** 0 = kein Jubiläum heuer, sonst die erreichten Jahre (5, 10, 15 …). */
  years: number
  /** Eintrittsmonat = aktueller Monat: das Jubiläum ist in diesem Monat. */
  thisMonth: boolean
}

export const jubilee = (m: Pick<Member, 'joined_at'>): Jubilee => {
  if (!m.joined_at) return { years: 0, thisMonth: false }

  const now = new Date()
  const years = now.getFullYear() - Number(m.joined_at.slice(0, 4))
  const isJubYear = years > 0 && years % 5 === 0
  const joinedMonth = Number(m.joined_at.slice(5, 7))

  return {
    years: isJubYear ? years : 0,
    thisMonth: isJubYear && joinedMonth === now.getMonth() + 1,
  }
}

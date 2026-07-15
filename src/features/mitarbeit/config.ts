/**
 * Mitarbeitspunkte-Konfiguration aus tenants.settings.mitarbeit.
 *
 * Fehlt die Config (neuer Verein), greifen die Defaults – die App ist sofort
 * lauffähig, ohne dass jemand etwas einstellen muss.
 */

export interface RewardTier {
  threshold: number
  label: string
}

export interface MitarbeitConfig {
  /** Punktwert je Anwesenheitsart. Schlüssel = Art, Wert = Punkte (auch 0/Komma). */
  point_values: Record<string, number>
  reward_tiers: RewardTier[]
  /** Ab diesem Datum wird gezählt (null = alles). */
  count_from: string | null
}

/** Standard-Punktwerte – decken die fünf Prototyp-Arten ab. */
export const DEFAULT_POINT_VALUES: Record<string, number> = {
  Sitzung: 1,
  Aufbau: 2,
  Abbau: 2,
  Veranstaltung: 2,
  Sonstiges: 1,
}

/** Standard-Belohnungsstufen (wie im Prototyp), bis der Verein eigene setzt. */
export const DEFAULT_TIERS: RewardTier[] = [
  { threshold: 4, label: '−50 % Selbstbehalt Vereinsausflug' },
  { threshold: 6, label: 'Selbstbehalt entfällt komplett' },
]

/** Punktwert einer Art mit Fallback auf den Standard (Sitzung 1, Einsätze 2). */
export function pointValueFor(config: MitarbeitConfig, type: string): number {
  const configured = config.point_values[type]
  if (typeof configured === 'number' && !Number.isNaN(configured)) return configured
  return DEFAULT_POINT_VALUES[type] ?? 0
}

/**
 * Liest die Config aus tenants.settings. Fehlende Teile werden mit Defaults
 * gefüllt, damit die Oberfläche nie mit einer leeren Config dasteht.
 */
export function readMitarbeitConfig(settings: Record<string, unknown> | undefined): MitarbeitConfig {
  const raw = (settings?.mitarbeit ?? {}) as Partial<MitarbeitConfig>

  const pv = raw.point_values && typeof raw.point_values === 'object' ? raw.point_values : null
  const point_values =
    pv && Object.keys(pv).length > 0 ? { ...(pv as Record<string, number>) } : { ...DEFAULT_POINT_VALUES }

  const tiers = Array.isArray(raw.reward_tiers) ? raw.reward_tiers : null
  const reward_tiers = (tiers ?? DEFAULT_TIERS)
    .filter((t): t is RewardTier => typeof t?.threshold === 'number' && typeof t?.label === 'string')
    .slice()
    .sort((a, b) => a.threshold - b.threshold)

  const count_from = typeof raw.count_from === 'string' && raw.count_from ? raw.count_from : null

  return { point_values, reward_tiers, count_from }
}

/** Sortierte Art-Liste für Dropdowns (Standardarten zuerst, dann eigene). */
export function attendanceTypes(config: MitarbeitConfig): string[] {
  const keys = Object.keys(config.point_values)
  const standard = Object.keys(DEFAULT_POINT_VALUES)
  const custom = keys.filter((k) => !standard.includes(k)).sort((a, b) => a.localeCompare(b, 'de'))
  const standardsPresent = standard.filter((k) => keys.includes(k))
  return [...standardsPresent, ...custom]
}

/** Höchste erreichte Belohnungsstufe für eine Punktezahl (oder null). */
export function highestTier(config: MitarbeitConfig, punkte: number): RewardTier | null {
  let best: RewardTier | null = null
  for (const t of config.reward_tiers) {
    if (punkte >= t.threshold && (best === null || t.threshold > best.threshold)) best = t
  }
  return best
}

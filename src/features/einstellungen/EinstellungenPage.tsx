import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import {
  DEFAULT_POINT_VALUES,
  readMitarbeitConfig,
  type MitarbeitConfig,
  type RewardTier,
} from '@/features/mitarbeit/config'
import {
  removeLogo,
  renameAttendanceType,
  setKeyInterval,
  setMitarbeitConfig,
  updateTenantBasics,
  uploadLogo,
} from './api'

const STANDARD_TYPES = Object.keys(DEFAULT_POINT_VALUES)

interface PvRow {
  type: string
  value: string
}
interface TierRow {
  threshold: string
  label: string
}

export function EinstellungenPage() {
  const { tenant, refresh } = useAuth()
  const { toast, toastError } = useToast()
  const tenantId = tenant?.id ?? ''

  // ---- Vereinsdaten ----
  const [name, setName] = useState(tenant?.name ?? '')
  const [zvr, setZvr] = useState(tenant?.zvr_zahl ?? '')
  const [dekade, setDekade] = useState(tenant?.dekade ?? '')

  // ---- Schlüssel-Intervall ----
  const initialInterval =
    typeof tenant?.settings?.key_interval_days === 'number' ? tenant.settings.key_interval_days : 30
  const [interval, setIntervalState] = useState(String(initialInterval))

  // ---- Mitarbeitspunkte ----
  const config = useMemo(() => readMitarbeitConfig(tenant?.settings), [tenant?.settings])
  const [pv, setPv] = useState<PvRow[]>(
    Object.entries(config.point_values).map(([type, value]) => ({ type, value: String(value) })),
  )
  const [tiers, setTiers] = useState<TierRow[]>(
    config.reward_tiers.map((t) => ({ threshold: String(t.threshold), label: t.label })),
  )
  const [countFrom, setCountFrom] = useState(config.count_from ?? '')
  const [newType, setNewType] = useState('')
  const [renaming, setRenaming] = useState<{ type: string; value: string } | null>(null)

  // ---------------------------------------------------------------
  // Mutationen
  // ---------------------------------------------------------------
  const basicsM = useMutation({
    mutationFn: () =>
      updateTenantBasics(tenantId, {
        name: name.trim(),
        zvr_zahl: zvr.trim() || null,
        dekade: dekade.trim() || null,
      }),
    onSuccess: async () => {
      await refresh()
      toast('Vereinsdaten gespeichert')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const intervalM = useMutation({
    mutationFn: (days: number) => setKeyInterval(days),
    onSuccess: async () => {
      await refresh()
      toast('Erinnerungsintervall gespeichert')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const logoM = useMutation({
    mutationFn: (file: File) => uploadLogo(tenantId, file),
    onSuccess: async () => {
      await refresh()
      toast('Logo aktualisiert')
    },
    onError: (e: Error) => toastError(`Logo-Upload fehlgeschlagen: ${e.message}`),
  })

  const logoRemoveM = useMutation({
    mutationFn: () => removeLogo(tenantId),
    onSuccess: async () => {
      await refresh()
      toast('Logo entfernt')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const buildConfig = (): MitarbeitConfig => {
    const point_values: Record<string, number> = {}
    for (const r of pv) {
      const key = r.type.trim()
      if (!key) continue
      const n = Number(r.value.replace(',', '.'))
      point_values[key] = Number.isFinite(n) ? n : 0
    }
    const reward_tiers: RewardTier[] = tiers
      .map((t) => ({ threshold: Number(t.threshold.replace(',', '.')), label: t.label.trim() }))
      .filter((t) => Number.isFinite(t.threshold) && t.label.length > 0)
      .sort((a, b) => a.threshold - b.threshold)
    return { point_values, reward_tiers, count_from: countFrom || null }
  }

  const mitarbeitM = useMutation({
    mutationFn: () => setMitarbeitConfig(buildConfig()),
    onSuccess: async () => {
      await refresh()
      toast('Mitarbeitspunkte-Konfiguration gespeichert')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const renameM = useMutation({
    // Erst offene Wert-Änderungen sichern, dann umbenennen (zieht Protokolle mit).
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      await setMitarbeitConfig(buildConfig())
      await renameAttendanceType(oldName, newName)
    },
    onSuccess: async (_d, vars) => {
      // Lokalen State mitziehen – refresh() aktualisiert nur tenant.settings.
      setPv((prev) => prev.map((r) => (r.type === vars.oldName ? { ...r, type: vars.newName } : r)))
      setRenaming(null)
      await refresh()
      toast('Art umbenannt (bestehende Protokolle mitgezogen)')
    },
    onError: (e: Error) => toastError(e.message),
  })

  // ---------------------------------------------------------------
  const onLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) logoM.mutate(f)
    e.target.value = ''
  }

  const addType = () => {
    const key = newType.trim()
    if (!key) return
    if (pv.some((r) => r.type === key)) {
      toastError('Diese Art gibt es schon')
      return
    }
    setPv([...pv, { type: key, value: '1' }])
    setNewType('')
  }

  return (
    <>
      <h2 className="view-title">Grundeinstellungen</h2>
      <p className="view-sub">Vereinsdaten, Logo und Mitarbeitspunkte – nur für die Verwaltung</p>

      {/* ---------------- Vereinsdaten ---------------- */}
      <div className="card">
        <h3>🏛 Vereinsdaten</h3>
        <div className="stack">
          <div>
            <label htmlFor="t-name">Vereinsname</label>
            <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-grid">
            <div>
              <label htmlFor="t-zvr">ZVR-Zahl</label>
              <input id="t-zvr" value={zvr} onChange={(e) => setZvr(e.target.value)} />
            </div>
            <div>
              <label htmlFor="t-dekade">Funktionsperiode (Dekade)</label>
              <input
                id="t-dekade"
                placeholder="2023 – 2028"
                value={dekade}
                onChange={(e) => setDekade(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn small"
            disabled={basicsM.isPending || !name.trim()}
            onClick={() => basicsM.mutate()}
          >
            {basicsM.isPending ? 'Speichern…' : 'Vereinsdaten speichern'}
          </button>
        </div>
      </div>

      {/* ---------------- Logo ---------------- */}
      <div className="card">
        <h3>🖼 Logo</h3>
        <div className="row" style={{ gap: 16 }}>
          <div className="brand-mark" style={{ width: 64, height: 64 }}>
            {tenant?.logo_url ? <img src={tenant.logo_url} alt="" /> : (tenant?.name ?? '?').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <label className="btn ghost small" style={{ cursor: 'pointer' }}>
              {logoM.isPending ? 'Wird hochgeladen…' : '📎 Logo hochladen'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                disabled={logoM.isPending}
                onChange={onLogoFile}
              />
            </label>
            {tenant?.logo_url && (
              <button
                className="btn ghost small"
                style={{ marginLeft: 8 }}
                disabled={logoRemoveM.isPending}
                onClick={() => logoRemoveM.mutate()}
              >
                Entfernen
              </button>
            )}
            <p className="hint">Wird in der Topbar und auf der Login-Seite angezeigt.</p>
          </div>
        </div>
      </div>

      {/* ---------------- Schlüssel-Erinnerung ---------------- */}
      <div className="card">
        <h3>🔑 Schlüssel-Auslese-Erinnerung</h3>
        <div className="row">
          <label style={{ fontWeight: 600, fontSize: 13.5 }}>Erinnerung alle</label>
          <input
            type="number"
            min={1}
            value={interval}
            style={{ width: 80, padding: 8, border: '1px solid var(--line)', borderRadius: 8 }}
            onChange={(e) => setIntervalState(e.target.value)}
          />
          <span style={{ fontSize: 13.5 }}>Tage</span>
          <button
            className="btn ghost small"
            disabled={intervalM.isPending || Number(interval) < 1}
            onClick={() => intervalM.mutate(Number(interval))}
          >
            Speichern
          </button>
        </div>
      </div>

      {/* ---------------- Mitarbeitspunkte ---------------- */}
      <div className="card">
        <h3>⭐ Mitarbeitspunkte</h3>

        <h4 style={{ margin: '8px 0 6px', fontSize: 14 }}>Punkte je Anwesenheitsart</h4>
        <p className="meta" style={{ marginBottom: 8 }}>
          Kommazahlen und 0 sind erlaubt. Eigene Arten erscheinen automatisch im Protokoll-Editor.
        </p>
        <div className="table-wrap">
          <table>
            <tbody>
              {pv.map((r, i) => (
                <tr key={r.type}>
                  <td>
                    <b>{r.type}</b>
                    {!STANDARD_TYPES.includes(r.type) && (
                      <span className="pill grey" style={{ marginLeft: 6 }}>
                        eigene Art
                      </span>
                    )}
                  </td>
                  <td style={{ width: 110 }}>
                    <input
                      inputMode="decimal"
                      value={r.value}
                      onChange={(e) =>
                        setPv(pv.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
                      }
                      style={{ width: 90 }}
                    />
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn ghost small"
                      onClick={() => setRenaming({ type: r.type, value: r.type })}
                    >
                      Umbenennen
                    </button>
                    <button
                      className="btn ghost small"
                      onClick={() => setPv(pv.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <input
            placeholder="Neue Art (z. B. Arbeitseinsatz)"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn ghost small" onClick={addType}>
            + Art hinzufügen
          </button>
        </div>

        {renaming && (
          <div className="notice" style={{ marginTop: 10 }}>
            <b>„{renaming.type}" umbenennen</b> – bestehende Protokolle werden mitgezogen.
            <div className="row" style={{ marginTop: 6 }}>
              <input
                autoFocus
                value={renaming.value}
                onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                style={{ flex: 1 }}
              />
              <button
                className="btn small"
                disabled={renameM.isPending || !renaming.value.trim()}
                onClick={() =>
                  renameM.mutate({ oldName: renaming.type, newName: renaming.value.trim() })
                }
              >
                {renameM.isPending ? '…' : 'Umbenennen'}
              </button>
              <button className="btn ghost small" onClick={() => setRenaming(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        )}

        <h4 style={{ margin: '18px 0 6px', fontSize: 14 }}>Belohnungsstufen</h4>
        <p className="meta" style={{ marginBottom: 8 }}>
          Ab welcher Punktezahl gibt es was? Wird nach Schwelle sortiert.
        </p>
        {tiers.map((t, i) => (
          <div className="row" key={i} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
            <span style={{ fontSize: 13.5 }}>ab</span>
            <input
              inputMode="decimal"
              value={t.threshold}
              onChange={(e) =>
                setTiers(tiers.map((x, idx) => (idx === i ? { ...x, threshold: e.target.value } : x)))
              }
              style={{ width: 70 }}
            />
            <span style={{ fontSize: 13.5 }}>P:</span>
            <input
              placeholder="Belohnung"
              value={t.label}
              onChange={(e) =>
                setTiers(tiers.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))
              }
              style={{ flex: 1 }}
            />
            <button
              className="btn ghost small"
              onClick={() => setTiers(tiers.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn ghost small"
          onClick={() => setTiers([...tiers, { threshold: '', label: '' }])}
        >
          + Stufe hinzufügen
        </button>

        <h4 style={{ margin: '18px 0 6px', fontSize: 14 }}>Zählung ab</h4>
        <div className="row">
          <input type="date" value={countFrom} onChange={(e) => setCountFrom(e.target.value)} />
          {countFrom && (
            <button className="btn ghost small" onClick={() => setCountFrom('')}>
              zurücksetzen (alles zählen)
            </button>
          )}
        </div>
        <p className="hint">
          Nur Protokolle ab diesem Datum zählen – so lässt sich die Wertung jährlich zurücksetzen.
        </p>

        <div className="row" style={{ marginTop: 14 }}>
          <button
            className="btn"
            disabled={mitarbeitM.isPending}
            onClick={() => mitarbeitM.mutate()}
          >
            {mitarbeitM.isPending ? 'Speichern…' : 'Mitarbeitspunkte-Konfiguration speichern'}
          </button>
        </div>
      </div>
    </>
  )
}

import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { daysSince, fdate } from '@/lib/format'
import { fetchMembers, keyChipsKey, membersKey } from '@/features/members/api'
import type { KeyLogRow } from '@/types'
import {
  assignChip,
  fetchKeyChips,
  fetchKeyLog,
  fetchKeyUploads,
  importKeyLog,
  keyChipsFullKey,
  keyLogKey,
  keyUploadsKey,
  revokeChip,
  setKeyInterval,
} from './api'
import { parseKeyLog } from './parse'
import { ChipDialog } from './ChipDialog'

/** Liest Intervall und letztes Auslesedatum aus tenant.settings. */
function keySettings(settings: Record<string, unknown> | undefined) {
  const interval = settings?.key_interval_days
  const last = settings?.last_key_log
  return {
    intervalDays: typeof interval === 'number' ? interval : 30,
    lastKeyLog: typeof last === 'string' ? last : null,
  }
}

export function SchluesselPage() {
  const { tenant, can, refresh } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const mayManage = can('keys.manage')
  const mayViewLog = can('keylog.view')
  const mayUpload = can('keylog.upload')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [interval, setIntervalState] = useState<number | null>(null)

  const { intervalDays, lastKeyLog } = keySettings(tenant?.settings)
  const sinceLast = lastKeyLog ? daysSince(lastKeyLog) : null
  const due = sinceLast === null || sinceLast >= intervalDays

  const chipsQuery = useQuery({
    queryKey: keyChipsFullKey(tenantId),
    queryFn: () => fetchKeyChips(tenantId),
    enabled: Boolean(tenantId),
  })
  const membersQuery = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })
  const logQuery = useQuery({
    queryKey: keyLogKey(tenantId),
    queryFn: () => fetchKeyLog(tenantId),
    enabled: Boolean(tenantId) && mayViewLog,
  })
  const uploadsQuery = useQuery({
    queryKey: keyUploadsKey(tenantId),
    queryFn: () => fetchKeyUploads(tenantId),
    enabled: Boolean(tenantId) && mayUpload,
  })

  const chips = chipsQuery.data ?? []
  const members = membersQuery.data ?? []

  // Chips gibt es nur einmal pro Person → für den Dialog nur Mitglieder ohne Chip.
  const withoutChip = useMemo(() => {
    const taken = new Set(chips.map((c) => c.member_id))
    return members.filter((m) => !taken.has(m.id))
  }, [chips, members])

  const suggestedNr = `CHIP-${String(chips.length + 1).padStart(3, '0')}`

  const refreshChips = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keyChipsFullKey(tenantId) }),
      // Das 🔑 in der Mitgliederliste hängt an denselben Daten.
      queryClient.invalidateQueries({ queryKey: keyChipsKey(tenantId) }),
    ])

  const assignM = useMutation({
    mutationFn: ({ memberId, chipNr }: { memberId: string; chipNr: string }) =>
      assignChip(memberId, chipNr),
    onSuccess: async () => {
      await refreshChips()
      setDialogOpen(false)
      toast('Chip ausgegeben')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const revokeM = useMutation({
    mutationFn: (chipId: string) => revokeChip(chipId),
    onSuccess: async () => {
      await refreshChips()
      toast('Chip entzogen')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const intervalM = useMutation({
    mutationFn: (days: number) => setKeyInterval(days),
    onSuccess: async () => {
      await refresh()
      setIntervalState(null)
      toast('Erinnerungsintervall gespeichert')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const uploadM = useMutation({
    mutationFn: async (file: File) => {
      const rows: KeyLogRow[] = await parseKeyLog(file)
      if (rows.length === 0) {
        throw new Error('Keine gültigen Zeilen erkannt – bitte Format des Exports prüfen')
      }
      await importKeyLog(file.name, rows)
      return rows.length
    },
    onSuccess: async (count) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keyLogKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: keyUploadsKey(tenantId) }),
        refresh(), // last_key_log hat sich geändert → Erinnerung nachziehen
      ])
      toast(`${count} Zutritte importiert – Erinnerung zurückgesetzt`)
    },
    onError: (e: Error) => toastError(e.message),
  })

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadM.mutate(file)
    e.target.value = ''
  }

  const onIntervalBlur = () => {
    if (interval !== null && interval >= 1 && interval !== intervalDays) {
      intervalM.mutate(interval)
    } else {
      setIntervalState(null)
    }
  }

  const confirmRevoke = (chipId: string, name: string) => {
    if (window.confirm(`Chip von ${name} wirklich entziehen?`)) revokeM.mutate(chipId)
  }

  if (chipsQuery.error) {
    return (
      <>
        <h2 className="view-title">Schlüsselverwaltung</h2>
        <div className="error-box">
          Schlüsselverwaltung konnte nicht geladen werden: {chipsQuery.error.message}
        </div>
      </>
    )
  }

  return (
    <>
      <h2 className="view-title">Schlüsselverwaltung</h2>
      <p className="view-sub">
        Chipschloss Lagerraum · {chips.length} Chips ausgegeben ·{' '}
        {mayManage ? 'Verwaltung aktiv' : 'Einsicht (Verwaltung nur mit Berechtigung)'}
      </p>

      {mayUpload && due && (
        <div className="notice">
          ⏰ <b>Schloss auslesen fällig!</b>{' '}
          {sinceLast === null
            ? 'Es wurde noch kein Zutrittsprotokoll hochgeladen.'
            : `Letzter Upload vor ${sinceLast} Tagen (Intervall: ${intervalDays} Tage).`}{' '}
          Bitte EVVA-App auslesen und die Datei unten hochladen.
        </div>
      )}

      <div className="grid2">
        {/* -------- Chips -------- */}
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>🔑 Ausgegebene Schlüsselchips</h3>
            <div className="spacer" />
            {mayManage && (
              <button
                className="btn small"
                disabled={withoutChip.length === 0}
                onClick={() => setDialogOpen(true)}
              >
                + Chip zuweisen
              </button>
            )}
          </div>

          {chipsQuery.isPending ? (
            <p className="meta">Wird geladen…</p>
          ) : chips.length === 0 ? (
            <p className="meta">Noch keine Chips ausgegeben.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Chip-Nr.</th>
                    <th>seit</th>
                    {mayManage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {chips.map((c) => {
                    const name = c.members
                      ? `${c.members.first_name} ${c.members.last_name}`
                      : 'Unbekannt'
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                            {c.members ? (
                              <Avatar member={c.members} size={30} />
                            ) : (
                              <div className="avatar">?</div>
                            )}
                            <b>{name}</b>
                            {c.members?.funktion && (
                              <span className="pill amber">{c.members.funktion}</span>
                            )}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 13 }}>
                          {c.chip_nr}
                        </td>
                        <td className="mono" style={{ fontSize: 13 }}>
                          {fdate(c.issued_at)}
                        </td>
                        {mayManage && (
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn ghost small"
                              disabled={revokeM.isPending}
                              onClick={() => confirmRevoke(c.id, name)}
                            >
                              Entziehen
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="meta" style={{ marginTop: 8 }}>
            Chips können auch an Mitglieder ohne Vorstandsfunktion ausgegeben werden. Die
            🔑-Kennzeichnung erscheint automatisch in der Mitgliederliste.
          </p>
        </div>

        {/* -------- Erinnerung, Upload, Protokoll -------- */}
        <div>
          {mayUpload && (
            <>
              <div className="card">
                <h3>⏰ Auslese-Erinnerung</h3>
                <p style={{ fontSize: 14 }}>
                  Letzter Upload:{' '}
                  <b className="mono">{lastKeyLog ? fdate(lastKeyLog) : 'noch nie'}</b>
                  {sinceLast !== null && ` (vor ${sinceLast} Tagen)`}
                </p>
                <div className="row" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 13.5, fontWeight: 600 }}>Erinnerung alle</label>
                  <input
                    type="number"
                    min={1}
                    value={interval ?? intervalDays}
                    style={{
                      width: 70,
                      padding: 7,
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                    }}
                    onChange={(e) => setIntervalState(Number(e.target.value))}
                    onBlur={onIntervalBlur}
                  />
                  <span style={{ fontSize: 13.5 }}>Tage</span>
                </div>
                <p className="meta" style={{ marginTop: 8 }}>
                  Bei Fälligkeit erscheint ein Hinweis am Dashboard.
                </p>
              </div>

              <div className="card">
                <h3>⬆️ Schlüsselprotokoll hochladen</h3>
                <label
                  className="upload-zone"
                  style={{ display: 'block', cursor: uploadM.isPending ? 'wait' : 'pointer' }}
                >
                  <input
                    type="file"
                    accept=".xls,.xlsx,.csv"
                    style={{ display: 'none' }}
                    disabled={uploadM.isPending}
                    onChange={onFile}
                  />
                  {uploadM.isPending
                    ? '⏳ Wird importiert…'
                    : '📎 EVVA-Export auswählen (.xls / .xlsx / .csv)'}
                </label>

                {(uploadsQuery.data ?? []).length > 0 && (
                  <p className="meta" style={{ marginTop: 8 }}>
                    Bisherige Uploads:{' '}
                    {(uploadsQuery.data ?? [])
                      .map(
                        (u) =>
                          `${u.file_name ?? 'Datei'} (${fdate(u.created_at.slice(0, 10))}, ${
                            u.row_count ?? 0
                          } Zeilen)`,
                      )
                      .join(' · ')}
                  </p>
                )}
              </div>
            </>
          )}

          {mayViewLog && (
            <div className="card">
              <h3>📋 Zutrittsprotokoll Lagerraum</h3>
              {logQuery.isPending ? (
                <p className="meta">Wird geladen…</p>
              ) : (logQuery.data ?? []).length === 0 ? (
                <p className="meta">Noch keine Zutritte importiert.</p>
              ) : (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Uhrzeit</th>
                          <th>Chip / Person</th>
                          <th>Ereignis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(logQuery.data ?? []).slice(0, 25).map((l) => {
                          const denied = (l.event ?? '').toLowerCase().includes('verweigert')
                          return (
                            <tr key={l.id}>
                              <td className="mono" style={{ fontSize: 13 }}>
                                {l.entry_date ? fdate(l.entry_date) : '–'}
                              </td>
                              <td className="mono" style={{ fontSize: 13 }}>
                                {l.entry_time ? l.entry_time.slice(0, 5) : '–'}
                              </td>
                              <td>{l.chip_info ?? '–'}</td>
                              <td>
                                {denied ? (
                                  <span className="pill red">{l.event}</span>
                                ) : (
                                  (l.event ?? '–')
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="meta" style={{ marginTop: 8 }}>
                    {(logQuery.data ?? []).length} Einträge geladen · Quelle: Export aus der
                    Schloss-App.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {dialogOpen && (
        <ChipDialog
          members={withoutChip}
          suggestedNr={suggestedNr}
          saving={assignM.isPending}
          onSave={(memberId, chipNr) => assignM.mutate({ memberId, chipNr })}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}

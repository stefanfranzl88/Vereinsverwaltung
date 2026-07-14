import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { eur, fdate } from '@/lib/format'
import type { CostCenter, CostCenterType, Transaction } from '@/types'
import {
  closeMonth,
  closingsKey,
  costCentersKey,
  createCostCenter,
  fetchClosings,
  fetchCostCenters,
  fetchTransactions,
  transactionsKey,
} from './api'
import {
  byCategory,
  carryOver,
  ccSums,
  inYear,
  monthCloseDue,
  monthLabel,
  nextOpenMonth,
  openingBalance,
  recurringSeries,
  sums,
} from './logic'
import { buildMonthZip, downloadZip, exportJournalCsv, exportYearCsv } from './export'
import { NewTransactionCard } from './NewTransactionCard'
import { CostCenterDialog } from './CostCenterDialog'
import { ReceiptLink } from './ReceiptLink'

type View = 'overview' | 'detail' | 'month' | 'year'

/** Vorzeichenbehaftete Darstellung: "+ 1.250,00 €" / "− 340,00 €" */
function Signed({ cents }: { cents: number }) {
  const positive = cents >= 0
  return (
    <span style={{ color: positive ? 'var(--pine)' : 'var(--red)' }}>
      {positive ? '+' : '−'} {eur(Math.abs(cents))}
    </span>
  )
}

export function KassaPage() {
  const { tenant, member: me, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const mayEdit = can('kassa.edit')

  // Events & Projekte verlinken mit /kassa?cc=<id> direkt auf die Nachkalkulation.
  const [searchParams, setSearchParams] = useSearchParams()
  const ccParam = searchParams.get('cc')

  const [view, setView] = useState<View>(ccParam ? 'detail' : 'overview')
  const [detailCc, setDetailCc] = useState<string | null>(ccParam)
  const [ccDialog, setCcDialog] = useState(false)
  const [closing, setClosing] = useState(false)

  const backToOverview = () => {
    setView('overview')
    setDetailCc(null)
    if (ccParam) setSearchParams({}, { replace: true })
  }

  const year = new Date().getFullYear()

  const ccQuery = useQuery({
    queryKey: costCentersKey(tenantId),
    queryFn: () => fetchCostCenters(tenantId),
    enabled: Boolean(tenantId),
  })
  const txQuery = useQuery({
    queryKey: transactionsKey(tenantId),
    queryFn: () => fetchTransactions(tenantId),
    enabled: Boolean(tenantId),
  })
  const closingsQuery = useQuery({
    queryKey: closingsKey(tenantId),
    queryFn: () => fetchClosings(tenantId),
    enabled: Boolean(tenantId),
  })

  const ccMutation = useMutation({
    mutationFn: ({ name, ccType }: { name: string; ccType: CostCenterType }) =>
      createCostCenter(tenantId, name, ccType),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: costCentersKey(tenantId) })
      setCcDialog(false)
      toast('Kostenstelle angelegt')
    },
    onError: (e: Error) => toastError(`Nicht angelegt: ${e.message}`),
  })

  const costCenters = ccQuery.data ?? []
  const transactions = txQuery.data ?? []
  const closings = closingsQuery.data ?? []

  const opening = openingBalance(tenant?.settings)
  const yearTx = useMemo(() => inYear(transactions, year), [transactions, year])
  const yearSums = useMemo(() => sums(yearTx), [yearTx])

  const openMonth = useMemo(
    () => nextOpenMonth(closings, transactions),
    [closings, transactions],
  )
  const dueMonth = monthCloseDue(openMonth)

  const error = ccQuery.error ?? txQuery.error ?? closingsQuery.error
  if (error) {
    return (
      <>
        <h2 className="view-title">Kassa</h2>
        <div className="error-box">Kassa konnte nicht geladen werden: {error.message}</div>
      </>
    )
  }

  const ccName = (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? '–'

  const txRow = (t: Transaction, withCc = true) => (
    <tr key={t.id}>
      <td className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
        {fdate(t.tx_date)}
      </td>
      <td>
        {t.description}
        {t.receipt_path && <ReceiptLink path={t.receipt_path} />}
        <br />
        <span className="meta">{t.category}</span>
      </td>
      {withCc && (
        <td>
          <span className="pill grey">{ccName(t.cost_center_id)}</span>
        </td>
      )}
      <td className={`amount ${t.direction}`}>
        {t.direction === 'in' ? '+' : '−'} {eur(t.amount_cents)}
      </td>
    </tr>
  )

  // ---------------------------------------------------------------
  // Nachkalkulation einer Kostenstelle
  // ---------------------------------------------------------------
  if (view === 'detail' && detailCc) {
    const cc = costCenters.find((c) => c.id === detailCc)
    if (!cc) {
      // Kann beim Laden noch fehlen (Query läuft) oder die Kostenstelle wurde
      // per URL angesteuert und existiert nicht.
      if (ccQuery.isPending) return <p className="meta">Wird geladen…</p>
      return (
        <>
          <button className="btn ghost small" style={{ marginBottom: 14 }} onClick={backToOverview}>
            ← Zurück zur Kassa
          </button>
          <div className="notice">Diese Kostenstelle existiert nicht (mehr).</div>
        </>
      )
    }

    const s = ccSums(transactions, cc.id)
    const ccTx = transactions.filter((t) => t.cost_center_id === cc.id)
    // Kostendeckung: Ohne Ausgaben ist alles gedeckt – sonst Division durch 0.
    const deckung = s.aus > 0 ? Math.round((s.ein / s.aus) * 100) : 100

    return (
      <>
        <button className="btn ghost small" style={{ marginBottom: 14 }} onClick={backToOverview}>
          ← Zurück zur Kassa
        </button>

        <h2 className="view-title">Nachkalkulation: {cc.name}</h2>
        <p className="view-sub">
          {cc.cc_type} · {s.count} Buchungen
        </p>

        <div className="grid3" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="k">Einnahmen</div>
            <div className="v pos">+ {eur(s.ein)}</div>
          </div>
          <div className="stat">
            <div className="k">Ausgaben</div>
            <div className="v neg">− {eur(s.aus)}</div>
          </div>
          <div className="stat">
            <div className="k">Ergebnis</div>
            <div className={`v ${s.erg >= 0 ? 'pos' : 'neg'}`}>
              <Signed cents={s.erg} />
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Kostendeckung</h3>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="meta">Einnahmen decken {deckung} % der Ausgaben</span>
            <span className="mono" style={{ fontSize: 13 }}>
              {deckung} %
            </span>
          </div>
          <div className="bar-track" style={{ height: 14 }}>
            <div
              className="bar-fill"
              style={{
                width: `${Math.min(100, deckung)}%`,
                background: s.erg >= 0 ? 'var(--pine)' : 'var(--amber)',
              }}
            />
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Buchungen dieser Kostenstelle</h3>
            <div className="spacer" />
            <button
              className="btn small"
              onClick={() =>
                exportJournalCsv(
                  ccTx,
                  costCenters,
                  `nachkalkulation_${cc.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_')}.csv`,
                )
              }
            >
              ⬇ Nachkalkulation exportieren (CSV)
            </button>
          </div>

          {ccTx.length === 0 ? (
            <p className="meta">
              Noch keine Buchungen – im Formular „Neue Buchung" dieser Kostenstelle zuordnen.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Buchungstext</th>
                    <th style={{ textAlign: 'right' }}>Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {ccTx.map((t) => txRow(t, false))}
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 600 }}>
                      Ergebnis
                    </td>
                    <td className="amount">
                      <Signed cents={s.erg} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  // ---------------------------------------------------------------
  // Monatsabschluss
  // ---------------------------------------------------------------
  if (view === 'month') {
    if (!openMonth) {
      return (
        <>
          <button
            className="btn ghost small"
            style={{ marginBottom: 14 }}
            onClick={() => setView('overview')}
          >
            ← Zurück zur Kassa
          </button>
          <h2 className="view-title">Monatsabschluss</h2>
          <div className="notice">
            Es gibt noch keine Buchungen – ein Monatsabschluss ist erst nach dem ersten
            Geschäftsvorfall möglich.
          </div>
        </>
      )
    }

    const monthTx = transactions
      .filter((t) => t.tx_date.startsWith(openMonth))
      .sort((a, b) => a.tx_date.localeCompare(b.tx_date))
    const ms = sums(monthTx)
    const carry = carryOver(transactions, openMonth, opening)
    const receipts = monthTx.filter((t) => t.receipt_path).length

    const doClose = async () => {
      setClosing(true)
      try {
        const zip = await buildMonthZip(
          openMonth,
          tenant?.name ?? 'Verein',
          monthTx,
          costCenters,
          carry,
        )
        // Erst archivieren und in month_closings eintragen, dann herunterladen.
        // Andersherum hätte der Benutzer eine Datei in der Hand, während der
        // Abschluss in der Datenbank gar nicht angekommen ist.
        await closeMonth(tenantId, me?.id ?? null, openMonth, zip)
        downloadZip(zip, openMonth)

        await queryClient.invalidateQueries({ queryKey: closingsKey(tenantId) })
        toast(`Monatsabschluss ${monthLabel(openMonth)} exportiert & abgeschlossen`)
        setView('overview')
      } catch (e) {
        toastError(
          `Abschluss fehlgeschlagen: ${e instanceof Error ? e.message : 'Unbekannter Fehler'}`,
        )
      } finally {
        setClosing(false)
      }
    }

    return (
      <>
        <button
          className="btn ghost small"
          style={{ marginBottom: 14 }}
          onClick={() => setView('overview')}
        >
          ← Zurück zur Kassa
        </button>

        <h2 className="view-title">Monatsabschluss {monthLabel(openMonth)}</h2>
        <p className="view-sub">
          Zur zusätzlichen Datensicherung &amp; Buchhaltung · Erinnerung automatisch am 5. des
          Folgemonats
        </p>

        <div className="grid3" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="k">Übertrag Vormonat</div>
            <div className="v">{eur(carry)}</div>
          </div>
          <div className="stat">
            <div className="k">Einnahmen / Ausgaben</div>
            <div className="v" style={{ fontSize: 17 }}>
              <span className="pos">+ {eur(ms.ein)}</span> ·{' '}
              <span className="neg">− {eur(ms.aus)}</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">Kassastand Monatsende</div>
            <div className={`v ${carry + ms.erg >= 0 ? 'pos' : 'neg'}`}>
              {eur(carry + ms.erg)}
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Buchungen {monthLabel(openMonth)}</h3>
          {monthTx.length === 0 ? (
            <p className="meta">Keine Buchungen in diesem Monat.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Buchungstext</th>
                    <th>Kostenstelle</th>
                    <th style={{ textAlign: 'right' }}>Betrag</th>
                  </tr>
                </thead>
                <tbody>{monthTx.map((t) => txRow(t))}</tbody>
              </table>
            </div>
          )}
          <p className="meta" style={{ marginTop: 8 }}>
            📎 {receipts} Beleg{receipts === 1 ? '' : 'e'} verknüpft – werden im ZIP-Export
            mitgeliefert.
          </p>
        </div>

        {mayEdit ? (
          <div className="row">
            <button className="btn" disabled={closing} onClick={() => void doClose()}>
              {closing
                ? 'Wird exportiert…'
                : '⬇ Abschließen & exportieren (XLSX + Belege als ZIP)'}
            </button>
            <button className="btn ghost small" onClick={() => window.print()}>
              🖨 Drucken / PDF
            </button>
          </div>
        ) : (
          <div className="notice">🔒 Abschließen kann nur die Kassenführung.</div>
        )}

        <p className="meta" style={{ marginTop: 10 }}>
          Mit dem Export gilt {monthLabel(openMonth)} als abgeschlossen – die Erinnerung
          verschwindet und der nächste offene Monat rückt nach.
        </p>
      </>
    )
  }

  // ---------------------------------------------------------------
  // Jahresabschluss
  // ---------------------------------------------------------------
  if (view === 'year') {
    const cats = byCategory(yearTx)

    return (
      <>
        <button
          className="btn ghost small"
          style={{ marginBottom: 14 }}
          onClick={() => setView('overview')}
        >
          ← Zurück zur Kassa
        </button>

        <h2 className="view-title">Jahresabschluss {year}</h2>
        <p className="view-sub">
          Kassabericht für die Generalversammlung · Funktionsperiode: {tenant?.dekade ?? '–'}
        </p>

        <div className="grid3" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="k">Anfangsbestand 01.01.</div>
            <div className="v">{eur(opening)}</div>
          </div>
          <div className="stat">
            <div className="k">Einnahmen / Ausgaben</div>
            <div className="v" style={{ fontSize: 17 }}>
              <span className="pos">+ {eur(yearSums.ein)}</span> ·{' '}
              <span className="neg">− {eur(yearSums.aus)}</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">Endbestand</div>
            <div className={`v ${opening + yearSums.erg >= 0 ? 'pos' : 'neg'}`}>
              {eur(opening + yearSums.erg)}
            </div>
          </div>
        </div>

        <div className="grid2">
          <div className="card">
            <h3>Nach Kategorie</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kategorie</th>
                    <th style={{ textAlign: 'right' }}>Einnahmen</th>
                    <th style={{ textAlign: 'right' }}>Ausgaben</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td className="amount in">+ {eur(c.ein)}</td>
                      <td className="amount out">− {eur(c.aus)}</td>
                      <td className="amount">
                        <Signed cents={c.ein - c.aus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Nach Kostenstelle</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kostenstelle</th>
                    <th style={{ textAlign: 'right' }}>Einnahmen</th>
                    <th style={{ textAlign: 'right' }}>Ausgaben</th>
                    <th style={{ textAlign: 'right' }}>Ergebnis</th>
                  </tr>
                </thead>
                <tbody>
                  {costCenters
                    .map((cc) => ({ cc, s: ccSums(yearTx, cc.id) }))
                    .filter((x) => x.s.count > 0)
                    .map(({ cc, s }) => (
                      <tr key={cc.id}>
                        <td>{cc.name}</td>
                        <td className="amount in">+ {eur(s.ein)}</td>
                        <td className="amount out">− {eur(s.aus)}</td>
                        <td className="amount">
                          <Signed cents={s.erg} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Bestätigung</h3>
          <p style={{ fontSize: 14 }}>
            Der Kassabericht wurde geprüft und für in Ordnung befunden. Den Rechnungsprüfern wurde
            vollständige Einsicht in Belege und Aufzeichnungen gewährt.
          </p>
          <div className="grid3" style={{ marginTop: 26 }}>
            {['Kassier', 'Rechnungsprüfer/in 1', 'Rechnungsprüfer/in 2'].map((label) => (
              <div
                key={label}
                style={{ borderTop: '1px solid var(--ink)', paddingTop: 6, fontSize: 12.5 }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <div className="row">
          <button
            className="btn small"
            onClick={() =>
              exportYearCsv(
                year,
                tenant?.name ?? 'Verein',
                tenant?.dekade ?? null,
                opening,
                yearTx,
                costCenters,
              )
            }
          >
            ⬇ Jahresabschluss exportieren (CSV)
          </button>
          <button className="btn ghost small" onClick={() => window.print()}>
            🖨 Drucken / als PDF speichern
          </button>
        </div>
      </>
    )
  }

  // ---------------------------------------------------------------
  // Übersicht
  // ---------------------------------------------------------------
  const series = recurringSeries(costCenters)

  return (
    <>
      <h2 className="view-title">Kassa</h2>
      <p className="view-sub">
        Eingangs- und Ausgangsrechnung · Vereinsjahr {year} · nur für berechtigte Rollen sichtbar
      </p>

      {mayEdit && dueMonth && (
        <div className="notice">
          📅 <b>Monatsabschluss {monthLabel(dueMonth)} fällig!</b> Erinnerung jeweils am 5. des
          Folgemonats.{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              setView('month')
            }}
          >
            Jetzt abschließen &amp; exportieren
          </a>
        </div>
      )}

      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="k">Einnahmen {year}</div>
          <div className="v pos">+ {eur(yearSums.ein)}</div>
        </div>
        <div className="stat">
          <div className="k">Ausgaben {year}</div>
          <div className="v neg">− {eur(yearSums.aus)}</div>
        </div>
        <div className="stat">
          <div className="k">Saldo (inkl. Anfangsbestand)</div>
          <div className={`v ${opening + yearSums.erg >= 0 ? 'pos' : 'neg'}`}>
            {eur(opening + yearSums.erg)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>🏷️ Kostenstellen (Events &amp; Projekte)</h3>
          <div className="spacer" />
          {mayEdit && (
            <button className="btn ghost small" onClick={() => setCcDialog(true)}>
              + Kostenstelle anlegen
            </button>
          )}
        </div>

        {costCenters.length === 0 ? (
          <p className="meta">Noch keine Kostenstellen angelegt.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kostenstelle</th>
                  <th>Art</th>
                  <th style={{ textAlign: 'right' }}>Einnahmen</th>
                  <th style={{ textAlign: 'right' }}>Ausgaben</th>
                  <th style={{ textAlign: 'right' }}>Ergebnis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {costCenters.map((c: CostCenter) => {
                  const s = ccSums(transactions, c.id)
                  return (
                    <tr key={c.id}>
                      <td>
                        <b>{c.name}</b>
                      </td>
                      <td>
                        <span className="pill grey">{c.cc_type}</span>
                      </td>
                      <td className="amount in">+ {eur(s.ein)}</td>
                      <td className="amount out">− {eur(s.aus)}</td>
                      <td className="amount">
                        <Signed cents={s.erg} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn ghost small"
                          onClick={() => {
                            setDetailCc(c.id)
                            setView('detail')
                          }}
                        >
                          Nachkalkulation
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Buchungen {year}</h3>
          {txQuery.isPending ? (
            <p className="meta">Wird geladen…</p>
          ) : yearTx.length === 0 ? (
            <p className="meta">Keine Buchungen in {year}.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Buchungstext</th>
                    <th>Kostenstelle</th>
                    <th style={{ textAlign: 'right' }}>Betrag</th>
                  </tr>
                </thead>
                <tbody>{yearTx.map((t) => txRow(t))}</tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn ghost small"
              onClick={() => exportJournalCsv(yearTx, costCenters, `kassajournal_${year}.csv`)}
            >
              ⬇ Journal (CSV)
            </button>
            <button className="btn ghost small" onClick={() => setView('month')}>
              📅 Monatsabschluss
            </button>
            <button className="btn small amber" onClick={() => setView('year')}>
              📑 Jahresabschluss
            </button>
          </div>
        </div>

        {mayEdit ? (
          <NewTransactionCard costCenters={costCenters} />
        ) : (
          <div className="card">
            <p className="meta">
              🔒 Buchungen erfassen kann nur die Kassenführung (Kassier, Kassier Stv.,
              Systemadmin).
            </p>
          </div>
        )}
      </div>

      {series.length > 0 && (
        <div className="card">
          <h3>📈 Jahresvergleich wiederkehrender Events</h3>

          {series.map(({ base, entries }) => {
            const rows = entries.map((cc) => ({ cc, s: ccSums(transactions, cc.id) }))
            const max = Math.max(1, ...rows.map((r) => Math.max(r.s.ein, r.s.aus)))

            return (
              <div key={base} style={{ marginBottom: 18 }}>
                <b style={{ fontFamily: 'var(--font-display)' }}>{base}</b>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Jahr</th>
                        <th style={{ textAlign: 'right' }}>Einnahmen</th>
                        <th style={{ textAlign: 'right' }}>Ausgaben</th>
                        <th style={{ textAlign: 'right' }}>Ergebnis</th>
                        <th style={{ minWidth: 140 }}>Verlauf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const prev = i > 0 ? rows[i - 1] : null
                        const delta = prev ? r.s.erg - prev.s.erg : null

                        return (
                          <tr key={r.cc.id}>
                            <td className="mono">
                              {r.cc.year}
                              {r.s.count === 0 && (
                                <span className="pill grey" style={{ marginLeft: 6 }}>
                                  läuft noch
                                </span>
                              )}
                            </td>
                            <td className="amount in">+ {eur(r.s.ein)}</td>
                            <td className="amount out">− {eur(r.s.aus)}</td>
                            <td className="amount">
                              <Signed cents={r.s.erg} />
                              {delta !== null && (
                                <div className="meta">
                                  {delta >= 0 ? '▲' : '▼'} {eur(Math.abs(delta))} ggü. Vorjahr
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="bar-track" style={{ height: 7, margin: '3px 0' }}>
                                <div
                                  className="bar-fill"
                                  style={{ width: `${(r.s.ein / max) * 100}%` }}
                                />
                              </div>
                              <div className="bar-track" style={{ height: 7 }}>
                                <div
                                  className="bar-fill"
                                  style={{
                                    width: `${(r.s.aus / max) * 100}%`,
                                    background: 'var(--red)',
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          <p className="meta">
            Grün = Einnahmen, Rot = Ausgaben. Die Zuordnung erfolgt automatisch über gleichnamige
            Kostenstellen mit Jahreszahl (z. B. „Jahreskirchtag 2025" / „… 2026").
          </p>
        </div>
      )}

      {ccDialog && (
        <CostCenterDialog
          saving={ccMutation.isPending}
          onSave={(name, ccType) => ccMutation.mutate({ name, ccType })}
          onClose={() => setCcDialog(false)}
        />
      )}
    </>
  )
}

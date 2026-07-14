import { useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { eur, fdate } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import { costCentersKey, fetchCostCenters, transactionsKey } from '@/features/kassa/api'
import { euroToCents } from '@/features/kassa/logic'
import { ReceiptLink } from '@/features/kassa/ReceiptLink'
import type { Invoice, InvoiceInput, InvoiceStatus } from '@/types'
import { decideInvoice, fetchInvoices, invoicesKey, payInvoice, submitInvoice } from './api'

function StatusPill({ status }: { status: InvoiceStatus }) {
  switch (status) {
    case 'bezahlt':
      return <span className="pill green">✓ bezahlt / überwiesen</span>
    case 'freigegeben':
      return <span className="pill amber">freigegeben · Auszahlung offen</span>
    case 'abgelehnt':
      return <span className="pill red">abgelehnt</span>
    default:
      return <span className="pill grey">offen · wartet auf Prüfung</span>
  }
}

export function InvoicesPage() {
  const { tenant, member: me, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const mayViewAll = can('invoice.viewall')
  const mayApprove = can('invoice.approve')

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [ccId, setCcId] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const invoicesQuery = useQuery({
    queryKey: invoicesKey(tenantId),
    queryFn: () => fetchInvoices(tenantId),
    enabled: Boolean(tenantId),
  })

  // Kostenstellen sieht nur, wer 'kassa.view' hat (RLS). Ein normales Mitglied
  // bekommt hier eine leere Liste – deshalb ist die Auswahl optional.
  const { data: costCenters = [] } = useQuery({
    queryKey: costCentersKey(tenantId),
    queryFn: () => fetchCostCenters(tenantId),
    enabled: Boolean(tenantId),
  })

  const { data: members = [] } = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: invoicesKey(tenantId) }),
      // Eine bezahlte Rechnung erzeugt eine Buchung – die Kassa muss nachziehen.
      queryClient.invalidateQueries({ queryKey: transactionsKey(tenantId) }),
    ])

  const submitMutation = useMutation({
    mutationFn: (input: InvoiceInput) => submitInvoice(tenantId, me!.id, input),
    onSuccess: async () => {
      await refresh()
      setDescription('')
      setAmount('')
      setFile(null)
      toast('Beleg eingereicht – wartet auf Prüfung durch die Kassa')
    },
    onError: (e: Error) => toastError(`Nicht eingereicht: ${e.message}`),
  })

  const decideMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'freigegeben' | 'abgelehnt' }) =>
      decideInvoice(id, status),
    onSuccess: async (_d, vars) => {
      await refresh()
      toast(
        vars.status === 'freigegeben'
          ? 'Freigegeben – als Nächstes überweisen & abhaken'
          : 'Abgelehnt',
      )
    },
    onError: (e: Error) => toastError(e.message),
  })

  const payMutation = useMutation({
    mutationFn: (id: string) => payInvoice(id),
    onSuccess: async () => {
      await refresh()
      toast('Als bezahlt markiert & in Kassa verbucht')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const onFile = (e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)

  const submit = () => {
    const text = description.trim()
    if (!text) {
      toastError('Bitte eine Beschreibung angeben')
      return
    }
    const cents = euroToCents(amount)
    if (cents === null || cents <= 0) {
      toastError('Bitte einen gültigen Betrag angeben (z. B. 12,50)')
      return
    }
    if (!file) {
      // file_path ist im Schema not null – ohne Datei gäbe es nichts zu prüfen.
      toastError('Bitte den Beleg als Foto oder PDF anhängen')
      return
    }
    if (!me) {
      toastError('Dein Login ist mit keinem Mitglied verknüpft')
      return
    }

    submitMutation.mutate({
      description: text,
      amount_cents: cents,
      cost_center_id: ccId || null,
      file,
    })
  }

  const invoices = invoicesQuery.data ?? []
  const busy = decideMutation.isPending || payMutation.isPending

  if (invoicesQuery.error) {
    return (
      <>
        <h2 className="view-title">Rechnungseinreichung</h2>
        <div className="error-box">
          Belege konnten nicht geladen werden: {invoicesQuery.error.message}
        </div>
      </>
    )
  }

  const submitterOf = (i: Invoice) => members.find((m) => m.id === i.submitted_by)
  const ccName = (id: string | null) => costCenters.find((c) => c.id === id)?.name

  return (
    <>
      <h2 className="view-title">Rechnungseinreichung</h2>
      <p className="view-sub">
        {mayViewAll
          ? 'Kassa-Ansicht: alle eingereichten Belege'
          : 'Du siehst nur deine eigenen Belege – alle Belege sehen nur Kassier/in und Stv.'}
      </p>

      <div className="grid2">
        <div className="card">
          <h3>Beleg einreichen</h3>

          <div className="stack">
            <div>
              <label htmlFor="inv-text">Beschreibung</label>
              <input
                id="inv-text"
                placeholder="z. B. Material Sommerfest"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="form-grid">
              <div>
                <label htmlFor="inv-amount">Betrag (€)</label>
                <input
                  id="inv-amount"
                  inputMode="decimal"
                  placeholder="12,50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="inv-cc">Kostenstelle</label>
                <select id="inv-cc" value={ccId} onChange={(e) => setCcId(e.target.value)}>
                  <option value="">– keine / weiß ich nicht –</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label>Beleg (Foto oder PDF)</label>
              <label
                className={`upload-zone${file ? ' hasfile' : ''}`}
                style={{ display: 'block', cursor: 'pointer' }}
              >
                <input
                  type="file"
                  accept="image/*,.pdf"
                  style={{ display: 'none' }}
                  onChange={onFile}
                />
                {file ? `✓ ${file.name}` : '📎 Datei auswählen oder Foto aufnehmen'}
              </label>
            </div>
          </div>

          <button className="btn small" disabled={submitMutation.isPending} onClick={submit}>
            {submitMutation.isPending ? 'Wird eingereicht…' : 'Einreichen'}
          </button>

          <p className="meta" style={{ marginTop: 10 }}>
            Ablauf: Einreichen → Kassier prüft &amp; gibt frei → Überweisung → erst mit dem Haken
            „Bezahlt/Überwiesen" landet der Betrag als Ausgabe in der Kassa.
          </p>
        </div>

        <div className="card">
          <h3>{mayViewAll ? 'Alle Belege' : 'Meine Belege'}</h3>

          {invoicesQuery.isPending ? (
            <p className="meta">Wird geladen…</p>
          ) : invoices.length === 0 ? (
            <p className="meta">Noch keine Belege eingereicht.</p>
          ) : (
            invoices.map((i) => {
              const submitter = submitterOf(i)
              const cc = ccName(i.cost_center_id)

              return (
                <div className="list-item" key={i.id}>
                  {submitter ? (
                    <Avatar member={submitter} />
                  ) : (
                    <div className="avatar">?</div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{i.description}</b>
                    <div className="meta">
                      {i.members
                        ? `${i.members.first_name} ${i.members.last_name}`
                        : 'Unbekannt'}{' '}
                      · {fdate(i.created_at.slice(0, 10))}
                      <ReceiptLink path={i.file_path} />
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {eur(i.amount_cents)}
                      </span>
                      {cc && (
                        <span className="pill grey" style={{ marginLeft: 6 }}>
                          {cc}
                        </span>
                      )}
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <StatusPill status={i.status} />
                      {i.status === 'bezahlt' && i.paid_at && (
                        <span className="meta" style={{ marginLeft: 6 }}>
                          am {fdate(i.paid_at)}
                        </span>
                      )}
                    </div>

                    {mayApprove && i.status === 'offen' && (
                      <div className="row" style={{ marginTop: 8 }}>
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() =>
                            decideMutation.mutate({ id: i.id, status: 'freigegeben' })
                          }
                        >
                          Freigeben
                        </button>
                        <button
                          className="btn small danger"
                          disabled={busy}
                          onClick={() =>
                            decideMutation.mutate({ id: i.id, status: 'abgelehnt' })
                          }
                        >
                          Ablehnen
                        </button>
                      </div>
                    )}

                    {mayApprove && i.status === 'freigegeben' && (
                      <label
                        className="row"
                        style={{
                          marginTop: 8,
                          gap: 8,
                          cursor: busy ? 'wait' : 'pointer',
                          fontSize: 14,
                          fontWeight: 600,
                          color: 'var(--pine)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={false}
                          disabled={busy}
                          onChange={() => payMutation.mutate(i.id)}
                          style={{ accentColor: 'var(--pine)', width: 17, height: 17 }}
                        />
                        Bezahlt / Überwiesen – jetzt in Kassa verbuchen
                      </label>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

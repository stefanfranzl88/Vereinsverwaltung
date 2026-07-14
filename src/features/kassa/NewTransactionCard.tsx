import { useState, type ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { today } from '@/lib/format'
import type { CostCenter, Direction, TransactionInput } from '@/types'
import { createTransaction, transactionsKey } from './api'
import { euroToCents, KATEGORIEN } from './logic'

export function NewTransactionCard({ costCenters }: { costCenters: CostCenter[] }) {
  const { tenant, member: me } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<Direction>('in')
  const [ccId, setCcId] = useState('')
  const [category, setCategory] = useState<string>(KATEGORIEN[0])
  const [receipt, setReceipt] = useState<File | null>(null)
  const [txDate, setTxDate] = useState(today())

  const mutation = useMutation({
    mutationFn: (input: TransactionInput) => createTransaction(tenantId, me?.id ?? null, input),
    onSuccess: async (_d, vars) => {
      await queryClient.invalidateQueries({ queryKey: transactionsKey(tenantId) })
      setDescription('')
      setAmount('')
      setReceipt(null)
      toast(`Buchung erfasst${vars.receipt ? ' – Beleg verknüpft 📎' : ''}`)
    },
    onError: (e: Error) => toastError(`Buchung nicht erfasst: ${e.message}`),
  })

  const onFile = (e: ChangeEvent<HTMLInputElement>) => setReceipt(e.target.files?.[0] ?? null)

  const submit = () => {
    const text = description.trim()
    if (!text) {
      toastError('Bitte einen Buchungstext angeben')
      return
    }

    const cents = euroToCents(amount)
    if (cents === null || cents <= 0) {
      // Das Schema erzwingt amount_cents > 0; die Richtung steckt in direction.
      toastError('Bitte einen gültigen Betrag größer als 0 angeben (z. B. 12,50)')
      return
    }

    mutation.mutate({
      tx_date: txDate,
      description: text,
      category,
      amount_cents: cents,
      direction,
      cost_center_id: ccId || null,
      receipt,
    })
  }

  return (
    <div className="card">
      <h3>Neue Buchung</h3>

      <div className="stack">
        <div>
          <label htmlFor="tx-text">Buchungstext</label>
          <input
            id="tx-text"
            placeholder="z. B. Erlös Sommerfest"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-grid">
          <div>
            <label htmlFor="tx-amount">Betrag (€)</label>
            <input
              id="tx-amount"
              inputMode="decimal"
              placeholder="12,50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="tx-type">Art</label>
            <select
              id="tx-type"
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
            >
              <option value="in">Einnahme</option>
              <option value="out">Ausgabe</option>
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div>
            <label htmlFor="tx-date">Datum</label>
            <input
              id="tx-date"
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="tx-cc">Kostenstelle</label>
            <select id="tx-cc" value={ccId} onChange={(e) => setCcId(e.target.value)}>
              <option value="">– keine –</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="tx-cat">Kategorie</label>
          <select id="tx-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {KATEGORIEN.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Beleg (Foto oder PDF, optional)</label>
          <label
            className={`upload-zone${receipt ? ' hasfile' : ''}`}
            style={{ display: 'block', cursor: 'pointer', padding: 14 }}
          >
            <input
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={onFile}
            />
            {receipt ? `✓ ${receipt.name}` : '📎 Beleg anhängen'}
          </label>
        </div>
      </div>

      <div className="row">
        <button className="btn small" disabled={mutation.isPending} onClick={submit}>
          {mutation.isPending ? 'Wird erfasst…' : 'Buchung erfassen'}
        </button>
      </div>
    </div>
  )
}

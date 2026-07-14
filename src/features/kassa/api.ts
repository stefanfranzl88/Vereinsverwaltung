import { supabase } from '@/lib/supabase'
import type {
  CostCenter,
  CostCenterType,
  MonthClosing,
  Transaction,
  TransactionInput,
} from '@/types'

export const costCentersKey = (tenantId: string) => ['cost-centers', tenantId] as const
export const transactionsKey = (tenantId: string) => ['transactions', tenantId] as const
export const closingsKey = (tenantId: string) => ['month-closings', tenantId] as const

export async function fetchCostCenters(tenantId: string): Promise<CostCenter[]> {
  const { data, error } = await supabase
    .from('cost_centers')
    .select('id, tenant_id, name, cc_type, base_name, year')
    .eq('tenant_id', tenantId)
    .order('name')
    .returns<CostCenter[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchTransactions(tenantId: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, tenant_id, tx_date, description, category, amount_cents, direction, cost_center_id, receipt_path, created_at',
    )
    .eq('tenant_id', tenantId)
    .order('tx_date', { ascending: false })
    .returns<Transaction[]>()

  if (error) throw error
  // bigint kommt als number durch PostgREST; Beträge liegen weit unter 2^53.
  return (data ?? []).map((t) => ({ ...t, amount_cents: Number(t.amount_cents) }))
}

export async function fetchClosings(tenantId: string): Promise<MonthClosing[]> {
  const { data, error } = await supabase
    .from('month_closings')
    .select('tenant_id, month, closed_at, export_path')
    .eq('tenant_id', tenantId)
    .order('month', { ascending: false })
    .returns<MonthClosing[]>()

  if (error) throw error
  return data ?? []
}

/**
 * Kostenstelle anlegen. base_name und year werden aus dem Namen abgeleitet
 * ("Jahreskirchtag 2026" → base_name "Jahreskirchtag", year 2026) – genau das
 * verbindet der Jahresvergleich später zu einer Reihe.
 */
export async function createCostCenter(
  tenantId: string,
  name: string,
  ccType: CostCenterType,
): Promise<void> {
  const match = name.trim().match(/^(.*)\s(20\d\d)$/)

  const { error } = await supabase.from('cost_centers').insert({
    tenant_id: tenantId,
    name: name.trim(),
    cc_type: ccType,
    base_name: match ? match[1].trim() : null,
    year: match ? Number(match[2]) : null,
  })

  if (error) throw error
}

/**
 * Buchung erfassen, optional mit Beleg.
 * Beleg-Pfad wie im Schema: {tenant_id}/{yyyy-mm}/{uuid}.{ext}
 */
export async function createTransaction(
  tenantId: string,
  memberId: string | null,
  input: TransactionInput,
): Promise<void> {
  let receiptPath: string | null = null

  if (input.receipt) {
    const ext = input.receipt.name.split('.').pop()?.toLowerCase() || 'pdf'
    const yyyymm = input.tx_date.slice(0, 7)
    receiptPath = `${tenantId}/${yyyymm}/${crypto.randomUUID()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('receipts')
      .upload(receiptPath, input.receipt, { contentType: input.receipt.type })

    if (uploadErr) throw uploadErr
  }

  const { error } = await supabase.from('transactions').insert({
    tenant_id: tenantId,
    tx_date: input.tx_date,
    description: input.description,
    category: input.category,
    amount_cents: input.amount_cents,
    direction: input.direction,
    cost_center_id: input.cost_center_id,
    receipt_path: receiptPath,
    created_by: memberId,
  })

  if (error) {
    // Buchung nicht entstanden – sonst bliebe der Beleg verwaist im Bucket.
    if (receiptPath) await supabase.storage.from('receipts').remove([receiptPath])
    throw error
  }
}

/** Signierte URL für einen Beleg (Bucket ist privat). */
export async function receiptUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

/** Beleg-Datei herunterladen – für das ZIP des Monatsabschlusses. */
export async function downloadReceipt(path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from('receipts').download(path)
  if (error) return null
  return data
}

export async function setOpeningBalance(cents: number): Promise<void> {
  const { error } = await supabase.rpc('set_opening_balance', { p_cents: cents })
  if (error) throw error
}

/**
 * Monat abschließen: ZIP in den exports-Bucket legen und die Zeile in
 * month_closings schreiben. Erst danach gilt der Monat als abgeschlossen und
 * der nächste offene Monat rückt nach.
 */
export async function closeMonth(
  tenantId: string,
  memberId: string | null,
  month: string,
  zip: Blob,
): Promise<void> {
  const exportPath = `${tenantId}/${month}.zip`

  const { error: uploadErr } = await supabase.storage
    .from('exports')
    .upload(exportPath, zip, { contentType: 'application/zip', upsert: true })

  if (uploadErr) throw uploadErr

  const { error } = await supabase.from('month_closings').insert({
    tenant_id: tenantId,
    month,
    closed_by: memberId,
    export_path: exportPath,
  })

  if (error) throw error
}

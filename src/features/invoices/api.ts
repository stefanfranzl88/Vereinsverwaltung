import { supabase } from '@/lib/supabase'
import type { Invoice, InvoiceInput } from '@/types'

export const invoicesKey = (tenantId: string) => ['invoices', tenantId] as const

/**
 * RLS entscheidet, was zurückkommt: die eigenen Belege – oder alle, wenn der
 * Benutzer 'invoice.viewall' hat. Das Frontend filtert hier bewusst NICHT
 * zusätzlich, sonst gäbe es zwei Wahrheiten.
 */
export async function fetchInvoices(tenantId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      'id, tenant_id, submitted_by, description, amount_cents, cost_center_id, file_path, status, paid_at, created_at, members!invoices_submitted_by_fkey(first_name, last_name)',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<Invoice[]>()

  if (error) throw error
  return (data ?? []).map((i) => ({ ...i, amount_cents: Number(i.amount_cents) }))
}

/**
 * Beleg einreichen. Die Datei liegt im receipts-Bucket unter
 * {tenant_id}/invoices/{uuid}.{ext} – denselben Pfad übernimmt später die
 * Buchung als receipt_path, damit der Beleg im Monatsabschluss-ZIP auftaucht.
 */
export async function submitInvoice(
  tenantId: string,
  memberId: string,
  input: InvoiceInput,
): Promise<void> {
  const ext = input.file.name.split('.').pop()?.toLowerCase() || 'pdf'
  const path = `${tenantId}/invoices/${crypto.randomUUID()}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from('receipts')
    .upload(path, input.file, { contentType: input.file.type })

  if (uploadErr) throw uploadErr

  const { error } = await supabase.from('invoices').insert({
    tenant_id: tenantId,
    submitted_by: memberId,
    description: input.description,
    amount_cents: input.amount_cents,
    cost_center_id: input.cost_center_id,
    file_path: path,
    status: 'offen',
  })

  if (error) {
    // Sonst bliebe die Datei verwaist im Bucket liegen.
    await supabase.storage.from('receipts').remove([path])
    throw error
  }
}

/** Freigeben oder ablehnen – schreibt nur status und decided_by. */
export async function decideInvoice(
  invoiceId: string,
  status: 'freigegeben' | 'abgelehnt',
): Promise<void> {
  const { error } = await supabase.rpc('decide_invoice', {
    p_invoice_id: invoiceId,
    p_status: status,
  })
  if (error) throw error
}

/**
 * Bezahlt markieren UND als Ausgabe in der Kassa verbuchen.
 * Beides passiert serverseitig in einer Transaktion – zwei getrennte Requests
 * könnten halb durchlaufen und die Rechnung als bezahlt zurücklassen, ohne dass
 * die Ausgabe je in der Kassa ankommt.
 */
export async function payInvoice(invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('pay_invoice', { p_invoice_id: invoiceId })
  if (error) throw error
}

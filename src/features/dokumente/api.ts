import { supabase } from '@/lib/supabase'
import type { VereinsDocument } from '@/types'

export const documentsKey = (tenantId: string) => ['documents', tenantId] as const

export async function fetchDocuments(tenantId: string): Promise<VereinsDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, tenant_id, name, category, file_path, created_at, members(first_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<VereinsDocument[]>()

  if (error) throw error
  return data ?? []
}

/** Kategorie → storage-tauglicher Pfad-Baustein (keine Umlaute/Sonderzeichen). */
function slugifyCategory(category: string): string {
  return (
    category
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sonstiges'
  )
}

export interface DocumentInput {
  name: string
  category: string
  file: File
}

/**
 * Datei in den Bucket "documents", dann Metadatenzeile.
 * Pfad: {tenant_id}/{kategorie-slug}/{uuid}.{ext} – die echte Kategorie steht
 * in der Tabelle, im Pfad nur ihr Slug.
 */
export async function uploadDocument(
  tenantId: string,
  memberId: string | null,
  input: DocumentInput,
): Promise<void> {
  const ext = input.file.name.split('.').pop()?.toLowerCase() || 'bin'
  const path = `${tenantId}/${slugifyCategory(input.category)}/${crypto.randomUUID()}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(path, input.file, { contentType: input.file.type })

  if (uploadErr) throw uploadErr

  const { error } = await supabase.from('documents').insert({
    tenant_id: tenantId,
    name: input.name,
    category: input.category,
    file_path: path,
    uploaded_by: memberId,
  })

  if (error) {
    // Zeile nicht entstanden – Datei nicht verwaisen lassen.
    await supabase.storage.from('documents').remove([path])
    throw error
  }
}

/**
 * Zeile löschen, dann die Datei best-effort entfernen.
 *
 * Reihenfolge bewusst so: Die Tabellenzeile ist der maßgebliche Datensatz.
 * Bliebe sie stehen, während die Datei weg ist, würde „Öffnen" ins Leere
 * greifen. Eine übrig gebliebene Datei ohne Zeile ist dagegen unsichtbarer
 * Ballast – ohne Zeile kennt niemand ihren Pfad.
 */
export async function deleteDocument(doc: { id: string; file_path: string }): Promise<void> {
  const { error } = await supabase.from('documents').delete().eq('id', doc.id)
  if (error) throw error
  await supabase.storage.from('documents').remove([doc.file_path])
}

/** Signierte URL zum Öffnen (Bucket ist privat). */
export async function documentUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

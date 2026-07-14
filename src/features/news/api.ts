import { supabase } from '@/lib/supabase'
import type { NewsItem } from '@/types'

export const newsKey = (tenantId: string) => ['news', tenantId] as const

/**
 * Abgelaufene Mitteilungen filtert bereits die RLS-Policy heraus (news_select).
 * Wer 'news.post' hat, sieht sie weiterhin – sonst wären sie unauffindbar.
 */
export async function fetchNews(tenantId: string): Promise<NewsItem[]> {
  const { data, error } = await supabase
    .from('news')
    .select(
      'id, tenant_id, author_id, title, body, photo_path, expires_at, created_at, members(first_name, last_name)',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<NewsItem[]>()

  if (error) throw error
  return data ?? []
}

export interface NewsInput {
  title: string
  body: string
  /** Sichtbarkeit in Tagen; 0 = unbegrenzt. */
  days: number
  photo: File | null
}

export async function publishNews(
  tenantId: string,
  authorId: string | null,
  input: NewsInput,
): Promise<void> {
  let photoPath: string | null = null

  if (input.photo) {
    const ext = input.photo.name.split('.').pop()?.toLowerCase() || 'jpg'
    // crypto.randomUUID: Pfad muss eindeutig sein, mehrere Fotos pro Tag möglich.
    photoPath = `${tenantId}/${crypto.randomUUID()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('news')
      .upload(photoPath, input.photo, { contentType: input.photo.type })

    if (uploadErr) throw uploadErr
  }

  let expiresAt: string | null = null
  if (input.days > 0) {
    const d = new Date()
    d.setDate(d.getDate() + input.days)
    expiresAt = d.toISOString().slice(0, 10)
  }

  const { error } = await supabase.from('news').insert({
    tenant_id: tenantId,
    author_id: authorId,
    title: input.title,
    body: input.body || null,
    photo_path: photoPath,
    expires_at: expiresAt,
  })

  if (error) {
    // Die Zeile ist nicht entstanden – sonst bliebe das Foto verwaist im Bucket.
    if (photoPath) await supabase.storage.from('news').remove([photoPath])
    throw error
  }
}

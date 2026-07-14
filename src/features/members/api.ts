import { supabase } from '@/lib/supabase'
import type { KeyChip, Member, MemberInput } from '@/types'

export const membersKey = (tenantId: string) => ['members', tenantId] as const
export const keyChipsKey = (tenantId: string) => ['key-chips', tenantId] as const

/**
 * Schlüsselchips für das 🔑 in der Mitgliederliste.
 * Nur aufrufen, wenn das Modul 'schluessel' gebucht ist – sonst liefert die
 * RLS-Policy (module_active) ohnehin nichts.
 */
export async function fetchKeyChips(tenantId: string): Promise<KeyChip[]> {
  const { data, error } = await supabase
    .from('key_chips')
    .select('id, member_id, chip_nr, issued_at')
    .eq('tenant_id', tenantId)
    .returns<KeyChip[]>()

  if (error) throw error
  return data ?? []
}

/** Funktionsperiode des Vorstands (tenants.dekade) – braucht 'roles.manage'. */
export async function updateDekade(tenantId: string, dekade: string): Promise<void> {
  const { data, error } = await supabase
    .from('tenants')
    .update({ dekade })
    .eq('id', tenantId)
    .select('id')

  if (error) throw error

  // Ein per RLS blockiertes UPDATE wirft keinen Fehler – es trifft keine Zeile.
  if (!data || data.length === 0) {
    throw new Error('Funktionsperiode nicht geändert – fehlende Berechtigung (roles.manage).')
  }
}

export async function fetchMembers(tenantId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('last_name')
    .returns<Member[]>()

  if (error) throw error
  return data ?? []
}

export async function createMember(tenantId: string, input: MemberInput): Promise<Member> {
  const { data, error } = await supabase
    .from('members')
    .insert({ ...input, tenant_id: tenantId })
    .select()
    .single<Member>()

  if (error) throw error
  return data
}

export async function updateMember(id: string, input: MemberInput): Promise<Member> {
  const { data, error } = await supabase
    .from('members')
    .update(input)
    .eq('id', id)
    .select()
    .single<Member>()

  if (error) throw error
  return data
}

/**
 * Profilbild in den Bucket "avatars" legen, Pfad wie im Schema vorgesehen:
 * {tenant_id}/{member_id}.<ext>. upsert=true, damit ein neues Bild das alte ersetzt.
 *
 * Für das eigene Bild geht der DB-Schreibvorgang über set_own_avatar() – die
 * Funktion setzt ausschließlich photo_path. Ein direktes UPDATE auf members
 * bräuchte 'members.edit' und würde einem normalen Mitglied nebenbei erlauben,
 * an der eigenen Zeile auch funktion oder status zu ändern.
 */
export async function uploadAvatar(
  tenantId: string,
  memberId: string,
  file: File,
  isSelf: boolean,
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${tenantId}/${memberId}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadErr) throw uploadErr

  const { error: writeErr } = isSelf
    ? await supabase.rpc('set_own_avatar', { p_path: path })
    : await supabase.from('members').update({ photo_path: path }).eq('id', memberId)

  if (writeErr) throw writeErr
  return path
}

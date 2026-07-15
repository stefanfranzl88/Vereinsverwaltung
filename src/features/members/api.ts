import { supabase } from '@/lib/supabase'
import type { KeyChip, Member, MemberInput } from '@/types'

export const membersKey = (tenantId: string) => ['members', tenantId] as const
export const keyChipsKey = (tenantId: string) => ['key-chips', tenantId] as const
export const accountStatesKey = (tenantId: string) => ['member-account-states', tenantId] as const

/** Zugangsstatus eines Mitglieds. Fehlt der Eintrag → kein Zugang (einladbar). */
export type MemberAccountStatus = 'aktiv' | 'eingeladen'

/**
 * Account-Status je Mitglied (aus member_account_states()). Nur Mitglieder MIT
 * Zugang stehen in der Map; wer fehlt, hat noch keinen Login. Die Funktion ist
 * über auth_tenant_id() auf den eigenen Verein beschränkt.
 */
export async function fetchMemberAccountStates(): Promise<Map<string, MemberAccountStatus>> {
  const { data, error } = await supabase.rpc('member_account_states')
  if (error) throw error

  const map = new Map<string, MemberAccountStatus>()
  for (const r of (data ?? []) as { member_id: string; status: MemberAccountStatus }[]) {
    map.set(r.member_id, r.status)
  }
  return map
}

/**
 * Lädt ein Mitglied per E-Mail ein. Ruft die Edge Function 'invite-member' auf –
 * der service_role-Key bleibt dort im Backend. Gibt die Ziel-E-Mail zurück.
 */
export async function inviteMember(memberId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean
    email?: string
    error?: string
  }>('invite-member', { body: { member_id: memberId } })

  if (error) {
    // Bei non-2xx steckt die eigentliche Meldung im Response-Body, nicht in
    // error.message ("Edge Function returned a non-2xx status code").
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json()
        if (body?.error) msg = body.error
      } catch {
        /* Body nicht lesbar – bei der Standardmeldung bleiben. */
      }
    }
    throw new Error(msg)
  }

  if (!data?.ok) throw new Error(data?.error ?? 'Einladung fehlgeschlagen')
  return data.email ?? ''
}

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

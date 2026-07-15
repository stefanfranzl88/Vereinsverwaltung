// =====================================================================
// Edge Function: member-offboard
//
// Zwei Aktionen, beide brauchen den service_role-Key (Auth-Benutzer entfernen),
// der von Supabase automatisch injiziert wird und nie ins Frontend gelangt:
//
//  action = 'exit'  (Recht: members.edit)
//      Austritt: Mitglied auf 'ausgetreten', Auth-Zugang + Profil-Verknüpfung
//      + Rollen entfernen. Der members-Datensatz bleibt (Historie).
//
//  action = 'gdpr'  (Recht: nur Systemadmin)
//      DSGVO-Löschung: personenbezogene Felder anonymisieren
//      ("Ehemaliges Mitglied"), Avatar + Chips + Rollen + Auth-Zugang löschen.
//      Der members-Datensatz bleibt bestehen, damit Verweise (Aufgaben,
//      Anwesenheiten, Buchungen) gültig bleiben – sie zeigen dann
//      "Ehemaliges Mitglied".
//
// Läuft in Deno (Supabase Edge Runtime), nicht im Vite-Build.
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Nicht angemeldet' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json({ error: 'Function nicht korrekt konfiguriert' }, 500)

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const admin = createClient(url, serviceKey)

  // --- Aufrufer
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'Ungültige Sitzung' }, 401)

  const { data: caller, error: callerErr } = await userClient
    .from('profiles')
    .select('tenant_id, is_sysadmin')
    .eq('id', userData.user.id)
    .single()
  if (callerErr || !caller) return json({ error: 'Profil des Aufrufers nicht gefunden' }, 400)

  // --- Eingabe
  let action: string | undefined
  let memberId: string | undefined
  try {
    const body = await req.json()
    action = body?.action
    memberId = body?.member_id
  } catch {
    return json({ error: 'Ungültiger Request-Body' }, 400)
  }
  if (!memberId) return json({ error: 'member_id fehlt' }, 400)
  if (action !== 'exit' && action !== 'gdpr') return json({ error: 'Ungültige action' }, 400)

  // --- Rechteprüfung SERVERSEITIG
  if (action === 'exit') {
    const { data: canEdit, error: permErr } = await userClient.rpc('has_perm', { p: 'members.edit' })
    if (permErr) return json({ error: permErr.message }, 500)
    if (!canEdit) return json({ error: 'Keine Berechtigung (members.edit erforderlich)' }, 403)
  } else {
    // gdpr: nur Systemadmin
    if (!caller.is_sysadmin) return json({ error: 'DSGVO-Löschung nur durch den Systemadmin' }, 403)
  }

  // --- Mitglied laden & Mandantentrennung
  const { data: member, error: memErr } = await admin
    .from('members')
    .select('id, tenant_id, photo_path')
    .eq('id', memberId)
    .single()
  if (memErr || !member) return json({ error: 'Mitglied nicht gefunden' }, 404)
  if (member.tenant_id !== caller.tenant_id) {
    return json({ error: 'Mitglied gehört zu einem anderen Verein' }, 403)
  }

  // --- Verknüpftes Profil / Auth-Benutzer finden
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('member_id', memberId)
    .maybeSingle()

  // gemeinsame Schritte: Zugang + Rollen entfernen
  const removeAccess = async () => {
    await admin.from('member_roles').delete().eq('member_id', memberId)
    if (profile) {
      await admin.from('profiles').delete().eq('id', profile.id)
      // Auth-Benutzer löschen → kein Login mehr möglich
      await admin.auth.admin.deleteUser(profile.id)
    }
  }

  if (action === 'exit') {
    const { error } = await admin.from('members').update({ status: 'ausgetreten' }).eq('id', memberId)
    if (error) return json({ error: `Austritt fehlgeschlagen: ${error.message}` }, 500)
    await removeAccess()
    return json({ ok: true, action: 'exit' }, 200)
  }

  // --- gdpr: anonymisieren
  const { error: anonErr } = await admin
    .from('members')
    .update({
      first_name: 'Ehemaliges',
      last_name: 'Mitglied',
      email: null,
      phone: null,
      funktion: null,
      status: 'ausgetreten',
      photo_path: null,
    })
    .eq('id', memberId)
  if (anonErr) return json({ error: `Anonymisierung fehlgeschlagen: ${anonErr.message}` }, 500)

  // Avatar-Datei entfernen (falls vorhanden)
  if (member.photo_path) {
    await admin.storage.from('avatars').remove([member.photo_path])
  }
  // Schlüsselchips entziehen
  await admin.from('key_chips').delete().eq('member_id', memberId)

  await removeAccess()
  return json({ ok: true, action: 'gdpr' }, 200)
})

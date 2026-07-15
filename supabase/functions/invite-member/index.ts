// =====================================================================
// Edge Function: invite-member
//
// Lädt ein bestehendes Mitglied (mit E-Mail, ohne Zugang) per Supabase-Auth
// ein und legt die profiles-Verknüpfung an.
//
// SICHERHEIT – zwei Punkte, die den Aufbau bestimmen:
//
//  1. Der service_role-Key darf NIE ins Frontend. Er wird von Supabase
//     automatisch als SUPABASE_SERVICE_ROLE_KEY in die Function injiziert und
//     verlässt das Backend nicht. Das Frontend ruft nur diese Function auf.
//
//  2. Die Verknüpfung profiles → tenant/member wird SERVERSEITIG gesetzt, aus
//     dem Tenant des (geprüften) Aufrufers und der validierten member_id –
//     NICHT aus Client-Metadaten. Sonst könnte sich jemand per Self-Signup mit
//     user_metadata einem beliebigen Verein zuordnen.
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
  const appUrl = Deno.env.get('APP_URL')

  if (!url || !anonKey || !serviceKey) return json({ error: 'Function ist nicht korrekt konfiguriert' }, 500)
  if (!appUrl) return json({ error: 'APP_URL-Secret fehlt (Ziel-URL der App)' }, 500)

  // Client im Namen des Aufrufers: RLS gilt, auth.uid() funktioniert.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  // Admin-Client: service_role, umgeht RLS – nur für Invite + Profil-Insert.
  const admin = createClient(url, serviceKey)

  // --- 1. Aufrufer identifizieren
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'Ungültige Sitzung' }, 401)

  // --- 2. Rechteprüfung SERVERSEITIG (nie dem Frontend vertrauen)
  const { data: canEdit, error: permErr } = await userClient.rpc('has_perm', { p: 'members.edit' })
  if (permErr) return json({ error: permErr.message }, 500)
  if (!canEdit) return json({ error: 'Keine Berechtigung (members.edit erforderlich)' }, 403)

  // --- 3. Tenant des Aufrufers (aus dem eigenen Profil, RLS erlaubt das)
  const { data: caller, error: callerErr } = await userClient
    .from('profiles')
    .select('tenant_id')
    .eq('id', userData.user.id)
    .single()
  if (callerErr || !caller) return json({ error: 'Profil des Aufrufers nicht gefunden' }, 400)

  // --- 4. Eingabe
  let memberId: string | undefined
  try {
    const body = await req.json()
    memberId = body?.member_id
  } catch {
    return json({ error: 'Ungültiger Request-Body' }, 400)
  }
  if (!memberId) return json({ error: 'member_id fehlt' }, 400)

  // --- 5. Mitglied laden und validieren
  const { data: member, error: memErr } = await admin
    .from('members')
    .select('id, tenant_id, email')
    .eq('id', memberId)
    .single()
  if (memErr || !member) return json({ error: 'Mitglied nicht gefunden' }, 404)

  // Mandantentrennung: nur eigene Mitglieder einladen.
  if (member.tenant_id !== caller.tenant_id) {
    return json({ error: 'Mitglied gehört zu einem anderen Verein' }, 403)
  }
  if (!member.email) {
    return json({ error: 'Dieses Mitglied hat keine E-Mail-Adresse' }, 400)
  }

  // --- 6. Gibt es schon einen Auth-Benutzer für dieses Mitglied?
  //     Primär über das verknüpfte Profil (profile.id = auth.users.id). Zusätzlich
  //     über die E-Mail, um einen "Waisen"-Benutzer zu finden, der bei einem
  //     früheren, am Mailversand gescheiterten Versuch entstanden sein kann
  //     (angelegt, aber ohne Profil).
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('member_id', memberId)
    .maybeSingle()

  let existingUserId: string | null = profile?.id ?? null
  if (!existingUserId) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const match = list?.users.find(
      (u) => u.email?.toLowerCase() === member.email!.toLowerCase(),
    )
    existingUserId = match?.id ?? null
  }

  const reinvite = existingUserId !== null

  if (existingUserId) {
    // Ist der Zugang schon in Benutzung? Dann NICHT löschen/neu einladen.
    const { data: got } = await admin.auth.admin.getUserById(existingUserId)
    if (got?.user?.email_confirmed_at) {
      return json({ error: 'Dieses Mitglied hat bereits einen aktiven Zugang' }, 409)
    }
    // Unbestätigt (nie angemeldet): sauberer Neustart. Das Löschen cascadet das
    // Profil (profiles.id references auth.users on delete cascade).
    const { error: delErr } = await admin.auth.admin.deleteUser(existingUserId)
    if (delErr) {
      return json({ error: `Alte Einladung konnte nicht ersetzt werden: ${delErr.message}` }, 500)
    }
  }

  // --- 7. Einladung senden (verschickt die Mail über Supabase).
  //     redirectTo muss in der Redirect-URL-Allowlist stehen.
  const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(member.email, {
    redirectTo: `${appUrl}/set-password`,
  })
  // WICHTIG: Schlägt der Versand fehl (z. B. Rate-Limit), MELDEN wir das und
  // legen KEIN Profil an – das Mitglied gilt dann nicht als eingeladen.
  if (inviteErr || !invite?.user) {
    return json(
      { error: `Einladung/Versand fehlgeschlagen: ${inviteErr?.message ?? 'unbekannt'}` },
      400,
    )
  }

  // --- 8. Profil serverseitig anlegen (Verknüpfung, nicht aus Metadaten).
  const { error: profErr } = await admin.from('profiles').insert({
    id: invite.user.id,
    tenant_id: caller.tenant_id,
    member_id: member.id,
    is_sysadmin: false,
  })
  if (profErr) {
    // Aufräumen: den eben erstellten Auth-Benutzer wieder entfernen.
    await admin.auth.admin.deleteUser(invite.user.id)
    return json({ error: `Profil konnte nicht angelegt werden: ${profErr.message}` }, 500)
  }

  return json({ ok: true, email: member.email, reinvited: reinvite }, 200)
})

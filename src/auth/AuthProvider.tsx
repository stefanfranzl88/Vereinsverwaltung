import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Member, ModuleKey, Profile, Tenant } from '@/types'
import { AuthContext, type AuthState } from './context'
import type { Permission } from './roles'

interface RoleRef {
  key: string
  label: string
}

interface LoadedContext {
  profile: Profile | null
  tenant: Tenant | null
  member: Member | null
  roles: RoleRef[]
  permissions: Permission[]
  activeModules: ModuleKey[]
}

const EMPTY: LoadedContext = {
  profile: null,
  tenant: null,
  member: null,
  roles: [],
  permissions: [],
  activeModules: [],
}

/** Form der verschachtelten PostgREST-Antwort: member_roles → roles → role_permissions. */
interface MemberRoleRow {
  roles: {
    key: string
    label: string
    role_permissions: { permission_key: string }[]
  } | null
}

/**
 * Rechte des angemeldeten Benutzers – ausschließlich aus der Datenbank.
 *
 * Sysadmin bekommt den kompletten permissions-Katalog. Das spiegelt exakt, was
 * has_perm() in der DB tut (dort ein OR auf profiles.is_sysadmin), damit Frontend
 * und RLS dieselbe Antwort geben.
 */
async function loadPermissions(
  memberId: string | null,
  isSysadmin: boolean,
): Promise<{ roles: RoleRef[]; permissions: Permission[] }> {
  if (isSysadmin) {
    const { data, error } = await supabase
      .from('permissions')
      .select('key')
      .returns<{ key: string }[]>()

    if (error) throw error
    const all = (data ?? []).map((p) => p.key as Permission)

    // Die Rollen des Sysadmins interessieren trotzdem – für die Anzeige im Topbar-Chip.
    const roles = memberId ? await loadRoles(memberId) : []
    return { roles, permissions: all }
  }

  if (!memberId) return { roles: [], permissions: [] }

  const { data, error } = await supabase
    .from('member_roles')
    .select('roles(key, label, role_permissions(permission_key))')
    .eq('member_id', memberId)
    .returns<MemberRoleRow[]>()

  if (error) throw error

  const roles: RoleRef[] = []
  const perms = new Set<Permission>()

  for (const row of data ?? []) {
    if (!row.roles) continue
    roles.push({ key: row.roles.key, label: row.roles.label })
    for (const rp of row.roles.role_permissions ?? []) {
      perms.add(rp.permission_key as Permission)
    }
  }

  return { roles, permissions: [...perms] }
}

async function loadRoles(memberId: string): Promise<RoleRef[]> {
  const { data, error } = await supabase
    .from('member_roles')
    .select('roles(key, label)')
    .eq('member_id', memberId)
    .returns<{ roles: RoleRef | null }[]>()

  if (error) throw error
  return (data ?? []).map((r) => r.roles).filter((r): r is RoleRef => r !== null)
}

/**
 * Lädt den kompletten Mandanten-Kontext: profiles → tenants, members,
 * Rollen samt Rechten und die gebuchten Module.
 *
 * Alle Abfragen laufen unter RLS – der Server entscheidet, was sichtbar ist.
 * Das Frontend blendet lediglich aus, was ohnehin abgelehnt würde.
 */
async function loadContext(userId: string): Promise<LoadedContext> {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, tenant_id, member_id, is_sysadmin, consented_at, consent_version')
    .eq('id', userId)
    .maybeSingle<Profile>()

  if (profileErr) throw profileErr
  if (!profile) {
    throw new Error(
      'Für diesen Login existiert kein Profil (Tabelle profiles). Der Benutzer muss einem Verein zugeordnet werden.',
    )
  }

  const [tenantRes, memberRes, modulesRes, rolesAndPerms] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, logo_url, zvr_zahl, dekade, settings')
      .eq('id', profile.tenant_id)
      .maybeSingle<Tenant>(),
    profile.member_id
      ? supabase.from('members').select('*').eq('id', profile.member_id).maybeSingle<Member>()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('tenant_modules')
      .select('module_key, active_until')
      .eq('tenant_id', profile.tenant_id),
    loadPermissions(profile.member_id, profile.is_sysadmin),
  ])

  if (tenantRes.error) throw tenantRes.error
  if (memberRes.error) throw memberRes.error
  if (modulesRes.error) throw modulesRes.error

  // 'core' ist laut Schema immer aktiv, auch ohne Zeile in tenant_modules.
  const today = new Date().toISOString().slice(0, 10)
  const active = new Set<ModuleKey>(['core'])
  for (const row of modulesRes.data ?? []) {
    const m = row as { module_key: ModuleKey; active_until: string | null }
    if (!m.active_until || m.active_until >= today) active.add(m.module_key)
  }

  return {
    profile,
    tenant: tenantRes.data,
    member: memberRes.data,
    roles: rolesAndPerms.roles,
    permissions: rolesAndPerms.permissions,
    activeModules: [...active],
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ctx, setCtx] = useState<LoadedContext>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Verhindert, dass eine langsame Antwort eines alten Users den neuen überschreibt.
  const requestId = useRef(0)

  const hydrate = useCallback(async (activeSession: Session | null) => {
    const id = ++requestId.current
    if (!activeSession) {
      setCtx(EMPTY)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const loaded = await loadContext(activeSession.user.id)
      if (id !== requestId.current) return
      setCtx(loaded)
      setError(null)
    } catch (e) {
      if (id !== requestId.current) return
      setCtx(EMPTY)
      setError(e instanceof Error ? e.message : 'Kontext konnte nicht geladen werden.')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      void hydrate(data.session)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      // TOKEN_REFRESHED ändert den Mandanten-Kontext nicht – kein Reload nötig.
      if (event === 'TOKEN_REFRESHED') return
      void hydrate(newSession)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [hydrate])

  const value = useMemo<AuthState>(() => {
    const isSysadmin = ctx.profile?.is_sysadmin ?? false
    const permissions = new Set(ctx.permissions)
    const activeModules = new Set(ctx.activeModules)

    const roleKeys = ctx.roles.map((r) => r.key)
    const labels = ctx.roles.map((r) => r.label)
    const roleLabel = isSysadmin
      ? 'Systemadmin'
      : labels.length > 0
        ? labels.join(' + ')
        : 'Mitglied'

    return {
      session,
      profile: ctx.profile,
      tenant: ctx.tenant,
      member: ctx.member,
      roleKeys,
      roleLabel,
      permissions,
      activeModules,
      loading,
      error,
      can: (perm: Permission) => permissions.has(perm),
      hasModule: (mod: ModuleKey) => activeModules.has(mod),
      refresh: async () => {
        await hydrate(session)
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }
  }, [session, ctx, loading, error, hydrate])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

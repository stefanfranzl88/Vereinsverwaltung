import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { PERM_LABELS, type Permission } from '@/auth/roles'
import type { ModuleKey } from '@/types'
import {
  fetchPermissionCatalog,
  fetchRolePermissions,
  fetchRoles,
  permCatalogKey,
  rolePermsKey,
  rolesKey,
  setRolePermission,
} from './api'

/** core zuerst, danach die Zusatzmodule – wie in der Navigation. */
const MODULE_ORDER: ModuleKey[] = [
  'core',
  'kassa',
  'events',
  'inventar',
  'dokumente',
  'schluessel',
  'umfragen',
  'chat',
  'mitarbeit',
]

export function RolesMatrixPage() {
  const { tenant, can, hasModule, refresh, profile } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const mayManage = can('roles.manage')

  const rolesQuery = useQuery({
    queryKey: rolesKey(tenantId),
    queryFn: () => fetchRoles(tenantId),
    enabled: Boolean(tenantId),
  })
  const catalogQuery = useQuery({
    queryKey: permCatalogKey,
    queryFn: fetchPermissionCatalog,
  })
  const rolePermsQuery = useQuery({
    queryKey: rolePermsKey(tenantId),
    queryFn: fetchRolePermissions,
    enabled: Boolean(tenantId),
  })

  const toggle = useMutation({
    mutationFn: ({
      roleId,
      permissionKey,
      grant,
    }: {
      roleId: string
      permissionKey: string
      grant: boolean
      roleLabel: string
      permLabel: string
    }) => setRolePermission(roleId, permissionKey, grant),

    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: rolePermsKey(tenantId) })
      // Die Änderung kann die eigenen Rechte betreffen (z.B. Kassier entzieht
      // seiner eigenen Rolle ein Recht) – Kontext neu laden, sonst zeigt die
      // Navigation weiter Punkte, die die DB inzwischen ablehnt.
      await refresh()
      toast(`${vars.roleLabel}: „${vars.permLabel}" ${vars.grant ? 'erteilt' : 'entzogen'}`)
    },
    onError: (e: Error) => toastError(e.message),
  })

  const granted = useMemo(() => {
    const set = new Set<string>()
    for (const rp of rolePermsQuery.data ?? []) set.add(`${rp.role_id}::${rp.permission_key}`)
    return set
  }, [rolePermsQuery.data])

  const permissions = useMemo(() => {
    const items = catalogQuery.data ?? []
    return [...items].sort((a, b) => {
      const ma = MODULE_ORDER.indexOf((a.module_key ?? 'core') as ModuleKey)
      const mb = MODULE_ORDER.indexOf((b.module_key ?? 'core') as ModuleKey)
      if (ma !== mb) return ma - mb
      return a.label.localeCompare(b.label, 'de')
    })
  }, [catalogQuery.data])

  const roles = rolesQuery.data ?? []
  const isPending = rolesQuery.isPending || catalogQuery.isPending || rolePermsQuery.isPending
  const error = rolesQuery.error ?? catalogQuery.error ?? rolePermsQuery.error

  if (error) {
    return (
      <>
        <h2 className="view-title">Rechteverteilung</h2>
        <div className="error-box">Matrix konnte nicht geladen werden: {error.message}</div>
      </>
    )
  }

  return (
    <>
      <h2 className="view-title">Rechteverteilung</h2>
      <p className="view-sub">
        Wer darf was? Diese Matrix steuert die gesamte Anwendung.{' '}
        {mayManage
          ? 'Du kannst Rechte per Klick auf ✓/– umschalten.'
          : 'Du hast Einsicht – Änderungen nimmt nur der Systemadmin vor.'}
      </p>

      <div className="card">
        {isPending ? (
          <p className="meta">Wird geladen…</p>
        ) : (
          <div className="table-wrap">
            <table className="perm-grid">
              <thead>
                <tr>
                  <th>Berechtigung</th>
                  {roles.map((r) => (
                    <th key={r.id} style={{ textAlign: 'center' }}>
                      {r.label}
                      {r.is_locked && (
                        <>
                          <br />
                          <span className="meta" style={{ fontSize: 10 }}>
                            🔒 gesperrt
                          </span>
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((p) => {
                  const moduleKey = (p.module_key ?? 'core') as ModuleKey
                  const moduleActive = hasModule(moduleKey)

                  return (
                    <tr key={p.key} style={moduleActive ? undefined : { opacity: 0.55 }}>
                      <td>
                        {p.label || PERM_LABELS[p.key as Permission] || p.key}
                        {!moduleActive && (
                          <span className="pill grey" style={{ marginLeft: 6 }}>
                            Modul nicht gebucht
                          </span>
                        )}
                      </td>

                      {roles.map((r) => {
                        const on = granted.has(`${r.id}::${p.key}`)
                        const editable = mayManage && !r.is_locked
                        const mark = on ? (
                          <span className="check">✓</span>
                        ) : (
                          <span className="cross">–</span>
                        )

                        return (
                          <td key={r.id} style={{ textAlign: 'center' }}>
                            {editable ? (
                              <button
                                type="button"
                                title={`„${p.label}" für ${r.label} ${on ? 'entziehen' : 'erteilen'}`}
                                disabled={toggle.isPending}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  fontSize: 15,
                                }}
                                onClick={() =>
                                  toggle.mutate({
                                    roleId: r.id,
                                    permissionKey: p.key,
                                    grant: !on,
                                    roleLabel: r.label,
                                    permLabel: p.label,
                                  })
                                }
                              >
                                {mark}
                              </button>
                            ) : (
                              mark
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="meta" style={{ marginTop: 12 }}>
          Die Matrix ist die einzige Quelle der Wahrheit: Dieselben Zeilen
          (<span className="mono">role_permissions</span>) entscheiden im Frontend, was du siehst,
          und in der Datenbank über <span className="mono">has_perm()</span>, was du tun darfst.
          Die Systemadmin-Spalte ist gesperrt (<span className="mono">is_locked</span>) und auch per
          RLS gegen Änderungen geschützt.
          {profile?.is_sysadmin && ' Als Systemadmin hast du unabhängig von dieser Matrix alle Rechte.'}
        </p>
      </div>
    </>
  )
}

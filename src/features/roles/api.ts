import { supabase } from '@/lib/supabase'
import type { Role } from '@/auth/roles'
import type { PermissionCatalogItem, RolePermission } from '@/types'

export const rolesKey = (tenantId: string) => ['roles', tenantId] as const
export const permCatalogKey = ['permissions-catalog'] as const
export const rolePermsKey = (tenantId: string) => ['role-permissions', tenantId] as const

export async function fetchRoles(tenantId: string): Promise<Role[]> {
  const { data, error } = await supabase
    .from('roles')
    .select('id, key, label, sort_order, is_locked')
    .eq('tenant_id', tenantId)
    .order('sort_order')
    .returns<Role[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchPermissionCatalog(): Promise<PermissionCatalogItem[]> {
  const { data, error } = await supabase
    .from('permissions')
    .select('key, label, module_key')
    .returns<PermissionCatalogItem[]>()

  if (error) throw error
  return data ?? []
}

/** RLS liefert nur die role_permissions der Rollen des eigenen Vereins. */
export async function fetchRolePermissions(): Promise<RolePermission[]> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('role_id, permission_key')
    .returns<RolePermission[]>()

  if (error) throw error
  return data ?? []
}

/**
 * Recht erteilen bzw. entziehen.
 *
 * Die eigentliche Absicherung liegt in der RLS-Policy role_permissions_write:
 * nur mit 'roles.manage', nur im eigenen Verein und nur bei nicht gesperrten
 * Rollen. Das UI sperrt dieselben Fälle nur schon vorher weg.
 */
export async function setRolePermission(
  roleId: string,
  permissionKey: string,
  grant: boolean,
): Promise<void> {
  if (grant) {
    const { error } = await supabase
      .from('role_permissions')
      .insert({ role_id: roleId, permission_key: permissionKey })
    // Ein per RLS verbotenes INSERT liefert einen Fehler (42501) – das reicht hier.
    if (error) throw error
    return
  }

  const { data, error } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId)
    .eq('permission_key', permissionKey)
    .select('role_id')

  if (error) throw error

  // Achtung: Ein von RLS blockiertes DELETE wirft KEINEN Fehler – es trifft
  // einfach keine Zeile. Ohne diese Prüfung sähe ein abgelehnter Entzug in der
  // Oberfläche wie ein Erfolg aus, bis zum nächsten Reload.
  if (!data || data.length === 0) {
    throw new Error('Recht wurde nicht entzogen – fehlende Berechtigung oder Rolle gesperrt.')
  }
}

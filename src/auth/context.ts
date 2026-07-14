import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Member, ModuleKey, Profile, Tenant } from '@/types'
import type { Permission } from './roles'

export interface AuthState {
  session: Session | null
  profile: Profile | null
  tenant: Tenant | null
  member: Member | null
  roleKeys: string[]
  roleLabel: string
  permissions: Set<Permission>
  activeModules: Set<ModuleKey>
  loading: boolean
  /** Setup-Fehler, die kein Login-Problem sind (z.B. Profil ohne Tenant). */
  error: string | null
  can: (perm: Permission) => boolean
  hasModule: (mod: ModuleKey) => boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden')
  return ctx
}

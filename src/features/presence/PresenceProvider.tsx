import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/context'
import { touchPresence } from './api'

interface PresenceValue {
  /** Ist die Präsenz-Anzeige vereinsweit aktiv? */
  enabled: boolean
  /** member_ids der aktuell online befindlichen Mitglieder. */
  onlineIds: Set<string>
  onlineCount: number
}

const PresenceContext = createContext<PresenceValue>({
  enabled: false,
  onlineIds: new Set(),
  onlineCount: 0,
})

export function usePresence(): PresenceValue {
  return useContext(PresenceContext)
}

/** Alle 4 Minuten „zuletzt online" auffrischen, solange die App offen ist. */
const HEARTBEAT_MS = 4 * 60 * 1000

/**
 * Hält die Realtime-Presence des eigenen Vereins: trackt das eigene Mitglied auf
 * dem Kanal presence:{tenant} und liest heraus, wer sonst noch online ist. Der
 * „zuletzt online"-Zeitstempel wird per RPC persistiert (nur für die Verwaltung
 * sichtbar). Ist die Präsenz vereinsweit deaktiviert, passiert nichts.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { tenant, member } = useAuth()
  const tenantId = tenant?.id ?? ''
  const memberId = member?.id ?? ''
  // Standard = an; nur ein ausdrückliches false schaltet ab.
  const enabled = tenantId !== '' && tenant?.settings?.presence_enabled !== false

  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!enabled || !memberId) {
      setOnlineIds(new Set())
      return
    }

    void touchPresence().catch(() => {})
    const heartbeat = window.setInterval(() => void touchPresence().catch(() => {}), HEARTBEAT_MS)

    const channel = supabase.channel(`presence:${tenantId}`, {
      config: { presence: { key: memberId } },
    })

    const sync = () => {
      const state = channel.presenceState<{ member_id: string }>()
      const ids = new Set<string>()
      for (const key of Object.keys(state)) {
        for (const meta of state[key]) ids.add(meta.member_id ?? key)
      }
      setOnlineIds(ids)
    }

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ member_id: memberId })
        }
      })

    return () => {
      window.clearInterval(heartbeat)
      void supabase.removeChannel(channel)
    }
  }, [enabled, tenantId, memberId])

  return (
    <PresenceContext.Provider value={{ enabled, onlineIds, onlineCount: onlineIds.size }}>
      {children}
    </PresenceContext.Provider>
  )
}

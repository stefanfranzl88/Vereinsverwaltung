import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { fullName } from '@/lib/format'
import { fetchMembers, membersKey } from '@/features/members/api'
import type { ChatMessage } from '@/types'
import { chatKey, deleteMessage, fetchMessages, sendMessage } from './api'

/** "14:22" heute, sonst "Do 14:22" / "12.06. 14:22". */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return time

  const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 7) {
    const wd = d.toLocaleDateString('de-AT', { weekday: 'short' }).replace('.', '')
    return `${wd} ${time}`
  }
  return `${d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })} ${time}`
}

export function ChatPage() {
  const { tenant, member: me } = useAuth()
  const { toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const [draft, setDraft] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const { data: messages = [], isPending, error } = useQuery({
    queryKey: chatKey(tenantId),
    queryFn: () => fetchMessages(tenantId),
    enabled: Boolean(tenantId),
  })

  const { data: members = [] } = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) map.set(m.id, fullName(m))
    return map
  }, [members])

  // --- Cache-Helfer: Nachricht einfügen/entfernen, dedupliziert nach id ---
  const upsert = (msg: ChatMessage) => {
    queryClient.setQueryData<ChatMessage[]>(chatKey(tenantId), (prev = []) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      return [...prev, msg]
    })
  }
  const removeLocal = (id: string) => {
    queryClient.setQueryData<ChatMessage[]>(chatKey(tenantId), (prev = []) =>
      prev.filter((m) => m.id !== id),
    )
  }

  // --- Realtime: neue und gelöschte Nachrichten dieses Vereins live ---
  useEffect(() => {
    if (!tenantId) return

    const channel = supabase
      .channel(`chat:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => upsert(payload.new as ChatMessage),
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_messages',
          // DELETE-Payloads tragen nur den Primärschlüssel (kein tenant-Filter
          // möglich) – deshalb hier ungefiltert und nach id entfernen.
        },
        (payload) => {
          const id = (payload.old as { id?: string }).id
          if (id) removeLocal(id)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  // Nach unten scrollen, wenn neue Nachrichten kommen.
  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [messages.length])

  const sendM = useMutation({
    mutationFn: (body: string) => sendMessage(tenantId, me!.id, body),
    // Sofort anzeigen, ohne auf das Realtime-Echo zu warten (dedupliziert).
    onSuccess: (msg) => upsert(msg),
    onError: (e: Error) => toastError(`Nicht gesendet: ${e.message}`),
  })

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteMessage(id),
    onSuccess: (_d, id) => removeLocal(id),
    onError: (e: Error) => toastError(`Nicht gelöscht: ${e.message}`),
  })

  const send = () => {
    const body = draft.trim()
    if (!body || !me) return
    setDraft('')
    sendM.mutate(body)
  }

  if (error) {
    return (
      <>
        <h2 className="view-title">Vereins-Chat</h2>
        <div className="error-box">Chat konnte nicht geladen werden: {error.message}</div>
      </>
    )
  }

  return (
    <>
      <h2 className="view-title">Vereins-Chat</h2>
      <p className="view-sub">Kanal: #vorstand-und-helfer</p>

      <div className="card">
        <div className="chat-box" ref={boxRef}>
          {isPending ? (
            <p className="meta">Wird geladen…</p>
          ) : messages.length === 0 ? (
            <p className="meta">Noch keine Nachrichten – schreib die erste!</p>
          ) : (
            messages.map((m) => {
              const mine = m.member_id === me?.id
              return (
                <div key={m.id} className={`msg${mine ? ' mine' : ''}`}>
                  <div className="who">{nameById.get(m.member_id) ?? 'Mitglied'}</div>
                  {m.body}
                  <span className="t">
                    {formatTime(m.created_at)}
                    {mine && (
                      <button
                        title="Nachricht löschen"
                        onClick={() => deleteM.mutate(m.id)}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          color: 'inherit',
                          opacity: 0.7,
                          marginLeft: 6,
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="row">
          <input
            className="search"
            style={{ flex: 1 }}
            placeholder="Nachricht schreiben…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
          />
          <button className="btn small" disabled={!draft.trim() || sendM.isPending} onClick={send}>
            Senden
          </button>
        </div>
      </div>
    </>
  )
}

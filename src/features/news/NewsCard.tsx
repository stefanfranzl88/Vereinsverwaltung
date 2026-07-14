import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { fdate, today } from '@/lib/format'
import type { NewsItem } from '@/types'
import { fetchNews, newsKey, publishNews, type NewsInput } from './api'
import { NewsComposeDialog } from './NewsComposeDialog'

/** Bucket "news" ist privat – Fotos brauchen eine signierte URL. */
function NewsPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.storage
      .from('news')
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!url) return null

  return (
    <img
      src={url}
      alt=""
      style={{
        maxWidth: '100%',
        maxHeight: 180,
        borderRadius: 10,
        border: '1px solid var(--line)',
        margin: '4px 0',
        display: 'block',
      }}
    />
  )
}

export function NewsCard() {
  const { tenant, member: me, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()
  const [composeOpen, setComposeOpen] = useState(false)

  const tenantId = tenant?.id ?? ''
  const mayPost = can('news.post')

  const { data: items = [], isPending } = useQuery({
    queryKey: newsKey(tenantId),
    queryFn: () => fetchNews(tenantId),
    enabled: Boolean(tenantId),
  })

  const publishMutation = useMutation({
    mutationFn: (input: NewsInput) => publishNews(tenantId, me?.id ?? null, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: newsKey(tenantId) })
      setComposeOpen(false)
      toast('Mitteilung veröffentlicht')
    },
    onError: (e: Error) => toastError(`Nicht veröffentlicht: ${e.message}`),
  })

  const iso = today()
  const isExpired = (n: NewsItem) => Boolean(n.expires_at && n.expires_at < iso)

  return (
    <div className="card">
      <h3>📢 Aktuelle Mitteilungen</h3>

      {isPending ? (
        <p className="meta">Wird geladen…</p>
      ) : items.length === 0 ? (
        <p className="meta">Keine Mitteilungen.</p>
      ) : (
        items.map((n) => (
          <div className="list-item" key={n.id}>
            <div className="avatar">
              {n.members ? `${n.members.first_name[0]}${n.members.last_name[0]}` : '?'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{n.title}</b>
              {/* Abgelaufenes sieht nur, wer veröffentlichen darf (RLS) –
                  deshalb hier klar kennzeichnen. */}
              {isExpired(n) && (
                <span className="pill grey" style={{ marginLeft: 6 }}>
                  abgelaufen
                </span>
              )}
              {n.body && <div style={{ fontSize: 13.5, margin: '2px 0' }}>{n.body}</div>}
              {n.photo_path && <NewsPhoto path={n.photo_path} />}
              <div className="meta">
                {n.members ? `${n.members.first_name} ${n.members.last_name}` : 'Unbekannt'} ·{' '}
                {fdate(n.created_at.slice(0, 10))}
                {n.expires_at && ` · sichtbar bis ${fdate(n.expires_at)}`}
              </div>
            </div>
          </div>
        ))
      )}

      {mayPost && (
        <button
          className="btn ghost small"
          style={{ marginTop: 10 }}
          onClick={() => setComposeOpen(true)}
        >
          + Mitteilung veröffentlichen
        </button>
      )}

      {composeOpen && (
        <NewsComposeDialog
          saving={publishMutation.isPending}
          onSave={(input) => publishMutation.mutate(input)}
          onClose={() => setComposeOpen(false)}
        />
      )}
    </div>
  )
}

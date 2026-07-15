import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { fdate, fullName } from '@/lib/format'
import { DOC_CATEGORIES, type VereinsDocument } from '@/types'
import {
  deleteDocument,
  documentUrl,
  documentsKey,
  fetchDocuments,
  uploadDocument,
  type DocumentInput,
} from './api'
import { UploadDialog } from './UploadDialog'

export function DokumentePage() {
  const { tenant, member: me, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const mayManage = can('docs.manage')

  const [filter, setFilter] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  const { data: documents = [], isPending, error } = useQuery({
    queryKey: documentsKey(tenantId),
    queryFn: () => fetchDocuments(tenantId),
    enabled: Boolean(tenantId),
  })

  const uploadM = useMutation({
    mutationFn: (input: DocumentInput) => uploadDocument(tenantId, me?.id ?? null, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentsKey(tenantId) })
      setDialogOpen(false)
      toast('Dokument abgelegt')
    },
    onError: (e: Error) => toastError(`Nicht abgelegt: ${e.message}`),
  })

  const deleteM = useMutation({
    mutationFn: (doc: VereinsDocument) => deleteDocument(doc),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentsKey(tenantId) })
      toast('Dokument gelöscht')
    },
    onError: (e: Error) => toastError(`Nicht gelöscht: ${e.message}`),
  })

  const filtered = useMemo(
    () => (filter ? documents.filter((d) => d.category === filter) : documents),
    [documents, filter],
  )

  const open = async (doc: VereinsDocument) => {
    setOpening(doc.id)
    try {
      const url = await documentUrl(doc.file_path)
      if (url) window.open(url, '_blank', 'noopener')
      else toastError('Dokument konnte nicht geöffnet werden')
    } finally {
      setOpening(null)
    }
  }

  const confirmDelete = (doc: VereinsDocument) => {
    if (window.confirm(`„${doc.name}" wirklich löschen?`)) deleteM.mutate(doc)
  }

  if (error) {
    return (
      <>
        <h2 className="view-title">Dokumentenablage</h2>
        <div className="error-box">Dokumente konnten nicht geladen werden: {error.message}</div>
      </>
    )
  }

  return (
    <>
      <h2 className="view-title">Dokumentenablage</h2>
      <p className="view-sub">
        Verträge, Polizzen, Bescheide &amp; Co. – zentral abgelegt, nur für berechtigte Funktionen
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button className={!filter ? 'on' : ''} onClick={() => setFilter('')}>
            Alle
          </button>
          {DOC_CATEGORIES.map((c) => (
            <button key={c} className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {mayManage && (
          <button className="btn small" onClick={() => setDialogOpen(true)}>
            + Dokument ablegen
          </button>
        )}
      </div>

      <div className="card">
        {isPending ? (
          <p className="meta">Wird geladen…</p>
        ) : filtered.length === 0 ? (
          <p className="meta">
            {documents.length === 0
              ? 'Noch keine Dokumente abgelegt.'
              : 'Keine Dokumente in dieser Kategorie.'}
          </p>
        ) : (
          filtered.map((d) => (
            <div className="list-item" key={d.id}>
              <div className="avatar">📄</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{d.name}</b>
                <div className="meta">
                  <span className="pill grey">{d.category}</span> abgelegt von{' '}
                  {d.members ? fullName(d.members) : 'Unbekannt'} am{' '}
                  {fdate(d.created_at.slice(0, 10))}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn ghost small"
                  disabled={opening === d.id}
                  onClick={() => void open(d)}
                >
                  {opening === d.id ? 'Öffnet…' : 'Öffnen'}
                </button>
                {mayManage && (
                  <button
                    className="btn ghost small"
                    title="Löschen"
                    disabled={deleteM.isPending}
                    onClick={() => confirmDelete(d)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {dialogOpen && (
        <UploadDialog
          saving={uploadM.isPending}
          onSave={(input) => uploadM.mutate(input)}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}

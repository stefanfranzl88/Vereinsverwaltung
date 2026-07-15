import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Artikelfotos liegen im privaten Bucket "item-photos" – wie bei Avataren also
 * keine feste URL, sondern eine kurzlebige signierte URL.
 */
export function useItemPhotoUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let cancelled = false
    supabase.storage
      .from('item-photos')
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return url
}

/** Kleines Thumbnail für Listen; Fallback = Emoji-Kachel. */
export function ItemThumb({
  path,
  fallback = '📦',
  size = 40,
}: {
  path: string | null
  fallback?: string
  size?: number
}) {
  const url = useItemPhotoUrl(path)
  if (!url) {
    return (
      <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.5 }}>
        {fallback}
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        objectFit: 'cover',
        display: 'block',
        flexShrink: 0,
      }}
    />
  )
}

/** Großes Bild fürs Scan-/Detail-Panel. Zeigt nichts, wenn kein Foto da ist. */
export function ItemPhotoLarge({ path }: { path: string | null }) {
  const url = useItemPhotoUrl(path)
  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      style={{
        width: '100%',
        maxHeight: 240,
        objectFit: 'cover',
        borderRadius: 12,
        display: 'block',
      }}
    />
  )
}

/**
 * Foto-Feld für Anlegen/Bearbeiten: Vorschau (neue Auswahl ODER bestehendes
 * Foto), „Foto wählen" (Galerie/Kamera) und – am Handy – ein direkter
 * Kamera-Button (capture). Die eigentliche Datei hält der Aufrufer; hochgeladen
 * wird erst beim Speichern.
 */
export function ItemPhotoField({
  existingPath,
  file,
  removed,
  onPick,
  onRemove,
}: {
  existingPath: string | null
  file: File | null
  removed: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  const existingUrl = useItemPhotoUrl(removed ? null : existingPath)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const shown = preview ?? existingUrl
  const hasPhoto = Boolean(shown)

  return (
    <div>
      <label>Foto</label>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        {hasPhoto ? (
          <img
            src={shown!}
            alt=""
            style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div className="avatar" style={{ width: 72, height: 72, fontSize: 30 }}>
            📦
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <label className="btn ghost small" style={{ cursor: 'pointer' }}>
              🖼 Foto wählen
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPick(f)
                  e.target.value = ''
                }}
              />
            </label>
            <label className="btn ghost small" style={{ cursor: 'pointer' }}>
              📷 Kamera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPick(f)
                  e.target.value = ''
                }}
              />
            </label>
            {hasPhoto && (
              <button type="button" className="btn ghost small" onClick={onRemove}>
                Entfernen
              </button>
            )}
          </div>
          <p className="hint">Wird vor dem Upload verkleinert. Am Handy Kamera oder Galerie.</p>
        </div>
      </div>
    </div>
  )
}

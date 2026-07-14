import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { initials, jubilee } from '@/lib/format'
import type { Member } from '@/types'

/**
 * Profilbilder liegen im privaten Bucket "avatars" (Pfad: {tenant_id}/{member_id}.jpg).
 * Deshalb keine feste URL, sondern eine kurzlebige signierte URL.
 */
function useAvatarUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let cancelled = false
    supabase.storage
      .from('avatars')
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

/**
 * Bewusst nur die Felder, die der Avatar wirklich braucht. Sonst müssten
 * Aufrufer mit Teildaten (z.B. eingebettete members(...)-Joins) einen vollen
 * Member-Datensatz erfinden.
 */
export type AvatarMember = Pick<Member, 'first_name' | 'last_name' | 'photo_path'> & {
  joined_at?: string | null
}

interface AvatarProps {
  member: AvatarMember
  size?: number
  /** Jubiläums-Medaille (5, 10, 15 … Jahre) wie im Prototyp. */
  showMedal?: boolean
}

export function Avatar({ member, size = 36, showMedal = false }: AvatarProps) {
  const url = useAvatarUrl(member.photo_path)
  const jub = showMedal
    ? jubilee({ joined_at: member.joined_at ?? null })
    : { years: 0, thisMonth: false }

  const title = jub.thisMonth
    ? `${jub.years} Jahre Mitgliedschaft – Jubiläum diesen Monat!`
    : `${jub.years} Jahre Mitgliedschaft (Jubiläum heuer)`

  return (
    <div className="avatar-wrap" style={{ width: size }}>
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div className="avatar" style={{ width: size, height: size }}>
          {initials(member)}
        </div>
      )}
      {jub.years > 0 && (
        // Im Jubiläumsmonat bekommt die Medaille einen Ring – sonst ist sie
        // ein ruhiger Hinweis auf das laufende Jubiläumsjahr.
        <div className={`medal${jub.thisMonth ? ' now' : ''}`} title={title}>
          {jub.years}
        </div>
      )}
    </div>
  )
}

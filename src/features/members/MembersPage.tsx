import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { fdate, fullName } from '@/lib/format'
import type { Member, MemberInput } from '@/types'
import {
  createMember,
  fetchKeyChips,
  fetchMembers,
  keyChipsKey,
  membersKey,
  updateDekade,
  updateMember,
  uploadAvatar,
} from './api'
import { FUNK_ORDER, MemberFormDialog } from './MemberFormDialog'
import { DekadeDialog } from './DekadeDialog'

export function MembersPage() {
  const { tenant, member: me, can, hasModule, refresh } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Member | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dekadeOpen, setDekadeOpen] = useState(false)

  const tenantId = tenant?.id ?? ''
  const mayEdit = can('members.edit')
  const mayManage = can('roles.manage')
  const hasKeys = hasModule('schluessel')

  const {
    data: members = [],
    isPending,
    error,
  } = useQuery({
    queryKey: membersKey(tenantId),
    queryFn: () => fetchMembers(tenantId),
    enabled: Boolean(tenantId),
  })

  // Nur laden, wenn das Modul gebucht ist – sonst gäbe die RLS-Policy
  // (module_active('schluessel')) ohnehin nichts zurück.
  const { data: chips = [] } = useQuery({
    queryKey: keyChipsKey(tenantId),
    queryFn: () => fetchKeyChips(tenantId),
    enabled: Boolean(tenantId) && hasKeys,
  })

  const chipByMember = useMemo(() => {
    const map = new Map<string, (typeof chips)[number]>()
    for (const c of chips) map.set(c.member_id, c)
    return map
  }, [chips])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: membersKey(tenantId) })

  const saveMutation = useMutation({
    mutationFn: (input: MemberInput) =>
      editing ? updateMember(editing.id, input) : createMember(tenantId, input),
    onSuccess: async () => {
      await invalidate()
      toast(editing ? 'Gespeichert' : 'Mitglied angelegt')
      setDialogOpen(false)
      setEditing(null)
    },
    onError: (e: Error) => toastError(`Speichern fehlgeschlagen: ${e.message}`),
  })

  const avatarMutation = useMutation({
    mutationFn: ({ memberId, file }: { memberId: string; file: File }) =>
      uploadAvatar(tenantId, memberId, file, me?.id === memberId),
    onSuccess: async () => {
      await invalidate()
      // Das eigene Bild steckt auch im Auth-Kontext (Topbar) – mitziehen.
      await refresh()
      toast('Profilbild aktualisiert')
    },
    onError: (e: Error) => toastError(`Upload fehlgeschlagen: ${e.message}`),
  })

  const dekadeMutation = useMutation({
    mutationFn: (dekade: string) => updateDekade(tenantId, dekade),
    onSuccess: async () => {
      await refresh()
      setDekadeOpen(false)
      toast('Funktionsperiode aktualisiert')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const { board, regular } = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const matches = (m: Member) => fullName(m).toLowerCase().includes(needle)
    const hits = needle ? members.filter(matches) : members

    // Vorstand in Funktionsreihenfolge (Obmann → Ausschussmitglied),
    // alle übrigen alphabetisch nach Nachname.
    const boardList = FUNK_ORDER.flatMap((fn) => hits.filter((m) => m.funktion === fn))
    const regularList = hits
      .filter((m) => !m.funktion)
      .sort((a, b) => a.last_name.localeCompare(b.last_name, 'de'))

    return { board: boardList, regular: regularList }
  }, [members, filter])

  const onPickPhoto = (memberId: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) avatarMutation.mutate({ memberId, file })
    e.target.value = ''
  }

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (m: Member) => {
    setEditing(m)
    setDialogOpen(true)
  }

  if (error) {
    return (
      <>
        <h2 className="view-title">Mitgliederverwaltung</h2>
        <div className="error-box">Mitglieder konnten nicht geladen werden: {error.message}</div>
      </>
    )
  }

  const renderRow = (m: Member) => {
    const isMe = me?.id === m.id
    const chip = chipByMember.get(m.id)

    return (
      <tr key={m.id}>
        <td style={{ width: 56 }}>
          <Avatar member={m} size={40} showMedal />
        </td>
        <td>
          <b>{fullName(m)}</b>

          {chip && (
            <span
              className="key-chip"
              title={`Schlüsselchip ${chip.chip_nr} seit ${fdate(chip.issued_at)}`}
            >
              🔑
            </span>
          )}

          {m.funktion && (
            <span className="pill amber" style={{ marginLeft: 6 }}>
              {m.funktion}
            </span>
          )}
          {m.status !== 'aktiv' && (
            <span className="pill grey" style={{ marginLeft: 6 }}>
              {m.status}
            </span>
          )}

          {isMe && (
            <>
              <br />
              <label
                style={{ fontSize: 12, color: 'var(--pine)', cursor: 'pointer', fontWeight: 600 }}
              >
                {avatarMutation.isPending ? '⏳ Wird hochgeladen…' : '📷 Profilbild ändern'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={avatarMutation.isPending}
                  onChange={onPickPhoto(m.id)}
                />
              </label>
            </>
          )}
        </td>
        <td style={{ fontSize: 13 }}>
          {m.email ?? '–'}
          <br />
          <span className="meta">{m.phone ?? '–'}</span>
        </td>
        <td className="mono" style={{ fontSize: 13 }}>
          {fdate(m.joined_at)}
        </td>
        {mayEdit && (
          <td>
            <button className="btn ghost small" onClick={() => openEdit(m)}>
              Bearbeiten
            </button>
          </td>
        )}
      </tr>
    )
  }

  const head = (
    <thead>
      <tr>
        <th />
        <th>Name</th>
        <th>Kontakt</th>
        <th>Eintritt</th>
        {mayEdit && <th />}
      </tr>
    </thead>
  )

  const colCount = mayEdit ? 5 : 4
  const activeCount = members.filter((m) => m.status === 'aktiv').length

  return (
    <>
      <h2 className="view-title">Mitgliederverwaltung</h2>
      <p className="view-sub">
        {isPending
          ? 'Wird geladen…'
          : `${members.length} Mitglieder · ${activeCount} aktiv · 🏅 = Jubiläum heuer${
              hasKeys ? ' · 🔑 = Schlüsselchip' : ''
            }`}
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <input
          className="search"
          placeholder="Suchen…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="spacer" />
        {mayEdit && (
          <button className="btn small" onClick={openCreate}>
            + Mitglied anlegen
          </button>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Vorstand &amp; Ausschuss</h3>
          <div className="spacer" />
          <span className="pill green" title="Aktuelle Vorstandsperiode">
            🗓 Funktionsperiode: {tenant?.dekade ?? '–'}
          </span>
          {mayManage && (
            <button
              className="btn ghost small"
              title="Funktionsperiode bearbeiten"
              onClick={() => setDekadeOpen(true)}
            >
              ✎
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            {head}
            <tbody>
              {board.length > 0 ? (
                board.map(renderRow)
              ) : (
                <tr>
                  <td colSpan={colCount} className="meta">
                    {isPending ? 'Wird geladen…' : 'Keine Treffer.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Mitglieder A–Z</h3>
        <div className="table-wrap">
          <table>
            {head}
            <tbody>
              {regular.length > 0 ? (
                regular.map(renderRow)
              ) : (
                <tr>
                  <td colSpan={colCount} className="meta">
                    {isPending ? 'Wird geladen…' : 'Keine Treffer.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!mayEdit && (
          <p className="meta" style={{ marginTop: 10 }}>
            🔒 Bearbeiten ist berechtigten Funktionen vorbehalten. Dein eigenes Profilbild kannst du
            jederzeit selbst ändern.
          </p>
        )}
      </div>

      {dialogOpen && (
        <MemberFormDialog
          member={editing}
          saving={saveMutation.isPending}
          onSave={(input) => saveMutation.mutate(input)}
          onClose={() => {
            setDialogOpen(false)
            setEditing(null)
          }}
        />
      )}

      {dekadeOpen && (
        <DekadeDialog
          current={tenant?.dekade ?? ''}
          saving={dekadeMutation.isPending}
          onSave={(d) => dekadeMutation.mutate(d)}
          onClose={() => setDekadeOpen(false)}
        />
      )}
    </>
  )
}

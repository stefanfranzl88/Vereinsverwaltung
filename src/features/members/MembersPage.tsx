import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { fdate, fullName } from '@/lib/format'
import { fetchRoles, rolesKey } from '@/features/roles/api'
import type { Member, MemberInput } from '@/types'
import {
  accountStatesKey,
  createMember,
  fetchKeyChips,
  fetchMemberAccountStates,
  fetchMemberRoleKeys,
  fetchMembers,
  inviteMember,
  keyChipsKey,
  memberExit,
  memberGdprDelete,
  memberRolesKey,
  membersKey,
  setMemberRole,
  updateDekade,
  updateMember,
  uploadAvatar,
} from './api'
import { FUNK_ORDER, MemberFormDialog } from './MemberFormDialog'
import { DekadeDialog } from './DekadeDialog'
import { OffboardDialog } from './OffboardDialog'

export function MembersPage() {
  const { tenant, member: me, profile, can, hasModule, refresh } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Member | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dekadeOpen, setDekadeOpen] = useState(false)
  const [offboard, setOffboard] = useState<{ mode: 'exit' | 'gdpr'; member: Member } | null>(null)

  const tenantId = tenant?.id ?? ''
  const mayEdit = can('members.edit')
  const mayManage = can('roles.manage')
  const isSysadmin = profile?.is_sysadmin ?? false
  const hasKeys = hasModule('schluessel')

  // Rollen + aktuelle Rollenzuordnung – nur mit roles.manage relevant.
  const { data: roles = [] } = useQuery({
    queryKey: rolesKey(tenantId),
    queryFn: () => fetchRoles(tenantId),
    enabled: Boolean(tenantId) && mayManage,
  })
  const { data: memberRoleKeys = new Map<string, string>() } = useQuery({
    queryKey: memberRolesKey(tenantId),
    queryFn: fetchMemberRoleKeys,
    enabled: Boolean(tenantId) && mayManage,
  })

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

  // Account-Status (aktiv / eingeladen / kein Zugang) – nur relevant für
  // Verwalter, deshalb nur mit members.edit laden.
  const { data: accountStates = new Map() } = useQuery({
    queryKey: accountStatesKey(tenantId),
    queryFn: fetchMemberAccountStates,
    enabled: Boolean(tenantId) && mayEdit,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: membersKey(tenantId) })

  const inviteMutation = useMutation({
    mutationFn: (memberId: string) => inviteMember(memberId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: accountStatesKey(tenantId) })
      toast(
        result.reinvited
          ? `Erneute Einladung an ${result.email} gesendet`
          : `Einladung an ${result.email} gesendet`,
      )
    },
    // Fehler (z. B. Rate-Limit): KEINE Status-Änderung – der Button bleibt.
    onError: (e: Error) => toastError(`Einladung fehlgeschlagen: ${e.message}`),
  })

  const saveMutation = useMutation({
    // roleKey ist null, wenn der Dialog keine Rollenauswahl zeigte (kein
    // roles.manage) – dann bleibt die Rollenzuordnung unangetastet.
    mutationFn: async ({ input, roleKey }: { input: MemberInput; roleKey: string | null }) => {
      const saved = editing
        ? await updateMember(editing.id, input)
        : await createMember(tenantId, input)
      if (roleKey !== null) await setMemberRole(saved.id, roleKey)
      return saved
    },
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: memberRolesKey(tenantId) }),
      ])
      toast(editing ? 'Gespeichert' : 'Mitglied angelegt')
      setDialogOpen(false)
      setEditing(null)
    },
    onError: (e: Error) => toastError(`Speichern fehlgeschlagen: ${e.message}`),
  })

  const offboardMutation = useMutation({
    mutationFn: ({ mode, member }: { mode: 'exit' | 'gdpr'; member: Member }) =>
      mode === 'exit' ? memberExit(member.id) : memberGdprDelete(member.id),
    onSuccess: async (_d, vars) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: accountStatesKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: memberRolesKey(tenantId) }),
      ])
      setOffboard(null)
      toast(vars.mode === 'exit' ? 'Austritt erfasst' : 'Mitglied DSGVO-konform gelöscht')
    },
    onError: (e: Error) => toastError(e.message),
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
    // Zugangsstatus: kein Eintrag = noch kein Login. Nur für Verwalter geladen.
    const state = mayEdit ? accountStates.get(m.id) : undefined
    const account = state?.status
    const canInvite = mayEdit && account === undefined && Boolean(m.email)
    // "eingeladen" = Zugang existiert, aber E-Mail nie bestätigt → erneut möglich.
    const canReinvite = mayEdit && account === 'eingeladen' && Boolean(m.email)

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

          {/* Zugangsstatus (getrennt von der Mitgliedschafts-Status-Pille). */}
          {account === 'aktiv' && (
            <span className="pill green" style={{ marginLeft: 6 }} title="Hat einen Login">
              ✓ Zugang
            </span>
          )}
          {account === 'eingeladen' && (
            <span
              className="pill amber"
              style={{ marginLeft: 6 }}
              title={
                state?.invitedAt
                  ? `Zuletzt eingeladen am ${fdate(state.invitedAt.slice(0, 10))} – noch nicht angenommen`
                  : 'Einladung gesendet, noch nicht angenommen'
              }
            >
              eingeladen
              {state?.invitedAt && (
                <span style={{ fontWeight: 400, opacity: 0.8 }}>
                  {' '}
                  · {fdate(state.invitedAt.slice(0, 10))}
                </span>
              )}
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
            <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
              {canInvite && (
                <button
                  className="btn ghost small"
                  disabled={inviteMutation.isPending}
                  title={`Einladung an ${m.email} senden`}
                  onClick={() => inviteMutation.mutate(m.id)}
                >
                  ✉ Einladen
                </button>
              )}
              {canReinvite && (
                <button
                  className="btn ghost small"
                  disabled={inviteMutation.isPending}
                  title={
                    state?.invitedAt
                      ? `Zuletzt eingeladen am ${fdate(state.invitedAt.slice(0, 10))} – erneut senden`
                      : `Erneut an ${m.email} senden`
                  }
                  onClick={() => inviteMutation.mutate(m.id)}
                >
                  ↻ Erneut einladen
                </button>
              )}
              <button className="btn ghost small" onClick={() => openEdit(m)}>
                Bearbeiten
              </button>
              {/* Austritt: nicht bei sich selbst, nicht bei bereits Ausgetretenen. */}
              {m.status !== 'ausgetreten' && m.id !== me?.id && (
                <button
                  className="btn ghost small"
                  title="Austritt erfassen (Zugang entfernen)"
                  onClick={() => setOffboard({ mode: 'exit', member: m })}
                >
                  Austritt
                </button>
              )}
              {isSysadmin && m.id !== me?.id && (
                <button
                  className="btn ghost small danger"
                  title="DSGVO-Löschung (anonymisieren)"
                  onClick={() => setOffboard({ mode: 'gdpr', member: m })}
                >
                  🗑
                </button>
              )}
            </div>
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
          roles={mayManage ? roles : undefined}
          currentRoleKey={editing ? (memberRoleKeys.get(editing.id) ?? '') : ''}
          onSave={(input, roleKey) => saveMutation.mutate({ input, roleKey })}
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

      {offboard && (
        <OffboardDialog
          mode={offboard.mode}
          member={offboard.member}
          saving={offboardMutation.isPending}
          onConfirm={() => offboardMutation.mutate(offboard)}
          onClose={() => setOffboard(null)}
        />
      )}
    </>
  )
}

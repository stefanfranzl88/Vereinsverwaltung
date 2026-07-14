import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { fdate, fullName, today } from '@/lib/format'
import type { Item, ItemBorrow, ItemReservation } from '@/types'
import {
  borrowItem,
  borrowsKey,
  changeStock,
  createItem,
  createLocation,
  createReservation,
  decideReservation,
  fetchBorrows,
  fetchHistory,
  fetchItems,
  fetchLocations,
  fetchReservations,
  fixItem,
  historyKey,
  itemsKey,
  locationsKey,
  moveItem,
  reportDefect,
  reservationsKey,
  returnItem,
  setItemNote,
} from './api'
import { printLabel } from './label'
import {
  BorrowDialog,
  ItemDialog,
  MoveDialog,
  ReservationDialog,
  ReturnDialog,
  TextDialog,
} from './dialogs'

type Dialog =
  | { kind: 'item' }
  | { kind: 'location' }
  | { kind: 'borrow'; item: Item }
  | { kind: 'return'; item: Item }
  | { kind: 'reserve'; item: Item }
  | { kind: 'defect'; item: Item }
  | { kind: 'move'; item: Item }
  | { kind: 'note'; item: Item }
  | { kind: 'scan'; item: Item }
  | null

export function InventarPage() {
  const { tenant, member: me, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const mayManage = can('inventar.manage')
  const mayApprove = can('reserve.approve')

  const [filter, setFilter] = useState('')
  const [scanCode, setScanCode] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [openHistory, setOpenHistory] = useState<string | null>(null)

  const itemsQuery = useQuery({
    queryKey: itemsKey(tenantId),
    queryFn: () => fetchItems(tenantId),
    enabled: Boolean(tenantId),
  })
  const locationsQuery = useQuery({
    queryKey: locationsKey(tenantId),
    queryFn: () => fetchLocations(tenantId),
    enabled: Boolean(tenantId),
  })
  const borrowsQuery = useQuery({
    queryKey: borrowsKey(tenantId),
    queryFn: fetchBorrows,
    enabled: Boolean(tenantId),
  })
  const reservationsQuery = useQuery({
    queryKey: reservationsKey(tenantId),
    queryFn: fetchReservations,
    enabled: Boolean(tenantId),
  })
  const historyQuery = useQuery({
    queryKey: historyKey(openHistory ?? ''),
    queryFn: () => fetchHistory(openHistory!),
    enabled: Boolean(openHistory),
  })

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const locations = locationsQuery.data ?? []
  const borrows = useMemo(() => borrowsQuery.data ?? [], [borrowsQuery.data])
  const reservations = useMemo(() => reservationsQuery.data ?? [], [reservationsQuery.data])
  const iso = today()

  // ---------------------------------------------------------------
  // Ableitungen
  // ---------------------------------------------------------------
  const borrowsByItem = useMemo(() => {
    const map = new Map<string, ItemBorrow[]>()
    for (const b of borrows) {
      const list = map.get(b.item_id) ?? []
      list.push(b)
      map.set(b.item_id, list)
    }
    return map
  }, [borrows])

  /** Verfügbar = Gesamtbestand minus alles, was gerade ausgeborgt ist. */
  const availableOf = (item: Item) => {
    const taken = (borrowsByItem.get(item.id) ?? []).reduce((s, b) => s + b.qty, 0)
    return item.total_qty - taken
  }

  /** Aktive Reservierungen: nicht abgelehnt und noch nicht vorbei. */
  const reservationsOf = (itemId: string) =>
    reservations.filter(
      (r) => r.item_id === itemId && r.status !== 'abgelehnt' && r.date_to >= iso,
    )

  const locationName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? 'kein Standort'

  const pending = reservations.filter((r) => r.status === 'angefragt')

  const myBorrowedItems = items.filter(
    (i) => i.kind === 'geraet' && (borrowsByItem.get(i.id) ?? []).some((b) => b.member_id === me?.id),
  )

  const matches = (i: Item) =>
    `${i.name} ${i.inv_nr}`.toLowerCase().includes(filter.trim().toLowerCase())

  const devices = items.filter((i) => i.kind === 'geraet' && matches(i))
  const supplies = items.filter((i) => i.kind === 'vorrat' && matches(i))

  // ---------------------------------------------------------------
  // Mutationen
  // ---------------------------------------------------------------
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: itemsKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: borrowsKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: reservationsKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: ['item-history'] }),
    ])

  const fail = (e: Error) => toastError(e.message)
  const done = (msg: string) => async () => {
    await refresh()
    setDialog(null)
    toast(msg)
  }

  const itemM = useMutation({
    mutationFn: createItem,
    onSuccess: done('Gegenstand angelegt'),
    onError: fail,
  })
  const locationM = useMutation({
    mutationFn: (name: string) => createLocation(tenantId, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: locationsKey(tenantId) })
      setDialog(null)
      toast('Standort angelegt')
    },
    onError: fail,
  })
  const borrowM = useMutation({
    mutationFn: ({ itemId, qty }: { itemId: string; qty: number }) => borrowItem(itemId, qty),
    onSuccess: done('Ausgeborgt – gute Verwendung!'),
    onError: fail,
  })
  const returnM = useMutation({
    mutationFn: returnItem,
    onSuccess: done('Zurückgebracht'),
    onError: fail,
  })
  const stockM = useMutation({
    mutationFn: ({ itemId, delta }: { itemId: string; delta: number }) =>
      changeStock(itemId, delta),
    onSuccess: async () => {
      await refresh()
      toast('Bestand aktualisiert')
    },
    onError: fail,
  })
  const reserveM = useMutation({
    mutationFn: createReservation,
    onSuccess: done(mayApprove ? 'Reservierung eingetragen' : 'Anfrage gesendet'),
    onError: fail,
  })
  const decideM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'bestätigt' | 'abgelehnt' }) =>
      decideReservation(id, status),
    onSuccess: async (_d, vars) => {
      await refresh()
      toast(vars.status === 'bestätigt' ? 'Reservierung bestätigt' : 'Reservierung abgelehnt')
    },
    onError: fail,
  })
  const defectM = useMutation({
    mutationFn: ({ itemId, note }: { itemId: string; note: string }) =>
      reportDefect(itemId, note),
    onSuccess: done('Defekt gemeldet'),
    onError: fail,
  })
  const fixM = useMutation({
    mutationFn: (itemId: string) => fixItem(itemId),
    onSuccess: async () => {
      await refresh()
      toast('Als repariert markiert')
    },
    onError: fail,
  })
  const moveM = useMutation({
    mutationFn: ({ itemId, locationId }: { itemId: string; locationId: string }) =>
      moveItem(itemId, locationId),
    onSuccess: done('Standort aktualisiert'),
    onError: fail,
  })
  const noteM = useMutation({
    mutationFn: ({ itemId, note }: { itemId: string; note: string }) => setItemNote(itemId, note),
    onSuccess: done('Notiz gespeichert'),
    onError: fail,
  })

  const label = async (item: Item) => {
    try {
      await printLabel(item, tenant?.name ?? 'Verein')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Etikett konnte nicht erstellt werden')
    }
  }

  // ---------------------------------------------------------------
  // Scan
  // ---------------------------------------------------------------
  const doScan = (raw: string) => {
    const code = raw.trim().toUpperCase()
    if (!code) return

    const item = items.find((i) => i.inv_nr.toUpperCase() === code)
    if (!item) {
      toastError(`Keine Inventarnummer „${code}" gefunden`)
      return
    }
    setScanCode('')
    setDialog({ kind: 'scan', item })
  }

  if (itemsQuery.error) {
    return (
      <>
        <h2 className="view-title">Inventar</h2>
        <div className="error-box">
          Inventar konnte nicht geladen werden: {itemsQuery.error.message}
        </div>
      </>
    )
  }

  // ---------------------------------------------------------------
  // Zeile: Gerät
  // ---------------------------------------------------------------
  const deviceRow = (i: Item) => {
    const itemBorrows = borrowsByItem.get(i.id) ?? []
    const available = availableOf(i)
    const myBorrow = itemBorrows.find((b) => b.member_id === me?.id)
    const res = reservationsOf(i.id)
    const isOpen = openHistory === i.id

    return (
      <div className="list-item" key={i.id} style={{ flexWrap: 'wrap' }}>
        <div className="avatar">{i.defect ? '⚠️' : '📦'}</div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <b>{i.name}</b>{' '}
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {i.inv_nr}
          </span>
          <div className="meta">
            📍 {locationName(i.location_id)}
            {i.total_qty > 1 && ` · Gesamtbestand: ${i.total_qty} Stk`}
          </div>

          {itemBorrows.map((b) => (
            <div className="meta" key={b.id}>
              → {b.qty > 1 && `${b.qty}× `}bei {b.members ? fullName(b.members) : 'Unbekannt'} (seit{' '}
              {fdate(b.borrowed_at.slice(0, 10))})
            </div>
          ))}

          <div style={{ marginTop: 4 }}>
            {i.defect ? (
              <span className="pill red">defekt</span>
            ) : available === 0 ? (
              <span className="pill amber">alles ausgeborgt</span>
            ) : i.total_qty > 1 ? (
              <span className="pill green">
                {available} von {i.total_qty} verfügbar
              </span>
            ) : (
              <span className="pill green">verfügbar</span>
            )}
            {i.note && (
              <span className="meta" style={{ marginLeft: 8 }}>
                📝 {i.note}
              </span>
            )}
          </div>

          {res.map((r) => (
            <div className="meta" key={r.id} style={{ marginTop: 4 }}>
              {r.status === 'bestätigt' ? '🔒' : '⏳'} {fdate(r.date_from)} – {fdate(r.date_to)}:{' '}
              {r.purpose} ({r.members ? fullName(r.members) : '?'}
              {r.status === 'angefragt' && ', wartet auf Bestätigung'})
            </div>
          ))}
        </div>

        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          {available > 0 && !i.defect && (
            <button className="btn small" onClick={() => setDialog({ kind: 'borrow', item: i })}>
              Ausborgen
            </button>
          )}
          {(myBorrow || (itemBorrows.length > 0 && mayManage)) && (
            <button
              className="btn small amber"
              onClick={() => setDialog({ kind: 'return', item: i })}
            >
              Zurückbringen
            </button>
          )}
          <button
            className="btn ghost small"
            onClick={() => setDialog({ kind: 'reserve', item: i })}
          >
            {mayApprove ? 'Reservieren / Blocken' : 'Reservieren'}
          </button>
          <button className="btn ghost small" onClick={() => void label(i)}>
            🏷 Etikett
          </button>
          {!i.defect ? (
            <button
              className="btn ghost small"
              onClick={() => setDialog({ kind: 'defect', item: i })}
            >
              ⚠ Defekt melden
            </button>
          ) : (
            mayManage && (
              <button
                className="btn ghost small"
                disabled={fixM.isPending}
                onClick={() => fixM.mutate(i.id)}
              >
                ✓ Repariert
              </button>
            )
          )}
          {mayManage && itemBorrows.length === 0 && locations.length > 0 && (
            <button
              className="btn ghost small"
              onClick={() => setDialog({ kind: 'move', item: i })}
            >
              Standort ändern
            </button>
          )}
          <button
            className="btn ghost small"
            onClick={() => setOpenHistory(isOpen ? null : i.id)}
          >
            🕘 Historie
          </button>
        </div>

        {isOpen && (
          <div
            style={{
              flexBasis: '100%',
              background: '#F6F8F4',
              borderRadius: 10,
              padding: '10px 14px',
              marginTop: 8,
            }}
          >
            {historyQuery.isPending ? (
              <div className="meta">Wird geladen…</div>
            ) : (historyQuery.data ?? []).length === 0 ? (
              <div className="meta">Noch keine Einträge.</div>
            ) : (
              (historyQuery.data ?? []).map((h) => (
                <div className="meta" key={h.id} style={{ padding: '3px 0' }}>
                  <span className="mono">{fdate(h.created_at.slice(0, 10))}</span> ·{' '}
                  <b>{h.members ? fullName(h.members) : 'System'}</b> · {h.action}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------
  // Aktueller Konflikt für den Reservierungsdialog
  // ---------------------------------------------------------------
  const conflictFor = (itemId: string) => (from: string, to: string) =>
    reservations.some(
      (r) =>
        r.item_id === itemId &&
        r.status === 'bestätigt' &&
        from <= r.date_to &&
        to >= r.date_from,
    )

  /** Läuft gerade eine bestätigte Reservierung einer anderen Person? */
  const blockedBy = (item: Item): string | null => {
    const r = reservations.find(
      (x: ItemReservation) =>
        x.item_id === item.id &&
        x.status === 'bestätigt' &&
        x.date_from <= iso &&
        x.date_to >= iso &&
        x.member_id !== me?.id,
    )
    return r?.members ? fullName(r.members) : null
  }

  return (
    <>
      <h2 className="view-title">Inventar</h2>
      <p className="view-sub">
        Vereinsgegenstände ausborgen, reservieren und Vorräte im Blick behalten · jeder Artikel mit
        Inventarnummer &amp; QR-Etikett
      </p>

      <div className="card" style={{ borderColor: 'var(--pine)' }}>
        <div className="row">
          <span style={{ fontSize: 22 }}>📷</span>
          <input
            className="search"
            style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
            placeholder="QR-Code scannen oder Inventarnummer eingeben (z. B. DG-0005) …"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doScan(scanCode)
            }}
          />
          <button className="btn small" onClick={() => doScan(scanCode)}>
            Los
          </button>
        </div>
        <p className="meta" style={{ marginTop: 6 }}>
          Handscanner tippen den Code wie eine Tastatur ein – Feld anklicken, scannen, fertig.
        </p>
      </div>

      {myBorrowedItems.length > 0 && (
        <div className="notice">
          📦 Du hast aktuell ausgeborgt:{' '}
          {myBorrowedItems
            .map((i) => {
              const b = (borrowsByItem.get(i.id) ?? []).find((x) => x.member_id === me?.id)!
              return `${b.qty > 1 ? `${b.qty}× ` : ''}${i.name}`
            })
            .join(', ')}
        </div>
      )}

      {mayApprove && pending.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--amber)' }}>
          <h3>🔔 Reservierungsanfragen ({pending.length})</h3>
          {pending.map((r) => {
            const item = items.find((i) => i.id === r.item_id)
            return (
              <div className="list-item" key={r.id}>
                <div className="avatar">
                  {r.members
                    ? `${r.members.first_name[0]}${r.members.last_name[0]}`
                    : '?'}
                </div>
                <div style={{ flex: 1 }}>
                  <b>{item?.name ?? 'Unbekannter Artikel'}</b>
                  <div className="meta">
                    {r.members ? fullName(r.members) : '?'} · {fdate(r.date_from)} –{' '}
                    {fdate(r.date_to)} · {r.purpose}
                  </div>
                </div>
                <div
                  className="row"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                >
                  <button
                    className="btn small"
                    disabled={decideM.isPending}
                    onClick={() => decideM.mutate({ id: r.id, status: 'bestätigt' })}
                  >
                    Bestätigen
                  </button>
                  <button
                    className="btn small danger"
                    disabled={decideM.isPending}
                    onClick={() => decideM.mutate({ id: r.id, status: 'abgelehnt' })}
                  >
                    Ablehnen
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="row" style={{ marginBottom: 14 }}>
        <input
          className="search"
          placeholder="Suchen (Name oder Nr.)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="spacer" />
        {mayManage && (
          <>
            <button className="btn ghost small" onClick={() => setDialog({ kind: 'location' })}>
              + Standort
            </button>
            <button className="btn small" onClick={() => setDialog({ kind: 'item' })}>
              + Gegenstand anlegen
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h3>🛠 Geräte &amp; Ausstattung</h3>
        {itemsQuery.isPending ? (
          <p className="meta">Wird geladen…</p>
        ) : devices.length === 0 ? (
          <p className="meta">Keine Treffer.</p>
        ) : (
          devices.map(deviceRow)
        )}
      </div>

      <div className="card">
        <h3>🍺 Vorräte (z. B. Getränke fürs nächste Event)</h3>
        {supplies.length === 0 ? (
          <p className="meta">Keine Treffer.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Artikel</th>
                  <th>Standort</th>
                  <th style={{ textAlign: 'right' }}>Bestand</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {supplies.map((i) => (
                  <tr key={i.id}>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {i.inv_nr}
                    </td>
                    <td>
                      <b>{i.name}</b>
                    </td>
                    <td>
                      <span className="pill grey">📍 {locationName(i.location_id)}</span>
                    </td>
                    <td
                      className="amount"
                      style={{ color: i.total_qty <= 2 ? 'var(--red)' : 'var(--ink)' }}
                    >
                      {i.total_qty} {i.unit ?? 'Stk'}
                      {i.total_qty <= 2 && ' ⚠'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn ghost small"
                        disabled={stockM.isPending || i.total_qty === 0}
                        onClick={() => stockM.mutate({ itemId: i.id, delta: -1 })}
                      >
                        − Entnahme
                      </button>
                      <button
                        className="btn ghost small"
                        disabled={stockM.isPending}
                        onClick={() => stockM.mutate({ itemId: i.id, delta: 1 })}
                      >
                        + Zugang
                      </button>
                      <button className="btn ghost small" onClick={() => void label(i)}>
                        🏷
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- Dialoge ---------------- */}

      {dialog?.kind === 'item' && (
        <ItemDialog
          locations={locations}
          saving={itemM.isPending}
          onSave={(input) => itemM.mutate(input)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'location' && (
        <TextDialog
          title="📍 Standort anlegen"
          label="Name"
          hint="z. B. Vereinslager, Feuerwehrhaus, beim Obmann"
          saving={locationM.isPending}
          submitLabel="Anlegen"
          onSave={(name) => locationM.mutate(name)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'borrow' && (
        <BorrowDialog
          item={dialog.item}
          available={availableOf(dialog.item)}
          blockedBy={blockedBy(dialog.item)}
          saving={borrowM.isPending}
          onSave={(qty) => borrowM.mutate({ itemId: dialog.item.id, qty })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'return' && (
        <ReturnDialog
          item={dialog.item}
          borrows={borrowsByItem.get(dialog.item.id) ?? []}
          locations={locations}
          mayManage={mayManage}
          ownMemberId={me?.id ?? null}
          saving={returnM.isPending}
          onSave={(input) =>
            returnM.mutate({
              itemId: dialog.item.id,
              qty: input.qty,
              memberId: input.memberId,
              locationId: input.locationId,
              defectNote: input.defectNote,
            })
          }
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'reserve' && (
        <ReservationDialog
          item={dialog.item}
          mayApprove={mayApprove}
          conflict={conflictFor(dialog.item.id)}
          saving={reserveM.isPending}
          onSave={(input) => reserveM.mutate({ itemId: dialog.item.id, ...input })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'defect' && (
        <TextDialog
          title={`⚠ Defekt melden – ${dialog.item.name}`}
          label="Was ist defekt?"
          hint="Der Artikel wird als defekt markiert und nicht mehr zum Ausborgen angeboten."
          saving={defectM.isPending}
          submitLabel="Defekt melden"
          onSave={(note) => defectM.mutate({ itemId: dialog.item.id, note })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'move' && (
        <MoveDialog
          item={dialog.item}
          locations={locations}
          saving={moveM.isPending}
          onSave={(locationId) => moveM.mutate({ itemId: dialog.item.id, locationId })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'scan' && (
        <ScanResultDialog
          item={dialog.item}
          available={availableOf(dialog.item)}
          borrowedByMe={(borrowsByItem.get(dialog.item.id) ?? []).some(
            (b) => b.member_id === me?.id,
          )}
          hasBorrows={(borrowsByItem.get(dialog.item.id) ?? []).length > 0}
          mayManage={mayManage}
          locationName={locationName(dialog.item.location_id)}
          onBorrow={() => setDialog({ kind: 'borrow', item: dialog.item })}
          onReturn={() => setDialog({ kind: 'return', item: dialog.item })}
          onNote={() => setDialog({ kind: 'note', item: dialog.item })}
          onStock={(delta) => {
            stockM.mutate({ itemId: dialog.item.id, delta })
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'note' && (
        <TextDialog
          title={`📝 Notiz – ${dialog.item.name}`}
          label="Notiz"
          hint="Leer lassen entfernt die Notiz."
          current={dialog.item.note ?? ''}
          required={false}
          saving={noteM.isPending}
          onSave={(note) => noteM.mutate({ itemId: dialog.item.id, note })}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

/** Ergebnis eines Scans: kompakte Karte mit den passenden Aktionen. */
function ScanResultDialog({
  item,
  available,
  borrowedByMe,
  hasBorrows,
  mayManage,
  locationName,
  onBorrow,
  onReturn,
  onNote,
  onStock,
  onClose,
}: {
  item: Item
  available: number
  borrowedByMe: boolean
  hasBorrows: boolean
  mayManage: boolean
  locationName: string
  onBorrow: () => void
  onReturn: () => void
  onNote: () => void
  onStock: (delta: number) => void
  onClose: () => void
}) {
  const isDevice = item.kind === 'geraet'

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="head">
          <h3>📦 {item.name}</h3>
          <p className="meta">
            <span className="mono">{item.inv_nr}</span> · 📍 {locationName}
            {isDevice && item.total_qty > 1 && ` · ${available} von ${item.total_qty} verfügbar`}
            {!isDevice && ` · Bestand: ${item.total_qty} ${item.unit ?? 'Stk'}`}
          </p>
          {item.defect && (
            <p className="meta">
              <span className="pill red">defekt</span>
            </p>
          )}
          {item.note && <p className="meta">📝 {item.note}</p>}
        </div>

        <div className="foot" style={{ marginTop: 0 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {isDevice ? (
              <>
                {available > 0 && !item.defect && (
                  <button className="btn small" onClick={onBorrow}>
                    Ausborgen
                  </button>
                )}
                {(borrowedByMe || (hasBorrows && mayManage)) && (
                  <button className="btn small amber" onClick={onReturn}>
                    Zurückbringen
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className="btn small"
                  disabled={item.total_qty === 0}
                  onClick={() => onStock(-1)}
                >
                  − Entnahme
                </button>
                <button className="btn small" onClick={() => onStock(1)}>
                  + Zugang
                </button>
              </>
            )}
            <button className="btn ghost small" onClick={onNote}>
              📝 Notiz
            </button>
            <div className="spacer" />
            <button className="btn ghost small" onClick={onClose}>
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

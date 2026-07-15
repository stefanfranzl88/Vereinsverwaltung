import { useState, type FormEvent } from 'react'
import { fullName, today } from '@/lib/format'
import type { Item, ItemBorrow, ItemKind, Location } from '@/types'

// ---------------------------------------------------------------
// Gegenstand bearbeiten (inventar.manage)
// ---------------------------------------------------------------
export function EditItemDialog({
  item,
  locations,
  borrowedQty,
  saving,
  onSave,
  onClose,
}: {
  item: Item
  locations: Location[]
  /** Aktuell ausgeborgte Menge – Stückzahl darf nicht darunter fallen. */
  borrowedQty: number
  saving: boolean
  onSave: (input: {
    name: string
    invNr: string
    totalQty: number
    unit: string
    locationId: string | null
    note: string
  }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item.name)
  const [invNr, setInvNr] = useState(item.inv_nr)
  const [qty, setQty] = useState(String(item.total_qty))
  const [unit, setUnit] = useState(item.unit ?? '')
  const [locationId, setLocationId] = useState(item.location_id ?? '')
  const [note, setNote] = useState(item.note ?? '')

  const n = Number(qty)
  const minQty = Math.max(1, borrowedQty)
  const qtyOk = Number.isInteger(n) && n >= minQty
  const valid = name.trim().length > 0 && invNr.trim().length > 0 && qtyOk

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            onSave({
              name: name.trim(),
              invNr: invNr.trim(),
              totalQty: n,
              unit: unit.trim() || 'Stk',
              locationId: locationId || null,
              note: note.trim(),
            })
          }}
        >
          <div className="head">
            <h3>✎ Gegenstand bearbeiten</h3>
          </div>

          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="ei-name">Bezeichnung</label>
                <input id="ei-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="form-grid">
                <div>
                  <label htmlFor="ei-nr">Inventarnummer</label>
                  <input
                    id="ei-nr"
                    required
                    value={invNr}
                    onChange={(e) => setInvNr(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div>
                  <label htmlFor="ei-qty">
                    {item.kind === 'geraet' ? 'Gesamtbestand' : 'Bestand'}
                  </label>
                  <input
                    id="ei-qty"
                    type="number"
                    min={minQty}
                    step={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                  />
                  {borrowedQty > 0 && (
                    <p className="hint">Mind. {borrowedQty} – so viel ist aktuell ausgeborgt.</p>
                  )}
                </div>
              </div>

              <div className="form-grid">
                <div>
                  <label htmlFor="ei-unit">Einheit</label>
                  <input id="ei-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="ei-loc">Standort</label>
                  <select
                    id="ei-loc"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="">– kein Standort –</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="ei-note">Notiz</label>
                <input id="ei-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="foot">
            <div className="row">
              <button className="btn ghost small" type="button" onClick={onClose}>
                Abbrechen
              </button>
              <div className="spacer" />
              <button className="btn" type="submit" disabled={saving || !valid}>
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

interface ShellProps {
  title: string
  saving: boolean
  disabled?: boolean
  submitLabel?: string
  onSubmit: (e: FormEvent) => void
  onClose: () => void
  children: React.ReactNode
}

function DialogShell({
  title,
  saving,
  disabled,
  submitLabel = 'Speichern',
  onSubmit,
  onClose,
  children,
}: ShellProps) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <form onSubmit={onSubmit}>
          <div className="head">
            <h3>{title}</h3>
          </div>
          <div className="body">
            <div className="stack" style={{ marginTop: 8 }}>{children}</div>
          </div>
          <div className="foot">
            <div className="row">
              <button className="btn ghost small" type="button" onClick={onClose}>
                Abbrechen
              </button>
              <div className="spacer" />
              <button className="btn" type="submit" disabled={saving || disabled}>
                {saving ? 'Speichern…' : submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Gegenstand anlegen
// ---------------------------------------------------------------
export function ItemDialog({
  locations,
  saving,
  onSave,
  onClose,
}: {
  locations: Location[]
  saving: boolean
  onSave: (input: {
    name: string
    kind: ItemKind
    qty: number
    unit: string
    location_id: string | null
  }) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ItemKind>('geraet')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState('Stk')
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')

  const n = Number(qty)
  const valid = name.trim().length > 0 && Number.isInteger(n) && n >= 1

  return (
    <DialogShell
      title="📦 Gegenstand anlegen"
      saving={saving}
      disabled={!valid}
      submitLabel="Anlegen"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave({
          name: name.trim(),
          kind,
          qty: n,
          unit: unit.trim() || 'Stk',
          location_id: locationId || null,
        })
      }}
    >
      <div>
        <label htmlFor="it-name">Bezeichnung</label>
        <input
          id="it-name"
          required
          autoFocus
          placeholder="z. B. Biertischgarnitur"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="hint">Die Inventarnummer (z. B. DG-0005) vergibt das System automatisch.</p>
      </div>

      <div>
        <label htmlFor="it-kind">Art</label>
        <select id="it-kind" value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
          <option value="geraet">🛠 Gerät – wird ausgeborgt und zurückgebracht</option>
          <option value="vorrat">🍺 Vorrat – wird verbraucht (Bestand)</option>
        </select>
      </div>

      <div className="form-grid">
        <div>
          <label htmlFor="it-qty">
            {kind === 'geraet' ? 'Gesamtbestand (Stück)' : 'Anfangsbestand'}
          </label>
          <input
            id="it-qty"
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="it-unit">Einheit</label>
          <input
            id="it-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Stk, Kisten, …"
          />
        </div>
      </div>

      <div>
        <label htmlFor="it-loc">Standort</label>
        <select
          id="it-loc"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">– kein Standort –</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Ausborgen
// ---------------------------------------------------------------
export function BorrowDialog({
  item,
  available,
  blockedBy,
  saving,
  onSave,
  onClose,
}: {
  item: Item
  available: number
  /** Bestätigte Reservierung einer anderen Person, die gerade läuft. */
  blockedBy: string | null
  saving: boolean
  onSave: (qty: number) => void
  onClose: () => void
}) {
  const [qty, setQty] = useState('1')
  const n = Number(qty)
  const valid = Number.isInteger(n) && n >= 1 && n <= available

  return (
    <DialogShell
      title={`Ausborgen – ${item.name}`}
      saving={saving}
      disabled={!valid}
      submitLabel="Ausborgen"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(n)
      }}
    >
      {blockedBy && (
        <div className="notice">
          ⚠️ Achtung: „{item.name}" ist aktuell für <b>{blockedBy}</b> reserviert. Ausborgen ist
          trotzdem möglich – bitte kurz abstimmen.
        </div>
      )}

      {item.total_qty > 1 ? (
        <div>
          <label htmlFor="bo-qty">Wie viele Stück? (verfügbar: {available})</label>
          <input
            id="bo-qty"
            type="number"
            min={1}
            max={available}
            step={1}
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
      ) : (
        <p style={{ fontSize: 14 }}>
          „{item.name}" jetzt ausborgen? Der Artikel wird dir zugeordnet, bis du ihn
          zurückbringst.
        </p>
      )}
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Zurückbringen
// ---------------------------------------------------------------
export function ReturnDialog({
  item,
  borrows,
  locations,
  mayManage,
  ownMemberId,
  saving,
  onSave,
  onClose,
}: {
  item: Item
  borrows: ItemBorrow[]
  locations: Location[]
  mayManage: boolean
  ownMemberId: string | null
  saving: boolean
  onSave: (input: {
    qty: number
    memberId: string | null
    locationId: string | null
    defectNote: string | null
  }) => void
  onClose: () => void
}) {
  // Ohne inventar.manage kann nur die eigene Ausleihe zurückgegeben werden.
  const selectable = mayManage ? borrows : borrows.filter((b) => b.member_id === ownMemberId)
  const [memberId, setMemberId] = useState(selectable[0]?.member_id ?? '')

  const borrow = selectable.find((b) => b.member_id === memberId)
  const maxQty = borrow?.qty ?? 1

  const [qty, setQty] = useState('1')
  const [locationId, setLocationId] = useState(item.location_id ?? '')
  const [hasDefect, setHasDefect] = useState(false)
  const [defectNote, setDefectNote] = useState('')

  const n = Number(qty || maxQty)
  const valid =
    Boolean(borrow) &&
    Number.isInteger(n) &&
    n >= 1 &&
    n <= maxQty &&
    (!hasDefect || defectNote.trim().length > 0)

  return (
    <DialogShell
      title={`Zurückbringen – ${item.name}`}
      saving={saving}
      disabled={!valid}
      submitLabel="Zurückbringen"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave({
          qty: n,
          memberId: memberId || null,
          locationId: locationId || null,
          defectNote: hasDefect ? defectNote.trim() : null,
        })
      }}
    >
      {selectable.length === 0 ? (
        <p className="meta">Keine passende Ausleihe gefunden.</p>
      ) : (
        <>
          {mayManage && borrows.length > 1 && (
            <div>
              <label htmlFor="re-who">Rückgabe für</label>
              <select
                id="re-who"
                value={memberId}
                onChange={(e) => {
                  setMemberId(e.target.value)
                  setQty('1')
                }}
              >
                {selectable.map((b) => (
                  <option key={b.member_id} value={b.member_id}>
                    {b.members ? fullName(b.members) : 'Unbekannt'} ({b.qty} Stk)
                  </option>
                ))}
              </select>
            </div>
          )}

          {maxQty > 1 && (
            <div>
              <label htmlFor="re-qty">Wie viele Stück? (ausgeborgt: {maxQty})</label>
              <input
                id="re-qty"
                type="number"
                min={1}
                max={maxQty}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor="re-loc">Wohin zurückgebracht?</label>
            <select
              id="re-loc"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">– unverändert –</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="consent-check" style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={hasDefect}
                onChange={(e) => setHasDefect(e.target.checked)}
              />
              <span>Etwas ist defekt oder beschädigt</span>
            </label>
          </div>

          {hasDefect && (
            <div>
              <label htmlFor="re-defect">Was ist defekt?</label>
              <input
                id="re-defect"
                autoFocus
                required
                value={defectNote}
                onChange={(e) => setDefectNote(e.target.value)}
              />
              <p className="hint">Der Artikel wird als defekt markiert und nicht mehr verliehen.</p>
            </div>
          )}
        </>
      )}
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Reservieren / Blocken
// ---------------------------------------------------------------
export function ReservationDialog({
  item,
  mayApprove,
  conflict,
  saving,
  onSave,
  onClose,
}: {
  item: Item
  mayApprove: boolean
  /** Es gibt bereits eine bestätigte Reservierung im gewählten Zeitraum. */
  conflict: (from: string, to: string) => boolean
  saving: boolean
  onSave: (input: { from: string; to: string; purpose: string }) => void
  onClose: () => void
}) {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [purpose, setPurpose] = useState('')

  const invalidRange = to < from
  const hasConflict = !invalidRange && conflict(from, to)

  return (
    <DialogShell
      title={`${mayApprove ? 'Reservieren / Blocken' : 'Reservieren'} – ${item.name}`}
      saving={saving}
      disabled={invalidRange || purpose.trim().length === 0}
      submitLabel={mayApprove ? 'Eintragen' : 'Anfragen'}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ from, to, purpose: purpose.trim() })
      }}
    >
      {hasConflict && (
        <div className="notice">
          ⚠️ In diesem Zeitraum gibt es bereits eine <b>bestätigte Reservierung</b>. Die Anfrage
          ist trotzdem möglich.
        </div>
      )}

      <div className="form-grid">
        <div>
          <label htmlFor="rs-from">Von</label>
          <input
            id="rs-from"
            type="date"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              if (to < e.target.value) setTo(e.target.value)
            }}
          />
        </div>
        <div>
          <label htmlFor="rs-to">Bis</label>
          <input
            id="rs-to"
            type="date"
            required
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label htmlFor="rs-purpose">Zweck</label>
        <input
          id="rs-purpose"
          required
          placeholder="z. B. Privater Geburtstag, Sommerfest"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
        <p className="hint">
          {mayApprove
            ? 'Wird sofort als bestätigte Blockung eingetragen.'
            : 'Die Anfrage wird vom Vorstand bestätigt oder abgelehnt.'}
        </p>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Einzeiliger Text (Defekt melden, Notiz, Standort anlegen)
// ---------------------------------------------------------------
export function TextDialog({
  title,
  label,
  hint,
  current = '',
  required = true,
  saving,
  submitLabel,
  onSave,
  onClose,
}: {
  title: string
  label: string
  hint?: string
  current?: string
  required?: boolean
  saving: boolean
  submitLabel?: string
  onSave: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current)

  return (
    <DialogShell
      title={title}
      saving={saving}
      disabled={required && value.trim().length === 0}
      submitLabel={submitLabel}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(value.trim())
      }}
    >
      <div>
        <label htmlFor="td-value">{label}</label>
        <input
          id="td-value"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {hint && <p className="hint">{hint}</p>}
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------
// Standort ändern
// ---------------------------------------------------------------
export function MoveDialog({
  item,
  locations,
  saving,
  onSave,
  onClose,
}: {
  item: Item
  locations: Location[]
  saving: boolean
  onSave: (locationId: string) => void
  onClose: () => void
}) {
  const [locationId, setLocationId] = useState(item.location_id ?? locations[0]?.id ?? '')

  return (
    <DialogShell
      title={`Standort ändern – ${item.name}`}
      saving={saving}
      disabled={!locationId || locationId === item.location_id}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(locationId)
      }}
    >
      <div>
        <label htmlFor="mv-loc">Neuer Standort</label>
        <select id="mv-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </DialogShell>
  )
}

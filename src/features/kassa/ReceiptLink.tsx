import { useState } from 'react'
import { useToast } from '@/components/Toast'
import { receiptUrl } from './api'

/**
 * 📎 neben einer Buchung. Der receipts-Bucket ist privat – die signierte URL
 * wird erst beim Klick geholt, nicht für jede Zeile der Tabelle im Voraus.
 */
export function ReceiptLink({ path }: { path: string }) {
  const { toastError } = useToast()
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)
    try {
      const url = await receiptUrl(path)
      if (url) window.open(url, '_blank', 'noopener')
      else toastError('Beleg konnte nicht geöffnet werden')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      title="Beleg anzeigen"
      disabled={busy}
      onClick={() => void open()}
      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '0 4px' }}
    >
      📎
    </button>
  )
}

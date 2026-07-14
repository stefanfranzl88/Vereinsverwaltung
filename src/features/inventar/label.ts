import type { Item } from '@/types'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Etikett mit QR-Code, Inventarnummer und Vereinsname – öffnet den Druckdialog.
 *
 * Der QR-Code enthält die Inventarnummer (z. B. "DG-0005"), also genau das,
 * was das Scan-Feld erwartet. Die qrcode-Bibliothek wird dynamisch geladen:
 * Sie wird nur hier gebraucht und soll nicht im Haupt-Bundle liegen.
 */
export async function printLabel(item: Item, tenantName: string): Promise<void> {
  const QRCode = await import('qrcode')
  const qrDataUrl = await QRCode.toDataURL(item.inv_nr, {
    width: 184,
    margin: 1,
    errorCorrectionLevel: 'M',
  })

  const w = window.open('', '_blank', 'width=440,height=340')
  if (!w) {
    throw new Error('Popup blockiert – bitte Popups für diese Seite erlauben')
  }

  w.document.write(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Etikett ${escapeHtml(item.inv_nr)}</title>
<style>
  body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;margin:0;height:100vh}
  .label{border:2px solid #12382A;border-radius:10px;padding:12px 16px;display:flex;gap:14px;align-items:center;width:340px}
  .label img.qr{width:92px;height:92px}
  .nr{font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:1px}
  .nm{font-size:12px;margin-top:2px;max-width:150px}
  .club{font-size:9px;color:#12382A;font-weight:bold;margin-top:4px;text-transform:uppercase;letter-spacing:.05em}
  @media print{body{height:auto}}
</style></head>
<body>
  <div class="label">
    <div>
      <div class="nr">${escapeHtml(item.inv_nr)}</div>
      <div class="nm">${escapeHtml(item.name)}</div>
      <div class="club">${escapeHtml(tenantName)}</div>
    </div>
    <img class="qr" src="${qrDataUrl}" alt="">
  </div>
</body></html>`)

  w.document.close()
  // Erst drucken, wenn das QR-Bild wirklich gerendert ist.
  w.onload = () => w.print()
}

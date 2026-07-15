/**
 * Verkleinert ein Bild clientseitig vor dem Upload: längste Kante auf maxDim,
 * Ausgabe als JPEG. Handy-Fotos sind sonst schnell 3–8 MB – das kostet
 * Upload-Zeit, Speicher und später Ladezeit. Die EXIF-Orientierung wird über
 * createImageBitmap({ imageOrientation: 'from-image' }) berücksichtigt, damit
 * Hochkant-Fotos nicht gedreht landen.
 *
 * Fällt bei Nicht-Bildern (oder wenn der Browser createImageBitmap/toBlob nicht
 * liefert) auf die Originaldatei zurück – der Upload klappt dann trotzdem.
 */
export async function downscaleImage(
  file: File,
  maxDim = 1280,
  quality = 0.82,
): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  if (typeof createImageBitmap !== 'function') return file

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(
    () => null,
  )
  if (!bitmap) return file

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  return blob ?? file
}

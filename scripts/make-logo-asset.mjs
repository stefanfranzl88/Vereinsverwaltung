// Extrahiert das DG-Logo (Base64) aus dem Prototyp und erzeugt eine
// quadratische 1024er-PNG-Quelle (assets/logo.png) für @capacitor/assets.
//
// Braucht `sharp` (nicht dauerhaft installiert). Einmalig ausführen mit:
//   npm i -D sharp && node scripts/make-logo-asset.mjs && npm remove sharp
// Danach Icons/Splash generieren:
//   npx @capacitor/assets@latest generate --android \
//     --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#12382A' \
//     --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#12382A'
import fs from 'node:fs'
import sharp from 'sharp'

const html = fs.readFileSync('vereinsverwaltung-prototyp.html', 'utf8')
const m = html.match(/data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)/)
if (!m) {
  console.error('Kein eingebettetes Logo im Prototyp gefunden.')
  process.exit(1)
}
const buf = Buffer.from(m[2], 'base64')
fs.mkdirSync('assets', { recursive: true })

const meta = await sharp(buf).metadata()
console.log(`Logo gefunden: ${meta.width}x${meta.height} (${meta.format})`)

// Logo mit etwas Rand mittig auf weißes 1024er-Quadrat setzen.
const logo = await sharp(buf)
  .resize(840, 840, { fit: 'contain', background: '#ffffff' })
  .toBuffer()

await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' },
})
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile('assets/logo.png')

console.log('assets/logo.png (1024x1024) erzeugt.')

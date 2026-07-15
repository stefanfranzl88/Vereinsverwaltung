import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'at.goedersdorf.verein',
  appName: 'Vereinsverwaltung Gödersdorf',
  webDir: 'dist',

  // =====================================================================
  // TESTPHASE: Die App lädt die live gehostete Web-App (Vercel) direkt.
  // Vorteil: Tester bekommen jeden neuen Stand SOFORT, ohne dass eine neue
  // APK gebaut/verteilt werden muss – die App ist quasi ein Vollbild-Browser
  // auf die deployte Seite.
  //
  // >>> VOR DEM STORE-RELEASE ENTFERNEN <<<
  // Ohne server.url bündelt Capacitor den lokalen dist-Build (webDir) in die
  // App. Dann läuft sie eigenständig, ist unabhängig von Vercel und im Store
  // zulässig (Google verlangt eine echte App, keinen reinen Website-Wrapper).
  // Ablauf fürs Release: diesen server-Block löschen → `npm run build`
  // → `npx cap sync android` → signierten Release-Build bauen.
  // =====================================================================
  server: {
    url: 'https://vereinsverwaltung-by-scherbenviertel.vercel.app',
    cleartext: false,
  },
}

export default config

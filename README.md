# Vereinsverwaltung

React + Vite + TypeScript auf Supabase. Design und Funktionsumfang folgen
`vereinsverwaltung-prototyp_10.html`, das Datenmodell `vereinsverwaltung_schema.sql`.

Stand: alle Module aus dem Prototyp sind umgesetzt – Login mit DSGVO-Zustimmung,
Mandanten-Kontext (Tenant), Modul-Gating, Rollen-Matrix, Mitglieder, Termine,
Mitteilungen, Aufgaben, Kassa, Rechnungen, Events & Projekte, Inventar,
Protokolle, Mitarbeitspunkte, Umfragen, Schlüsselverwaltung, Dokumente und Chat.

## Einrichten

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_ANON_KEY eintragen
npm run dev
```

### Datenbank (Supabase SQL-Editor, in dieser Reihenfolge)

| Schritt | Datei | Zweck |
| --- | --- | --- |
| 1 | `vereinsverwaltung_schema.sql` | Tabellen, Hilfsfunktionen, Basis-RLS |
| 2 | Auth-Benutzer anlegen | Dashboard → Authentication → Users → *Add user* („Auto Confirm" aktivieren) |
| 3 | `supabase/setup_complete.sql` | RLS + Seed + Profil-Verknüpfung + Kontrollabfragen, in einem Durchlauf |
| 4 | `supabase/migrations/0005_events_news_tasks_rls.sql` | RLS für Termine, Mitteilungen, Aufgaben + `news`-Bucket |
| 5 | `supabase/migrations/0006_kassa_rls.sql` | RLS für Kostenstellen und Monatsabschlüsse + `receipts`/`exports`-Buckets |
| 6 | `supabase/migrations/0007_invoices.sql` | Rechnungen: Statuswechsel als Funktionen, `inv_update` entfernt |
| 7 | `supabase/migrations/0008_bigevents_rls.sql` | RLS für Events & Projekte, Abteilungen, Einteilung |
| 8 | `supabase/migrations/0009_inventar.sql` | RLS + Funktionen fürs Inventar (Ausborgen, Bestand, Historie) |
| 9 | `supabase/migrations/0010_protokolle.sql` | RLS für die Anwesenheit + atomares Speichern von Protokollen |
| 10 | `supabase/migrations/0011_mitarbeitspunkte.sql` | Punkte-Aggregat aus der Anwesenheit (member_points) |
| 11 | `supabase/migrations/0012_umfragen.sql` | RLS für Umfragen; geheime Abstimmung, Ergebnis-Aggregat |
| 12 | `supabase/migrations/0013_schluessel.sql` | RLS für Zutrittsprotokoll + Chip-/Import-Funktionen |
| 13 | `supabase/migrations/0014_dokumente.sql` | RLS für die Dokumentenablage + `documents`-Bucket |
| 14 | `supabase/migrations/0015_chat.sql` | RLS für den Chat + Realtime-Publication |
| 15 | `supabase/seed_demo_content.sql` | *optional*: Demo-Termine, -Mitteilungen und -Aufgaben |
| 16 | `supabase/seed_demo_kassa.sql` | *optional*: Anfangsbestand, Kostenstellen, Buchungen |
| 17 | `supabase/seed_demo_events.sql` | *optional*: Subtermine, Abteilungen, Helfereinteilung |
| 18 | `supabase/seed_demo_inventar.sql` | *optional*: Standorte, Artikel, Ausleihen, Reservierungen |
| 19 | `supabase/seed_demo_protokolle.sql` | *optional*: Protokolle, Anwesenheit, Aufgaben-Zuordnung |
| 20 | `supabase/seed_demo_schluessel.sql` | *optional*: Zutrittsprotokoll und Auslese-Erinnerung |
| 21 | `supabase/seed_demo_chat.sql` | *optional*: ein paar Chat-Nachrichten |

Zum Nachprüfen: `supabase/activate_realtime_and_storage.sql` stellt die Buckets
und die Realtime-Publication idempotent sicher und meldet am Ende, welche
Buckets, Storage-Policies, Realtime- und RLS-Einstellungen tatsächlich aktiv
sind. Buckets und Realtime brauchen **keinen** separaten Schalter im Dashboard –
sie entstehen per SQL (in den Migrationen bzw. diesem Skript).

### Mitglieder einladen (Edge Function)

`0016_member_invitations.sql` liefert den Account-Status je Mitglied. Die
Einladung selbst läuft über die Edge Function `invite-member` – Deployment,
Secrets (`APP_URL`) und die nötige Redirect-URL-Konfiguration im Dashboard sind
in `supabase/functions/invite-member/README.md` beschrieben. Der
`service_role`-Key wird von Supabase automatisch in die Function injiziert und
steht nie im Frontend.

`setup_complete.sql` ist das einzige Skript, das du brauchst. Es ist durchgängig
idempotent und darf beliebig oft laufen. Die E-Mail des Auth-Benutzers steht in
Abschnitt 3 und 4 – bei abweichender Adresse dort ersetzen.

Die Einzelmigrationen unter `supabase/migrations/` (`0002`, `0003`) sind der
inkrementelle Verlauf für Datenbanken, auf denen sie bereits gelaufen sind.
`setup_complete.sql` enthält beide bereits im korrigierten Endzustand.

Der Sicherheitsteil ist nicht optional: Bei einer `for all`-Policy wertet Postgres
beim `INSERT` ausschließlich `with check` aus, nicht `using`. Im Basisschema stand
die Rechteprüfung nur im `using` – jedes eingeloggte Mitglied konnte dadurch in
`role_permissions`, `member_roles`, `members` und `protocols` einfügen, sich also
selbst Rechte oder die Systemadmin-Rolle erteilen.

Alle Skripte sind idempotent und können mehrfach laufen.

`setup_stefan.sql` enthält den Seed aus `supabase/seed.sql` und hängt die
Profil-Verknüpfung an. Wer nur die Grunddaten ohne konkreten Benutzer braucht,
nimmt `seed.sql`.

Das Mitglied wird im Profil-Insert über **Vor- und Nachname** gematcht, nicht über
die E-Mail: Der Auth-Login ist eine echte Adresse, der Seed legt die Mitglieder mit
`@example.at`-Adressen an. Ein Match über E-Mail-Gleichheit fügt kommentarlos nichts
ein. Die Kontroll-Abfrage am Ende des Skripts muss genau eine Zeile liefern.

Schritt 2 ist nicht optional: Das Basisschema aktiviert RLS nur exemplarisch auf
`members`, `transactions`, `invoices` und `protocols` (Abschnitt 9 endet mit einem
TODO). `profiles`, `tenants`, `tenant_modules`, `roles` und `member_roles` wären
sonst über alle Vereine hinweg lesbar und beschreibbar.

Beim Anlegen des Auth-Benutzers „Auto Confirm User" aktivieren, sonst bleibt der
Login bis zur E-Mail-Bestätigung gesperrt.

## Architektur

```
src/
  auth/
    roles.ts          Rolle → Rechte (aus dem Prototyp) + can()-Logik
    AuthProvider.tsx  lädt profiles → tenant, member, Rollen, aktive Module
    RequireAuth.tsx   Login-, Modul- und Rechte-Gate für Routen
    ConsentGate.tsx   DSGVO-Zustimmung, persistiert in profiles
  features/members/   Mitglieder-Modul (Liste, Formular, Avatar-Upload)
  components/         AppShell (Topbar/Sidenav/Bottomnav), Avatar, Toast
  nav.ts              Navigation inkl. Modul- und Rechte-Zuordnung
  index.css           Design-System, 1:1 aus dem Prototyp
```

### Rechte: eine Quelle der Wahrheit

Rechte kommen ausschließlich aus der Datenbank. `role_permissions` entscheidet

- im **Frontend**, was `can(...)` erlaubt und was die Navigation zeigt
  (der `AuthProvider` lädt sie beim Login über `member_roles → roles → role_permissions`),
- in der **Datenbank**, was `has_perm()` in den RLS-Policies durchlässt.

Dieselben Zeilen, dieselbe Antwort – Anzeige und Durchsetzung können nicht mehr
auseinanderlaufen. `is_sysadmin = true` bedeutet auf beiden Seiten „alle Rechte".

`src/auth/roles.ts` enthält deshalb **keine Rechtelogik** mehr, nur noch den
`Permission`-Typ (damit ein Tippfehler in `can('kassa.view')` auffliegt) und
Anzeige-Labels als Fallback.

Gepflegt wird das in der App unter **/rollen** (Rollen-Matrix): Einsicht ab
`roles.view`, Umschalten per Klick ab `roles.manage`. Die Systemadmin-Spalte ist
über `roles.is_locked` gesperrt – im UI *und* per RLS.

### Geld

Beträge liegen durchgehend als **ganzzahlige Cent** vor (`transactions.amount_cents`).
Der Prototyp rechnete mit Fließkomma-Euro – das ist bei Geld falsch, weil
`0.1 + 0.2 !== 0.3`. Umgerechnet wird ausschließlich an der Oberfläche über `eur()`.
Eingaben wie „12,50" wandelt `euroToCents()` in `1250`.

`amount_cents` ist per Schema immer **positiv** (`check > 0`); die Richtung steckt
in `direction` (`in`/`out`). Der Anfangsbestand liegt pro Verein in
`tenants.settings.opening_balance_cents`.

Buchungen sind **nicht änderbar**: Das Basisschema erlaubt auf `transactions` nur
`INSERT`, kein `UPDATE`/`DELETE`. Das ist Absicht und bleibt so – eine falsche
Buchung wird durch eine Gegenbuchung storniert, nicht überschrieben.

### Modul-Gating

`tenant_modules` bestimmt, welche Module ein Verein gebucht hat. Ein Nav-Eintrag
erscheint nur, wenn das Modul aktiv **und** das nötige Recht vorhanden ist
(`visibleNav` in `nav.ts`). Direktaufrufe per URL fängt `RequireAccess` ab –
ohne das wäre `/kassa` trotz ausgeblendeter Navigation erreichbar. `core` ist
laut Schema immer aktiv.

## Skripte

```bash
npm run dev        # Dev-Server (Port 5173)
npm run build      # Typecheck + Produktionsbuild
npm run typecheck  # nur Typen prüfen
```

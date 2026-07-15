# CLAUDE.md – Arbeitsregeln für dieses Projekt

## Datenbank-Änderungen (VERBINDLICH)

**Jede Änderung, die die Datenbank betrifft** – Tabellen, Spalten, RLS-Policies,
Funktionen/RPCs, Trigger, Storage-Buckets und -Policies, Realtime-Publication,
Grants, schemabezogene Seeds – **kommt als neue, fortlaufend nummerierte,
idempotente Migrationsdatei nach `supabase/migrations/`.**

- Namensschema: `NNNN_kurzbeschreibung.sql`, fortlaufend (aktuell bis `0017`).
- **Idempotent**: mehrfaches Ausführen darf nie scheitern – also
  `drop policy if exists` + `create policy`, `create or replace function`,
  `insert ... on conflict do nothing`, Guards bei `alter publication`/`create
  bucket` usw.
- Bereits eingespielte Migrationen werden **nicht** nachträglich inhaltlich
  geändert. Korrekturen kommen als NEUE, höher nummerierte Migration.
- Nichts Datenbankwirksames außerhalb von `supabase/migrations/` ablegen.
  Einzige Ausnahme: reine Test-/Diagnose-Skripte (z. B. `test_news_insert.sql`),
  die klar als solche gekennzeichnet sind und nichts persistent verändern.

## Migrations-Checkliste

`supabase/MIGRATIONS_STATUS.md` führt Buch über alle Migrationen und ihren
Einspiel-Status:
- Neue Migration → ich trage sie dort mit Status „offen" (`[ ]`) ein.
- Du spielst eine im SQL-Editor ein und sagst es mir → ich hake sie ab (`[x]`).

## Ende jeder Arbeitssitzung

Ich sage dir **explizit** einen der beiden Sätze:

- „**Folgende Migrationen musst du noch im SQL-Editor einspielen:** …" (mit Liste), **oder**
- „**Keine DB-Änderungen – nur pushen.**"

## Weitere feste Konventionen (bereits etabliert)

- **Vor jedem Commit**: `npm run typecheck` UND `npm run build` – erst bei grün
  committen.
- **Secrets** (service_role-Key, Passwörter) nie ins Frontend oder Repo. Der
  service_role-Key wird von Supabase in Edge Functions automatisch injiziert.
- **Commit-Messages** über Datei einreichen (`git commit -F <datei>`) – die
  PowerShell zerlegt Here-Strings mit Anführungszeichen.
- **Ehrlichkeit vor Optimismus**: „gebaut" (tsc/Build grün) ist NICHT „getestet"
  (end-to-end gegen die echte DB durchgespielt). Status ehrlich benennen; siehe
  `STATUS.md`.

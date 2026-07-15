# Migrations-Status

Checkliste aller datenbankwirksamen Skripte und ob sie in der Live-DB
(`latfjryxezqemhrynokx`) eingespielt sind.

**Ablauf:** Wenn du eine Migration im SQL-Editor eingespielt hast, sag es mir –
dann hake ich sie hier ab (`[x]`). Neue Migrationen trage ich mit `[ ]` ein.

**Status:** `[x]` bestätigt eingespielt · `[~]` wahrscheinlich (indirekte
Evidenz, nicht einzeln bestätigt) · `[ ]` offen / unbestätigt

---

## Bootstrap (einmalig)

- [x] **`vereinsverwaltung_schema.sql`** (Projektwurzel) – Basisschema, Tabellen,
  Hilfsfunktionen, Basis-RLS. _Bestätigt: die App läuft, Tabellen existieren._
- [x] **`supabase/setup_complete.sql`** – konsolidiert `0002`+`0003` (RLS für
  profiles/tenants/roles/…), Seed (Verein, Rollen, Rechte, Mitglieder) und die
  Profil-Verknüpfung. _Bestätigt: Login mit Profil funktioniert._
  → deckt inhaltlich **`0002`** und **`0003`** ab.
- [x] **`supabase/activate_realtime_and_storage.sql`** – Buckets + Realtime-
  Publication + Statusreport. _Bestätigt: „Status überall an"._

## Nummerierte Migrationen (`supabase/migrations/`)

| # | Datei | Zweck | Status |
| --- | --- | --- | --- |
| 0002 | `0002_rls_app_tables.sql` | RLS profiles/tenants/roles/… + avatars-Bucket | [x] via setup_complete |
| 0003 | `0003_fix_write_policies.sql` | with-check-Fix Basisschema-Policies | [x] via setup_complete |
| 0004 | `0004_key_chips_rls.sql` | RLS key_chips | [~] |
| 0005 | `0005_events_news_tasks_rls.sql` | RLS Termine/Mitteilungen/Aufgaben + news-Bucket | [~] ⚠ news-Policies durch **0017** korrigiert |
| 0006 | `0006_kassa_rls.sql` | RLS Kassa + receipts/exports-Buckets | [~] |
| 0007 | `0007_invoices.sql` | Rechnungen: Statusfunktionen, inv_update entfernt | [~] |
| 0008 | `0008_bigevents_rls.sql` | RLS Events & Projekte | [~] |
| 0009 | `0009_inventar.sql` | RLS + Funktionen Inventar | [~] |
| 0010 | `0010_protokolle.sql` | RLS Anwesenheit + create_protocol | [~] |
| 0011 | `0011_mitarbeitspunkte.sql` | member_points() | [~] |
| 0012 | `0012_umfragen.sql` | RLS Umfragen, geheime Abstimmung | [~] |
| 0013 | `0013_schluessel.sql` | RLS Zutrittsprotokoll + Chip-/Import-Funktionen | [~] |
| 0014 | `0014_dokumente.sql` | RLS Dokumente + documents-Bucket | [~] |
| 0015 | `0015_chat.sql` | RLS Chat + Realtime-Publication | [~] |
| 0016 | `0016_member_invitations.sql` | member_account_states() für Einladungen | [ ] |
| 0017 | `0017_fix_news_write_policies.sql` | **news-Schreib-Policies fixen** + Audit aller Schreib-Policies | [ ] |

`[~]` beruht auf deinem activate-Report („RLS überall an") – das belegt, dass die
RLS-aktivierenden Migrationen liefen, aber nicht jede einzeln. Sag Bescheid,
welche du sicher eingespielt hast, dann setze ich sie auf `[x]`.

## Offen – bitte einspielen

- [ ] **`0016_member_invitations.sql`** – nötig, damit die Account-Status-Anzeige
  (aktiv/eingeladen) in der Mitgliederliste funktioniert.
- [ ] **`0017_fix_news_write_policies.sql`** – behebt den RLS-Fehler beim
  Veröffentlichen von Mitteilungen. Danach optional **`test_news_insert.sql`**
  zum Verifizieren.

## Optionale Demo-Seeds (nur Beispieldaten, keine Pflicht)

Status jeweils unbestätigt – nur nötig, wenn du die Ansichten mit Beispieldaten
füllen willst:

- [ ] `seed_demo_content.sql` (Termine, Mitteilungen, Aufgaben)
- [ ] `seed_demo_kassa.sql` (Anfangsbestand, Kostenstellen, Buchungen)
- [ ] `seed_demo_events.sql` (Subtermine, Abteilungen, Einteilung)
- [ ] `seed_demo_inventar.sql` (Standorte, Artikel, Ausleihen)
- [ ] `seed_demo_protokolle.sql` (Protokolle, Anwesenheit)
- [ ] `seed_demo_schluessel.sql` (Zutrittsprotokoll)
- [ ] `seed_demo_chat.sql` (Chat-Nachrichten)

## Kein Migrations-Status (reine Hilfsskripte)

- `supabase/test_news_insert.sql` – **Test**, kein persistenter Eingriff
  (Insert mit Rollback). Nach `0017` ausführbar.
- `supabase/seed.sql` – frühe Seed-Variante, durch `setup_complete.sql` ersetzt.

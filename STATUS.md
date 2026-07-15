# Status – Prototyp vs. Implementierung

Ehrliche Bestandsaufnahme, Stand 2026-07-15. Verglichen wird der Funktionsumfang
von `vereinsverwaltung-prototyp.html` mit dem tatsächlich gebauten und gepushten
Code.

## Was „getestet" hier bedeutet

Ich (der Assistent) kann die App **nicht selbst gegen die echte DB bedienen** –
mir fehlen Session/Passwort und der service_role-Key. „Getestet" heißt deshalb
eines von zweien:

- **Nutzung belegt:** Du hast es im echten Betrieb ausgeführt (z. B. Login,
  Navigation – belegt durch deine Fehlermeldungen aus der laufenden App).
- **Query-Struktur gegen die echte DB geprüft:** per REST-Probe verifiziert,
  dass die Abfrage strukturell durchläuft (HTTP 200, kein Relationship-Fehler).
  Das ist **nicht gleichbedeutend** mit „Feature end-to-end funktioniert" – Anlegen,
  Uploads, Exporte, Mutationen sind damit **nicht** bestätigt.

Alles andere ist **gebaut, aber ungetestet**: Code existiert, `tsc` und Build
sind grün, aber der Ablauf wurde nie durchgespielt.

Legende: ✅ fertig & getestet · 🔨 gebaut, ungetestet · ⬜ nicht gebaut ·
🐛→🔨 war fehlerhaft, Fix in diesem Commit, noch nicht verifiziert

---

## Befunde zu deinen zwei konkreten Fragen

**(1) Warum lädt die Protokolle-Seite nicht?**
Kein Routing- und kein RLS-Problem, sondern ein **Query-Fehler**. Die Route
existiert (`/protokolle` → `ProtokollePage`), die RLS-Select-Policies auf
`protocols`/`protocol_attendance` sind vorhanden. Die Abfrage `fetchProtocols`
bettet aber `members(...)` ein, und PostgREST findet **zwei** Beziehungen
zwischen `protocols` und `members`: den `author_id`-Fremdschlüssel **und** die
Verknüpfungstabelle `protocol_attendance`. Ergebnis: `PGRST201` („more than one
relationship"), HTTP 300 – die Query wirft, die Seite zeigt den Fehler.
Per REST gegen die echte DB reproduziert und mit explizitem FK-Namen
(`members!protocols_author_id_fkey`) behoben. **Beim selben Test fiel ein
zweiter, gleichartiger Bug auf:** `item_reservations` (Inventar) hat zwei FKs zu
`members` (`member_id`, `decided_by`) → dieselbe Mehrdeutigkeit. Ebenfalls
gefixt. Beide Fixes sind hier committet, aber noch **nicht** end-to-end getestet.

**(2) Existiert die Mitglieder-Einladung im Code?**
**Ja.** `SetPasswordPage`, Edge Function `invite-member` (+ README + Migration
`0016`), die `inviteMember`-API und der `✉ Einladen`-Button in der
Mitgliederliste (Commit `69a2714`). ABER: Die Edge Function wurde **nie bestätigt
deployt**, und `APP_URL`/Redirect-URL sind noch nicht gesetzt. Damit ist die
Funktion **gebaut, aber nicht lauffähig** – der Button ruft eine (noch) nicht
erreichbare Function auf.

---

## Modul für Modul

### Login & Zugang
| Funktion | Status | Notiz |
| --- | --- | --- |
| E-Mail/Passwort-Login | ✅ | Nutzung belegt (du bist in der App) |
| DSGVO-Consent (Erstlogin) | 🔨 | beim ersten Login durchlaufen, nicht gezielt geprüft |
| Mitglieder-Einladung (Edge Function) | 🔨 | Code da, **Edge Function nicht deployt** → aktuell nicht lauffähig |
| Passwort-setzen-Seite `/set-password` | 🔨 | gebaut, ungetestet |

### Mandant & Modul-Gating
| Funktion | Status | Notiz |
| --- | --- | --- |
| Tenant-Kontext laden | ✅ | Nutzung belegt |
| Nav-Gating (Modul + Recht) | ✅ | Nutzung belegt (Navigation funktioniert) |
| Route-Gating `RequireAccess` | 🔨 | gebaut, nur teilweise durchlaufen |
| RLS / Buckets / Realtime aktiv | ✅ | von dir per `activate_realtime_and_storage.sql` bestätigt |

### Dashboard
| Funktion | Status | Notiz |
| --- | --- | --- |
| Kennzahlen, Nächste Termine, Jubilare | 🔨 | Queries strukturell ok, Anzeige nicht bestätigt |
| Meine Aufgaben / Event-Einsätze / Umfrage- & Schlüssel-Hinweis | 🔨 | gebaut, ungetestet |

### Mitglieder
| Funktion | Status | Notiz |
| --- | --- | --- |
| Liste Vorstand + A–Z, Suche | 🔨 | Query ok (200), Anzeige nicht bestätigt |
| Jubiläums-Medaille, Schlüssel-Symbol | 🔨 | gebaut, ungetestet |
| Anlegen / Bearbeiten | 🔨 | gebaut, ungetestet |
| Profilbild-Upload (`set_own_avatar`, Bucket) | 🔨 | gebaut, ungetestet |
| Funktionsperiode (Dekade) bearbeiten | 🔨 | gebaut, ungetestet |
| Account-Status aktiv/eingeladen | 🔨 | gebaut, ungetestet |
| **Einladung versenden** | 🔨 | Code da, Edge Function nicht deployt (s. o.) |

### Termine
| Funktion | Status | Notiz |
| --- | --- | --- |
| Liste / Monat / Jahr | 🔨 | Query ok, ungetestet |
| Filter alle/zugesagt/abgesagt | 🔨 | gebaut, ungetestet |
| Zu-/Absagen | 🔨 | gebaut, ungetestet |
| „Wer kommt?" (Vorstand) | 🔨 | Query ok (200), ungetestet |
| Termin anlegen | 🔨 | gebaut, ungetestet |

### Mitteilungen
| Funktion | Status | Notiz |
| --- | --- | --- |
| Anzeige (Dashboard) | 🔨 | gebaut, ungetestet |
| Veröffentlichen (Foto, Ablaufdatum) | 🐛→🔨 | RLS-Fehler von dir gemeldet; Fix in Migration `0017`, unbestätigt |

### Aufgaben
| Funktion | Status | Notiz |
| --- | --- | --- |
| Meine Aufgaben + Abhaken (`set_task_done`) | 🔨 | gebaut, ungetestet |
| Vorstandsübersicht, Filter, Tabs | 🔨 | gebaut, ungetestet |
| Erfassen mit Event-Zuordnung & Fälligkeit | 🔨 | gebaut, ungetestet |

### Kassa
| Funktion | Status | Notiz |
| --- | --- | --- |
| Übersicht, Kostenstellen, Buchungen | 🔨 | gebaut, ungetestet |
| Neue Buchung + Beleg-Upload | 🔨 | gebaut, ungetestet |
| Nachkalkulation je Kostenstelle | 🔨 | gebaut, ungetestet |
| Monatsabschluss (XLSX + Belege als ZIP) | 🔨 | gebaut, ungetestet |
| Jahresabschluss (CSV) | 🔨 | gebaut, ungetestet |
| Jahresvergleich wiederkehrender Events | 🔨 | gebaut, ungetestet |
| Anfangsbestand setzen | 🔨 | gebaut, ungetestet |
| Belegerkennung (KI/OCR) | ⬜ | im Prototyp nur Demo mit Zufallszahlen – bewusst nicht gebaut |

### Rechnungen
| Funktion | Status | Notiz |
| --- | --- | --- |
| Beleg einreichen (Upload) | 🔨 | gebaut, ungetestet |
| Freigeben / Ablehnen (`decide_invoice`) | 🔨 | gebaut, ungetestet |
| Bezahlt → Kassa-Buchung (`pay_invoice`) | 🔨 | gebaut, ungetestet |
| Badge offene Belege | 🔨 | gebaut, ungetestet |

### Events & Projekte
| Funktion | Status | Notiz |
| --- | --- | --- |
| Übersicht Aktiv/Archiv | 🔨 | gebaut, ungetestet |
| Detail: Info, Subtermine | 🔨 | gebaut, ungetestet |
| Abteilungen & Einteilung (Mitglieder + Externe) | 🔨 | Query ok (200), ungetestet |
| Aufgaben zum Event | 🔨 | gebaut, ungetestet |
| Abschließen/Nachbericht, Wieder-aktivieren | 🔨 | gebaut, ungetestet |

### Inventar
| Funktion | Status | Notiz |
| --- | --- | --- |
| Geräte-/Vorräte-Liste, Suche | 🔨 | gebaut, ungetestet |
| Scan-Feld (Inventarnummer) | 🔨 | gebaut, ungetestet |
| Ausborgen/Zurückbringen (Teilmengen, Defekt) | 🔨 | gebaut, ungetestet |
| Vorratsbestand +/- (`change_stock`) | 🔨 | gebaut, ungetestet |
| **Reservierungen** | 🐛→🔨 | Query-Fehler (PGRST201) gefunden & gefixt, unbestätigt |
| Reservierungsanfragen bestätigen/ablehnen | 🐛→🔨 | hing an derselben Query, mitgefixt |
| Defekt/Repariert, Standort, Notiz | 🔨 | gebaut, ungetestet |
| Historie je Artikel | 🔨 | Query ok (200), ungetestet |
| QR-Etikett drucken | 🔨 | gebaut, ungetestet |

### Protokolle
| Funktion | Status | Notiz |
| --- | --- | --- |
| **Liste Aktuell/Archiv** | 🐛→🔨 | **Ursache fürs Nicht-Laden** (PGRST201) gefunden & gefixt |
| Detail: Anwesenheit + Aufgabenverteilung | 🐛→🔨 | hing an derselben Query, mitgefixt; ungetestet |
| Editor (Anwesenheit, Aufgaben, `create_protocol`) | 🔨 | gebaut, ungetestet |
| TXT-Export | 🔨 | gebaut, ungetestet |

### Mitarbeitspunkte
| Funktion | Status | Notiz |
| --- | --- | --- |
| Rangliste, Punkte (`member_points`), Schwellen, Jahr | 🔨 | gebaut, ungetestet |

### Umfragen
| Funktion | Status | Notiz |
| --- | --- | --- |
| Erstellen | 🔨 | gebaut, ungetestet |
| Abstimmen (geheim, `vote_survey`) | 🔨 | gebaut, ungetestet |
| Ergebnisse (Aggregat), Beenden/Öffnen | 🔨 | gebaut, ungetestet |

### Schlüsselverwaltung
| Funktion | Status | Notiz |
| --- | --- | --- |
| Chips zuweisen/entziehen | 🔨 | gebaut, ungetestet |
| Zutrittsprotokoll anzeigen | 🔨 | gebaut, ungetestet |
| EVVA-Export hochladen (Parse + `import_key_log`) | 🔨 | gebaut, ungetestet |
| Erinnerungsintervall | 🔨 | gebaut, ungetestet |

### Dokumente
| Funktion | Status | Notiz |
| --- | --- | --- |
| Ablegen (Upload), Kategorie-Filter | 🔨 | gebaut, ungetestet |
| Öffnen (signierte URL), Löschen | 🔨 | gebaut, ungetestet |

### Chat
| Funktion | Status | Notiz |
| --- | --- | --- |
| Nachrichten + Realtime | 🔨 | gebaut, ungetestet |
| Senden, eigene löschen | 🔨 | gebaut, ungetestet |

### Rollen & Rechte
| Funktion | Status | Notiz |
| --- | --- | --- |
| Rollen-Matrix anzeigen (`roles.view`) | 🔨 | gebaut, ungetestet |
| Rechte per Klick umschalten (`roles.manage`) | 🔨 | gebaut, ungetestet |
| Rollen anlegen/umbenennen | ⬜ | Matrix schaltet nur Rechte – kein UI zum Anlegen von Rollen |
| Rollen zu Mitgliedern zuweisen | ⬜ | nur per SQL-Seed (`member_roles`), kein UI |

### Übergreifend nicht gebaut
| Funktion | Status | Notiz |
| --- | --- | --- |
| Push-Benachrichtigungen | ⬜ | `push_subscriptions` im Schema, im Prototyp nur angekündigt |
| Belegerkennung Kassa (OCR/KI) | ⬜ | im Prototyp Demo, nicht implementiert |

---

## Zusammenfassung

- **✅ getestet:** Login, Tenant-Kontext, Nav-/Modul-Gating, RLS/Buckets/Realtime
  (Konfiguration von dir bestätigt). Das ist die tatsächlich belegte Basis.
- **🔨 gebaut, ungetestet:** praktisch alle Modul-Features. Code steht, baut
  sauber, Query-Struktur größtenteils gegen die echte DB als „durchläuft"
  bestätigt – aber kein einziger Schreib-/Upload-/Export-Ablauf wurde
  durchgespielt.
- **🐛→🔨 war fehlerhaft, jetzt gefixt (unbestätigt):** Protokolle-Liste/Detail,
  Inventar-Reservierungen (beide PGRST201), News-Veröffentlichen (RLS – Fix als
  SQL bereitgestellt).
- **⬜ nicht gebaut:** Belegerkennung, Push, Rollen anlegen/zuweisen-UI.

**Ehrliches Fazit:** Der Funktionsumfang des Prototyps ist als Code weitgehend
nachgebaut, aber die App ist **nicht verifiziert**. Zwei Seiten waren sogar
schlicht defekt (Protokolle, Inventar-Reservierungen), was zeigt: ohne echten
End-to-End-Durchlauf pro Modul ist „gebaut" nicht „funktioniert". Nächster
sinnvoller Schritt ist ein systematischer Klick-Test Modul für Modul gegen die
echte DB – idealerweise beginnend mit den drei 🐛→🔨-Punkten.

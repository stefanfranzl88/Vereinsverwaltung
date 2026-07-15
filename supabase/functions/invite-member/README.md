# Edge Function: `invite-member`

Lädt ein bestehendes Mitglied (mit E-Mail, ohne Zugang) per Supabase-Auth ein
und legt die `profiles`-Verknüpfung an. Das Frontend ruft nur diese Function
auf – der `service_role`-Key bleibt im Backend.

## Ablauf

1. Verwalter (`members.edit`) klickt in der Mitgliederliste **✉ Einladen**.
2. Frontend ruft `invite-member` mit dem eigenen JWT auf (`member_id` im Body).
3. Die Function prüft **serverseitig** das Recht, validiert das Mitglied
   (eigener Verein, E-Mail vorhanden, noch kein Zugang), verschickt die
   Einladung und legt `profiles(id, tenant_id, member_id, is_sysadmin=false)`
   an. Status → **eingeladen**.
4. Die Person klickt den Link in der E-Mail → landet auf `/set-password`,
   setzt ihr Passwort, ist angemeldet. Status → **aktiv**.

Die Tenant-/Member-Verknüpfung wird **serverseitig** gesetzt, nicht aus
Client-Metadaten – sonst könnte sich jemand per Self-Signup einem fremden
Verein zuordnen.

## Deployment (Supabase CLI)

```bash
# einmalig
npm i -g supabase
supabase login
supabase link --project-ref latfjryxezqemhrynokx

# Function deployen
supabase functions deploy invite-member
```

## Secrets

Diese drei injiziert Supabase **automatisch** – nicht selbst setzen:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Nur **eines** musst du setzen – die Basis-URL der App für den E-Mail-Link:

```bash
# Produktion
supabase secrets set APP_URL=https://deine-app.example

# oder zum lokalen Testen (Vite-Dev-Server)
supabase secrets set APP_URL=http://localhost:5173
```

## Dashboard-Konfiguration

**Authentication → URL Configuration → Redirect URLs** – die Ziel-URL des
Einladungslinks muss auf der Allowlist stehen, sonst lehnt Supabase den
Redirect ab:

```
https://deine-app.example/set-password
http://localhost:5173/set-password        (fürs lokale Testen)
```

Dort auch die **Site URL** auf die App-Basis-URL setzen.

**Authentication → Providers → Email** muss aktiv sein. Empfehlung:
**„Enable email signups" deaktivieren** – der Zugang läuft ausschließlich über
Einladungen, niemand soll sich selbst registrieren. Der Admin-Invite
funktioniert unabhängig davon.

**E-Mail-Versand:** Der eingebaute Supabase-Mailer ist stark ratenbegrenzt und
nur für Tests gedacht. Für den echten Betrieb unter **Authentication → SMTP
Settings** einen eigenen SMTP-Anbieter hinterlegen. Optional das Template unter
**Authentication → Email Templates → Invite user** anpassen.

## Testen

1. In der App als Systemadmin einloggen, Mitglieder öffnen.
2. Bei einem Mitglied **mit** E-Mail, aber **ohne** Zugang erscheint **✉ Einladen**.
3. Klicken → Toast „Einladung an … gesendet", Status wechselt auf **eingeladen**.
4. E-Mail öffnen, Link klicken → `/set-password`, Passwort setzen → Dashboard.
5. In der Mitgliederliste steht die Person jetzt auf **✓ Zugang**.

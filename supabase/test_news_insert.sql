-- =====================================================================
-- LIVE-TEST: darf der eingeloggte Benutzer eine Mitteilung anlegen?
--
-- ERST fix_write_policies.sql ausführen, DANN diese Datei.
--
-- Der Test simuliert die Session des Benutzers (setzt auth.uid() über das
-- JWT-Claim) und wechselt auf die Rolle 'authenticated' – nur so greift die
-- RLS-Policy wirklich. Als 'postgres' (Standard im SQL-Editor) würde RLS
-- umgangen und der Test wäre wertlos.
--
-- Der Insert wird am Ende IMMER zurückgerollt – es bleibt keine Testzeile.
--
-- >>> E-Mail unten ggf. auf deinen Auth-Benutzer anpassen. <<<
--
-- Ergebnis:
--   * Block läuft ohne Fehler → die INSERT-Policy erlaubt das Posten. Fix ok.
--   * "violates row-level security policy" → der Benutzer hat news.post NICHT
--     (dann E1 in fix_write_policies.sql ansehen: Rolle/Recht fehlt) ODER die
--     E-Mail gehört zu keinem Mitglied dieses Vereins.
--   * "null value ... author_id" o.ä. → der Benutzer hat kein verknüpftes
--     Mitglied (profiles.member_id ist null).
-- =====================================================================
begin;

  -- Session des Benutzers simulieren
  select set_config(
    'request.jwt.claim.sub',
    (select id::text from auth.users where email = 'stefanfranzl88@gmail.com'),
    true
  ) as simulierte_user_id;

  set local role authenticated;

  -- Kontext, wie ihn die Policy sieht (zur Sicht­kontrolle):
  select auth_tenant_id() as tenant, auth_member_id() as member, has_perm('news.post') as darf_posten;

  -- Der eigentliche Test – wird von der RLS-Policy geprüft:
  insert into news (tenant_id, author_id, title, body)
  values (auth_tenant_id(), auth_member_id(),
          'RLS-Test – wird zurückgerollt', 'Testinhalt');

  select 'TEST-INSERT ERFOLGREICH – Policy erlaubt das Posten' as ergebnis;

rollback;  -- verwirft die Testzeile und den Rollenwechsel

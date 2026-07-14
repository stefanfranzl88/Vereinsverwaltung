-- =====================================================================
-- DEMO-INHALTE KASSA: Anfangsbestand, Kostenstellen, Buchungen
--
-- Optional. Ohne diese Daten ist die Kassa funktionsfähig, aber leer.
-- Voraussetzung: setup_complete.sql und 0006_kassa_rls.sql sind gelaufen.
-- Idempotent: Existenz-Checks; mehrfach ausführbar.
--
-- ACHTUNG BETRÄGE: amount_cents ist eine GANZZAHL in CENT.
-- 284,60 € → 28460. Der Prototyp rechnete mit Fließkomma – bei Geld falsch.
-- =====================================================================


-- ---------------------------------------------------------------
-- 1) Anfangsbestand (im Prototyp die Konstante start = 1250)
--    Liegt in tenants.settings, damit er pro Verein einstellbar ist.
-- ---------------------------------------------------------------
update tenants
   set settings = jsonb_set(
         coalesce(settings, '{}'::jsonb),
         '{opening_balance_cents}',
         to_jsonb(125000::bigint),   -- 1.250,00 €
         true
       )
 where slug = 'goedersdorf'
   and coalesce(settings, '{}'::jsonb) -> 'opening_balance_cents' is null;


-- ---------------------------------------------------------------
-- 2) Kostenstellen
--    base_name und year werden aus dem Namen abgeleitet – genau daraus
--    baut der Jahresvergleich seine Reihen ("Jahreskirchtag" 2025 vs. 2026).
-- ---------------------------------------------------------------
insert into cost_centers (tenant_id, name, cc_type, base_name, year)
select t.id, c.name, c.cc_type, c.base_name, c.year
from tenants t
cross join (values
  ('Allgemein / Vereinsbetrieb', 'laufend', null,                 null),
  ('Sommerfest 2026',           'Event',   'Sommerfest',          2026),
  ('Vereinsausflug 2026',       'Event',   'Vereinsausflug',      2026),
  ('Vereinszeitung',            'Projekt', null,                  null),
  ('Frühjahrskonzert 2026',     'Event',   'Frühjahrskonzert',    2026),
  ('Jahreskirchtag 2026',       'Event',   'Jahreskirchtag',      2026),
  ('Neubau Lagerraum',          'Projekt', null,                  null),
  ('Jahreskirchtag 2025',       'Event',   'Jahreskirchtag',      2025),
  ('Frühjahrskonzert 2025',     'Event',   'Frühjahrskonzert',    2025)
) as c(name, cc_type, base_name, year)
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from cost_centers ex
    where ex.tenant_id = t.id and ex.name = c.name
  );


-- ---------------------------------------------------------------
-- 3) Buchungen
--    receipt_path bleibt null: Der Prototyp hatte Beleg-NAMEN ohne Datei.
--    Ein Pfad ohne Objekt im Bucket würde beim ZIP-Export als "Beleg fehlt"
--    auflaufen – ehrlicher ist: kein Beleg hinterlegt.
-- ---------------------------------------------------------------
insert into transactions (tenant_id, tx_date, description, category,
                          amount_cents, direction, cost_center_id, created_by)
select
  t.id, x.tx_date::date, x.description, x.category,
  x.amount_cents::bigint, x.direction, cc.id, kassier.id
from tenants t
cross join (values
  -- laufendes Jahr
  ('2026-07-05', 'Spende Regionalbank',                   'Spenden',              15000, 'in',  'Allgemein / Vereinsbetrieb'),
  ('2026-07-02', 'Getränkeeinkauf Sommerfest',            'Veranstaltungen',      28460, 'out', 'Sommerfest 2026'),
  ('2026-06-28', 'Subvention Gemeinde',                   'Förderungen',          50000, 'in',  'Allgemein / Vereinsbetrieb'),
  ('2026-06-20', 'Erlös Kuchenbuffet Frühjahrskonzert',   'Veranstaltungen',      41250, 'in',  'Frühjahrskonzert 2026'),
  ('2026-06-14', 'Druck Vereinszeitung',                  'Öffentlichkeitsarbeit', 9600, 'out', 'Vereinszeitung'),
  ('2026-06-10', 'Baumaterial Fundament Lagerraum',       'Bau & Anschaffungen',  48000, 'out', 'Neubau Lagerraum'),
  ('2026-06-02', 'Versicherungsprämie',                   'Verwaltung',           18000, 'out', 'Allgemein / Vereinsbetrieb'),
  ('2026-05-18', 'Saalmiete Frühjahrskonzert',            'Veranstaltungen',      12000, 'out', 'Frühjahrskonzert 2026'),
  ('2026-05-16', 'Eintritte Frühjahrskonzert',            'Veranstaltungen',      36500, 'in',  'Frühjahrskonzert 2026'),
  -- Vorjahr: Basis für den Jahresvergleich
  ('2025-08-23', 'Erlös Ausschank Kirchtag',              'Veranstaltungen',     386000, 'in',  'Jahreskirchtag 2025'),
  ('2025-08-23', 'Erlös Küche Kirchtag',                  'Veranstaltungen',     154000, 'in',  'Jahreskirchtag 2025'),
  ('2025-08-21', 'Getränkeeinkauf Kirchtag',              'Veranstaltungen',     198000, 'out', 'Jahreskirchtag 2025'),
  ('2025-08-22', 'Gage Musikgruppe',                      'Veranstaltungen',      90000, 'out', 'Jahreskirchtag 2025'),
  ('2025-08-19', 'Zeltmiete & Technik',                   'Veranstaltungen',      45000, 'out', 'Jahreskirchtag 2025'),
  ('2025-05-17', 'Eintritte & Buffet Frühjahrskonzert',   'Veranstaltungen',      69000, 'in',  'Frühjahrskonzert 2025'),
  ('2025-05-17', 'Saalmiete & Druckkosten',               'Veranstaltungen',      21000, 'out', 'Frühjahrskonzert 2025')
) as x(tx_date, description, category, amount_cents, direction, cc_name)
join cost_centers cc on cc.tenant_id = t.id and cc.name = x.cc_name
join members kassier on kassier.tenant_id = t.id
                    and kassier.first_name = 'Christoph'
                    and kassier.last_name  = 'Kovac'
where t.slug = 'goedersdorf'
  and not exists (
    select 1 from transactions ex
    where ex.tenant_id = t.id
      and ex.tx_date = x.tx_date::date
      and ex.description = x.description
  );


-- ---------------------------------------------------------------
-- KONTROLLE
--
-- Erwartet: 9 Kostenstellen, 16 Buchungen, Anfangsbestand 125000 Cent.
-- saldo_2026 = 125000 + (Einnahmen 2026 − Ausgaben 2026)
--            = 125000 + (142750 − 116060) = 151690 Cent = 1.516,90 €
-- ---------------------------------------------------------------
select
  (select count(*) from cost_centers c join tenants t on t.id = c.tenant_id
    where t.slug = 'goedersdorf')                                        as kostenstellen,
  (select count(*) from transactions x join tenants t on t.id = x.tenant_id
    where t.slug = 'goedersdorf')                                        as buchungen,
  (select settings ->> 'opening_balance_cents' from tenants
    where slug = 'goedersdorf')                                          as anfangsbestand_cent,
  (select
     coalesce(sum(case when x.direction = 'in'  then x.amount_cents end), 0)
   - coalesce(sum(case when x.direction = 'out' then x.amount_cents end), 0)
     from transactions x join tenants t on t.id = x.tenant_id
    where t.slug = 'goedersdorf'
      and extract(year from x.tx_date) = 2026)                           as ergebnis_2026_cent;

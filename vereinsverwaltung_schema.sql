-- =====================================================================
-- VEREINSVERWALTUNG – Datenbankschema (PostgreSQL / Supabase)
-- Multi-Tenant · Modular (Abo pro Modul) · Rollen pro Verein konfigurierbar
-- Version 0.1 – Grundlage aus dem Prototyp Dorfgemeinschaft Gödersdorf
-- =====================================================================

-- ---------------------------------------------------------------
-- 1) MANDANTEN (Vereine) & MODULE
-- ---------------------------------------------------------------
create table tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                        -- "Dorfgemeinschaft Gödersdorf"
  slug         text unique not null,                 -- "goedersdorf" (Subdomain/URL)
  logo_url     text,
  zvr_zahl     text,                                 -- Vereinsregister
  dekade       text,                                 -- Funktionsperiode "2023 – 2028"
  settings     jsonb not null default '{}',          -- z.B. key_interval_days, last_key_log
  created_at   timestamptz not null default now()
);

create table modules (
  key          text primary key,                     -- 'core','kassa','inventar','dokumente','schluessel','events','umfragen','chat'
  label        text not null,
  description  text,
  is_core      boolean not null default false        -- core ist immer aktiv
);

create table tenant_modules (
  tenant_id    uuid references tenants(id) on delete cascade,
  module_key   text references modules(key),
  active_from  date not null default current_date,
  active_until date,                                 -- null = unbefristet (laufendes Abo)
  primary key (tenant_id, module_key)
);

-- Modul-Katalog befüllen
insert into modules (key, label, is_core) values
  ('core',      'Basis (Mitglieder, Termine, Mitteilungen, Aufgaben, Protokolle)', true),
  ('kassa',     'Kassa & Rechnungswesen', false),
  ('events',    'Events & Projekte', false),
  ('inventar',  'Inventar & QR-Etiketten', false),
  ('dokumente', 'Dokumentenablage', false),
  ('schluessel','Schlüsselverwaltung', false),
  ('umfragen',  'Umfragen', false),
  ('chat',      'Vereins-Chat', false),
  ('mitarbeit', 'Mitarbeitspunkte', false);

-- ---------------------------------------------------------------
-- 2) BENUTZER, MITGLIEDER, ROLLEN & RECHTE (pro Verein konfigurierbar)
-- ---------------------------------------------------------------
-- Verknüpfung Supabase-Auth (auth.users) <-> Verein
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  member_id    uuid,                                 -- FK auf members, wird unten gesetzt
  is_sysadmin  boolean not null default false,       -- Systemadmin des Vereins (Stefan)
  consented_at timestamptz,                          -- DSGVO/Nutzungsbedingungen
  consent_version text,
  created_at   timestamptz not null default now()
);

create table members (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  first_name   text not null,
  last_name    text not null,
  email        text,
  phone        text,
  joined_at    date,
  status       text not null default 'aktiv',        -- aktiv | ruhend | ausgetreten
  funktion     text,                                  -- 'Obmann', 'Kassier Stv.', ... (null = Mitglied)
  photo_path   text,                                  -- Supabase Storage
  created_at   timestamptz not null default now()
);
alter table profiles add constraint fk_profile_member
  foreign key (member_id) references members(id) on delete set null;

-- Rollen sind PRO VEREIN definiert (klickbare Matrix aus dem Prototyp)
create table roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  key          text not null,                        -- 'obmann','kassier_stv','ausschuss',...
  label        text not null,
  sort_order   int  not null default 0,
  is_locked    boolean not null default false,       -- Systemadmin-Rolle: nicht editierbar
  unique (tenant_id, key)
);

create table permissions (                            -- globaler Katalog
  key          text primary key,                     -- 'kassa.view','tasks.create',...
  label        text not null,
  module_key   text references modules(key)          -- Recht gehört zu Modul (Gating!)
);

create table role_permissions (
  role_id      uuid references roles(id) on delete cascade,
  permission_key text references permissions(key),
  primary key (role_id, permission_key)
);

create table member_roles (
  member_id    uuid references members(id) on delete cascade,
  role_id      uuid references roles(id) on delete cascade,
  primary key (member_id, role_id)                   -- mehrere Rollen möglich (Kassier Stv. + Admin!)
);

insert into permissions (key, label, module_key) values
  ('members.edit',   'Mitglieder anlegen & bearbeiten',              'core'),
  ('news.post',      'Mitteilungen veröffentlichen',                 'core'),
  ('event.create',   'Termine, Events & Projekte anlegen',           'core'),
  ('protokoll.edit', 'Protokolle verfassen',                         'core'),
  ('tasks.viewall',  'Aufgabenübersicht einsehen',                   'core'),
  ('tasks.create',   'Aufgaben erfassen & zuteilen',                 'core'),
  ('roles.view',     'Rollen-Matrix einsehen',                       'core'),
  ('roles.manage',   'Rollen & Einstellungen verwalten',             'core'),
  ('kassa.view',     'Kassa einsehen',                               'kassa'),
  ('kassa.edit',     'Buchungen erfassen',                           'kassa'),
  ('invoice.viewall','Alle eingereichten Belege sehen',              'kassa'),
  ('invoice.approve','Rechnungen freigeben & Auszahlung bestätigen', 'kassa'),
  ('survey.create',  'Umfragen erstellen',                           'umfragen'),
  ('inventar.manage','Inventar verwalten',                           'inventar'),
  ('reserve.approve','Leihartikel/Reservierungen freigeben',         'inventar'),
  ('docs.view',      'Dokumentenablage einsehen',                    'dokumente'),
  ('docs.manage',    'Dokumente hochladen & löschen',                'dokumente'),
  ('keys.view',      'Schlüsselverwaltung einsehen',                 'schluessel'),
  ('keys.manage',    'Schlüsselchips verwalten',                     'schluessel'),
  ('keylog.view',    'Zutrittsprotokoll einsehen',                   'schluessel'),
  ('keylog.upload',  'Zutrittsprotokoll hochladen',                  'schluessel');

-- ---------------------------------------------------------------
-- 3) KOMMUNIKATION (core): Mitteilungen, Termine, Aufgaben, Protokolle
-- ---------------------------------------------------------------
create table news (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  author_id    uuid references members(id),
  title        text not null,
  body         text,
  photo_path   text,
  expires_at   date,                                  -- null = unbegrenzt sichtbar
  created_at   timestamptz not null default now()
);

create table events (                                 -- einfache Termine
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  title        text not null,
  event_date   date not null,
  event_time   time,
  location     text,
  created_at   timestamptz not null default now()
);

create table event_rsvps (
  event_id     uuid references events(id) on delete cascade,
  member_id    uuid references members(id) on delete cascade,
  answer       text not null check (answer in ('yes','no')),
  answered_at  timestamptz not null default now(),
  primary key (event_id, member_id)
);

create table protocols (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  title        text not null,
  proto_date   date not null,
  time_from    time,
  time_to      time,
  location     text,
  proto_type   text not null default 'Sitzung',      -- Sitzung|Aufbau|Abbau|Veranstaltung|Sonstiges
  visibility   text not null default 'alle',         -- alle | vorstand
  author_id    uuid references members(id),
  body         text,
  created_at   timestamptz not null default now()
  -- "Archiv" = proto_date < now() - interval '12 months' (View, kein Feld nötig)
);

create table protocol_attendance (
  protocol_id  uuid references protocols(id) on delete cascade,
  member_id    uuid references members(id) on delete cascade,
  primary key (protocol_id, member_id)                -- Basis für Mitarbeitspunkte
);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  title        text not null,
  assignee_id  uuid references members(id),
  due_date     date,                                  -- null = ohne Fälligkeit
  done         boolean not null default false,
  done_at      date,
  source_type  text,                                  -- 'protocol' | 'big_event' | 'manual'
  source_id    uuid,                                  -- FK je nach source_type
  created_by   uuid references members(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 4) MODUL KASSA
-- ---------------------------------------------------------------
create table cost_centers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,                         -- "Jahreskirchtag 2026"
  cc_type      text not null default 'Event',         -- Event | Projekt | laufend
  base_name    text,                                  -- "Jahreskirchtag" (für Jahresvergleich)
  year         int,
  created_at   timestamptz not null default now()
);

create table transactions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  tx_date      date not null,
  description  text not null,
  category     text not null,
  amount_cents bigint not null check (amount_cents > 0),
  direction    text not null check (direction in ('in','out')),
  cost_center_id uuid references cost_centers(id),
  receipt_path text,                                  -- Beleg in Storage
  invoice_id   uuid,                                  -- Verknüpfung Rückerstattung (FK unten)
  created_by   uuid references members(id),
  created_at   timestamptz not null default now()
);

create table invoices (                               -- Rechnungseinreichung
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  submitted_by uuid not null references members(id),
  description  text not null,
  amount_cents bigint not null,
  cost_center_id uuid references cost_centers(id),
  file_path    text not null,
  status       text not null default 'offen',        -- offen|freigegeben|bezahlt|abgelehnt
  decided_by   uuid references members(id),
  paid_at      date,
  created_at   timestamptz not null default now()
);
alter table transactions add constraint fk_tx_invoice
  foreign key (invoice_id) references invoices(id);

create table month_closings (                         -- Monatsabschluss-Historie
  tenant_id    uuid references tenants(id) on delete cascade,
  month        text not null,                         -- '2026-06'
  closed_by    uuid references members(id),
  closed_at    timestamptz not null default now(),
  export_path  text,                                  -- ZIP im Storage
  primary key (tenant_id, month)
);

-- ---------------------------------------------------------------
-- 5) MODUL EVENTS & PROJEKTE
-- ---------------------------------------------------------------
create table big_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  kind         text not null default 'Event',         -- Event | Projekt
  name         text not null,
  date_from    date,
  date_to      date,
  description  text,
  cost_center_id uuid references cost_centers(id),
  status       text not null default 'aktiv',         -- aktiv | archiviert
  report       text,                                  -- Nachbericht
  closed_at    date,
  created_at   timestamptz not null default now()
);

create table big_event_subs (                         -- Subtermine
  id           uuid primary key default gen_random_uuid(),
  big_event_id uuid not null references big_events(id) on delete cascade,
  sub_date     date not null,
  sub_time     time,
  title        text not null
);

create table departments (
  id           uuid primary key default gen_random_uuid(),
  big_event_id uuid not null references big_events(id) on delete cascade,
  name         text not null                          -- "Bierbude"
);

create table dept_assignments (
  id           uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  member_id    uuid references members(id),           -- null bei Externen
  external_name text,                                 -- "Hans Wieser" (Externe Helfer)
  role         text not null default 'crew',          -- lead | crew
  note         text,
  check (member_id is not null or external_name is not null)
);

-- ---------------------------------------------------------------
-- 6) MODUL INVENTAR
-- ---------------------------------------------------------------
create table locations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null
);

create table items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  inv_nr       text not null,                         -- 'DG-0005' (QR-Inhalt)
  name         text not null,
  kind         text not null default 'geraet',        -- geraet | vorrat
  total_qty    int not null default 1,                -- Gerät: Gesamtbestand; Vorrat: aktueller Bestand
  unit         text default 'Stk',
  location_id  uuid references locations(id),
  defect       boolean not null default false,
  note         text,
  created_at   timestamptz not null default now(),
  unique (tenant_id, inv_nr)
);

create table item_borrows (                           -- aktive Ausleihen (Teilmengen!)
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id) on delete cascade,
  member_id    uuid not null references members(id),
  qty          int not null default 1,
  borrowed_at  timestamptz not null default now()
);

create table item_reservations (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id) on delete cascade,
  member_id    uuid not null references members(id),
  date_from    date not null,
  date_to      date not null,
  purpose      text,
  status       text not null default 'angefragt',     -- angefragt|bestätigt|abgelehnt
  decided_by   uuid references members(id)
);

create table item_history (                           -- vollständiges Protokoll
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id) on delete cascade,
  member_id    uuid references members(id),
  action       text not null,                         -- 'Ausgeborgt 2 Stk', 'Zurückgebracht → Vereinslager', ...
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 7) MODUL DOKUMENTE & SCHLÜSSEL
-- ---------------------------------------------------------------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  category     text not null,                         -- Verträge|Versicherungen|Schadensmeldungen|Bescheide|Sonstiges
  file_path    text not null,
  uploaded_by  uuid references members(id),
  created_at   timestamptz not null default now()
);

create table key_chips (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  member_id    uuid not null references members(id),
  chip_nr      text not null,
  issued_at    date not null default current_date,
  unique (tenant_id, chip_nr)
);

create table key_log_entries (                        -- Import aus EVVA-Export
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  entry_date   date,
  entry_time   time,
  chip_info    text,                                  -- Rohtext aus Export
  event        text,
  upload_id    uuid
);

create table key_log_uploads (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  file_name    text,
  row_count    int,
  uploaded_by  uuid references members(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 8) UMFRAGEN & CHAT
-- ---------------------------------------------------------------
create table surveys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  question     text not null,
  is_open      boolean not null default true,
  created_by   uuid references members(id),
  created_at   timestamptz not null default now()
);
create table survey_options (
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid not null references surveys(id) on delete cascade,
  label        text not null,
  sort_order   int not null default 0
);
create table survey_votes (
  survey_id    uuid references surveys(id) on delete cascade,
  member_id    uuid references members(id) on delete cascade,
  option_id    uuid not null references survey_options(id),
  primary key (survey_id, member_id)                  -- eine Stimme pro Person
);

create table chat_messages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  member_id    uuid not null references members(id),
  body         text not null,
  created_at   timestamptz not null default now()
);

-- Push-Abos (Web Push / FCM / APNs)
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  platform     text not null,                         -- webpush | fcm | apns
  token        jsonb not null,
  prefs        jsonb not null default '{"news":true,"tasks":true,"events":true,"chat":false}',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 9) ROW LEVEL SECURITY – Grundmuster
-- ---------------------------------------------------------------
-- Hilfsfunktionen: Mandant & Rechte des eingeloggten Benutzers
create or replace function auth_tenant_id() returns uuid
language sql stable security definer as $$
  select tenant_id from profiles where id = auth.uid()
$$;

create or replace function auth_member_id() returns uuid
language sql stable security definer as $$
  select member_id from profiles where id = auth.uid()
$$;

create or replace function has_perm(p text) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from profiles pr
    where pr.id = auth.uid() and pr.is_sysadmin
  ) or exists (
    select 1
    from profiles pr
    join member_roles mr on mr.member_id = pr.member_id
    join role_permissions rp on rp.role_id = mr.role_id
    where pr.id = auth.uid() and rp.permission_key = p
  )
$$;

create or replace function module_active(m text) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from tenant_modules tm
    where tm.tenant_id = auth_tenant_id()
      and tm.module_key = m
      and (tm.active_until is null or tm.active_until >= current_date)
  ) or m = 'core'
$$;

-- Beispiel-Policies (Muster für ALLE Tabellen – hier exemplarisch):
alter table members enable row level security;
create policy members_select on members for select
  using (tenant_id = auth_tenant_id());
create policy members_write on members for all
  using (tenant_id = auth_tenant_id() and has_perm('members.edit'))
  with check (tenant_id = auth_tenant_id());

alter table transactions enable row level security;
create policy tx_select on transactions for select
  using (tenant_id = auth_tenant_id() and module_active('kassa') and has_perm('kassa.view'));
create policy tx_write on transactions for insert
  with check (tenant_id = auth_tenant_id() and module_active('kassa') and has_perm('kassa.edit'));

alter table invoices enable row level security;
create policy inv_select on invoices for select
  using (tenant_id = auth_tenant_id() and module_active('kassa')
         and (submitted_by = auth_member_id() or has_perm('invoice.viewall')));
create policy inv_insert on invoices for insert
  with check (tenant_id = auth_tenant_id() and submitted_by = auth_member_id());
create policy inv_update on invoices for update
  using (tenant_id = auth_tenant_id() and has_perm('invoice.approve'));

alter table protocols enable row level security;
create policy proto_select on protocols for select
  using (tenant_id = auth_tenant_id()
         and (visibility = 'alle' or has_perm('roles.view')));  -- 'roles.view' = Vorstands-Marker
create policy proto_write on protocols for all
  using (tenant_id = auth_tenant_id() and has_perm('protokoll.edit'))
  with check (tenant_id = auth_tenant_id());

-- >>> TODO beim Aufbau: dieses Muster (select: tenant + module + view-Recht,
-- >>> write: tenant + module + edit-Recht) auf alle übrigen Tabellen anwenden.

-- ---------------------------------------------------------------
-- 10) STORAGE-BUCKETS (in Supabase anlegen)
-- ---------------------------------------------------------------
-- avatars/    – Profilbilder      (Pfad: {tenant_id}/{member_id}.jpg)
-- receipts/   – Kassabelege       (Pfad: {tenant_id}/{yyyy-mm}/{uuid}.pdf)
-- documents/  – Dokumentenablage  (Pfad: {tenant_id}/{category}/{uuid}.pdf)
-- news/       – Mitteilungsfotos
-- exports/    – Monatsabschluss-ZIPs, Jahresabschlüsse
-- Storage-Policies analog: Pfad muss mit auth_tenant_id() beginnen.

-- AsBuiltIQ / Telcovantage-Site-Map-Reader — Supabase schema
--
-- This app has no login/auth system and is used by a small trusted internal
-- team, so RLS is disabled on every table below (the anon key is used
-- directly from the browser). If this ever needs to be exposed publicly,
-- add real RLS policies before that happens.
--
-- Run this whole file once in the Supabase SQL editor for a fresh project.
-- It's idempotent (IF NOT EXISTS / OR REPLACE everywhere) so re-running is
-- safe.

create extension if not exists pgcrypto;

-- ── projects ────────────────────────────────────────────────────────────────
-- One row per distinct DXF file, identified primarily by content checksum
-- (SHA-256) so the same file re-uploaded from a different PC/path resolves
-- to the same project instead of creating a duplicate.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  dxf_file_name text not null,
  dxf_checksum text,
  dxf_file_path text,
  asbuilt_node_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_checksum on projects (dxf_checksum);
create index if not exists idx_projects_file_path on projects (dxf_file_path);

-- ── sessions ────────────────────────────────────────────────────────────────
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sessions_project on sessions (project_id);
create index if not exists idx_sessions_active on sessions (project_id, is_active);

-- ── session_config ──────────────────────────────────────────────────────────
create table if not exists session_config (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions (id) on delete cascade,
  strand_layer text,
  pole_layer text,
  equipment_layers text[],
  mask_enabled boolean not null default true,
  ocr_done boolean not null default false,
  equipment_done boolean not null default false,
  poles_done boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ── digit_results (strand OCR) ─────────────────────────────────────────────
create table if not exists digit_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  digit_id integer not null,
  value text,
  corrected_value text,
  confidence numeric,
  needs_review boolean not null default false,
  center_x numeric,
  center_y numeric,
  bbox jsonb,
  manual boolean not null default false,
  unique (session_id, digit_id)
);

-- ── poles ───────────────────────────────────────────────────────────────────
create table if not exists poles (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  pole_id integer not null,
  name text,
  corrected_name text,
  cx numeric,
  cy numeric,
  bbox jsonb,
  layer text,
  source text,
  ocr_conf numeric,
  needs_review boolean not null default false,
  unique (session_id, pole_id)
);

-- ── equipment_shapes ────────────────────────────────────────────────────────
create table if not exists equipment_shapes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  shape_id integer not null,
  kind text not null,
  layer text not null,
  cx numeric not null,
  cy numeric not null,
  bbox jsonb,
  unique (session_id, shape_id)
);

-- ── cable_spans + cable_segments ────────────────────────────────────────────
create table if not exists cable_spans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  original_span_id integer,
  span_id integer not null,
  layer text,
  cx numeric,
  cy numeric,
  bbox jsonb,
  total_length numeric,
  meter_value numeric,
  cable_runs integer not null default 1,
  from_pole text,
  to_pole text,
  is_deleted boolean not null default false,
  parent_span_id uuid references cable_spans (id) on delete set null,
  unique (session_id, span_id)
);
create index if not exists idx_cable_spans_session on cable_spans (session_id, is_deleted);

create table if not exists cable_segments (
  id bigint generated always as identity primary key,
  cable_span_id uuid not null references cable_spans (id) on delete cascade,
  segment_index integer not null,
  x1 numeric not null,
  y1 numeric not null,
  x2 numeric not null,
  y2 numeric not null,
  unique (cable_span_id, segment_index)
);

-- ── trashed_spans ───────────────────────────────────────────────────────────
create table if not exists trashed_spans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  original_span_id integer,
  span_data jsonb,
  status text,
  partial_detail jsonb,
  trashed_at timestamptz not null default now(),
  restored_at timestamptz
);

-- ── span_operations (audit trail: split/pair/merge/delete/restore/status) ──
create table if not exists span_operations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  operation_type text not null,
  span_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, span_id, operation_type)
);

-- ── boundaries ──────────────────────────────────────────────────────────────
create table if not exists boundaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions (id) on delete cascade,
  polygon jsonb,
  created_at timestamptz not null default now()
);

-- ── dxf_segments (raw geometry cache, per layer) ───────────────────────────
create table if not exists dxf_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  layer text not null,
  segments jsonb,
  unique (session_id, layer)
);

-- ── RLS: disabled everywhere (see note at top of file) ─────────────────────
alter table projects disable row level security;
alter table sessions disable row level security;
alter table session_config disable row level security;
alter table digit_results disable row level security;
alter table poles disable row level security;
alter table equipment_shapes disable row level security;
alter table cable_spans disable row level security;
alter table cable_segments disable row level security;
alter table trashed_spans disable row level security;
alter table span_operations disable row level security;
alter table boundaries disable row level security;
alter table dxf_segments disable row level security;

-- ── Storage: raw DXF file bucket ────────────────────────────────────────────
-- Public=false; the app fetches bytes server-side with the service-role key,
-- so no public bucket policy is needed. Create it once here so the app code
-- doesn't need to auto-create it on first use.
insert into storage.buckets (id, name, public)
values ('dxf-files', 'dxf-files', false)
on conflict (id) do nothing;

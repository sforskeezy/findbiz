-- ProspectIQ proposed PostgreSQL 16+ / PostGIS schema.
-- This is the production data contract; the Phase 1 prototype uses browser-local storage.

create extension if not exists postgis;
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create type search_status as enum ('queued', 'running', 'partial', 'complete', 'failed');
create type source_confidence as enum ('verified', 'estimated', 'manual', 'unavailable', 'stale');
create type operating_status as enum ('open', 'temporarily_closed', 'permanently_closed', 'unknown');
create type observation_method as enum ('api', 'import', 'manual');
create type broadband_classification as enum ('business', 'residential', 'unknown');
create type provider_run_status as enum ('queued', 'running', 'succeeded', 'partial', 'failed', 'rate_limited');

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table source_records (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_name text not null,
  external_record_id text,
  source_url text,
  terms_url text,
  dataset_date date,
  retrieved_at timestamptz not null default now(),
  freshness_expires_at timestamptz,
  retention_expires_at timestamptz,
  content_checksum text,
  confidence source_confidence not null,
  metadata jsonb not null default '{}'::jsonb
);

create table target_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  input_address text not null,
  normalized_address text not null,
  address_components jsonb not null default '{}'::jsonb,
  geom geography(point, 4326) not null,
  geocoder_name text not null,
  geocoder_external_id text,
  geocode_confidence source_confidence not null,
  source_id uuid references source_records(id),
  created_at timestamptz not null default now()
);
create index target_addresses_geom_gix on target_addresses using gist (geom);
create index target_addresses_normalized_trgm on target_addresses using gin (normalized_address gin_trgm_ops);

create table searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  target_address_id uuid not null references target_addresses(id),
  radius_meters integer not null check (radius_meters > 0 and radius_meters <= 8047),
  category_filters text[] not null default '{}',
  minimum_score smallint not null default 0 check (minimum_score between 0 and 100),
  status search_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  partial_error_summary text,
  created_at timestamptz not null default now()
);
create index searches_user_created_idx on searches (user_id, created_at desc);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null,
  primary_category text,
  category_codes text[] not null default '{}',
  website_domain citext,
  employee_estimate_min integer check (employee_estimate_min is null or employee_estimate_min >= 0),
  employee_estimate_max integer check (employee_estimate_max is null or employee_estimate_max >= 0),
  employee_estimate_basis text,
  location_count_estimate integer check (location_count_estimate is null or location_count_estimate >= 1),
  location_count_basis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_normalized_name_trgm on businesses using gin (normalized_name gin_trgm_ops);

create table business_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  address text not null,
  normalized_address text not null,
  geom geography(point, 4326) not null,
  phone text,
  website_url text,
  hours jsonb,
  operating_status operating_status not null default 'unknown',
  rating numeric(3,2) check (rating is null or rating between 0 and 5),
  review_count integer check (review_count is null or review_count >= 0),
  public_notes text,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index business_locations_geom_gix on business_locations using gist (geom);
create index business_locations_address_trgm on business_locations using gin (normalized_address gin_trgm_ops);

create table business_external_ids (
  id uuid primary key default gen_random_uuid(),
  business_location_id uuid not null references business_locations(id) on delete cascade,
  provider_name text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  unique (provider_name, external_id)
);

create table business_location_sources (
  business_location_id uuid not null references business_locations(id) on delete cascade,
  source_id uuid not null references source_records(id) on delete cascade,
  observed_fields text[] not null default '{}',
  primary key (business_location_id, source_id)
);

create table search_results (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references searches(id) on delete cascade,
  business_location_id uuid not null references business_locations(id),
  distance_meters integer not null check (distance_meters >= 0),
  included boolean not null default true,
  exclusion_reason text,
  top_opportunity text,
  created_at timestamptz not null default now(),
  unique (search_id, business_location_id)
);
create index search_results_distance_idx on search_results (search_id, distance_meters);

create table providers (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  public_identifiers jsonb not null default '{}'::jsonb,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table broadband_observations (
  id uuid primary key default gen_random_uuid(),
  target_address_id uuid references target_addresses(id),
  business_location_id uuid references business_locations(id),
  provider_id uuid not null references providers(id),
  technology text not null,
  max_download_mbps numeric(12,3) check (max_download_mbps is null or max_download_mbps >= 0),
  max_upload_mbps numeric(12,3) check (max_upload_mbps is null or max_upload_mbps >= 0),
  classification broadband_classification not null default 'unknown',
  geographic_unit text not null,
  evidence_scope text not null,
  entry_method observation_method not null,
  source_date date not null,
  retrieved_at timestamptz not null default now(),
  confidence source_confidence not null,
  confidence_score numeric(4,3) check (confidence_score is null or confidence_score between 0 and 1),
  is_estimated boolean not null,
  source_id uuid not null references source_records(id),
  notes text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(target_address_id, business_location_id) = 1)
);
create index broadband_target_idx on broadband_observations (target_address_id, source_date desc);
create index broadband_business_idx on broadband_observations (business_location_id, source_date desc);

create table prospect_scores (
  id uuid primary key default gen_random_uuid(),
  search_result_id uuid not null references search_results(id) on delete cascade,
  scoring_version text not null,
  distance_points smallint not null check (distance_points between 0 and 15),
  category_points smallint not null check (category_points between 0 and 15),
  network_use_points smallint not null check (network_use_points between 0 and 20),
  scale_points smallint not null check (scale_points between 0 and 10),
  broadband_raw_points smallint not null check (broadband_raw_points between 0 and 30),
  broadband_evidence_multiplier numeric(4,3) not null check (broadband_evidence_multiplier between 0 and 1),
  broadband_points smallint not null check (broadband_points between 0 and 30),
  evidence_readiness_points smallint not null check (evidence_readiness_points between 0 and 10),
  total_score smallint not null check (total_score between 0 and 100),
  confidence_score smallint not null check (confidence_score between 0 and 100),
  explanation text not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique (search_result_id, scoring_version, input_hash)
);
create index prospect_scores_total_idx on prospect_scores (total_score desc);

create table research_briefs (
  id uuid primary key default gen_random_uuid(),
  search_result_id uuid not null references search_results(id) on delete cascade,
  ai_provider text not null,
  ai_model text not null,
  prompt_version text not null,
  fact_pack_hash text not null,
  business_summary text not null,
  hypothesized_needs jsonb not null,
  opportunity text not null,
  discovery_questions jsonb not null,
  call_opener text not null,
  email_subject text not null,
  email_body text not null,
  generation_status text not null,
  created_at timestamptz not null default now()
);

create table research_brief_sources (
  research_brief_id uuid not null references research_briefs(id) on delete cascade,
  source_id uuid not null references source_records(id) on delete cascade,
  primary key (research_brief_id, source_id)
);

create table saved_prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  business_location_id uuid not null references business_locations(id),
  status text not null default 'saved',
  notes text,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, business_location_id)
);

create table manual_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  field_name text not null,
  old_value jsonb,
  new_value jsonb not null,
  rationale text not null,
  supporting_source_id uuid references source_records(id),
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);

create table data_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_type text not null,
  original_filename text not null,
  content_checksum text not null,
  source_date date not null,
  status text not null,
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  rejected_rows integer not null default 0,
  parse_errors jsonb not null default '[]'::jsonb,
  raw_file_retention_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table provider_runs (
  id uuid primary key default gen_random_uuid(),
  search_id uuid references searches(id) on delete cascade,
  adapter_name text not null,
  operation text not null,
  request_fingerprint text not null,
  status provider_run_status not null default 'queued',
  attempts smallint not null default 0,
  quota_units numeric(12,3) not null default 0,
  sanitized_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index provider_runs_search_idx on provider_runs (search_id, created_at);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  sanitized_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_user_created_idx on audit_events (user_id, created_at desc);

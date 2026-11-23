-- Telemetría anónima de Cartero (colector de cartero.elrincondeisma.com/api/telemetry).
-- Se aplica con: node --env-file=.env.local scripts/telemetry-migrate.mjs
-- No se guarda ninguna IP: solo el país que da Vercel (x-vercel-ip-country).

create table if not exists telemetry_instances (
  id          uuid primary key,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  version     text not null,
  mode        text not null,
  country     text,
  last_report jsonb not null
);

create table if not exists telemetry_reports (
  id          bigserial primary key,
  instance_id uuid not null references telemetry_instances(id) on delete cascade,
  received_at timestamptz not null default now(),
  country     text,
  payload     jsonb not null
);

create index if not exists telemetry_reports_received on telemetry_reports (received_at);
create index if not exists telemetry_reports_instance on telemetry_reports (instance_id, received_at desc);
create index if not exists telemetry_instances_last_seen on telemetry_instances (last_seen);

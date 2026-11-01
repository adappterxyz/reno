-- Reno v2 initial schema (Phase 0/1 vertical slice).
-- The full port of the legacy reno-be schema (attendance, consumables, PO,
-- kanban cards, meetings, ...) lands in later phases; this covers auth + projects
-- + the Gaussian-splat 3D core that replaces Matterport.

-- Users: maps an Auth0 subject to an app-local profile + roles.
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,         -- app id
  auth0_sub    TEXT UNIQUE NOT NULL,     -- Auth0 'sub' claim
  email        TEXT,
  first_name   TEXT,
  last_name    TEXT,
  role         TEXT NOT NULL DEFAULT 'Staff', -- Superadmin | Admin | Staff
  status       TEXT NOT NULL DEFAULT 'Active',
  date_added   TEXT NOT NULL
);

-- A renovation project (was projectModels).
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  location    TEXT,
  status      TEXT NOT NULL DEFAULT 'Pending',
  created_by  TEXT NOT NULL,
  date_added  TEXT NOT NULL,
  date_updated TEXT NOT NULL
);

-- A space/room within a project (was projectModelSpaces). Holds the 3D model ref.
CREATE TABLE IF NOT EXISTS project_spaces (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Pending',
  splat_model_id  TEXT,                  -- current/active splat model for the space
  date_added      TEXT NOT NULL
);

-- 3D Gaussian-splat model (replaces the Matterport SID).
CREATE TABLE IF NOT EXISTS splat_models (
  id               TEXT PRIMARY KEY,
  project_space_id TEXT NOT NULL REFERENCES project_spaces(id),
  name             TEXT NOT NULL,
  r2_key           TEXT,                 -- object key in the SPLATS bucket
  format           TEXT,                 -- ply | compressed-ply | sog
  file_size        INTEGER,
  thumbnail_key    TEXT,
  scale_factor     REAL,                 -- splat units -> metres (null = uncalibrated)
  status           TEXT NOT NULL DEFAULT 'draft',
  pose_source      TEXT,                 -- webxr | sfm | external
  created_by       TEXT NOT NULL,
  date_added       TEXT NOT NULL,
  date_updated     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_splat_models_space ON splat_models(project_space_id);

-- Tickets anchored to 3D points on the splat (was Matterport Mattertags).
-- `anchor`/`normal` stored as JSON {x,y,z}. Positions are splat-space; multiply
-- by splat_models.scale_factor for metres.
CREATE TABLE IF NOT EXISTS tickets (
  id             TEXT PRIMARY KEY,
  splat_model_id TEXT NOT NULL REFERENCES splat_models(id),
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'Pending',
  anchor         TEXT NOT NULL,          -- JSON Vec3
  normal         TEXT,                   -- JSON Vec3 | null
  date_added     TEXT NOT NULL,
  date_updated   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_model ON tickets(splat_model_id);

-- Measurements: ordered polyline of anchor points.
CREATE TABLE IF NOT EXISTS measurements (
  id             TEXT PRIMARY KEY,
  splat_model_id TEXT NOT NULL REFERENCES splat_models(id),
  label          TEXT NOT NULL DEFAULT '',
  points         TEXT NOT NULL,          -- JSON Vec3[]
  date_added     TEXT NOT NULL,
  date_updated   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_measurements_model ON measurements(splat_model_id);

-- Switch auth from Auth0 to self-hosted email-OTP.
-- The users table is recreated around email as the login handle (no auth0_sub).
-- Safe to drop: pre-launch, no production rows. Projects reference created_by =
-- the app user id (text), which is unchanged in shape.

DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id           TEXT PRIMARY KEY,          -- app user id (the JWT "sub")
  email        TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'Staff',   -- Superadmin | Admin | Staff
  status       TEXT NOT NULL DEFAULT 'Active',
  date_added   TEXT NOT NULL,
  last_login   TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

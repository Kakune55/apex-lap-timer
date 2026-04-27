CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'local',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  is_active INTEGER NOT NULL DEFAULT 1,
  dashboard_access INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  user_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  data BLOB,
  data_hash TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, track_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS track_laps (
  user_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  lap_id TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id, lap_id),
  FOREIGN KEY (user_id, track_id) REFERENCES tracks(user_id, track_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_updated_at
ON users(updated_at);

CREATE INDEX IF NOT EXISTS idx_tracks_user_updated_at
ON tracks(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_track_laps_track
ON track_laps(user_id, track_id);

CREATE INDEX IF NOT EXISTS idx_sessions_user
ON sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS calendar (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  previous TEXT,
  published_at TEXT,
  previous_published_at TEXT,
  legacy_checked_at TEXT
);

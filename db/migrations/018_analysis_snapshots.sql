CREATE TABLE analysis_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id BIGINT NOT NULL UNIQUE REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  fen TEXT NOT NULL,
  engine_id TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  depth INT NOT NULL,
  lines JSONB NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analysis_snapshots_user_fen_idx ON analysis_snapshots(user_id, fen, created_at DESC);

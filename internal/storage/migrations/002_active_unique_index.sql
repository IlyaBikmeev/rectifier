CREATE UNIQUE INDEX idx_runs_single_active
  ON runs ((1))
  WHERE stopped_at IS NULL;
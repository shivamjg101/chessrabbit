ALTER TABLE games
  ADD COLUMN variant TEXT NOT NULL DEFAULT 'standard'
    CHECK (variant IN ('standard', 'chess960')),
  ADD COLUMN start_fen TEXT;

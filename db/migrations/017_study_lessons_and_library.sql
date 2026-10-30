-- Studies grow up: lessons, tags, topics, likes and clones.
-- Applied automatically on fresh docker volumes and by the desktop app on its
-- next start (it applies any migration file it has not seen); apply manually
-- on other live databases.
--
-- Everything here is additive. A chapter is still PGN movetext, and nothing in
-- this file asks the server to understand a move; the new columns describe how
-- a chapter is *read*, not what is in it.

-- ============================================================
-- 1. How a chapter is read
-- ============================================================
-- mode:
--   normal  - an analysis board, as before
--   lesson  - an interactive lesson: the reader plays one side and has to
--             find the author's main-line moves; side lines are the wrong
--             answers, and their comments are the explanations
--   conceal - the moves are there, but each one stays hidden until the
--             reader steps onto it, so a game can be read as "guess the move"
--
-- hide_engine is the author asking that readers work it out for themselves.
-- It is a request to the reading UI, not access control: the engine is a
-- local process, and anybody can paste the position into another board.
ALTER TABLE study_chapters
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal'
    CHECK (mode IN ('normal', 'lesson', 'conceal')),
  ADD COLUMN hide_engine BOOLEAN NOT NULL DEFAULT false,
  -- PGN tag pairs (White, Black, Event, Date, Result, Annotator ...). Kept as
  -- a map rather than columns because the set is open-ended in the format, and
  -- the export writes whatever is here as tags.
  ADD COLUMN tags JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- 2. Finding studies other people wrote
-- ============================================================
ALTER TABLE studies
  ADD COLUMN topics TEXT[] NOT NULL DEFAULT '{}',
  -- Where a clone came from. SET NULL rather than CASCADE: deleting the
  -- original must never take somebody else's copy with it.
  ADD COLUMN cloned_from BIGINT REFERENCES studies(id) ON DELETE SET NULL;

-- The public listing only ever reads public studies, newest-touched first.
CREATE INDEX studies_public_idx ON studies(updated_at DESC) WHERE visibility = 'public';
CREATE INDEX studies_topics_idx ON studies USING GIN (topics);

CREATE TABLE study_likes (
  study_id   BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (study_id, user_id)
);

-- "Studies I liked" scans by user.
CREATE INDEX study_likes_user_idx ON study_likes(user_id);

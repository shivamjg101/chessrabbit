-- Puzzles extracted from a player's private games are visible only to that player.
ALTER TABLE puzzles ADD COLUMN owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX puzzles_owner_rating_idx ON puzzles(owner_id, rating);

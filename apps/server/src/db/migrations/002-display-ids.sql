-- 002-display-ids.sql
-- Human-friendly task identifiers (T-1, T-2, ...) sourced from a
-- single-row monotonic counter. Backfills existing tasks in stable
-- insertion order so the first task ever filed gets T-1, the next T-2,
-- and so on. The counter's value is also seeded from the backfill so
-- subsequent inserts pick up where the backfill left off.

CREATE TABLE IF NOT EXISTS sequences (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO sequences (name, value) VALUES ('tasks', 0);

ALTER TABLE tasks ADD COLUMN display_id INTEGER;

WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
    FROM tasks
)
UPDATE tasks
SET display_id = (SELECT rn FROM ordered WHERE ordered.id = tasks.id);

UPDATE sequences
SET value = COALESCE((SELECT MAX(display_id) FROM tasks), 0)
WHERE name = 'tasks';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_display_id ON tasks(display_id);

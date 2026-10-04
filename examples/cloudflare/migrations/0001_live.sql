-- The versions refreshOn watches: the same table every rsc-kit store reads.
CREATE TABLE IF NOT EXISTS rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL);

-- The data the /live page shows.
CREATE TABLE IF NOT EXISTS stock (id INTEGER PRIMARY KEY, left_count INTEGER NOT NULL);
INSERT OR IGNORE INTO stock (id, left_count) VALUES (1, 12);

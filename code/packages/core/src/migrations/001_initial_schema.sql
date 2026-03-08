-- ============================================================================
-- Phase 8: Initial PostgreSQL Schema
-- Run via the migration runner in packages/core/src/migrate.ts
-- ============================================================================

-- Schema migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content items (synced from DynamoDB via Streams)
CREATE TABLE IF NOT EXISTS content_items (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  source_url      TEXT,
  ingested_at     TIMESTAMPTZ,
  relevance_score INTEGER,
  is_duplicate    BOOLEAN DEFAULT FALSE,
  full_text       TEXT,
  fts_vector      tsvector
);

-- Auto-update fts_vector on insert/update
CREATE OR REPLACE FUNCTION content_items_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts_vector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.full_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_items_fts_trigger ON content_items;
CREATE TRIGGER content_items_fts_trigger
  BEFORE INSERT OR UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION content_items_fts_update();

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_content_items_fts ON content_items USING GIN (fts_vector);

-- Hot takes (synced from DynamoDB)
CREATE TABLE IF NOT EXISTS hot_takes (
  id               TEXT PRIMARY KEY,
  content_item_id  TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  text             TEXT NOT NULL,
  word_count       INTEGER,
  variation_index  INTEGER,
  created_at       TIMESTAMPTZ
);

-- Draft content (synced from DynamoDB)
CREATE TABLE IF NOT EXISTS draft_content (
  id               TEXT PRIMARY KEY,
  hot_take_id      TEXT REFERENCES hot_takes(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  status           TEXT NOT NULL,
  created_at       TIMESTAMPTZ
);

-- Published posts (written by the Publisher Lambda)
CREATE TABLE IF NOT EXISTS published_posts (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  draft_content_id  TEXT REFERENCES draft_content(id) ON DELETE SET NULL,
  platform          TEXT NOT NULL,
  platform_url      TEXT,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_item_id   TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  content_snippet   TEXT
);

CREATE INDEX IF NOT EXISTS idx_published_posts_platform ON published_posts (platform);
CREATE INDEX IF NOT EXISTS idx_published_posts_published_at ON published_posts (published_at);

-- Embeddings for semantic duplicate detection
CREATE TABLE IF NOT EXISTS embeddings (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  content_item_id  TEXT UNIQUE REFERENCES content_items(id) ON DELETE CASCADE,
  vector           FLOAT8[] NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_created_at ON embeddings (created_at DESC);

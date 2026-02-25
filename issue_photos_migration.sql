-- ============================================
-- Migration: Multi-photo support for issues
-- Creates issue_photos table and migrates
-- existing photos from issue_updates
-- ============================================

-- 1. Create issue_photos table
CREATE TABLE IF NOT EXISTS issue_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_update_id UUID NOT NULL REFERENCES issue_updates(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  photo_thumb_url TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_issue_photos_update_id ON issue_photos(issue_update_id);

-- 3. Migrate existing photos from issue_updates to issue_photos
INSERT INTO issue_photos (issue_update_id, photo_url, photo_thumb_url, sort_order, created_at)
SELECT id, photo_url, photo_thumb_url, 0, COALESCE(created_at, now())
FROM issue_updates
WHERE photo_url IS NOT NULL;

-- 4. Enable RLS
ALTER TABLE issue_photos ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies (match issue_updates patterns)
CREATE POLICY "issue_photos_select" ON issue_photos FOR SELECT USING (true);
CREATE POLICY "issue_photos_insert" ON issue_photos FOR INSERT WITH CHECK (true);
CREATE POLICY "issue_photos_update" ON issue_photos FOR UPDATE USING (true);
CREATE POLICY "issue_photos_delete" ON issue_photos FOR DELETE USING (true);

-- NOTE: After verifying migration, you can optionally clear old columns:
-- ALTER TABLE issue_updates DROP COLUMN photo_url;
-- ALTER TABLE issue_updates DROP COLUMN photo_thumb_url;
-- (Keep them for now as fallback)

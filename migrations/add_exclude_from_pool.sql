-- Add exclude_from_pool to meters table
ALTER TABLE meters ADD COLUMN IF NOT EXISTS exclude_from_pool boolean DEFAULT false;

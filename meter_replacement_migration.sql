-- Meter Replacement Support
-- Adds columns to track meter replacements in readings

-- Add replacement columns to meter_readings
ALTER TABLE meter_readings ADD COLUMN IF NOT EXISTS is_replacement boolean DEFAULT false;
ALTER TABLE meter_readings ADD COLUMN IF NOT EXISTS replacement_type text; -- 'final' or 'initial'

-- Add previous_meter_number to meters to keep history
ALTER TABLE meters ADD COLUMN IF NOT EXISTS previous_meter_number text;
ALTER TABLE meters ADD COLUMN IF NOT EXISTS replacement_date date;

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_meter_readings_replacement ON meter_readings (meter_id, is_replacement) WHERE is_replacement = true;

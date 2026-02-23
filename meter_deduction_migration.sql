-- Meter: enable deduction field on readings
ALTER TABLE meters ADD COLUMN IF NOT EXISTS has_deduction boolean DEFAULT false;
ALTER TABLE meters ADD COLUMN IF NOT EXISTS deduction_note text;

-- Reading: per-reading deduction value
ALTER TABLE meter_readings ADD COLUMN IF NOT EXISTS deduction numeric;

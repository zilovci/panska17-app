-- Meter deduction: subtract amount before redirecting (e.g., Gatto chladničky on kotolňa meter)
ALTER TABLE meters ADD COLUMN IF NOT EXISTS deduction numeric;
ALTER TABLE meters ADD COLUMN IF NOT EXISTS deduction_note text;

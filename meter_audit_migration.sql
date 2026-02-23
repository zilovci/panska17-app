-- Meter audit fields on expenses
-- Stores main meter vs sub-meter totals for transparency in reports

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_main_consumption numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_sub_consumption numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_redirected_consumption numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_losses numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_consumption_unit text;

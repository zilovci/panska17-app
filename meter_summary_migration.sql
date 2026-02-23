-- Store meter summary on expense for reporting
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_main_consumption numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_sub_total numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_losses numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_losses_pct numeric;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS consumption_unit text;

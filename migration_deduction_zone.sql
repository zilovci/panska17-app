-- Add deduction_zone_id to meters table
-- This allows specifying which zone the deduction consumption should be allocated to
-- e.g., Elektromer kotolňa has deduction for Gatto chladničky → Reštaurácia zone
ALTER TABLE meters ADD COLUMN IF NOT EXISTS deduction_zone_id uuid REFERENCES zones(id);

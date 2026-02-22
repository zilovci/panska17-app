-- Parent-child expense linking for redirected meters
-- E.g., water meter in kotolňa → creates child expense in Vykurovanie

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS parent_expense_id uuid REFERENCES expenses(id) ON DELETE CASCADE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_auto_generated boolean DEFAULT false;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS auto_source_meter_id uuid REFERENCES meters(id);

CREATE INDEX IF NOT EXISTS idx_expenses_parent ON expenses (parent_expense_id) WHERE parent_expense_id IS NOT NULL;

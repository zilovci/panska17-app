-- Add total_settlements column to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_settlements NUMERIC DEFAULT 0;

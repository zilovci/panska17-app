-- Add pdf_url to invoices table for static PDF storage
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_url text;

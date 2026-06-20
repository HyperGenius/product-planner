-- Add is_confirmed, confirmed_by, confirmed_at to process_routings
-- These fields support admin-only routing confirmation workflow (Issue #197, #199)

ALTER TABLE public.process_routings
  ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

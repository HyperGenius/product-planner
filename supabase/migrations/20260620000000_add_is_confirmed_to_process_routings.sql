ALTER TABLE process_routings
  ADD COLUMN is_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmed_by uuid REFERENCES auth.users(id),
  ADD COLUMN confirmed_at timestamptz;

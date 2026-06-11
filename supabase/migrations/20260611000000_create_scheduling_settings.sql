CREATE TABLE scheduling_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  guard_time_minutes int NOT NULL DEFAULT 0,
  min_slot_minutes int NOT NULL DEFAULT 0,
  max_fragments int NOT NULL DEFAULT 10
);

ALTER TABLE scheduling_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can manage scheduling_settings"
  ON scheduling_settings
  FOR ALL
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

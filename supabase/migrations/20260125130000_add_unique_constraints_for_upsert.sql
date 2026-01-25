-- Add unique constraints needed for UPSERT operations in seed_scenario.py
-- These constraints ensure idempotency when importing scenario data

-- equipment_groups: ensure (tenant_id, name) is unique
ALTER TABLE equipment_groups
ADD CONSTRAINT equipment_groups_tenant_id_name_key 
UNIQUE (tenant_id, name);

-- equipments: ensure (tenant_id, name) is unique
ALTER TABLE equipments
ADD CONSTRAINT equipments_tenant_id_name_key 
UNIQUE (tenant_id, name);

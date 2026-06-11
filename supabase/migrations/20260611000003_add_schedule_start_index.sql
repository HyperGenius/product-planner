-- ギャップ計算用: 設備ごとの既存スケジュールを start_datetime 昇順で効率的に取得するためのインデックス
CREATE INDEX idx_schedules_tenant_equip_start
  ON production_schedules (tenant_id, equipment_id, start_datetime ASC);

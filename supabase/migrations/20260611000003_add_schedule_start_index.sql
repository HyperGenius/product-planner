-- ギャップ計算用: 設備ごとの既存スケジュールを start_datetime 昇順で効率的に取得するためのインデックス
-- equipment_id を先頭にすることで get_schedules_by_equipment クエリが確実にインデックスを利用できるようにする
CREATE INDEX idx_schedules_equip_start
  ON production_schedules (equipment_id, start_datetime ASC);

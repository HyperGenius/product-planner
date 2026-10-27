-- ==========================================
-- 工程の前倒し・後ろ倒し（Issue #582）
--
-- ガントの詳細シートから注文の1工程を稼働日単位でずらし、同じ注文の後工程を連動させる。
-- ずらし後のセグメントの計算は backend の services/schedule_shift_service.py（純粋関数）で行い、
-- ここにはその保存（セグメントの作り直し・完成見込みの更新・変更の記録）を1トランザクションで行う
-- RPC と、変更の記録のテーブルを置く。
--
-- 記録は承認ワークフロー専用の order_approval_log に混ぜず、前後の期間を持てる専用テーブルにする。
-- ==========================================

-- ---------------------------------------------------------------------------
-- production_schedule_shift_logs: 計画をずらした記録（追記専用）
-- ---------------------------------------------------------------------------
--   process_routing_id   ボタンを押した工程。工程が削除されても記録は残す（製品の統合 #515 で工程が消える）
--   working_days         ずらした稼働日（負は前倒し）
--   stopped_at_previous  前倒しが前工程の終了で止まった
--   processes            動いた工程ごとの前後の期間
--                        [{process_routing_id, process_name, before: {start_datetime, end_datetime}, after: {...}}]
CREATE TABLE production_schedule_shift_logs (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES tenants(id),
  order_id                   bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  process_routing_id         bigint REFERENCES process_routings(id) ON DELETE SET NULL,
  working_days               integer NOT NULL CHECK (working_days <> 0),
  stopped_at_previous        boolean NOT NULL DEFAULT false,
  processes                  jsonb NOT NULL,
  confirmed_deadline_before  date,
  confirmed_deadline_after   date,
  actor_user_id              uuid NOT NULL REFERENCES auth.users(id),
  created_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_schedule_shift_logs IS
  'ガントの詳細シートから工程の計画を前倒し・後ろ倒しした記録（Issue #582。追記専用）';

ALTER TABLE production_schedule_shift_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation (select)" ON production_schedule_shift_logs
  FOR SELECT
  USING (is_tenant_member(tenant_id));

-- 書き込みは RPC shift_order_process_schedules（SECURITY INVOKER）から操作者本人のユーザー JWT で行う。
-- 記録の偽造を防ぐため、操作者が本人であること・受注が同じテナントのものであること・
-- ロールがスケジュールを書き換えられるもの（backend SCHEDULE_EDITOR_ROLES）であることを検証する
CREATE POLICY "tenant isolation (insert)" ON production_schedule_shift_logs
  FOR INSERT
  WITH CHECK (
    is_tenant_member(tenant_id)
    AND actor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = production_schedule_shift_logs.order_id
        AND o.tenant_id = production_schedule_shift_logs.tenant_id
    )
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.tenant_id = production_schedule_shift_logs.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('president')
    )
  );

CREATE INDEX idx_production_schedule_shift_logs_tenant_order
  ON production_schedule_shift_logs (tenant_id, order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- shift_order_process_schedules: ずらした計画を保存する
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER（ユーザー JWT で呼び、RLS 下で動く）。production_schedules / orders の書き込みは
-- 既存のテナントメンバー向けポリシーで許可されている。
--
--   p_expected       計算に使った注文の全セグメント（id, process_routing_id, equipment_id, start/end）。
--                    受注の行をロックしたうえで現在のセグメントと突き合わせ、1件でも違えば
--                    P0001 で失敗する（計算の後に別の操作で計画が変わった）
--   p_segments       動かす工程（対象＋後工程）の新しいセグメント。動かす工程の既存のセグメントは
--                    すべて消して作り直す
--   p_scheduling_start_date  注文の最初の工程の日が変わったときだけ渡す（作業開始日を合わせ、
--                    手動で決めた計画として scheduling_start_date_auto を false にする）
--
-- エラー: 42501 権限なし / P0002 受注が無い / 55000 ずらせないステータス / P0001 計画が変わった
-- （40001 は PostgREST が再試行対象として 504 にするので使わない）
CREATE OR REPLACE FUNCTION shift_order_process_schedules(
  p_tenant_id               uuid,
  p_order_id                bigint,
  p_process_routing_id      bigint,
  p_working_days            integer,
  p_expected                jsonb,
  p_segments                jsonb,
  p_confirmed_deadline      date,
  p_scheduling_start_date   date,
  p_stopped_at_previous     boolean,
  p_log_processes           jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status             text;
  v_deadline_before    date;
  v_routing_ids        bigint[];
  v_log_id             uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM organization_members m
     WHERE m.tenant_id = p_tenant_id
       AND m.user_id = auth.uid()
       AND m.role IN ('president')
  ) THEN
    RAISE EXCEPTION 'shift_order_process_schedules: permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT o.status, o.confirmed_deadline INTO v_status, v_deadline_before
    FROM orders o
   WHERE o.tenant_id = p_tenant_id
     AND o.id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_order_process_schedules: order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('confirmed', 'in_progress') THEN
    RAISE EXCEPTION 'shift_order_process_schedules: order is not adjustable' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    (
      SELECT ps.id, ps.process_routing_id, ps.equipment_id, ps.start_datetime, ps.end_datetime
        FROM production_schedules ps
       WHERE ps.tenant_id = p_tenant_id
         AND ps.order_id = p_order_id
      EXCEPT
      SELECT e.id, e.process_routing_id, e.equipment_id, e.start_datetime, e.end_datetime
        FROM jsonb_to_recordset(COALESCE(p_expected, '[]'::jsonb)) AS e(
          id                  bigint,
          process_routing_id  bigint,
          equipment_id        bigint,
          start_datetime      timestamptz,
          end_datetime        timestamptz
        )
    )
    UNION ALL
    (
      SELECT e.id, e.process_routing_id, e.equipment_id, e.start_datetime, e.end_datetime
        FROM jsonb_to_recordset(COALESCE(p_expected, '[]'::jsonb)) AS e(
          id                  bigint,
          process_routing_id  bigint,
          equipment_id        bigint,
          start_datetime      timestamptz,
          end_datetime        timestamptz
        )
      EXCEPT
      SELECT ps.id, ps.process_routing_id, ps.equipment_id, ps.start_datetime, ps.end_datetime
        FROM production_schedules ps
       WHERE ps.tenant_id = p_tenant_id
         AND ps.order_id = p_order_id
    )
  ) THEN
    RAISE EXCEPTION 'shift_order_process_schedules: schedules changed' USING ERRCODE = 'P0001';
  END IF;

  v_routing_ids := ARRAY(
    SELECT DISTINCT s.process_routing_id
      FROM jsonb_to_recordset(COALESCE(p_segments, '[]'::jsonb)) AS s(process_routing_id bigint)
  );
  IF cardinality(v_routing_ids) = 0 OR NOT p_process_routing_id = ANY(v_routing_ids) THEN
    RAISE EXCEPTION 'shift_order_process_schedules: invalid segments' USING ERRCODE = '22023';
  END IF;

  DELETE FROM production_schedules ps
   WHERE ps.tenant_id = p_tenant_id
     AND ps.order_id = p_order_id
     AND ps.process_routing_id = ANY(v_routing_ids);

  INSERT INTO production_schedules (
    tenant_id, order_id, process_routing_id, equipment_id, start_datetime, end_datetime
  )
  SELECT p_tenant_id, p_order_id, s.process_routing_id, s.equipment_id, s.start_datetime, s.end_datetime
    FROM jsonb_to_recordset(p_segments) AS s(
      process_routing_id  bigint,
      equipment_id        bigint,
      start_datetime      timestamptz,
      end_datetime        timestamptz
    );

  UPDATE orders o
     SET confirmed_deadline = p_confirmed_deadline,
         scheduling_start_date = COALESCE(p_scheduling_start_date, o.scheduling_start_date),
         scheduling_start_date_auto = CASE
           WHEN p_scheduling_start_date IS NULL THEN o.scheduling_start_date_auto
           ELSE false
         END
   WHERE o.tenant_id = p_tenant_id
     AND o.id = p_order_id;

  INSERT INTO production_schedule_shift_logs (
    tenant_id, order_id, process_routing_id, working_days, stopped_at_previous,
    processes, confirmed_deadline_before, confirmed_deadline_after, actor_user_id
  ) VALUES (
    p_tenant_id, p_order_id, p_process_routing_id, p_working_days, p_stopped_at_previous,
    COALESCE(p_log_processes, '[]'::jsonb), v_deadline_before, p_confirmed_deadline, auth.uid()
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION shift_order_process_schedules(
  uuid, bigint, bigint, integer, jsonb, jsonb, date, date, boolean, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION shift_order_process_schedules(
  uuid, bigint, bigint, integer, jsonb, jsonb, date, date, boolean, jsonb
) TO authenticated;

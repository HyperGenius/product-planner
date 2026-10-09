-- 設備ごとの1台グループを設備の作成時に自動で作る (Issue #512)
--
-- 工程ルーティング（process_routings.equipment_group_id）は設備グループしか参照できないので、
-- 設備を1台だけ指定するには、その設備だけをメンバーに持つ「1台グループ」が要る。初期移行では
-- 設備ごとに表示名と同名の1台グループを作っていたが、設備の作成（画面・台帳反映スクリプト）では
-- 作っていなかったため、後から追加した設備を工程に割り当てられなかった。
--
-- equipments の INSERT と同じトランザクションで作るトリガーに寄せ、画面（ユーザー JWT）と
-- 台帳反映スクリプト（service role）のどちらから作っても1台グループができるようにする。
-- グループ名は表示名 COALESCE(short_name, name)（ガントは設備グループ名を出すため。
-- Backend `equipment_display_name()` / Frontend `equipmentDisplayName()` と揃える）。

CREATE OR REPLACE FUNCTION ensure_solo_equipment_group(p_equipment_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tenant_id uuid;
  v_display_name text;
  v_candidate text;
  v_group_id bigint;
BEGIN
  SELECT tenant_id, COALESCE(short_name, name)
    INTO v_tenant_id, v_display_name
    FROM equipments
   WHERE id = p_equipment_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 表示名と同名のグループに他の設備が入っている（同名の共有グループがある）ときは、
  -- 「（単独）」を付けた名前で作る。何度呼んでも同じ結果になる（冪等）
  FOREACH v_candidate IN ARRAY ARRAY[v_display_name, v_display_name || '（単独）'] LOOP
    SELECT id INTO v_group_id
      FROM equipment_groups
     WHERE tenant_id = v_tenant_id AND name = v_candidate;

    IF v_group_id IS NULL THEN
      INSERT INTO equipment_groups (tenant_id, name)
      VALUES (v_tenant_id, v_candidate)
      RETURNING id INTO v_group_id;
    ELSIF EXISTS (
      SELECT 1 FROM equipment_group_members
       WHERE equipment_group_id = v_group_id AND equipment_id <> p_equipment_id
    ) THEN
      CONTINUE;
    END IF;

    -- 既存の1台グループ、またはメンバー0台の同名グループ（削除した設備の残骸。
    -- 工程から参照されていれば、同じ名前の設備を作り直すと参照が生き返る）に入れる
    INSERT INTO equipment_group_members (tenant_id, equipment_group_id, equipment_id)
    VALUES (v_tenant_id, v_group_id, p_equipment_id)
    ON CONFLICT (equipment_group_id, equipment_id) DO NOTHING;
    RETURN v_group_id;
  END LOOP;

  -- 候補名がどちらも共有グループに使われている。設備の作成は失敗させず、1台グループは作らない
  RAISE WARNING 'ensure_solo_equipment_group: no available group name for equipment %', p_equipment_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION create_solo_equipment_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  PERFORM ensure_solo_equipment_group(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_solo_equipment_group ON equipments;

CREATE TRIGGER trg_create_solo_equipment_group
AFTER INSERT ON equipments
FOR EACH ROW
EXECUTE FUNCTION create_solo_equipment_group();

-- 既存の設備で1台グループが無いものに作る。表示名と同名で、その設備だけがメンバーのグループを
-- 1台グループとみなす（名前が違う1台のグループは、メンバーが欠けた工程用グループとして残す）
SELECT ensure_solo_equipment_group(e.id)
  FROM equipments e
 WHERE NOT EXISTS (
   SELECT 1
     FROM equipment_groups g
     JOIN equipment_group_members m ON m.equipment_group_id = g.id
    WHERE g.tenant_id = e.tenant_id
      AND g.name = COALESCE(e.short_name, e.name)
      AND m.equipment_id = e.id
      AND NOT EXISTS (
        SELECT 1 FROM equipment_group_members o
         WHERE o.equipment_group_id = g.id AND o.equipment_id <> e.id
      )
 )
 ORDER BY e.id;

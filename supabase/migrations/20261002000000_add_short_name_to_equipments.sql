-- 設備に「呼称」（現場で使う短い名前）を追加する
--
-- 設備台帳の反映 (Issue #486) で equipments.name は台帳の正式名称（例: 25Tシングルクランクプレス）に
-- なり、ガントチャート等の表示が冗長になった。台帳反映前の短い名称（例: ワシノ25t）を呼称として持ち、
-- アプリ上の表示は「呼称があれば呼称、無ければ設備名」にする。
-- 表示で設備を見分けられるよう、呼称もテナント内で一意にする（未設定の NULL は重複可）。

ALTER TABLE equipments
  ADD COLUMN short_name text CHECK (btrim(short_name) <> '');

COMMENT ON COLUMN equipments.short_name IS '呼称（現場で使う短い名前）。画面表示に使い、NULL なら name を表示する';

CREATE UNIQUE INDEX equipments_tenant_id_short_name_key
  ON equipments (tenant_id, short_name)
  WHERE short_name IS NOT NULL;

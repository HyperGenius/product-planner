-- 設備名の UNIQUE をやめ、表示名（呼称があれば呼称、無ければ設備名）をテナント内で一意にする (Issue #501)
--
-- 設備名 equipments.name は設備台帳の正式名称（Issue #486）で、顧客の台帳には同名の設備が複数ある
-- （同じ機種で製造番号だけが異なる等）。現場は呼称 short_name で区別しているため、画面に出す名前
-- COALESCE(short_name, name) を一意にし、同名の設備は呼称で区別させる。
-- この式インデックスは short_name の一意性（equipments_tenant_id_short_name_key）も包含するので置き換える。
-- 表示名の算出は Backend `equipment_display_name()` / Frontend `equipmentDisplayName()` と揃える。

ALTER TABLE equipments DROP CONSTRAINT equipments_tenant_id_name_key;
DROP INDEX equipments_tenant_id_short_name_key;

CREATE UNIQUE INDEX equipments_tenant_id_display_name_key
  ON equipments (tenant_id, (COALESCE(short_name, name)));

COMMENT ON COLUMN equipments.name IS '設備名（設備台帳の正式名称）。同名の設備があり得るため一意ではない。同名の設備は呼称で区別する';
COMMENT ON COLUMN equipments.short_name IS '呼称（現場で使う短い名前）。画面表示に使い、NULL なら name を表示する。表示名 COALESCE(short_name, name) はテナント内で一意';

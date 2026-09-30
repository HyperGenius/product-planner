-- 設備マスタに設備台帳（顧客の正典）の列を追加する (Issue #486)
--
-- 日報の「使用設備No」（`〇〇t N号機` 形式の N）を台帳番号で照合するため、
-- 台帳番号 ledger_no をテナント内で一意にする。
-- 「汎用設備グループ」等の物理的な設備ではないレコードは台帳に無いため NULL 可。
-- manufactured_on は台帳の表記（「1993年5月」「S.53年11月」等）がまちまちなので text で持つ。

ALTER TABLE equipments
  ADD COLUMN ledger_no int CHECK (ledger_no > 0),
  ADD COLUMN maker text,
  ADD COLUMN model text,
  ADD COLUMN manufactured_on text,
  ADD COLUMN serial_no text,
  ADD COLUMN note text;

COMMENT ON COLUMN equipments.ledger_no IS '設備台帳の番号。日報の「〇〇t N号機」の N に対応する。台帳に無い設備は NULL';
COMMENT ON COLUMN equipments.maker IS 'メーカー（設備台帳）';
COMMENT ON COLUMN equipments.model IS '型式（設備台帳）';
COMMENT ON COLUMN equipments.manufactured_on IS '製造年月（設備台帳の表記のまま。和暦表記を含むため text）';
COMMENT ON COLUMN equipments.serial_no IS '製造番号（設備台帳）';
COMMENT ON COLUMN equipments.note IS '備考（設備台帳）';

CREATE UNIQUE INDEX equipments_tenant_id_ledger_no_key
  ON equipments (tenant_id, ledger_no)
  WHERE ledger_no IS NOT NULL;

-- 日報のパースと明細の保存 (Issue #487, 親Issue #485)
--
-- daily_report_files（#471）に保存された日報Excelを cron（GET /api/cron/parse-daily-reports）で
-- パースし、`YYMM製造` シートの1行を daily_report_entries の1行として保存する。
-- ここでは名寄せ（マスタとの照合、#488）は行わず、日報の値をそのまま（＋最低限の正規化）保存する。
--
-- 日報は同じブックに毎日追記される形式で、エージェントは保存のたびに別ファイル（別 sha256）として
-- 送ってくる。全ファイルの行を足すと二重計上になるため、**(テナント, シート名) 単位で最新のファイルの
-- 内容に丸ごと置き換える**。どのファイルの内容が載っているかは daily_report_sheets で管理する。
--
-- 書き込みは cron（service role）のみ。daily_report_files と同じく RLS を有効にしたうえで
-- SELECT ポリシーだけを作る（20260929000000_add_daily_report_agent.sql 参照）。

-- ---------------------------------------------------------------------------
-- daily_report_files: パースの処理状態
-- ---------------------------------------------------------------------------
-- pending     未処理（cron の処理対象。既存の行もこの値になり、初回の cron で取り込まれる）
-- parsed      パース済み（対象シートが無い・古い版で置き換えなかった場合も含む）
-- unsupported 未対応の形式（.xls 等。openpyxl で読めない）
-- failed      パース失敗。詳細はログにのみ残し、parse_error には固定文言を入れる。
--             再処理するときは parse_status を 'pending' に戻す
ALTER TABLE daily_report_files
  ADD COLUMN parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'unsupported', 'failed')),
  ADD COLUMN parsed_at timestamptz,
  ADD COLUMN parse_error text;

CREATE INDEX idx_daily_report_files_pending
  ON daily_report_files (received_at)
  WHERE parse_status = 'pending';

-- ---------------------------------------------------------------------------
-- daily_report_sheets: シートごとに「どのファイルの内容が載っているか」
-- ---------------------------------------------------------------------------
-- source_version_at はファイルの更新日時（file_modified_at）、無ければ受信日時（received_at）。
-- これが新しいファイルだけが明細を置き換える（同時刻なら received_at で比べる）。
CREATE TABLE daily_report_sheets (
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  sheet_name          text NOT NULL,
  source_file_id      uuid NOT NULL REFERENCES daily_report_files(id) ON DELETE CASCADE,
  source_version_at   timestamptz NOT NULL,
  source_received_at  timestamptz NOT NULL,
  entry_count         integer NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sheet_name)
);

ALTER TABLE daily_report_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily report sheets" ON daily_report_sheets
  FOR SELECT
  USING (is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- daily_report_entries: 日報の明細（1行＝日報の1行）
-- ---------------------------------------------------------------------------
-- *_raw は日報の値そのまま（前後の空白のみ除去、数値セルは文字列化）。名寄せは #488 で行う。
-- good_qty = processed_qty − defect_qty（0未満は0）。processed_qty が空なら NULL（進捗に数えない）。
-- parse_issues は解釈できなかった・補正した項目の配列（[{"field": "work_date", "code": "year_corrected"}, ...]）。
CREATE TABLE daily_report_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  source_file_id  uuid NOT NULL REFERENCES daily_report_files(id) ON DELETE CASCADE,
  sheet_name      text NOT NULL,
  row_no          integer NOT NULL CHECK (row_no > 0),
  work_date       date,
  work_date_raw   text,
  worker_raw      text,
  customer_raw    text,
  homeworker_raw  text,
  product_raw     text,
  process_raw     text,
  equipment_raw   text,
  processed_qty   integer,
  defect_qty      integer,
  good_qty        integer CHECK (good_qty >= 0),
  setup_qty       integer,
  lot_no          text,
  note            text,
  parse_issues    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_entries_sheet_row_key UNIQUE (tenant_id, sheet_name, row_no)
);

ALTER TABLE daily_report_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily report entries" ON daily_report_entries
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_daily_report_entries_tenant_work_date
  ON daily_report_entries (tenant_id, work_date);

CREATE INDEX idx_daily_report_entries_source_file
  ON daily_report_entries (source_file_id);

-- ---------------------------------------------------------------------------
-- replace_daily_report_sheet_entries: シートの明細を最新版で丸ごと置き換える
-- ---------------------------------------------------------------------------
-- 古い明細の DELETE と新しい明細の INSERT を1トランザクションで行い、途中で失敗しても
-- 明細が消えないようにする。p_source_file_id のファイルが、現在そのシートを載せている
-- ファイルより古ければ何もせず 'stale' を返す（新しいか同じファイルなら 'replaced'）。
-- 同じシートを並行して処理しても順序が崩れないよう、(テナント, シート名) で advisory lock を取る。
--
-- cron（service role）からのみ呼ぶ。p_tenant_id は呼び出し側が daily_report_files の行から
-- 解決した値で、ファイルが別テナントのものなら例外にする。
CREATE OR REPLACE FUNCTION replace_daily_report_sheet_entries(
  p_tenant_id       uuid,
  p_source_file_id  uuid,
  p_sheet_name      text,
  p_entries         jsonb
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_new_version_at   timestamptz;
  v_new_received_at  timestamptz;
  v_current          daily_report_sheets%ROWTYPE;
  v_entry_count      integer;
BEGIN
  SELECT COALESCE(f.file_modified_at, f.received_at), f.received_at
    INTO v_new_version_at, v_new_received_at
    FROM daily_report_files f
   WHERE f.id = p_source_file_id
     AND f.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'daily report file not found for tenant';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('daily_report_sheet:' || p_tenant_id::text || ':' || p_sheet_name, 0)
  );

  SELECT * INTO v_current
    FROM daily_report_sheets s
   WHERE s.tenant_id = p_tenant_id
     AND s.sheet_name = p_sheet_name;

  IF FOUND
     AND (v_current.source_version_at, v_current.source_received_at)
         > (v_new_version_at, v_new_received_at) THEN
    RETURN 'stale';
  END IF;

  DELETE FROM daily_report_entries
   WHERE tenant_id = p_tenant_id
     AND sheet_name = p_sheet_name;

  INSERT INTO daily_report_entries (
    tenant_id, source_file_id, sheet_name, row_no,
    work_date, work_date_raw,
    worker_raw, customer_raw, homeworker_raw, product_raw, process_raw, equipment_raw,
    processed_qty, defect_qty, good_qty, setup_qty,
    lot_no, note, parse_issues
  )
  SELECT
    p_tenant_id, p_source_file_id, p_sheet_name, e.row_no,
    e.work_date, e.work_date_raw,
    e.worker_raw, e.customer_raw, e.homeworker_raw, e.product_raw, e.process_raw, e.equipment_raw,
    e.processed_qty, e.defect_qty, e.good_qty, e.setup_qty,
    e.lot_no, e.note, COALESCE(e.parse_issues, '[]'::jsonb)
  FROM jsonb_to_recordset(COALESCE(p_entries, '[]'::jsonb)) AS e(
    row_no          integer,
    work_date       date,
    work_date_raw   text,
    worker_raw      text,
    customer_raw    text,
    homeworker_raw  text,
    product_raw     text,
    process_raw     text,
    equipment_raw   text,
    processed_qty   integer,
    defect_qty      integer,
    good_qty        integer,
    setup_qty       integer,
    lot_no          text,
    note            text,
    parse_issues    jsonb
  );

  GET DIAGNOSTICS v_entry_count = ROW_COUNT;

  INSERT INTO daily_report_sheets (
    tenant_id, sheet_name, source_file_id, source_version_at, source_received_at,
    entry_count, updated_at
  )
  VALUES (
    p_tenant_id, p_sheet_name, p_source_file_id, v_new_version_at, v_new_received_at,
    v_entry_count, now()
  )
  ON CONFLICT (tenant_id, sheet_name) DO UPDATE SET
    source_file_id     = EXCLUDED.source_file_id,
    source_version_at  = EXCLUDED.source_version_at,
    source_received_at = EXCLUDED.source_received_at,
    entry_count        = EXCLUDED.entry_count,
    updated_at         = EXCLUDED.updated_at;

  RETURN 'replaced';
END;
$$;

-- SECURITY INVOKER なのでユーザー JWT から呼んでも RLS（書き込みポリシー無し）で弾かれるが、
-- service role 専用であることを明示するため実行権限も絞る。
REVOKE EXECUTE ON FUNCTION replace_daily_report_sheet_entries(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_daily_report_sheet_entries(uuid, uuid, text, jsonb)
  TO service_role;

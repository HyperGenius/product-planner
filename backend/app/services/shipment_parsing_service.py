# backend/app/services/shipment_parsing_service.py
"""未処理の弥生のエクスポートを解析して明細を保存する cron 処理 (Issue #667)。

`shipment_files.parse_status = 'pending'` のファイルを Storage から取得し、`shipment_parser` で
解析して、RPC `replace_shipment_entries` でファイルの期間の明細を日ごとに置き換える
（その日を含むファイルのうち `file_modified_at` → `received_at` が最新のものだけを残す。判定は RPC 側）。

cron から service role の admin client で全テナント横断に呼ばれる。`tenant_id` は
`shipment_files` の行から取り、以降のクエリはすべて `.eq("tenant_id", tenant_id)` で絞り込む。
"""

import os
from datetime import UTC, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.services.daily_report_service import storage_extension
from app.services.shipment_file_service import SHIPMENT_FILE_BUCKET
from app.services.shipment_parser import ShipmentParseError, parse_shipment_workbook
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

# 1回の cron 実行で処理するファイル数の上限。滞留分は次回以降に持ち越す（冪等）。
_PARSE_SHIPMENT_FILES_BATCH_LIMIT = int(
    os.environ.get("PARSE_SHIPMENT_FILES_BATCH_LIMIT", "10")
)

# 実物のエクスポートは「得意先別売上明細表」の .xlsx。CSV・テキストは受け取るだけで解析しない
_SUPPORTED_EXTENSIONS = {".xlsx", ".xlsm"}

# parse_error はテナントのメンバーが参照できる列なので、例外の文言は入れず固定の分類にする
# （詳細はログにのみ残す）。画面の表示文言は frontend の SHIPMENT_PARSE_ERROR_LABELS。
ERROR_UNSUPPORTED = "unsupported_file_type"
ERROR_FAILED = "parse_failed"


def parse_pending_shipment_files(db: Client) -> dict[str, int]:
    result = (
        db.table(SupabaseTableName.SHIPMENT_FILES.value)
        .select("id, tenant_id, storage_path, file_name")
        .eq("parse_status", "pending")
        .order("received_at")
        .limit(_PARSE_SHIPMENT_FILES_BATCH_LIMIT)
        .execute()
    )
    files = cast(list[dict[str, Any]], result.data or [])

    summary = {
        "processed": 0,
        "parsed": 0,
        "unsupported": 0,
        "failed": 0,
        "entries_saved": 0,
    }
    for file_row in files:
        summary["processed"] += 1
        try:
            status = _parse_one(db, file_row, summary)
        except ShipmentParseError as exc:
            logger.warning(
                f"shipment_parsing: file {file_row['id']} could not be read ({exc.code})"
            )
            status = "failed"
            _mark(db, file_row, {"parse_status": "failed", "parse_error": exc.code})
        except Exception:
            logger.error(
                f"shipment_parsing: file {file_row['id']} failed", exc_info=True
            )
            status = "failed"
            _mark(db, file_row, {"parse_status": "failed", "parse_error": ERROR_FAILED})
        summary[status] += 1

    logger.info(f"shipment_parsing complete: {summary}")
    return summary


def _parse_one(db: Client, file_row: dict[str, Any], summary: dict[str, int]) -> str:
    if storage_extension(file_row["file_name"]) not in _SUPPORTED_EXTENSIONS:
        _mark(
            db,
            file_row,
            {"parse_status": "unsupported", "parse_error": ERROR_UNSUPPORTED},
        )
        return "unsupported"

    content = db.storage.from_(SHIPMENT_FILE_BUCKET).download(file_row["storage_path"])
    parsed = parse_shipment_workbook(content)

    rpc_result = db.rpc(
        "replace_shipment_entries",
        {
            "p_tenant_id": file_row["tenant_id"],
            "p_source_file_id": file_row["id"],
            "p_period_start": parsed.period_start.isoformat(),
            "p_period_end": parsed.period_end.isoformat(),
            "p_entries": parsed.entries,
        },
    ).execute()
    replaced = cast(dict[str, Any], rpc_result.data or {})
    entry_count = int(replaced.get("entry_count") or 0)
    summary["entries_saved"] += entry_count

    _mark(
        db,
        file_row,
        {
            "parse_status": "parsed",
            "parse_error": None,
            "period_start": parsed.period_start.isoformat(),
            "period_end": parsed.period_end.isoformat(),
            # 置き換えに使った行数ではなく、ファイルから読めた商品の行数を残す
            # （新しいファイルが既に載っている日の行は入らないが、ファイルの解析結果として見せる）
            "entry_count": len(parsed.entries),
            "skipped_count": parsed.skipped_count,
            "replace_result": replaced.get("status"),
        },
    )
    return "parsed"


def _mark(db: Client, file_row: dict[str, Any], values: dict[str, Any]) -> None:
    (
        db.table(SupabaseTableName.SHIPMENT_FILES.value)
        .update({**values, "parsed_at": datetime.now(UTC).isoformat()})
        .eq("id", file_row["id"])
        .eq("tenant_id", file_row["tenant_id"])
        .execute()
    )

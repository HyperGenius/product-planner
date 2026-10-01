# backend/app/services/daily_report_parsing_service.py
"""未処理の日報ファイルをパースして明細を保存する cron 処理 (Issue #487, 親Issue #485)。

`daily_report_files.parse_status = 'pending'` のファイルを Storage から取得し、
`daily_report_parser` でパースして、シートごとに RPC `replace_daily_report_sheet_entries` で
明細を置き換える。同じブックは保存のたびに別ファイルとして届くため、(テナント, シート名) 単位で
最新のファイル（`file_modified_at`、無ければ `received_at`）の内容だけを残す（判定は RPC 側）。

cron から service role の admin client で全テナント横断に呼ばれる。`tenant_id` は
`daily_report_files` の行から取り、以降のクエリはすべて `.eq("tenant_id", tenant_id)` で絞り込む。
"""

import os
from datetime import UTC, datetime
from typing import Any, cast

from app.services.daily_report_parser import (
    DailyReportParseError,
    parse_daily_report_workbook,
)
from app.services.daily_report_service import DAILY_REPORT_BUCKET, storage_extension
from app.utils.logger import get_logger
from supabase import Client  # type: ignore

logger = get_logger(__name__)

# 1回の cron 実行で処理するファイル数の上限。滞留分は次回以降に持ち越す（冪等）。
_PARSE_DAILY_REPORTS_BATCH_LIMIT = int(
    os.environ.get("PARSE_DAILY_REPORTS_BATCH_LIMIT", "10")
)

# openpyxl で読める形式。`.xls`（旧形式）等は unsupported にする。
_SUPPORTED_EXTENSIONS = {".xlsx", ".xlsm"}

# parse_error はテナントのメンバーが参照できる列なので、例外の詳細は入れず固定文言にする
# （詳細はログにのみ残す。cron のエラー規約と同じ方針）。
_ERROR_UNSUPPORTED = "unsupported file type"
_ERROR_INVALID_WORKBOOK = "unable to open workbook"
_ERROR_FAILED = "parse failed"


def parse_pending_daily_reports(db: Client) -> dict[str, int]:
    result = (
        db.table("daily_report_files")
        .select("id, tenant_id, storage_path, file_name")
        .eq("parse_status", "pending")
        .order("received_at")
        .limit(_PARSE_DAILY_REPORTS_BATCH_LIMIT)
        .execute()
    )
    files = cast(list[dict[str, Any]], result.data or [])

    summary = {
        "processed": 0,
        "parsed": 0,
        "unsupported": 0,
        "failed": 0,
        "sheets_replaced": 0,
        "sheets_stale": 0,
        "sheets_without_header": 0,
        "entries_saved": 0,
    }
    for file_row in files:
        summary["processed"] += 1
        try:
            status = _parse_one(db, file_row, summary)
        except DailyReportParseError:
            logger.warning(
                f"daily_report_parsing: file {file_row['id']} is not a readable workbook",
                exc_info=True,
            )
            status = "failed"
            _mark(db, file_row, "failed", _ERROR_INVALID_WORKBOOK)
        except Exception:
            logger.error(
                f"daily_report_parsing: file {file_row['id']} failed", exc_info=True
            )
            status = "failed"
            _mark(db, file_row, "failed", _ERROR_FAILED)
        summary[status] += 1

    logger.info(f"daily_report_parsing complete: {summary}")
    return summary


def _parse_one(db: Client, file_row: dict[str, Any], summary: dict[str, int]) -> str:
    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]

    if storage_extension(file_row["file_name"]) not in _SUPPORTED_EXTENSIONS:
        _mark(db, file_row, "unsupported", _ERROR_UNSUPPORTED)
        return "unsupported"

    content = db.storage.from_(DAILY_REPORT_BUCKET).download(file_row["storage_path"])
    sheets = parse_daily_report_workbook(content)

    for sheet in sheets:
        if not sheet.header_found:
            # ヘッダ行が無いシートで既存の明細を消さないよう、置き換えずに飛ばす
            logger.warning(
                f"daily_report_parsing: file {file_id} sheet {sheet.sheet_name!r} "
                "has no header row; skipped"
            )
            summary["sheets_without_header"] += 1
            continue
        rpc_result = db.rpc(
            "replace_daily_report_sheet_entries",
            {
                "p_tenant_id": tenant_id,
                "p_source_file_id": file_id,
                "p_sheet_name": sheet.sheet_name,
                "p_entries": sheet.entries,
            },
        ).execute()
        if rpc_result.data == "replaced":
            summary["sheets_replaced"] += 1
            summary["entries_saved"] += len(sheet.entries)
        else:
            summary["sheets_stale"] += 1

    _mark(db, file_row, "parsed", None)
    return "parsed"


def _mark(db: Client, file_row: dict[str, Any], status: str, error: str | None) -> None:
    (
        db.table("daily_report_files")
        .update(
            {
                "parse_status": status,
                "parsed_at": datetime.now(UTC).isoformat(),
                "parse_error": error,
            }
        )
        .eq("id", file_row["id"])
        .eq("tenant_id", file_row["tenant_id"])
        .execute()
    )

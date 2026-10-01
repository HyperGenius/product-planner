# __tests__/unit/services/test_daily_report_parsing_service.py
"""日報パース cron の処理単位のテスト (Issue #487)。DB・Storage はモック。"""

from io import BytesIO
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.services import daily_report_parsing_service as service
from app.services.daily_report_parser import ParsedSheet
from openpyxl import Workbook

TENANT_ID = "00000000-0000-0000-0000-0000000000aa"


def _file_row(file_id: str = "file-1", file_name: str = "日報.xlsx") -> dict[str, Any]:
    return {
        "id": file_id,
        "tenant_id": TENANT_ID,
        "storage_path": f"{TENANT_ID}/{'a' * 64}.xlsx",
        "file_name": file_name,
    }


def _workbook_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "2609製造"
    ws.append(["加工日", "商品名", "加工数", "不適合合計数"])
    ws.append(["2026.09.01", "P-1", 10, 1])
    ws.append(["2026.09.02", "P-2", 20, 0])
    wb.create_sheet("原紙").append(["加工日", "商品名", "加工数"])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _db(files: list[dict[str, Any]], rpc_result: str = "replaced") -> MagicMock:
    db = MagicMock()
    select_chain = db.table.return_value.select.return_value
    select_chain.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = files
    db.rpc.return_value.execute.return_value.data = rpc_result
    db.storage.from_.return_value.download.return_value = _workbook_bytes()
    return db


def _updates(db: MagicMock) -> list[dict[str, Any]]:
    return [c.args[0] for c in db.table.return_value.update.call_args_list]


class TestParsePendingDailyReports:
    def test_parses_pending_files_and_replaces_sheet_entries(self):
        db = _db([_file_row()])

        summary = service.parse_pending_daily_reports(db)

        assert summary == {
            "processed": 1,
            "parsed": 1,
            "unsupported": 0,
            "failed": 0,
            "sheets_replaced": 1,
            "sheets_stale": 0,
            "sheets_without_header": 0,
            "entries_saved": 2,
        }
        select_chain = db.table.return_value.select.return_value
        select_chain.eq.assert_called_once_with("parse_status", "pending")
        db.storage.from_.assert_called_with(service.DAILY_REPORT_BUCKET)
        db.storage.from_.return_value.download.assert_called_once_with(
            _file_row()["storage_path"]
        )

        db.rpc.assert_called_once()
        name, params = db.rpc.call_args.args
        assert name == "replace_daily_report_sheet_entries"
        assert params["p_tenant_id"] == TENANT_ID
        assert params["p_source_file_id"] == "file-1"
        assert params["p_sheet_name"] == "2609製造"
        assert [e["good_qty"] for e in params["p_entries"]] == [9, 20]

        (update,) = _updates(db)
        assert update["parse_status"] == "parsed"
        assert update["parse_error"] is None
        assert update["parsed_at"]
        update_chain = db.table.return_value.update.return_value
        update_chain.eq.assert_called_once_with("id", "file-1")
        update_chain.eq.return_value.eq.assert_called_once_with("tenant_id", TENANT_ID)

    def test_stale_sheet_is_counted_and_file_is_still_parsed(self):
        db = _db([_file_row()], rpc_result="stale")

        summary = service.parse_pending_daily_reports(db)

        assert summary["parsed"] == 1
        assert summary["sheets_stale"] == 1
        assert summary["sheets_replaced"] == 0
        assert summary["entries_saved"] == 0
        assert _updates(db)[0]["parse_status"] == "parsed"

    @pytest.mark.parametrize("file_name", ["日報.xls", "日報.XLS", "日報.csv", "日報"])
    def test_unsupported_extension_is_marked_without_download(self, file_name):
        db = _db([_file_row(file_name=file_name)])

        summary = service.parse_pending_daily_reports(db)

        assert summary["unsupported"] == 1
        db.storage.from_.return_value.download.assert_not_called()
        db.rpc.assert_not_called()
        (update,) = _updates(db)
        assert update["parse_status"] == "unsupported"
        assert update["parse_error"] == "unsupported file type"

    def test_unreadable_workbook_is_marked_failed(self):
        db = _db([_file_row()])
        db.storage.from_.return_value.download.return_value = b"not an excel file"

        summary = service.parse_pending_daily_reports(db)

        assert summary["failed"] == 1
        db.rpc.assert_not_called()
        (update,) = _updates(db)
        assert update["parse_status"] == "failed"
        assert update["parse_error"] == "unable to open workbook"

    def test_unexpected_error_is_marked_failed_with_fixed_message_and_continues(self):
        db = _db([_file_row("file-1"), _file_row("file-2")])
        db.rpc.return_value.execute.side_effect = [
            RuntimeError("secret internal detail"),
            MagicMock(data="replaced"),
        ]

        summary = service.parse_pending_daily_reports(db)

        assert summary["processed"] == 2
        assert summary["failed"] == 1
        assert summary["parsed"] == 1
        statuses = [(u["parse_status"], u["parse_error"]) for u in _updates(db)]
        assert statuses == [("failed", "parse failed"), ("parsed", None)]

    def test_sheet_without_header_does_not_replace_entries(self, monkeypatch):
        monkeypatch.setattr(
            service,
            "parse_daily_report_workbook",
            lambda _content: [ParsedSheet(sheet_name="2609製造", header_found=False)],
        )
        db = _db([_file_row()])

        summary = service.parse_pending_daily_reports(db)

        assert summary["sheets_without_header"] == 1
        assert summary["parsed"] == 1
        db.rpc.assert_not_called()

    def test_no_pending_files(self):
        db = _db([])

        summary = service.parse_pending_daily_reports(db)

        assert summary["processed"] == 0
        db.storage.from_.return_value.download.assert_not_called()
        assert _updates(db) == []

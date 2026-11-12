# __tests__/unit/services/test_shipment_parsing_service.py
"""弥生のエクスポートの解析 cron の処理単位のテスト (Issue #667)。DB・Storage はモック。"""

from datetime import datetime
from io import BytesIO
from typing import Any
from unittest.mock import MagicMock

from app.services import shipment_parsing_service as service
from openpyxl import Workbook

TENANT_ID = "00000000-0000-0000-0000-0000000000aa"


def _file_row(file_name: str = "弥生_2026.10.xlsx") -> dict[str, Any]:
    return {
        "id": "file-1",
        "tenant_id": TENANT_ID,
        "storage_path": f"{TENANT_ID}/{'a' * 64}.xlsx",
        "file_name": file_name,
    }


def _workbook_bytes(with_header: bool = True) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append([None, "得意先別売上明細表"])
    ws.append([])
    ws.append([None, "期間:2026年10月01日 ～ 2026年10月31日"])
    ws.append([])
    header = [None, "得意先コード", "得意先名", "売上日", "伝票番号", "商品コード"]
    header += ["商品名/摘要", "数量", "金額", "備考"]
    ws.append(header if with_header else [None, "得意先"])
    ws.append(
        [
            None,
            "001",
            "架空商事",
            datetime(2026, 10, 5),
            "1",
            "X1",
            "品A",
            10,
            999,
            None,
        ]
    )
    ws.append(
        [
            None,
            "001",
            "架空商事",
            datetime(2026, 10, 5),
            "1",
            None,
            "《消費税》",
            None,
            99,
            None,
        ]
    )
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _db(files: list[dict[str, Any]], content: bytes | None = None) -> MagicMock:
    db = MagicMock()
    select_chain = db.table.return_value.select.return_value
    select_chain.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = files
    db.rpc.return_value.execute.return_value.data = {
        "status": "replaced",
        "entry_count": 1,
    }
    db.storage.from_.return_value.download.return_value = content or _workbook_bytes()
    return db


def _updates(db: MagicMock) -> list[dict[str, Any]]:
    return [c.args[0] for c in db.table.return_value.update.call_args_list]


class TestParsePendingShipmentFiles:
    def test_parses_file_and_replaces_entries_for_period(self):
        db = _db([_file_row()])

        summary = service.parse_pending_shipment_files(db)

        assert summary == {
            "processed": 1,
            "parsed": 1,
            "unsupported": 0,
            "failed": 0,
            "entries_saved": 1,
        }
        db.storage.from_.assert_called_with("shipment-files")
        name, params = db.rpc.call_args.args
        assert name == "replace_shipment_entries"
        assert params["p_tenant_id"] == TENANT_ID
        assert params["p_period_start"] == "2026-10-01"
        assert params["p_period_end"] == "2026-10-31"
        assert [e["product_code"] for e in params["p_entries"]] == ["X1"]
        # 金額の列は送らない
        assert "amount" not in params["p_entries"][0]
        assert 999 not in params["p_entries"][0].values()
        update = _updates(db)[-1]
        assert update["parse_status"] == "parsed"
        assert update["entry_count"] == 1
        assert update["replace_result"] == "replaced"
        assert update["parse_error"] is None

    def test_csv_is_unsupported(self):
        db = _db([_file_row("売上.csv")])

        summary = service.parse_pending_shipment_files(db)

        assert summary["unsupported"] == 1
        db.rpc.assert_not_called()
        assert _updates(db)[-1]["parse_error"] == "unsupported_file_type"

    def test_unreadable_header_is_recorded_without_exception_text(self):
        db = _db([_file_row()], _workbook_bytes(with_header=False))

        summary = service.parse_pending_shipment_files(db)

        assert summary["failed"] == 1
        db.rpc.assert_not_called()
        update = _updates(db)[-1]
        assert update["parse_status"] == "failed"
        assert update["parse_error"] == "header_not_found"

    def test_unexpected_error_uses_fixed_text_and_continues(self):
        db = _db([_file_row(), {**_file_row(), "id": "file-2"}])
        db.rpc.return_value.execute.side_effect = [
            RuntimeError("secret detail"),
            MagicMock(data={"status": "stale", "entry_count": 0}),
        ]

        summary = service.parse_pending_shipment_files(db)

        assert summary["failed"] == 1
        assert summary["parsed"] == 1
        errors = [u.get("parse_error") for u in _updates(db)]
        assert "parse_failed" in errors
        assert all("secret" not in str(e) for e in errors)

# __tests__/api/routers/agent/test_shipment_files.py
"""エージェント経由の送品ファイル受信 (Issue #662)。"""

import hashlib
from unittest.mock import MagicMock
from urllib.parse import quote

import pytest
from app.dependencies import get_supabase_admin_client
from app.main import app
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

client = TestClient(app)

URL = "/api/agent/shipment-files"
VALID_TOKEN = "valid-agent-token-abc123"
TENANT_ID = "11111111-1111-1111-1111-111111111111"
AGENT_TOKEN_ID = "33333333-3333-3333-3333-333333333333"

CONTENT = "伝票番号,品名,数量\n1,テスト品,10\n".encode("cp932")
SHA256 = hashlib.sha256(CONTENT).hexdigest()
PATH = r"\\fileserver\共有\弥生\売上伝票_1109.csv"


def _headers(
    *, sha256: str = SHA256, path: str = PATH, token: str = VALID_TOKEN
) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/octet-stream",
        "X-File-Sha256": sha256,
        "X-File-Path": quote(path, safe=""),
        "X-File-Modified-At": "2026-11-09T17:05:12+09:00",
    }


class _Admin:
    def __init__(self) -> None:
        self.client = MagicMock()
        self.tables: dict[str, MagicMock] = {}
        self.client.table.side_effect = lambda n: self.tables.setdefault(n, MagicMock())
        self.table(
            "agent_tokens"
        ).select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": AGENT_TOKEN_ID,
            "tenant_id": TENANT_ID,
            "revoked_at": None,
        }
        self.set_existing(False)

    def table(self, name: str) -> MagicMock:
        return self.tables.setdefault(name, MagicMock())

    @property
    def storage(self) -> MagicMock:
        return self.client.storage.from_.return_value

    def set_existing(self, exists: bool) -> None:
        self.table(
            "shipment_files"
        ).select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = (
            [{"id": "x"}] if exists else []
        )


@pytest.mark.api
class TestPostShipmentFile:
    @pytest.fixture
    def admin(self):
        mock = _Admin()
        app.dependency_overrides[get_supabase_admin_client] = lambda: mock.client
        yield mock
        app.dependency_overrides = {}

    def test_stores_file_with_token_tenant(self, admin):
        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 200
        assert response.json() == {"status": "stored", "sha256": SHA256}
        admin.client.storage.from_.assert_called_with("shipment-files")
        kwargs = admin.storage.upload.call_args.kwargs
        assert kwargs["path"] == f"{TENANT_ID}/{SHA256}.csv"
        assert kwargs["file_options"] == {"content-type": "text/csv", "upsert": "false"}
        row = admin.table("shipment_files").insert.call_args.args[0]
        assert row["tenant_id"] == TENANT_ID
        assert row["source"] == "agent"
        assert row["agent_token_id"] == AGENT_TOKEN_ID
        assert row["uploaded_by"] is None
        assert row["file_name"] == "売上伝票_1109.csv"
        assert row["original_path"] == PATH

    def test_existing_row_returns_duplicate(self, admin):
        admin.set_existing(True)

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.json()["status"] == "duplicate"
        admin.storage.upload.assert_not_called()
        admin.table("shipment_files").insert.assert_not_called()

    def test_unique_violation_on_insert_returns_duplicate(self, admin):
        admin.table(
            "shipment_files"
        ).insert.return_value.execute.side_effect = APIError(
            {"code": "23505", "message": "duplicate", "details": "", "hint": ""}
        )

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.json()["status"] == "duplicate"

    def test_xlsx_is_accepted_with_excel_content_type(self, admin):
        response = client.post(
            URL, headers=_headers(path=r"\\fs\弥生\売上伝票.xlsx"), content=CONTENT
        )

        assert response.status_code == 200
        kwargs = admin.storage.upload.call_args.kwargs
        assert kwargs["path"] == f"{TENANT_ID}/{SHA256}.xlsx"
        assert kwargs["file_options"]["content-type"] == (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    def test_unsupported_extension_is_rejected(self, admin):
        response = client.post(
            URL, headers=_headers(path=r"\\fs\弥生\売上.pdf"), content=CONTENT
        )

        assert response.status_code == 400
        admin.storage.upload.assert_not_called()

    def test_sha256_mismatch_is_rejected(self, admin):
        response = client.post(URL, headers=_headers(sha256="0" * 64), content=CONTENT)

        assert response.status_code == 400
        admin.storage.upload.assert_not_called()

    def test_body_over_limit_returns_413(self, admin, monkeypatch):
        from app.routers.agent import shipment_files

        monkeypatch.setattr(shipment_files, "MAX_SHIPMENT_FILE_BYTES", 5)

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 413
        admin.storage.upload.assert_not_called()

    def test_chunked_body_over_limit_returns_413(self, admin, monkeypatch):
        from app.routers.agent import shipment_files

        monkeypatch.setattr(shipment_files, "MAX_SHIPMENT_FILE_BYTES", 5)

        response = client.post(
            URL, headers=_headers(), content=iter([CONTENT[:4], CONTENT[4:]])
        )

        assert response.status_code == 413

    def test_invalid_token_returns_401(self, admin):
        admin.table(
            "agent_tokens"
        ).select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 401

    def test_storage_failure_returns_500_without_detail(self, admin):
        admin.storage.upload.side_effect = RuntimeError("secret internal detail")

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 500
        assert "secret" not in response.text

# __tests__/api/routers/transaction/test_shipment_files.py
"""アプリからの送品ファイルのアップロード・一覧 (Issue #662)。"""

import hashlib
from unittest.mock import MagicMock, patch
from urllib.parse import quote

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

URL = "/shipment-files"
TENANT = "11111111-1111-1111-1111-111111111111"
USER = "55555555-5555-5555-5555-555555555555"
CONTENT = "伝票番号,品名\n1,テスト品\n".encode("cp932")
SHA256 = hashlib.sha256(CONTENT).hexdigest()


def _headers(name: str = "売上伝票.csv") -> dict[str, str]:
    return {
        "Content-Type": "application/octet-stream",
        "X-File-Name": quote(name, safe=""),
    }


@pytest.mark.api
class TestShipmentFilesRouter:
    @pytest.fixture
    def db(self):
        mock = MagicMock()
        mock.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_current_user_id] = lambda: USER
        app.dependency_overrides[get_supabase_client] = lambda: mock
        yield mock
        app.dependency_overrides = {}

    @pytest.fixture
    def role(self):
        with patch(
            "app.routers.transaction.shipment_files.get_current_user_role",
            return_value="order_handler",
        ) as m:
            yield m

    def test_upload_stores_with_user_jwt_client(self, db, role):
        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 200
        assert response.json() == {"status": "stored", "sha256": SHA256}
        db.storage.from_.assert_called_with("shipment-files")
        assert db.storage.from_.return_value.upload.call_args.kwargs["path"] == (
            f"{TENANT}/{SHA256}.csv"
        )
        row = db.table.return_value.insert.call_args.args[0]
        assert row["source"] == "web"
        assert row["uploaded_by"] == USER
        assert row["agent_token_id"] is None
        assert row["tenant_id"] == TENANT
        assert row["file_name"] == "売上伝票.csv"

    def test_path_separators_in_file_name_are_dropped(self, db, role):
        response = client.post(
            URL, headers=_headers(r"C:\Users\x\売上伝票.csv"), content=CONTENT
        )

        assert response.status_code == 200
        row = db.table.return_value.insert.call_args.args[0]
        assert row["file_name"] == "売上伝票.csv"
        assert row["original_path"] == "売上伝票.csv"

    @pytest.mark.parametrize("role_name", ["iso_officer"])
    def test_non_editor_role_is_forbidden(self, db, role_name):
        with patch(
            "app.routers.transaction.shipment_files.get_current_user_role",
            return_value=role_name,
        ):
            response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 403
        db.storage.from_.return_value.upload.assert_not_called()

    def test_unsupported_extension_is_rejected(self, db, role):
        response = client.post(URL, headers=_headers("売上伝票.xlsx"), content=CONTENT)

        assert response.status_code == 400

    def test_empty_body_is_rejected(self, db, role):
        response = client.post(URL, headers=_headers(), content=b"")

        assert response.status_code == 400

    def test_missing_file_name_header_is_rejected(self, db, role):
        response = client.post(
            URL, headers={"Content-Type": "application/octet-stream"}, content=CONTENT
        )

        assert response.status_code == 400

    def test_oversize_body_returns_413(self, db, role, monkeypatch):
        from app.routers.transaction import shipment_files

        monkeypatch.setattr(shipment_files, "MAX_SHIPMENT_FILE_BYTES", 5)

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 413

    def test_list_returns_last_received_and_files(self, db):
        db.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {
                "id": "a",
                "file_name": "新しい.csv",
                "source": "web",
                "size_bytes": 10,
                "received_at": "2026-11-09T08:00:00+00:00",
            },
            {
                "id": "b",
                "file_name": "古い.csv",
                "source": "agent",
                "size_bytes": 20,
                "received_at": "2026-11-01T08:00:00+00:00",
            },
        ]

        response = client.get(URL)

        body = response.json()
        assert response.status_code == 200
        assert body["last_received_at"] == "2026-11-09T08:00:00+00:00"
        assert [f["file_name"] for f in body["files"]] == ["新しい.csv", "古い.csv"]
        db.table.return_value.select.return_value.eq.assert_called_with(
            "tenant_id", TENANT
        )

    def test_list_is_empty_when_nothing_received(self, db):
        db.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []

        body = client.get(URL).json()

        assert body == {"last_received_at": None, "files": []}

# __tests__/api/routers/agent/test_daily_reports.py
import hashlib
from unittest.mock import MagicMock
from urllib.parse import quote

import pytest
from app.dependencies import get_supabase_admin_client
from app.main import app
from app.routers.agent import daily_reports
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from storage3.exceptions import StorageApiError

client = TestClient(app)

URL = "/api/agent/daily-reports"
VALID_TOKEN = "valid-agent-token-abc123"
TOKEN_TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
AGENT_TOKEN_ID = "33333333-3333-3333-3333-333333333333"

UNAUTHORIZED_DETAIL = "Invalid agent token."

CONTENT = b"PK\x03\x04 dummy xlsx content"
CONTENT_SHA256 = hashlib.sha256(CONTENT).hexdigest()
JP_PATH = r"\\fileserver\共有\日報\2026年9月\日報_0929.xlsx"


def _headers(
    *,
    token: str = VALID_TOKEN,
    sha256: str = CONTENT_SHA256,
    path: str = JP_PATH,
    modified_at: str | None = "2026-09-29T17:05:12.1234567+09:00",
) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/octet-stream",
        "X-File-Sha256": sha256,
        # PowerShell 5.1 の [System.Uri]::EscapeDataString() 相当（UTF-8、区切りも含めて全エンコード）
        "X-File-Path": quote(path, safe=""),
    }
    if modified_at is not None:
        headers["X-File-Modified-At"] = modified_at
    return headers


class _AdminClientMock:
    """テーブル名ごとに別の MagicMock を返す admin client のモック。"""

    def __init__(self) -> None:
        self.client = MagicMock()
        self.tables: dict[str, MagicMock] = {}
        self.client.table.side_effect = self._table
        self.set_existing(False)

    def _table(self, name: str) -> MagicMock:
        return self.tables.setdefault(name, MagicMock())

    def table(self, name: str) -> MagicMock:
        return self._table(name)

    @property
    def storage(self) -> MagicMock:
        return self.client.storage.from_.return_value

    def set_token(self, *, revoked_at: str | None = None, found: bool = True) -> None:
        data = (
            {
                "id": AGENT_TOKEN_ID,
                "tenant_id": TOKEN_TENANT_ID,
                "revoked_at": revoked_at,
            }
            if found
            else None
        )
        self.table(
            "agent_tokens"
        ).select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = data

    def existing_lookup(self) -> MagicMock:
        return self.table("daily_report_files").select.return_value

    def set_existing(self, exists: bool) -> None:
        self.existing_lookup().eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = (
            [{"id": "44444444-4444-4444-4444-444444444444"}] if exists else []
        )

    def inserted_row(self) -> dict:
        insert = self.table("daily_report_files").insert
        insert.assert_called_once()
        return insert.call_args.args[0]


@pytest.mark.api
class TestPostDailyReport:
    @pytest.fixture
    def admin(self):
        mock = _AdminClientMock()
        mock.set_token()
        return mock

    @pytest.fixture(autouse=True)
    def override_dependency(self, admin):
        app.dependency_overrides[get_supabase_admin_client] = lambda: admin.client
        yield
        app.dependency_overrides = {}

    # ------------------------------------------------------------------
    # 正常系
    # ------------------------------------------------------------------

    def test_stores_file_and_records_row(self, admin):
        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 200
        assert response.json() == {"status": "stored", "sha256": CONTENT_SHA256}

        storage_path = f"{TOKEN_TENANT_ID}/{CONTENT_SHA256}.xlsx"
        admin.client.storage.from_.assert_called_with("daily-reports")
        admin.storage.upload.assert_called_once()
        upload_kwargs = admin.storage.upload.call_args.kwargs
        assert upload_kwargs["path"] == storage_path
        assert upload_kwargs["file"] == CONTENT
        assert upload_kwargs["file_options"]["upsert"] == "false"
        assert upload_kwargs["file_options"]["content-type"] == (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

        assert admin.inserted_row() == {
            "tenant_id": TOKEN_TENANT_ID,
            "agent_token_id": AGENT_TOKEN_ID,
            "sha256": CONTENT_SHA256,
            "storage_path": storage_path,
            "original_path": JP_PATH,
            "file_name": "日報_0929.xlsx",
            "size_bytes": len(CONTENT),
            "file_modified_at": "2026-09-29T17:05:12.123456+09:00",
        }

    def test_existing_lookup_is_scoped_to_token_tenant(self, admin):
        client.post(URL, headers=_headers(), content=CONTENT)

        lookup = admin.existing_lookup()
        lookup.eq.assert_called_once_with("tenant_id", TOKEN_TENANT_ID)
        lookup.eq.return_value.eq.assert_called_once_with("sha256", CONTENT_SHA256)

    def test_uppercase_sha256_header_is_accepted(self, admin):
        # PowerShell の Get-FileHash は大文字の hex を返す
        response = client.post(
            URL, headers=_headers(sha256=CONTENT_SHA256.upper()), content=CONTENT
        )

        assert response.status_code == 200
        assert response.json()["sha256"] == CONTENT_SHA256
        assert admin.inserted_row()["sha256"] == CONTENT_SHA256

    def test_modified_at_header_is_optional(self, admin):
        response = client.post(URL, headers=_headers(modified_at=None), content=CONTENT)

        assert response.status_code == 200
        assert admin.inserted_row()["file_modified_at"] is None

    def test_unparsable_modified_at_is_stored_as_null(self, admin):
        response = client.post(
            URL, headers=_headers(modified_at="2026/09/29 17:05"), content=CONTENT
        )

        assert response.status_code == 200
        assert admin.inserted_row()["file_modified_at"] is None

    # ------------------------------------------------------------------
    # 重複排除
    # ------------------------------------------------------------------

    def test_existing_row_returns_duplicate_without_upload_or_insert(self, admin):
        admin.set_existing(True)

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 200
        assert response.json() == {"status": "duplicate", "sha256": CONTENT_SHA256}
        admin.storage.upload.assert_not_called()
        admin.table("daily_report_files").insert.assert_not_called()

    def test_existing_storage_object_is_not_overwritten_and_row_is_inserted(
        self, admin
    ):
        # 前回 INSERT に失敗して Storage にだけオブジェクトが残っているケース
        admin.storage.upload.side_effect = StorageApiError(
            "The resource already exists", "Duplicate", "409"
        )

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 200
        assert response.json()["status"] == "stored"
        admin.inserted_row()

    def test_unique_violation_on_insert_returns_duplicate(self, admin):
        # 同時送信で別リクエストに先を越されたケース
        admin.table(
            "daily_report_files"
        ).insert.return_value.execute.side_effect = APIError(
            {
                "code": "23505",
                "message": "duplicate key value violates unique constraint "
                '"daily_report_files_tenant_sha256_key"',
            }
        )

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 200
        assert response.json() == {"status": "duplicate", "sha256": CONTENT_SHA256}

    # ------------------------------------------------------------------
    # テナント分離: リクエスト由来の tenant_id は無視する
    # ------------------------------------------------------------------

    def test_tenant_id_in_header_and_query_is_ignored(self, admin):
        response = client.post(
            f"{URL}?tenant_id={OTHER_TENANT_ID}",
            headers={**_headers(), "x-tenant-id": OTHER_TENANT_ID},
            content=CONTENT,
        )

        assert response.status_code == 200
        row = admin.inserted_row()
        assert row["tenant_id"] == TOKEN_TENANT_ID
        assert row["storage_path"].startswith(f"{TOKEN_TENANT_ID}/")
        assert admin.storage.upload.call_args.kwargs["path"].startswith(
            f"{TOKEN_TENANT_ID}/"
        )

    # ------------------------------------------------------------------
    # ヘッダ・ボディの検証（400）
    # ------------------------------------------------------------------

    @pytest.mark.parametrize("missing", ["X-File-Sha256", "X-File-Path"])
    def test_missing_required_header_returns_400(self, admin, missing):
        headers = _headers()
        del headers[missing]

        response = client.post(URL, headers=headers, content=CONTENT)

        assert response.status_code == 400
        assert missing in response.json()["detail"]
        admin.storage.upload.assert_not_called()

    @pytest.mark.parametrize(
        "sha256",
        ["abc", "g" * 64, CONTENT_SHA256 + "0"],
        ids=["short", "non-hex", "long"],
    )
    def test_malformed_sha256_header_returns_400(self, admin, sha256):
        response = client.post(URL, headers=_headers(sha256=sha256), content=CONTENT)

        assert response.status_code == 400
        admin.storage.upload.assert_not_called()

    def test_sha256_mismatch_returns_400(self, admin):
        other_sha256 = hashlib.sha256(b"other content").hexdigest()

        response = client.post(
            URL, headers=_headers(sha256=other_sha256), content=CONTENT
        )

        assert response.status_code == 400
        assert response.json() == {
            "detail": "X-File-Sha256 does not match the request body."
        }
        admin.storage.upload.assert_not_called()
        admin.table("daily_report_files").insert.assert_not_called()

    def test_invalid_utf8_file_path_returns_400(self, admin):
        headers = _headers()
        headers["X-File-Path"] = "%FF%FE.xlsx"

        response = client.post(URL, headers=headers, content=CONTENT)

        assert response.status_code == 400
        admin.storage.upload.assert_not_called()

    def test_file_path_without_file_name_returns_400(self, admin):
        response = client.post(
            URL, headers=_headers(path="\\\\fileserver\\共有\\"), content=CONTENT
        )

        assert response.status_code == 400

    # ------------------------------------------------------------------
    # サイズ上限（413）
    # ------------------------------------------------------------------

    def test_declared_content_length_over_limit_returns_413_before_reading(
        self, admin, monkeypatch
    ):
        monkeypatch.setattr(daily_reports, "MAX_DAILY_REPORT_BYTES", 10)
        body = b"12345"
        headers = {
            **_headers(sha256=hashlib.sha256(body).hexdigest()),
            # 実際のボディは上限以内だが、宣言値だけで弾くことを確認する
            "Content-Length": "100",
        }

        response = client.post(URL, headers=headers, content=body)

        assert response.status_code == 413
        admin.storage.upload.assert_not_called()

    def test_streamed_body_over_limit_returns_413(self, admin, monkeypatch):
        monkeypatch.setattr(daily_reports, "MAX_DAILY_REPORT_BYTES", 10)
        chunks = [b"x" * 6, b"y" * 6]
        sha256 = hashlib.sha256(b"".join(chunks)).hexdigest()

        # イテレータを渡すと httpx は Content-Length 無しのチャンク転送で送る
        response = client.post(
            URL, headers=_headers(sha256=sha256), content=iter(chunks)
        )

        assert response.status_code == 413
        admin.storage.upload.assert_not_called()
        admin.table("daily_report_files").insert.assert_not_called()

    def test_streamed_body_within_limit_is_stored(self, admin, monkeypatch):
        monkeypatch.setattr(daily_reports, "MAX_DAILY_REPORT_BYTES", 12)
        chunks = [b"x" * 6, b"y" * 6]
        body = b"".join(chunks)
        sha256 = hashlib.sha256(body).hexdigest()

        response = client.post(
            URL, headers=_headers(sha256=sha256), content=iter(chunks)
        )

        assert response.status_code == 200
        assert admin.storage.upload.call_args.kwargs["file"] == body
        assert admin.inserted_row()["size_bytes"] == 12

    # ------------------------------------------------------------------
    # 認証エラー（すべて 401・固定文言）
    # ------------------------------------------------------------------

    def test_unknown_token_returns_401(self, admin):
        admin.set_token(found=False)

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 401
        assert response.json() == {"detail": UNAUTHORIZED_DETAIL}
        admin.storage.upload.assert_not_called()

    def test_revoked_token_returns_401(self, admin):
        admin.set_token(revoked_at="2026-09-01T00:00:00+00:00")

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 401
        assert response.json() == {"detail": UNAUTHORIZED_DETAIL}
        admin.storage.upload.assert_not_called()

    def test_missing_authorization_returns_401(self, admin):
        headers = _headers()
        del headers["Authorization"]

        response = client.post(URL, headers=headers, content=CONTENT)

        assert response.status_code == 401
        assert response.json() == {"detail": UNAUTHORIZED_DETAIL}

    # ------------------------------------------------------------------
    # Storage・DB エラー（500・固定文言）
    # ------------------------------------------------------------------

    def test_storage_error_returns_fixed_message(self, admin):
        admin.storage.upload.side_effect = StorageApiError(
            "internal error at secret-internal-host", "InternalError", "500"
        )

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 500
        assert response.json() == {"detail": "Failed to store daily report."}
        assert "secret-internal-host" not in response.text
        admin.table("daily_report_files").insert.assert_not_called()

    def test_insert_error_other_than_unique_violation_returns_fixed_message(
        self, admin
    ):
        admin.table(
            "daily_report_files"
        ).insert.return_value.execute.side_effect = APIError(
            {
                "code": "23514",
                "message": 'violates check constraint "daily_report_files_sha256_check"',
            }
        )

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 500
        assert response.json() == {"detail": "Failed to store daily report."}
        assert "check constraint" not in response.text

    def test_existing_lookup_error_returns_fixed_message(self, admin):
        admin.existing_lookup().eq.return_value.eq.return_value.limit.return_value.execute.side_effect = RuntimeError(
            "connection refused: secret-internal-host"
        )

        response = client.post(URL, headers=_headers(), content=CONTENT)

        assert response.status_code == 500
        assert "secret-internal-host" not in response.text
        admin.storage.upload.assert_not_called()

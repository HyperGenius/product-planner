# __tests__/api/routers/master/test_customer_extraction_prompt_router.py
from unittest.mock import MagicMock

import anthropic
import httpx2
import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from app.routers.master import customer_extraction_prompt as router_module
from app.services.extraction_prompt_preview_service import (
    ExtractionPreview,
    ExtractionReading,
)
from app.services.pdf_order_parsing_service import LineItemReading
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from storage3.exceptions import StorageApiError

client = TestClient(app)

_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_ATTACHMENT_ID = "22222222-2222-2222-2222-222222222222"
_CUSTOMER = {"id": 7, "name": "顧客A社", "order_extraction_prompt": "今の指示"}
_ATTACHMENT = {
    "id": _ATTACHMENT_ID,
    "customer_id": 7,
    "storage_path": f"{_TENANT_ID}/inbox/msg-1/order.pdf",
    "original_filename": "注文書.pdf",
    "size_bytes": 1234,
    "created_at": "2026-10-01T00:00:00+00:00",
}


def _reading(document_order_no: str, product_id: int | None) -> ExtractionReading:
    return ExtractionReading(
        error=None,
        document_order_no=document_order_no,
        is_repair=False,
        subject=None,
        line_items=[
            LineItemReading(
                product_number_raw="A-1",
                product_name_raw="部品A",
                extracted_product_name="部品A",
                quantity=10,
                deadline_date="2026-11-01",
                certainty="confirmed",
                line_order_no=None,
                customer_order_no=document_order_no,
                product_id=product_id,
            )
        ],
        fallback=None,
    )


@pytest.mark.api
class TestCustomerExtractionPromptRouter:
    """顧客ごとの抽出指示の編集・試し読み API（Issue #602）"""

    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client):
        app.dependency_overrides[get_current_user_id] = lambda: "test-user-id"
        app.dependency_overrides[get_current_tenant_id] = lambda: _TENANT_ID
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        yield
        app.dependency_overrides = {}

    @pytest.fixture(autouse=True)
    def fresh_rate_limiter(self, monkeypatch):
        monkeypatch.setattr(
            router_module, "_preview_rate_limiter", router_module._PreviewRateLimiter()
        )

    @pytest.fixture
    def set_role(self, monkeypatch):
        def _set(role: str) -> None:
            monkeypatch.setattr(
                router_module, "get_current_user_role", lambda *_args: role
            )

        return _set

    @pytest.fixture
    def customer_found(self, monkeypatch):
        monkeypatch.setattr(router_module, "_get_customer", lambda *_args: _CUSTOMER)

    @pytest.fixture
    def attachment_found(self, monkeypatch):
        monkeypatch.setattr(
            router_module, "find_customer_pdf_attachment", lambda *_args: _ATTACHMENT
        )

    @pytest.mark.parametrize("role", ["president", "order_handler", "iso_officer"])
    def test_forbidden_for_non_platform_admin(self, headers, set_role, role):
        set_role(role)
        base = "/customers/7/extraction-prompt"

        assert client.get(base, headers=headers).status_code == 403
        assert (
            client.put(base, json={"prompt": "指示"}, headers=headers).status_code
            == 403
        )
        assert client.get(f"{base}/history", headers=headers).status_code == 403
        assert client.get(f"{base}/attachments", headers=headers).status_code == 403
        assert (
            client.post(
                f"{base}/preview",
                json={"attachment_id": _ATTACHMENT_ID, "prompt": "指示"},
                headers=headers,
            ).status_code
            == 403
        )

    def test_get_returns_current_prompt(self, headers, set_role, mock_client):
        set_role("platform_admin")
        select = mock_client.table.return_value.select.return_value
        select.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {**_CUSTOMER, "order_extraction_prompt": "  今の指示\n"}
        ]

        response = client.get("/customers/7/extraction-prompt", headers=headers)

        assert response.status_code == 200
        assert response.json() == {
            "customer_id": 7,
            "customer_name": "顧客A社",
            "prompt": "今の指示",
            "max_length": 2000,
        }
        mock_client.table.assert_called_with("customers")
        select.eq.assert_called_with("tenant_id", _TENANT_ID)
        select.eq.return_value.eq.assert_called_with("id", 7)

    def test_get_missing_customer_returns_404(self, headers, set_role, mock_client):
        set_role("platform_admin")
        select = mock_client.table.return_value.select.return_value
        select.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []

        response = client.get("/customers/7/extraction-prompt", headers=headers)

        assert response.status_code == 404

    def test_put_saves_through_rpc_with_normalized_prompt(
        self, headers, set_role, mock_client
    ):
        set_role("platform_admin")
        mock_client.rpc.return_value.execute.return_value.data = [
            {"changed": True, "saved_prompt": "新しい指示"}
        ]

        response = client.put(
            "/customers/7/extraction-prompt",
            json={"prompt": "  新しい指示 \n"},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == {"prompt": "新しい指示", "changed": True}
        mock_client.rpc.assert_called_once_with(
            "save_customer_extraction_prompt",
            {"p_tenant_id": _TENANT_ID, "p_customer_id": 7, "p_prompt": "新しい指示"},
        )

    def test_put_empty_prompt_saves_null(self, headers, set_role, mock_client):
        set_role("platform_admin")
        mock_client.rpc.return_value.execute.return_value.data = [
            {"changed": True, "saved_prompt": None}
        ]

        response = client.put(
            "/customers/7/extraction-prompt", json={"prompt": "   "}, headers=headers
        )

        assert response.status_code == 200
        assert mock_client.rpc.call_args.args[1]["p_prompt"] is None

    def test_put_rejects_too_long_prompt(self, headers, set_role, mock_client):
        set_role("platform_admin")

        response = client.put(
            "/customers/7/extraction-prompt",
            json={"prompt": "あ" * 2001},
            headers=headers,
        )

        assert response.status_code == 422
        mock_client.rpc.assert_not_called()

    @pytest.mark.parametrize(("code", "expected"), [("P0002", 404), ("42501", 403)])
    def test_put_maps_rpc_errors(self, headers, set_role, mock_client, code, expected):
        set_role("platform_admin")
        mock_client.rpc.return_value.execute.side_effect = APIError(
            {"code": code, "message": "error"}
        )

        response = client.put(
            "/customers/7/extraction-prompt", json={"prompt": "指示"}, headers=headers
        )

        assert response.status_code == expected

    def test_history_is_scoped_by_tenant_and_customer(
        self, headers, set_role, mock_client, customer_found
    ):
        set_role("platform_admin")
        select = mock_client.table.return_value.select.return_value
        select.eq.return_value.eq.return_value.order.return_value.execute.return_value.data = [
            {
                "id": 2,
                "prompt": None,
                "changed_by": "user-1",
                "changed_at": "2026-10-30T00:00:00+00:00",
            },
            {
                "id": 1,
                "prompt": "移行時点の指示",
                "changed_by": None,
                "changed_at": "2026-10-29T00:00:00+00:00",
            },
        ]

        response = client.get("/customers/7/extraction-prompt/history", headers=headers)

        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [2, 1]
        mock_client.table.assert_called_with("customer_extraction_prompt_history")
        select.eq.assert_called_with("tenant_id", _TENANT_ID)
        select.eq.return_value.eq.assert_called_with("customer_id", 7)
        select.eq.return_value.eq.return_value.order.assert_called_with("id", desc=True)

    def test_attachments_lists_customer_pdfs(
        self, headers, set_role, mock_client, customer_found, monkeypatch
    ):
        set_role("platform_admin")
        calls = []

        def _list(db, tenant_id, customer_id):
            calls.append((tenant_id, customer_id))
            return [_ATTACHMENT]

        monkeypatch.setattr(router_module, "list_customer_pdf_attachments", _list)

        response = client.get(
            "/customers/7/extraction-prompt/attachments", headers=headers
        )

        assert response.status_code == 200
        assert response.json() == [
            {
                "id": _ATTACHMENT_ID,
                "original_filename": "注文書.pdf",
                "size_bytes": 1234,
                "received_at": "2026-10-01T00:00:00Z",
            }
        ]
        assert calls == [(_TENANT_ID, 7)]

    def test_preview_returns_both_readings(
        self, headers, set_role, customer_found, attachment_found, monkeypatch
    ):
        set_role("platform_admin")
        received: dict[str, object] = {}

        def _preview(db, tenant_id, customer_id, attachment, current, edited):
            received.update(
                tenant_id=tenant_id,
                customer_id=customer_id,
                attachment=attachment,
                current=current,
                edited=edited,
            )
            return ExtractionPreview(
                source="text",
                unreadable_reason=None,
                current=_reading("C100", 42),
                edited=_reading("C200", None),
                same_prompt=False,
                products={42: {"id": 42, "code": "A-1", "name": "部品A"}},
            )

        monkeypatch.setattr(router_module, "preview_extraction", _preview)

        response = client.post(
            "/customers/7/extraction-prompt/preview",
            json={"attachment_id": _ATTACHMENT_ID, "prompt": " 新しい指示 "},
            headers=headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert received == {
            "tenant_id": _TENANT_ID,
            "customer_id": 7,
            "attachment": _ATTACHMENT,
            "current": "今の指示",
            "edited": "新しい指示",
        }
        assert body["source"] == "text"
        assert body["current"]["document_order_no"] == "C100"
        assert body["current"]["line_items"][0]["product"] == {
            "id": 42,
            "code": "A-1",
            "name": "部品A",
        }
        assert body["edited"]["line_items"][0]["product"] is None
        assert body["edited"]["line_items"][0]["invalid_quantity"] is False

    def test_preview_rejects_attachment_of_other_customer(
        self, headers, set_role, customer_found, monkeypatch
    ):
        set_role("platform_admin")
        received = []
        monkeypatch.setattr(
            router_module,
            "find_customer_pdf_attachment",
            lambda db, tenant_id, customer_id, attachment_id: received.append(
                (tenant_id, customer_id, attachment_id)
            ),
        )
        preview = MagicMock()
        monkeypatch.setattr(router_module, "preview_extraction", preview)

        response = client.post(
            "/customers/7/extraction-prompt/preview",
            json={"attachment_id": _ATTACHMENT_ID, "prompt": "指示"},
            headers=headers,
        )

        assert response.status_code == 404
        assert received == [(_TENANT_ID, 7, _ATTACHMENT_ID)]
        preview.assert_not_called()

    def test_preview_is_rate_limited_per_tenant(
        self, headers, set_role, customer_found, attachment_found, monkeypatch
    ):
        set_role("platform_admin")
        monkeypatch.setattr(router_module, "_PREVIEW_RATE_LIMIT", 2)
        monkeypatch.setattr(
            router_module,
            "preview_extraction",
            lambda *_args: ExtractionPreview(
                source=None,
                unreadable_reason="failed_encrypted",
                current=None,
                edited=None,
                same_prompt=False,
                products={},
            ),
        )
        payload = {"attachment_id": _ATTACHMENT_ID, "prompt": "指示"}
        url = "/customers/7/extraction-prompt/preview"

        assert client.post(url, json=payload, headers=headers).status_code == 200
        assert client.post(url, json=payload, headers=headers).status_code == 200
        response = client.post(url, json=payload, headers=headers)

        assert response.status_code == 429
        assert response.json()["detail"]["error"] == "preview_rate_limited"

    def test_preview_maps_claude_api_failure_to_503(
        self, headers, set_role, customer_found, attachment_found, monkeypatch
    ):
        set_role("platform_admin")

        def _fail(*_args):
            raise anthropic.APIConnectionError(
                request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
            )

        monkeypatch.setattr(router_module, "preview_extraction", _fail)

        response = client.post(
            "/customers/7/extraction-prompt/preview",
            json={"attachment_id": _ATTACHMENT_ID, "prompt": "指示"},
            headers=headers,
        )

        assert response.status_code == 503
        assert response.json()["detail"] == {
            "error": "extraction_unavailable",
            "message": "読み取りに失敗しました。時間をおいて試してください",
        }

    def test_preview_maps_download_failure_to_502(
        self, headers, set_role, customer_found, attachment_found, monkeypatch
    ):
        set_role("platform_admin")

        def _fail(*_args):
            raise StorageApiError("Object not found", "NoSuchKey", 404)

        monkeypatch.setattr(router_module, "preview_extraction", _fail)

        response = client.post(
            "/customers/7/extraction-prompt/preview",
            json={"attachment_id": _ATTACHMENT_ID, "prompt": "指示"},
            headers=headers,
        )

        assert response.status_code == 502
        assert response.json()["detail"]["error"] == "attachment_download_failed"

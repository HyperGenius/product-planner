# __tests__/api/routers/transaction/test_notifications.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import get_supabase_admin_client, get_supabase_client
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

TENANT_ID = "11111111-1111-1111-1111-111111111111"


def _query_mock(data):
    """`.table(...).select(...).eq(...)...execute()` のチェーンをモックする"""
    query = MagicMock()
    query.select.return_value = query
    query.eq.return_value = query
    query.in_.return_value = query
    query.order.return_value = query
    query.limit.return_value = query
    query.is_.return_value = query
    query.update.return_value = query
    query.execute.return_value = MagicMock(data=data)
    return query


@pytest.mark.api
class TestNotificationsRouter:
    """notificationsルーターのユニットテスト（N+1回避の確認を含む）"""

    @pytest.fixture(autouse=True)
    def override_dependency(self):
        app.dependency_overrides = {}
        try:
            yield
        finally:
            app.dependency_overrides = {}

    def test_get_notifications_resolves_link_urls_without_n_plus_one(self):
        notification_rows = [
            {
                "id": "n1",
                "tenant_id": TENANT_ID,
                "notif_type": "no_product_match",
                "source_table": "order_parse_log",
                "source_id": "log-1",
                "detail": None,
                "read_at": None,
                "created_at": "2026-07-22T00:00:00+00:00",
            },
            {
                "id": "n2",
                "tenant_id": TENANT_ID,
                "notif_type": "attachment_added",
                "source_table": "order_attachments",
                "source_id": "att-2",
                "detail": None,
                "read_at": None,
                "created_at": "2026-07-22T00:01:00+00:00",
            },
            {
                "id": "n3",
                "tenant_id": TENANT_ID,
                "notif_type": "non_order_email",
                "source_table": "gmail_message",
                "source_id": "gmail-3",
                "detail": None,
                "read_at": None,
                "created_at": "2026-07-22T00:02:00+00:00",
            },
            {
                "id": "n4",
                "tenant_id": TENANT_ID,
                "notif_type": "no_product_match",
                "source_table": "order_parse_log",
                "source_id": None,
                "detail": None,
                "read_at": None,
                "created_at": "2026-07-22T00:03:00+00:00",
            },
            {
                "id": "n5",
                "tenant_id": TENANT_ID,
                "notif_type": "approval_requested",
                "source_table": "orders",
                "source_id": "42",
                "detail": {"order_no": "ORD-042"},
                "read_at": None,
                "created_at": "2026-07-22T00:04:00+00:00",
            },
            {
                "id": "n6",
                "tenant_id": TENANT_ID,
                "notif_type": "approval_requested",
                "source_table": "orders",
                "source_id": "../not-a-valid-order-id",
                "detail": None,
                "read_at": None,
                "created_at": "2026-07-22T00:05:00+00:00",
            },
        ]

        mock_client = MagicMock()
        mock_client.table.return_value = _query_mock(notification_rows)

        mock_admin_client = MagicMock()

        def table_side_effect(table_name):
            if table_name == "order_parse_log":
                return _query_mock([{"id": "log-1", "order_attachment_id": "att-1"}])
            if table_name == "order_attachments":
                return _query_mock(
                    [
                        {"id": "att-1", "storage_path": "tenant/att-1.pdf"},
                        {"id": "att-2", "storage_path": "tenant/att-2.pdf"},
                    ]
                )
            raise AssertionError(f"unexpected table: {table_name}")

        mock_admin_client.table.side_effect = table_side_effect
        mock_admin_client.storage.from_.return_value.create_signed_urls.return_value = [
            {
                "path": "tenant/att-1.pdf",
                "signedURL": "https://example.com/signed/att-1.pdf",
                "error": None,
            },
            {
                "path": "tenant/att-2.pdf",
                "signedURL": "https://example.com/signed/att-2.pdf",
                "error": None,
            },
        ]

        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        app.dependency_overrides[get_supabase_admin_client] = lambda: mock_admin_client

        response = client.get(
            "/notifications",
            headers={"Authorization": "Bearer dummy", "x-tenant-id": TENANT_ID},
        )

        assert response.status_code == 200
        body = {row["id"]: row for row in response.json()}
        assert body["n1"]["link_url"] == "https://example.com/signed/att-1.pdf"
        assert body["n2"]["link_url"] == "https://example.com/signed/att-2.pdf"
        assert body["n3"]["link_url"] == "https://mail.google.com/mail/u/0/#all/gmail-3"
        assert body["n4"]["link_url"] is None
        assert body["n5"]["link_url"] == "/orders/42"
        assert body["n6"]["link_url"] is None

        # order_parse_log / order_attachments への問い合わせが通知件数分ではなく
        # 1回ずつ（バッチ）にまとまっていること（N+1回避の確認）
        parse_log_calls = [
            c
            for c in mock_admin_client.table.call_args_list
            if c.args[0] == "order_parse_log"
        ]
        attachment_calls = [
            c
            for c in mock_admin_client.table.call_args_list
            if c.args[0] == "order_attachments"
        ]
        assert len(parse_log_calls) == 1
        assert len(attachment_calls) == 1

        # 署名付きURL生成もまとめて1回のバッチ呼び出しであること
        mock_admin_client.storage.from_.return_value.create_signed_urls.assert_called_once()
        called_paths = mock_admin_client.storage.from_.return_value.create_signed_urls.call_args.kwargs[
            "paths"
        ]
        assert set(called_paths) == {"tenant/att-1.pdf", "tenant/att-2.pdf"}

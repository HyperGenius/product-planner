"""
Integration テスト: notifications の RLS / IDOR 修正 (Issue #256, 元Issue #254)

以下は実際の Postgres (RLS込み) でしか検証できないため integration tier に置く。
- notifications テーブルの RLS ポリシー (SELECTのみ許可、書き込みはデフォルト拒否)
- GET /notifications の `_resolve_link_url` における他テナント参照のIDOR修正
  (commit 868a45f, admin_client クエリへの tenant_id 条件漏れ)
- PATCH /notifications/read の admin_client 経由更新が自テナント行のみを対象にすること

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_notifications_rls.py -v --run-integration
"""

from typing import Any, cast

import pytest
from app.main import app
from app.routers.transaction.notifications import _resolve_link_urls
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

client = TestClient(app)


@pytest.fixture()
def notif_tenants(admin_db, auth_user_id):
    """
    ログインユーザーが所属する own テナントと、所属しない other テナントを作成する。
    IDOR検証用に、各テナントに order/order_attachments/order_parse_log も用意する。
    """
    own = (
        admin_db.table("tenants")
        .insert({"name": "integration test notif tenant (own)"})
        .execute()
    )
    own_id = cast(list[dict[str, Any]], own.data)[0]["id"]

    other = (
        admin_db.table("tenants")
        .insert({"name": "integration test notif tenant (other)"})
        .execute()
    )
    other_id = cast(list[dict[str, Any]], other.data)[0]["id"]

    admin_db.table("organization_members").insert(
        {"user_id": auth_user_id, "tenant_id": own_id}
    ).execute()

    def _make_attachment(tenant_id: str) -> str:
        order = (
            admin_db.table("orders")
            .insert({"tenant_id": tenant_id, "quantity": 1})
            .execute()
        )
        order_id = cast(list[dict[str, Any]], order.data)[0]["id"]
        storage_path = f"{tenant_id}/orders/{order_id}/test.pdf"
        attachment = (
            admin_db.table("order_attachments")
            .insert(
                {
                    "order_id": order_id,
                    "tenant_id": tenant_id,
                    "storage_path": storage_path,
                    "original_filename": "test.pdf",
                }
            )
            .execute()
        )
        return cast(list[dict[str, Any]], attachment.data)[0]["id"]

    own_attachment_id = _make_attachment(own_id)
    other_attachment_id = _make_attachment(other_id)

    other_log = (
        admin_db.table("order_parse_log")
        .insert(
            {
                "tenant_id": other_id,
                "order_attachment_id": other_attachment_id,
                "reason": "no_product_match",
                "detail": {},
            }
        )
        .execute()
    )
    other_log_id = cast(list[dict[str, Any]], other_log.data)[0]["id"]

    yield {
        "own_id": own_id,
        "other_id": other_id,
        "own_attachment_id": own_attachment_id,
        "other_attachment_id": other_attachment_id,
        "other_log_id": other_log_id,
    }

    admin_db.table("notifications").delete().eq("tenant_id", own_id).execute()
    admin_db.table("notifications").delete().eq("tenant_id", other_id).execute()
    admin_db.table("order_parse_log").delete().eq("tenant_id", own_id).execute()
    admin_db.table("order_parse_log").delete().eq("tenant_id", other_id).execute()
    admin_db.table("order_attachments").delete().eq("tenant_id", own_id).execute()
    admin_db.table("order_attachments").delete().eq("tenant_id", other_id).execute()
    admin_db.table("orders").delete().eq("tenant_id", own_id).execute()
    admin_db.table("orders").delete().eq("tenant_id", other_id).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", own_id
    ).execute()
    admin_db.table("tenants").delete().eq("id", own_id).execute()
    admin_db.table("tenants").delete().eq("id", other_id).execute()


@pytest.mark.integration
class TestNotificationsRls:
    def test_own_tenant_notification_is_visible(
        self, auth_token, admin_db, notif_tenants
    ):
        admin_db.table("notifications").insert(
            {
                "tenant_id": notif_tenants["own_id"],
                "notif_type": "non_order_email",
                "source_table": "gmail_message",
                "source_id": "msg-own-visible",
            }
        ).execute()

        res = client.get(
            "/notifications",
            headers={
                "Authorization": f"Bearer {auth_token}",
                "x-tenant-id": notif_tenants["own_id"],
            },
        )
        assert res.status_code == 200
        source_ids = [n["source_id"] for n in res.json()]
        assert "msg-own-visible" in source_ids

    def test_other_tenant_notification_is_not_visible(
        self, auth_token, admin_db, notif_tenants
    ):
        """所属していないテナントの通知はRLS (SELECT: is_tenant_member)により見えない"""
        admin_db.table("notifications").insert(
            {
                "tenant_id": notif_tenants["other_id"],
                "notif_type": "non_order_email",
                "source_table": "gmail_message",
                "source_id": "msg-other-hidden",
            }
        ).execute()

        res = client.get(
            "/notifications",
            headers={
                "Authorization": f"Bearer {auth_token}",
                "x-tenant-id": notif_tenants["own_id"],
            },
        )
        assert res.status_code == 200
        source_ids = [n["source_id"] for n in res.json()]
        assert "msg-other-hidden" not in source_ids

    def test_notification_of_other_membership_is_not_mixed_in(
        self, auth_token, admin_db, auth_user_id, notif_tenants
    ):
        """
        ユーザーが own/other 両テナントに所属する場合の回帰テスト。
        is_tenant_member(tenant_id) は所属する全テナントの行を許可するため、
        x-tenant-id で明示的に絞り込まないと other テナントの通知が
        own テナント選択時の一覧に混ざってしまう。
        """
        admin_db.table("organization_members").insert(
            {"user_id": auth_user_id, "tenant_id": notif_tenants["other_id"]}
        ).execute()
        try:
            admin_db.table("notifications").insert(
                {
                    "tenant_id": notif_tenants["other_id"],
                    "notif_type": "non_order_email",
                    "source_table": "gmail_message",
                    "source_id": "msg-other-membership-hidden",
                }
            ).execute()

            res = client.get(
                "/notifications",
                headers={
                    "Authorization": f"Bearer {auth_token}",
                    "x-tenant-id": notif_tenants["own_id"],
                },
            )
            assert res.status_code == 200
            source_ids = [n["source_id"] for n in res.json()]
            assert "msg-other-membership-hidden" not in source_ids
        finally:
            admin_db.table("organization_members").delete().eq(
                "user_id", auth_user_id
            ).eq("tenant_id", notif_tenants["other_id"]).execute()

    def test_direct_insert_via_user_jwt_is_rejected(
        self, real_supabase_client, notif_tenants
    ):
        """
        notifications はSELECTポリシーのみでINSERT/UPDATE/DELETEにポリシーが
        無い（デフォルト拒否）。以前の FOR ALL ポリシーからの回帰確認。
        """
        with pytest.raises(APIError):
            real_supabase_client.table("notifications").insert(
                {
                    "tenant_id": notif_tenants["own_id"],
                    "notif_type": "non_order_email",
                    "source_table": "gmail_message",
                    "source_id": "spy-insert-attempt",
                }
            ).execute()

    def test_direct_update_via_user_jwt_is_rejected(
        self, real_supabase_client, admin_db, notif_tenants
    ):
        created = (
            admin_db.table("notifications")
            .insert(
                {
                    "tenant_id": notif_tenants["own_id"],
                    "notif_type": "non_order_email",
                    "source_table": "gmail_message",
                    "source_id": "spy-update-attempt",
                }
            )
            .execute()
        )
        notif_id = cast(list[dict[str, Any]], created.data)[0]["id"]

        result = (
            real_supabase_client.table("notifications")
            .update({"read_at": "2026-01-01T00:00:00Z"})
            .eq("id", notif_id)
            .execute()
        )
        assert result.data == []

        row = (
            admin_db.table("notifications")
            .select("read_at")
            .eq("id", notif_id)
            .single()
            .execute()
            .data
        )
        assert row["read_at"] is None


def _resolve_single(admin_db, tenant_id, notif_type, source_table, source_id):
    """_resolve_link_urls（バッチ版）を単一通知向けに呼び出すテスト用ヘルパー"""
    notif_id = "test-notif-id"
    row = {
        "id": notif_id,
        "notif_type": notif_type,
        "source_table": source_table,
        "source_id": source_id,
    }
    return _resolve_link_urls(admin_db, tenant_id, [row]).get(notif_id)


@pytest.mark.integration
class TestResolveLinkUrlIdorFix:
    """
    GET /notifications の `_resolve_link_urls`（バッチ化前は `_resolve_link_url`、
    commit 868a45f でIDOR修正）の回帰テスト。
    admin_client(Service Role Key, RLSバイパス) を使うため、notifications 行
    自身の tenant_id を必ず条件に含めないと、source_id 経由で他テナントの
    order_parse_log / order_attachments を参照できてしまう。
    """

    def test_order_attachments_source_in_other_tenant_resolves_to_none(
        self, admin_db, notif_tenants
    ):
        link_url = _resolve_single(
            admin_db,
            notif_tenants["own_id"],
            "no_product_match",
            "order_attachments",
            notif_tenants["other_attachment_id"],
        )
        assert link_url is None

    def test_order_parse_log_source_in_other_tenant_resolves_to_none(
        self, admin_db, notif_tenants
    ):
        link_url = _resolve_single(
            admin_db,
            notif_tenants["own_id"],
            "no_product_match",
            "order_parse_log",
            notif_tenants["other_log_id"],
        )
        assert link_url is None

    def test_order_attachments_source_in_own_tenant_resolves(
        self, admin_db, notif_tenants, monkeypatch
    ):
        """
        自テナントの場合は正しく storage_path が見つかり、署名付きURL生成まで
        到達すること。実際の署名付きURL生成（Storage側の可用性）はこのIDOR修正
        とは無関係なので create_signed_urls（バッチ版）はスタブ化し、DBクエリ側の
        挙動（tenant_id条件つきの照合が正しくヒットすること）だけを検証する。
        """
        monkeypatch.setattr(
            "app.routers.transaction.notifications.create_signed_urls",
            lambda _client, storage_paths, **_kwargs: {
                path: f"https://signed.example/{path}" for path in storage_paths
            },
        )
        link_url = _resolve_single(
            admin_db,
            notif_tenants["own_id"],
            "no_product_match",
            "order_attachments",
            notif_tenants["own_attachment_id"],
        )
        assert link_url is not None
        assert link_url.startswith("https://signed.example/")

    def test_non_order_email_builds_gmail_link_without_query(self, admin_db):
        """non_order_email はDBを引かずsource_idからGmailリンクを直接組み立てる"""
        link_url = _resolve_single(
            admin_db,
            "irrelevant-tenant-id",
            "non_order_email",
            "gmail_message",
            "msg-123",
        )
        assert link_url == "https://mail.google.com/mail/u/0/#all/msg-123"


@pytest.mark.integration
class TestMarkNotificationsReadScope:
    def test_marks_only_own_tenant_unread_notifications(
        self, auth_token, admin_db, notif_tenants
    ):
        own_notif = (
            admin_db.table("notifications")
            .insert(
                {
                    "tenant_id": notif_tenants["own_id"],
                    "notif_type": "non_order_email",
                    "source_table": "gmail_message",
                    "source_id": "msg-own-unread",
                }
            )
            .execute()
        )
        own_notif_id = cast(list[dict[str, Any]], own_notif.data)[0]["id"]

        other_notif = (
            admin_db.table("notifications")
            .insert(
                {
                    "tenant_id": notif_tenants["other_id"],
                    "notif_type": "non_order_email",
                    "source_table": "gmail_message",
                    "source_id": "msg-other-unread",
                }
            )
            .execute()
        )
        other_notif_id = cast(list[dict[str, Any]], other_notif.data)[0]["id"]

        res = client.patch(
            "/notifications/read",
            headers={
                "Authorization": f"Bearer {auth_token}",
                "x-tenant-id": notif_tenants["own_id"],
            },
        )
        assert res.status_code == 200

        own_row = (
            admin_db.table("notifications")
            .select("read_at")
            .eq("id", own_notif_id)
            .single()
            .execute()
            .data
        )
        other_row = (
            admin_db.table("notifications")
            .select("read_at")
            .eq("id", other_notif_id)
            .single()
            .execute()
            .data
        )
        assert own_row["read_at"] is not None
        assert other_row["read_at"] is None

    def test_second_call_does_not_change_already_read_notification(
        self, auth_token, admin_db, notif_tenants
    ):
        notif = (
            admin_db.table("notifications")
            .insert(
                {
                    "tenant_id": notif_tenants["own_id"],
                    "notif_type": "non_order_email",
                    "source_table": "gmail_message",
                    "source_id": "msg-own-idempotent",
                }
            )
            .execute()
        )
        notif_id = cast(list[dict[str, Any]], notif.data)[0]["id"]
        headers = {
            "Authorization": f"Bearer {auth_token}",
            "x-tenant-id": notif_tenants["own_id"],
        }

        client.patch("/notifications/read", headers=headers)
        first_read_at = (
            admin_db.table("notifications")
            .select("read_at")
            .eq("id", notif_id)
            .single()
            .execute()
            .data["read_at"]
        )
        assert first_read_at is not None

        client.patch("/notifications/read", headers=headers)
        second_read_at = (
            admin_db.table("notifications")
            .select("read_at")
            .eq("id", notif_id)
            .single()
            .execute()
            .data["read_at"]
        )
        assert second_read_at == first_read_at

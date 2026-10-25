"""
Integration テスト: メール起票の Slack 通知が引く行（Issue #574）

未通知の行の絞り込み（Gmail 受信のステージング行だけ・処理済み／滞留・通知済みの除外）は
PostgREST のクエリチェーン（`.not_.is_()` 等）が意図通りの SQL になるかに依存するため、実 DB で確かめる。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_email_intake_slack_queries.py -v --run-integration
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from app.services import email_intake_slack_service as service

NOW = datetime.now(UTC)


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data or [])


@pytest.fixture()
def staging(admin_db):
    """テスト用テナントに、通知の対象・対象外のステージング行を用意する。"""
    tenant = _rows(
        admin_db.table("tenants")
        .insert({"name": f"integration test email intake slack ({uuid.uuid4()})"})
        .execute()
    )[0]
    tenant_id = tenant["id"]

    def _insert(key: str, **values: Any) -> str:
        row = {
            "tenant_id": tenant_id,
            "order_id": None,
            "gmail_message_id": f"msg-{key}-{uuid.uuid4()}",
            "storage_path": "",
            "original_filename": "",
            "parse_status": "success",
            **values,
        }
        return _rows(admin_db.table("order_attachments").insert(row).execute())[0]["id"]

    old = (NOW - timedelta(hours=2)).isoformat()
    ids = {
        "finished": _insert("finished"),
        "failed": _insert("failed", parse_status="failed_no_attachment"),
        "already_notified": _insert("notified", slack_notified_at=NOW.isoformat()),
        # 手入力の「メール起票」（Issue #358）は gmail_message_id が無い
        "manual": _insert("manual", gmail_message_id=None),
        "pending_recent": _insert("pending_recent", parse_status="pending"),
        "pending_old": _insert("pending_old", parse_status="pending", created_at=old),
        "pending_old_notified": _insert(
            "pending_old_notified",
            parse_status="pending",
            created_at=old,
            slack_stalled_notified_at=NOW.isoformat(),
        ),
    }
    order_ids = [
        _rows(
            admin_db.table("orders")
            .insert({"tenant_id": tenant_id, "source_attachment_id": ids["finished"]})
            .execute()
        )[0]["id"]
        for _ in range(2)
    ]
    admin_db.table("order_parse_log").insert(
        {
            "tenant_id": tenant_id,
            "order_attachment_id": ids["finished"],
            "reason": "no_product_match",
        }
    ).execute()

    try:
        yield {"tenant_id": tenant_id, "tenant_name": tenant["name"], "ids": ids}
    finally:
        admin_db.table("order_parse_log").delete().eq("tenant_id", tenant_id).execute()
        admin_db.table("orders").delete().in_("id", order_ids).execute()
        admin_db.table("order_attachments").delete().eq(
            "tenant_id", tenant_id
        ).execute()
        admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _own_ids(rows: list[dict[str, Any]], tenant_id: str) -> set[str]:
    # 開発中のローカル DB には他テナントの未通知の行もありうるので、テスト用テナントに絞る
    return {row["id"] for row in rows if row["tenant_id"] == tenant_id}


@pytest.mark.integration
class TestEmailIntakeSlackQueries:
    def test_fetches_unnotified_rows_and_marks_them(self, admin_db, staging):
        tenant_id = staging["tenant_id"]
        ids = staging["ids"]

        finished = service._fetch_unnotified_finished_rows(admin_db)
        stalled = service._fetch_unnotified_stalled_rows(
            admin_db, NOW - service.STALLED_AFTER
        )
        assert _own_ids(finished, tenant_id) == {ids["finished"], ids["failed"]}
        assert _own_ids(stalled, tenant_id) == {ids["pending_old"]}

        finished_ids = [ids["finished"], ids["failed"]]
        assert service._count_orders_by_attachment(admin_db, finished_ids) == {
            ids["finished"]: 2
        }
        assert service._fetch_reasons_by_attachment(admin_db, finished_ids) == {
            ids["finished"]: ["no_product_match"]
        }
        assert service._fetch_tenant_names(admin_db, [tenant_id]) == {
            tenant_id: staging["tenant_name"]
        }

        service._mark_notified(admin_db, "slack_notified_at", finished_ids, NOW)
        service._mark_notified(
            admin_db, "slack_stalled_notified_at", [ids["pending_old"]], NOW
        )

        assert (
            _own_ids(service._fetch_unnotified_finished_rows(admin_db), tenant_id)
            == set()
        )
        assert (
            _own_ids(
                service._fetch_unnotified_stalled_rows(
                    admin_db, NOW - service.STALLED_AFTER
                ),
                tenant_id,
            )
            == set()
        )

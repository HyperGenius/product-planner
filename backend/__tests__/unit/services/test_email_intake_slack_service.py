# __tests__/unit/services/test_email_intake_slack_service.py
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from app.services import email_intake_slack_service as service
from app.services.email_intake_slack_service import (
    SlackNotifyError,
    TenantIntakeCounts,
    build_slack_message,
    notify_email_intake_slack,
    summarize_email_intakes,
)

WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/secret-token"
APP_BASE_URL = "https://app.example.com"
# 2026-10-25 09:15 JST
NOW = datetime(2026, 10, 25, 0, 15, tzinfo=UTC)


def _row(row_id: str, tenant_id: str = "t1", parse_status: str = "success"):
    return {"id": row_id, "tenant_id": tenant_id, "parse_status": parse_status}


@pytest.mark.unit
class TestSummarizeEmailIntakes:
    """未通知の行をテナントごとの件数に集計する（Issue #574）"""

    def test_counts_created_attention_failed_and_stalled(self):
        finished = [
            _row("a1"),
            _row("a2"),
            _row("a3"),
            _row("a4"),
        ]
        stalled = [_row("p1", parse_status="pending")]
        order_counts = {"a1": 2, "a2": 3}
        reasons = {"a2": ["no_product_match"], "a3": ["failed_no_attachment"]}

        counts = summarize_email_intakes(finished, stalled, order_counts, reasons)

        # a4 は起票0件・理由なしのスキップなので件数に出ない
        assert counts == {
            "t1": TenantIntakeCounts(
                created_emails=2,
                created_orders=5,
                needs_attention=1,
                failed=1,
                stalled=1,
            )
        }

    def test_empty_draft_is_failed_without_order_count(self):
        # 読み取り不能PDFは空の下書きが1件起票されるが、失敗として数える（受信メール処理結果と同じ）
        counts = summarize_email_intakes(
            [_row("a1")], [], {"a1": 1}, {"a1": ["failed_image"]}
        )
        assert counts == {"t1": TenantIntakeCounts(failed=1)}

    def test_tenant_with_only_skipped_is_excluded(self):
        counts = summarize_email_intakes(
            [_row("a1", tenant_id="t1"), _row("a2", tenant_id="t2")],
            [],
            {"a2": 1},
            {"a1": ["non_order_email"]},
        )
        assert set(counts) == {"t2"}

    def test_stalled_only_tenant_is_included(self):
        counts = summarize_email_intakes(
            [], [_row("p1", tenant_id="t2", parse_status="pending")], {}, {}
        )
        assert counts == {"t2": TenantIntakeCounts(stalled=1)}


@pytest.mark.unit
class TestBuildSlackMessage:
    """件数とリンクだけのメッセージを組み立てる（Issue #574）"""

    def test_lines_per_tenant_sorted_by_name_with_link(self):
        counts = {
            "t2": TenantIntakeCounts(created_emails=1, created_orders=1, stalled=1),
            "t1": TenantIntakeCounts(
                created_emails=3, created_orders=7, needs_attention=1, failed=1
            ),
        }
        message = build_slack_message(
            counts, {"t1": "テナントA", "t2": "テナントB"}, APP_BASE_URL + "/", NOW
        )
        assert message == (
            "📨 メール起票（10/25 09:15）\n"
            "・テナントA：起票 3通（受注 7件）／うち要確認 1通／失敗 1通\n"
            "・テナントB：起票 1通（受注 1件）／処理待ちの滞留 1通\n"
            "詳細 → https://app.example.com/orders/email-intake"
        )

    def test_escapes_tenant_name_and_falls_back_to_id(self):
        counts = {
            "t1": TenantIntakeCounts(failed=1),
            "t2": TenantIntakeCounts(failed=1),
        }
        message = build_slack_message(counts, {"t1": "A&B <x>"}, APP_BASE_URL, NOW)
        assert "・A&amp;B &lt;x&gt;：失敗 1通" in message
        assert "・t2：失敗 1通" in message


@pytest.fixture
def stub_queries(monkeypatch):
    """DB の読み書きを差し替え、通知済みにした列と行を記録する。"""
    state: dict[str, Any] = {
        "finished": [],
        "stalled": [],
        "order_counts": {},
        "reasons": {},
        "marked": [],
        "posted": [],
    }
    monkeypatch.setattr(
        service, "_fetch_unnotified_finished_rows", lambda db: state["finished"]
    )
    monkeypatch.setattr(
        service, "_fetch_unnotified_stalled_rows", lambda db, before: state["stalled"]
    )
    monkeypatch.setattr(
        service, "_count_orders_by_attachment", lambda db, ids: state["order_counts"]
    )
    monkeypatch.setattr(
        service, "_fetch_reasons_by_attachment", lambda db, ids: state["reasons"]
    )
    monkeypatch.setattr(
        service, "_fetch_tenant_names", lambda db, ids: {"t1": "テナントA"}
    )
    monkeypatch.setattr(
        service,
        "_mark_notified",
        lambda db, column, ids, now: state["marked"].append((column, ids)),
    )
    monkeypatch.setattr(
        service,
        "_post_to_slack",
        lambda url, text: state["posted"].append((url, text)),
    )
    monkeypatch.setenv("SLACK_WEBHOOK_URL", WEBHOOK_URL)
    monkeypatch.setenv("APP_BASE_URL", APP_BASE_URL)
    return state


@pytest.mark.unit
class TestNotifyEmailIntakeSlack:
    """送信に成功したときだけ通知済みにする（Issue #574）"""

    @pytest.mark.parametrize("missing", ["SLACK_WEBHOOK_URL", "APP_BASE_URL"])
    def test_disabled_without_env(self, stub_queries, monkeypatch, missing):
        monkeypatch.delenv(missing)
        stub_queries["finished"] = [_row("a1")]

        result = notify_email_intake_slack(MagicMock(), now=NOW)

        assert result == {"enabled": False, "sent": False, "finished": 0, "stalled": 0}
        assert stub_queries["posted"] == []
        assert stub_queries["marked"] == []

    def test_sends_and_marks_finished_and_stalled(self, stub_queries):
        stub_queries["finished"] = [_row("a1"), _row("a2")]
        stub_queries["stalled"] = [_row("p1", parse_status="pending")]
        stub_queries["order_counts"] = {"a1": 2}

        result = notify_email_intake_slack(MagicMock(), now=NOW)

        assert result == {"enabled": True, "sent": True, "finished": 2, "stalled": 1}
        [(url, text)] = stub_queries["posted"]
        assert url == WEBHOOK_URL
        assert "・テナントA：起票 1通（受注 2件）／処理待ちの滞留 1通" in text
        assert stub_queries["marked"] == [
            ("slack_notified_at", ["a1", "a2"]),
            ("slack_stalled_notified_at", ["p1"]),
        ]

    def test_marks_without_sending_when_nothing_to_report(self, stub_queries):
        stub_queries["finished"] = [_row("a1")]
        stub_queries["reasons"] = {"a1": ["non_order_email"]}

        result = notify_email_intake_slack(MagicMock(), now=NOW)

        assert result == {"enabled": True, "sent": False, "finished": 1, "stalled": 0}
        assert stub_queries["posted"] == []
        assert stub_queries["marked"] == [
            ("slack_notified_at", ["a1"]),
            ("slack_stalled_notified_at", []),
        ]

    def test_does_not_mark_when_send_fails(self, stub_queries, monkeypatch):
        stub_queries["finished"] = [_row("a1")]
        stub_queries["order_counts"] = {"a1": 1}

        def fail(url, text):
            raise SlackNotifyError("Slack webhook request failed")

        monkeypatch.setattr(service, "_post_to_slack", fail)

        with pytest.raises(SlackNotifyError):
            notify_email_intake_slack(MagicMock(), now=NOW)
        assert stub_queries["marked"] == []


@pytest.mark.unit
class TestPostToSlack:
    """webhook URL を例外・ログに残さない（Issue #574）"""

    def test_posts_text_as_json(self, monkeypatch):
        calls: list[tuple[str, dict[str, Any]]] = []

        def fake_post(url, json, timeout):
            calls.append((url, json))
            return httpx.Response(200, text="ok", request=httpx.Request("POST", url))

        monkeypatch.setattr(service.httpx, "post", fake_post)
        service._post_to_slack(WEBHOOK_URL, "hello")
        assert calls == [(WEBHOOK_URL, {"text": "hello"})]

    @pytest.mark.parametrize("failure", ["status", "network"])
    def test_failure_raises_without_webhook_url(self, monkeypatch, caplog, failure):
        def fake_post(url, json, timeout):
            request = httpx.Request("POST", url)
            if failure == "network":
                raise httpx.ConnectTimeout(f"timed out: {url}", request=request)
            return httpx.Response(404, text="no_service", request=request)

        monkeypatch.setattr(service.httpx, "post", fake_post)

        with pytest.raises(SlackNotifyError) as exc_info:
            service._post_to_slack(WEBHOOK_URL, "hello")

        assert "secret-token" not in str(exc_info.value)
        assert exc_info.value.__cause__ is None
        assert exc_info.value.__suppress_context__
        assert "secret-token" not in caplog.text

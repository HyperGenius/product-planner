# __tests__/unit/services/test_cron_alert_service.py
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.services import cron_alert_service as service
from app.services.slack_notify_service import SlackNotifyError

WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/secret-token"
NOW = datetime(2026, 11, 5, 0, 15, tzinfo=UTC)  # 09:15 JST


def _db(is_failing: bool | None) -> MagicMock:
    """cron_alert_state の SELECT が返す行を差し替えた DB モック。"""
    db = MagicMock()
    rows = [] if is_failing is None else [{"is_failing": is_failing}]
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = rows
    return db


@pytest.fixture
def posted(monkeypatch) -> list[str]:
    monkeypatch.setenv("SLACK_WEBHOOK_URL", WEBHOOK_URL)
    sent: list[str] = []
    monkeypatch.setattr(service, "post_to_slack", lambda url, text: sent.append(text))
    return sent


def _saved(db: MagicMock) -> dict[str, Any]:
    return db.table.return_value.upsert.call_args.args[0]


@pytest.mark.unit
class TestReportCronFailure:
    def test_first_failure_notifies_and_saves_state(self, posted):
        db = _db(None)
        assert service.report_cron_failure(db, "parse-order-pdfs", now=NOW) is True
        assert len(posted) == 1
        assert "parse-order-pdfs" in posted[0]
        assert _saved(db)["is_failing"] is True

    def test_consecutive_failure_does_not_notify_again(self, posted):
        db = _db(True)
        assert service.report_cron_failure(db, "parse-order-pdfs", now=NOW) is False
        assert posted == []
        db.table.return_value.upsert.assert_not_called()

    def test_failed_count_is_included(self, posted):
        service.report_cron_failure(
            _db(False), "compute-daily-report-progress", 2, now=NOW
        )
        assert "失敗 2件" in posted[0]

    def test_message_has_no_webhook_url(self, posted):
        service.report_cron_failure(_db(False), "x", now=NOW)
        assert "secret-token" not in posted[0]

    def test_send_failure_keeps_state_for_retry(self, monkeypatch):
        monkeypatch.setenv("SLACK_WEBHOOK_URL", WEBHOOK_URL)

        def fail(url, text):
            raise SlackNotifyError("Slack webhook request failed")

        monkeypatch.setattr(service, "post_to_slack", fail)
        db = _db(False)
        assert service.report_cron_failure(db, "x", now=NOW) is False
        db.table.return_value.upsert.assert_not_called()

    def test_db_error_does_not_raise(self, posted):
        db = MagicMock()
        db.table.side_effect = RuntimeError("db down")
        assert service.report_cron_failure(db, "x", now=NOW) is False

    def test_disabled_without_webhook_does_not_touch_db(self, monkeypatch):
        monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
        db = MagicMock()
        assert service.report_cron_failure(db, "x", now=NOW) is False
        db.table.assert_not_called()


@pytest.mark.unit
class TestReportCronSuccess:
    def test_recovery_notifies_once_and_clears_state(self, posted):
        db = _db(True)
        assert service.report_cron_success(db, "x", now=NOW) is True
        assert "復旧" in posted[0]
        assert _saved(db)["is_failing"] is False

    @pytest.mark.parametrize("state", [None, False])
    def test_normal_success_is_silent(self, posted, state):
        db = _db(state)
        assert service.report_cron_success(db, "x", now=NOW) is False
        assert posted == []
        db.table.return_value.upsert.assert_not_called()

    def test_disabled_without_webhook_does_not_touch_db(self, monkeypatch):
        monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
        db = MagicMock()
        assert service.report_cron_success(db, "x", now=NOW) is False
        db.table.assert_not_called()

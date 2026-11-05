# __tests__/unit/services/test_slack_notify_service.py
from typing import Any

import httpx
import pytest
from app.services import slack_notify_service as service
from app.services.slack_notify_service import SlackNotifyError

WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/secret-token"


@pytest.mark.unit
class TestPostToSlack:
    """webhook URL を例外・ログに残さない（Issue #574）"""

    def test_posts_text_as_json(self, monkeypatch):
        calls: list[tuple[str, dict[str, Any]]] = []

        def fake_post(url, json, timeout):
            calls.append((url, json))
            return httpx.Response(200, text="ok", request=httpx.Request("POST", url))

        monkeypatch.setattr(service.httpx, "post", fake_post)
        service.post_to_slack(WEBHOOK_URL, "hello")
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
            service.post_to_slack(WEBHOOK_URL, "hello")

        assert "secret-token" not in str(exc_info.value)
        assert exc_info.value.__cause__ is None
        assert exc_info.value.__suppress_context__
        assert "secret-token" not in caplog.text

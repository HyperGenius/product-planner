from unittest.mock import MagicMock, patch

import pytest
from app.services.gmail_service import poll_unread_emails


@pytest.mark.unit
class TestPollUnreadEmails:
    def _set_required_env(self, monkeypatch):
        monkeypatch.setenv("GMAIL_CLIENT_ID", "client-id")
        monkeypatch.setenv("GMAIL_CLIENT_SECRET", "client-secret")
        monkeypatch.setenv("GMAIL_REFRESH_TOKEN", "refresh-token")
        monkeypatch.setenv("GMAIL_QUERY_FILTER", "is:unread")
        monkeypatch.setenv("GMAIL_LABEL_PROCESSED", "Label_123")

    def test_no_unread_emails_returns_zero(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {"messages": []}

        with patch(
            "app.services.gmail_service._build_gmail_client", return_value=mock_service
        ):
            result = poll_unread_emails()

        assert result == {"processed": 0}

    def test_emails_are_labeled_and_count_returned(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "aaa"}, {"id": "bbb"}]
        }

        with patch(
            "app.services.gmail_service._build_gmail_client", return_value=mock_service
        ):
            result = poll_unread_emails()

        assert result == {"processed": 2}
        mock_service.users().messages().batchModify.assert_called_once()

    def test_missing_env_vars_raise_value_error(self, monkeypatch):
        monkeypatch.delenv("GMAIL_CLIENT_ID", raising=False)
        monkeypatch.delenv("GMAIL_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("GMAIL_REFRESH_TOKEN", raising=False)

        with pytest.raises(ValueError, match="Missing Gmail OAuth env vars"):
            poll_unread_emails()

    def test_paginated_emails_are_all_processed(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        # 1ページ目: nextPageToken あり、2ページ目: なし
        mock_service.users().messages().list().execute.side_effect = [
            {"messages": [{"id": "aaa"}, {"id": "bbb"}], "nextPageToken": "tok"},
            {"messages": [{"id": "ccc"}]},
        ]

        with patch(
            "app.services.gmail_service._build_gmail_client", return_value=mock_service
        ):
            result = poll_unread_emails()

        assert result == {"processed": 3}

from unittest.mock import MagicMock, patch

import pytest
from app.services.gmail_service import poll_unread_emails


@pytest.mark.unit
class TestPollUnreadEmails:
    def _set_required_env(self, monkeypatch):
        monkeypatch.setenv("GMAIL_CLIENT_ID", "client-id")
        monkeypatch.setenv("GMAIL_CLIENT_SECRET", "client-secret")
        monkeypatch.setenv("GMAIL_REFRESH_TOKEN", "refresh-token")

    def test_no_pending_labels_returns_zero(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().labels().list().execute.return_value = {"labels": []}

        with patch(
            "app.services.gmail_service._build_gmail_client", return_value=mock_service
        ):
            result = poll_unread_emails(MagicMock())

        assert result == {"processed": 0, "errors": 0}

    def test_messages_processed_and_count_returned(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().labels().list().execute.return_value = {
            "labels": [
                {"name": "pp-pending/tenantA", "id": "label-1"},
            ]
        }
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "aaa"}, {"id": "bbb"}]
        }

        mock_db = MagicMock()
        with (
            patch(
                "app.services.gmail_service._build_gmail_client",
                return_value=mock_service,
            ),
            patch("app.services.gmail_service._process_message") as mock_process,
        ):
            result = poll_unread_emails(mock_db)

        assert result["processed"] == 2
        assert result["errors"] == 0
        assert mock_process.call_count == 2

    def test_missing_env_vars_raise_value_error(self, monkeypatch):
        monkeypatch.delenv("GMAIL_CLIENT_ID", raising=False)
        monkeypatch.delenv("GMAIL_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("GMAIL_REFRESH_TOKEN", raising=False)

        with pytest.raises(ValueError, match="Missing Gmail OAuth env vars"):
            poll_unread_emails(MagicMock())

    def test_processing_error_increments_error_count(self, monkeypatch):
        self._set_required_env(monkeypatch)

        mock_service = MagicMock()
        mock_service.users().labels().list().execute.return_value = {
            "labels": [
                {"name": "pp-pending/tenantA", "id": "label-1"},
            ]
        }
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "aaa"}]
        }

        mock_db = MagicMock()
        with (
            patch(
                "app.services.gmail_service._build_gmail_client",
                return_value=mock_service,
            ),
            patch(
                "app.services.gmail_service._process_message",
                side_effect=Exception("processing failed"),
            ),
        ):
            result = poll_unread_emails(mock_db)

        assert result["processed"] == 0
        assert result["errors"] == 1

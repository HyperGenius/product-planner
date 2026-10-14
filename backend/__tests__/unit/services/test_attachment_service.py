"""
attachment_service の単体テスト (Issue #430)
"""

from unittest.mock import MagicMock

import pytest
from app.services.attachment_service import create_signed_urls


@pytest.mark.unit
class TestCreateSignedUrls:
    def test_empty_paths_does_not_call_storage(self):
        admin_client = MagicMock()
        assert create_signed_urls(admin_client, []) == {}
        admin_client.storage.from_.assert_not_called()

    def test_excludes_failed_items(self):
        """エラーの項目・signedURL が None の項目（storage3 2.29.0 以降）は含めない"""
        admin_client = MagicMock()
        admin_client.storage.from_.return_value.create_signed_urls.return_value = [
            {"path": "a.pdf", "error": None, "signedURL": "https://example.com/a"},
            {
                "path": "b.pdf",
                "error": "Either the object does not exist",
                "signedURL": None,
            },
            {"path": "c.pdf", "error": None, "signedURL": None},
        ]

        assert create_signed_urls(admin_client, ["a.pdf", "b.pdf", "c.pdf"]) == {
            "a.pdf": "https://example.com/a"
        }

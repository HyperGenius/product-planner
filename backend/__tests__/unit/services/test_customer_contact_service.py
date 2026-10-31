from unittest.mock import MagicMock

import pytest
from app.services.customer_contact_service import (
    add_contact,
    sync_primary_contact,
)
from postgrest.exceptions import APIError


def _unique_violation() -> APIError:
    return APIError({"code": "23505", "message": "duplicate", "details": ""})


@pytest.mark.unit
class TestAddContact:
    def test_inserts_normalized_email(self):
        db = MagicMock()

        assert add_contact(db, "t1", 5, "  Taro@Example.COM ", "山田") is True

        row = db.table().insert.call_args.args[0]
        assert row == {
            "tenant_id": "t1",
            "customer_id": 5,
            "email": "taro@example.com",
            "contact_name": "山田",
        }

    def test_blank_email_is_ignored(self):
        db = MagicMock()

        assert add_contact(db, "t1", 5, "   ") is False

        db.table().insert.assert_not_called()

    def test_existing_address_is_kept_as_is(self):
        db = MagicMock()
        db.table().insert().execute.side_effect = _unique_violation()

        assert add_contact(db, "t1", 5, "taro@example.com") is False

    def test_other_api_errors_are_raised(self):
        db = MagicMock()
        db.table().insert().execute.side_effect = APIError(
            {"code": "42501", "message": "denied", "details": ""}
        )

        with pytest.raises(APIError):
            add_contact(db, "t1", 5, "taro@example.com")


@pytest.mark.unit
class TestSyncPrimaryContact:
    def test_changed_email_removes_old_and_adds_new(self):
        db = MagicMock()

        sync_primary_contact(db, "t1", 5, "Old@example.com", "new@example.com")

        db.table().delete().eq().eq().eq.assert_called_with("email", "old@example.com")
        row = db.table().insert.call_args.args[0]
        assert row["email"] == "new@example.com"
        assert row["customer_id"] == 5

    def test_cleared_email_removes_old_only(self):
        db = MagicMock()

        sync_primary_contact(db, "t1", 5, "old@example.com", None)

        db.table().delete().eq().eq().eq.assert_called_with("email", "old@example.com")
        db.table().insert.assert_not_called()

    def test_unchanged_email_does_not_delete(self):
        db = MagicMock()

        sync_primary_contact(db, "t1", 5, "a@example.com", "A@example.com")

        db.table().delete.assert_not_called()

    def test_address_owned_by_another_customer_is_not_moved(self):
        db = MagicMock()
        db.table().insert().execute.side_effect = _unique_violation()
        db.table().select().eq().eq().limit().execute.return_value = MagicMock(
            data=[{"customer_id": 9}]
        )

        sync_primary_contact(db, "t1", 5, None, "shared@example.com")

        # 付け替え（UPDATE）はしない
        db.table().update.assert_not_called()

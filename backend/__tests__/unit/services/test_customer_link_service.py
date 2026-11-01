"""顧客不明の注文の紐づけ（Issue #609）の純粋なロジックと RPC のエラー変換。"""

from unittest.mock import MagicMock

import pytest
from app.services.customer_link_service import (
    LinkContactConflictError,
    LinkCustomerNotFoundError,
    LinkForbiddenError,
    LinkOrderDuplicateError,
    LinkOrderNotFoundError,
    LinkOrderNotUnknownError,
    email_domain,
    find_domain_candidate_customer_ids,
    link_customer,
)
from postgrest.exceptions import APIError


@pytest.mark.unit
class TestEmailDomain:
    @pytest.mark.parametrize(
        ("email", "expected"),
        [
            ("taro@Example.com", "example.com"),
            ("a@b@example.co.jp", "example.co.jp"),
            ("no-at-sign", None),
            ("trailing@", None),
            ("", None),
            (None, None),
        ],
    )
    def test_email_domain(self, email, expected):
        assert email_domain(email) == expected


@pytest.mark.unit
class TestFindDomainCandidates:
    def test_orders_by_contact_count_then_id_and_drops_wildcard_matches(self):
        db = MagicMock()
        db.table().select().eq().ilike().execute.return_value = MagicMock(
            data=[
                {"customer_id": 5, "email": "a@example.com"},
                {"customer_id": 3, "email": "b@example.com"},
                {"customer_id": 3, "email": "c@example.com"},
                # ilike の `_` はワイルドカード。ドメインが違う行は落とす
                {"customer_id": 9, "email": "d@exampleXcom"},
                {"customer_id": 2, "email": "e@example.com"},
            ]
        )

        assert find_domain_candidate_customer_ids(db, "t", "new@example.com") == [
            3,
            2,
            5,
        ]

    def test_invalid_sender_has_no_candidates(self):
        db = MagicMock()

        assert find_domain_candidate_customer_ids(db, "t", "invalid") == []
        db.table.assert_not_called()


@pytest.mark.unit
class TestLinkCustomerErrors:
    @pytest.mark.parametrize(
        ("code", "error"),
        [
            ("42501", LinkForbiddenError),
            ("P0002", LinkOrderNotFoundError),
            ("55000", LinkOrderNotUnknownError),
            ("23503", LinkCustomerNotFoundError),
            ("P0001", LinkContactConflictError),
            ("23505", LinkOrderDuplicateError),
        ],
    )
    def test_rpc_error_codes_are_translated(self, code, error):
        db = MagicMock()
        db.rpc().execute.side_effect = APIError(
            {
                "message": "orders_dedupe_key",
                "code": code,
                "details": None,
                "hint": None,
            }
        )

        with pytest.raises(error):
            link_customer(db, "t", 1, 2, True, False)

    def test_unexpected_error_is_re_raised(self):
        db = MagicMock()
        db.rpc().execute.side_effect = APIError(
            {"message": "boom", "code": "XX000", "details": None, "hint": None}
        )

        with pytest.raises(APIError):
            link_customer(db, "t", 1, 2, True, False)

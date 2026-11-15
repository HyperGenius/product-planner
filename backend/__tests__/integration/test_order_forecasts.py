"""
Integration テスト: 注文書の内示を受注にせず保存する (Issue #676)

取り込みの `_process_line_items()` を実 Supabase に対して呼び、内示の明細が `orders` に
起票されず、RPC `replace_order_forecasts` で注文書ごとに `order_forecasts` へ保存されることを
確かめる。あわせて RLS（テナントのメンバーは読めるが書けない）と FK の ON DELETE を確かめる。

Claude API には依存しない（抽出済みの明細を直接渡す）。

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_order_forecasts.py -v --run-integration
"""

import uuid
from typing import Any, cast

import pytest
from app.services.pdf_order_parsing_service import _process_line_items
from postgrest.exceptions import APIError

_NEXT_MONTH = {
    "product_name_raw": "FILTER COMP",
    "product_number_raw": "FC-676",
    "quantity": 36000,
    "delivery_date": None,
    "line_order_no": None,
    "certainty": "forecast",
    "forecast_period_start": "2026-11",
    "forecast_period_end": "2026-11",
}
_QUARTER = {
    **_NEXT_MONTH,
    "quantity": 39600,
    "certainty": "forecast_tentative",
    "forecast_period_start": "2027-01",
    "forecast_period_end": "2027-03",
}


def _rows(result: Any) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], result.data or [])


@pytest.fixture()
def forecast_fixture(admin_db, auth_user_id):
    tenants = {
        key: _rows(
            admin_db.table("tenants")
            .insert({"name": f"integration order forecasts ({key}) {uuid.uuid4()}"})
            .execute()
        )[0]["id"]
        for key in ("own", "other")
    }
    admin_db.table("organization_members").insert(
        {"user_id": auth_user_id, "tenant_id": tenants["own"]}
    ).execute()
    customer_id = _rows(
        admin_db.table("customers")
        .insert({"tenant_id": tenants["own"], "name": "integration forecast customer"})
        .execute()
    )[0]["id"]
    product_id = _rows(
        admin_db.table("products")
        .insert(
            {"tenant_id": tenants["own"], "name": "FILTER COMP φ10.6", "code": "FC-676"}
        )
        .execute()
    )[0]["id"]

    def staging(tenant_key: str = "own") -> dict[str, Any]:
        tenant_id = tenants[tenant_key]
        return _rows(
            admin_db.table("order_attachments")
            .insert(
                {
                    "tenant_id": tenant_id,
                    "customer_id": customer_id if tenant_key == "own" else None,
                    "order_id": None,
                    "storage_path": f"{tenant_id}/inbox/{uuid.uuid4()}/order.pdf",
                    "original_filename": "order.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 1234,
                    "parse_status": "pending",
                    "source_raw": "integration forecast",
                }
            )
            .execute()
        )[0]

    yield {
        "tenants": tenants,
        "customer_id": customer_id,
        "product_id": product_id,
        "staging": staging,
    }

    for tenant_id in tenants.values():
        # order_forecasts は order_attachments の ON DELETE CASCADE で消える
        admin_db.table("order_parse_log").delete().eq("tenant_id", tenant_id).execute()
        admin_db.table("orders").delete().eq("tenant_id", tenant_id).execute()
        admin_db.table("order_attachments").delete().eq(
            "tenant_id", tenant_id
        ).execute()
    admin_db.table("products").delete().eq("tenant_id", tenants["own"]).execute()
    admin_db.table("customers").delete().eq("tenant_id", tenants["own"]).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", tenants["own"]
    ).execute()
    for tenant_id in tenants.values():
        admin_db.table("tenants").delete().eq("id", tenant_id).execute()


def _forecasts(admin_db, tenant_id: str) -> list[dict[str, Any]]:
    return _rows(
        admin_db.table("order_forecasts")
        .select(
            "source_attachment_id, line_index, customer_id, product_id, "
            "extracted_product_name, period_start, period_end, quantity, certainty"
        )
        .eq("tenant_id", tenant_id)
        .order("line_index")
        .execute()
    )


def _replace(client, tenant_id: str, attachment_id: str, rows: list[dict[str, Any]]):
    return client.rpc(
        "replace_order_forecasts",
        {
            "p_tenant_id": tenant_id,
            "p_attachment_id": attachment_id,
            "p_customer_id": None,
            "p_rows": rows,
        },
    ).execute()


@pytest.mark.integration
class TestRecordForecasts:
    def test_forecast_lines_are_saved_and_not_created_as_orders(
        self, admin_db, forecast_fixture
    ):
        own = forecast_fixture["tenants"]["own"]
        row = forecast_fixture["staging"]()

        created = _process_line_items(
            admin_db, row, [_NEXT_MONTH, _QUARTER], None, None
        )

        assert created == 0
        assert (
            _rows(admin_db.table("orders").select("id").eq("tenant_id", own).execute())
            == []
        )
        assert _forecasts(admin_db, own) == [
            {
                "source_attachment_id": row["id"],
                "line_index": 0,
                "customer_id": forecast_fixture["customer_id"],
                "product_id": forecast_fixture["product_id"],
                "extracted_product_name": "FILTER COMP",
                "period_start": "2026-11-01",
                "period_end": "2026-11-01",
                "quantity": 36000,
                "certainty": "forecast",
            },
            {
                "source_attachment_id": row["id"],
                "line_index": 1,
                "customer_id": forecast_fixture["customer_id"],
                "product_id": forecast_fixture["product_id"],
                "extracted_product_name": "FILTER COMP",
                "period_start": "2027-01-01",
                "period_end": "2027-03-01",
                "quantity": 39600,
                "certainty": "forecast_tentative",
            },
        ]
        reasons = [
            r["reason"]
            for r in _rows(
                admin_db.table("order_parse_log")
                .select("reason")
                .eq("order_attachment_id", row["id"])
                .execute()
            )
        ]
        assert reasons == ["forecast_recorded"]

    def test_reprocessing_the_same_document_replaces_its_forecasts(
        self, admin_db, forecast_fixture
    ):
        own = forecast_fixture["tenants"]["own"]
        row = forecast_fixture["staging"]()
        _process_line_items(admin_db, row, [_NEXT_MONTH, _QUARTER], None, None)

        _process_line_items(admin_db, row, [{**_NEXT_MONTH, "quantity": 0}], None, None)

        assert [
            (f["line_index"], f["quantity"]) for f in _forecasts(admin_db, own)
        ] == [(0, 0)]

    def test_each_document_keeps_its_own_forecasts(self, admin_db, forecast_fixture):
        """前回比のため、前の注文書の内示は残す。"""
        own = forecast_fixture["tenants"]["own"]
        first = forecast_fixture["staging"]()
        second = forecast_fixture["staging"]()

        _process_line_items(admin_db, first, [_NEXT_MONTH], None, None)
        _process_line_items(
            admin_db, second, [{**_NEXT_MONTH, "quantity": 32000}], None, None
        )

        stored = {
            f["source_attachment_id"]: f["quantity"] for f in _forecasts(admin_db, own)
        }
        assert stored == {first["id"]: 36000, second["id"]: 32000}

    def test_deleting_product_keeps_forecast_with_null_product(
        self, admin_db, forecast_fixture
    ):
        """重複製品の統合で統合元が消えても内示は残る（ON DELETE SET NULL）。"""
        own = forecast_fixture["tenants"]["own"]
        row = forecast_fixture["staging"]()
        _process_line_items(admin_db, row, [_NEXT_MONTH], None, None)

        admin_db.table("products").delete().eq(
            "id", forecast_fixture["product_id"]
        ).execute()

        [forecast] = _forecasts(admin_db, own)
        assert forecast["product_id"] is None
        assert forecast["extracted_product_name"] == "FILTER COMP"

    def test_rpc_rejects_attachment_of_other_tenant(self, admin_db, forecast_fixture):
        own = forecast_fixture["tenants"]["own"]
        other_row = forecast_fixture["staging"]("other")

        with pytest.raises(APIError):
            _replace(admin_db, own, other_row["id"], [])

    def test_rpc_rejects_invalid_period(self, admin_db, forecast_fixture):
        """期間は月の1日で、開始と終了が揃っている（取り込み側で正規化してから渡す）。"""
        own = forecast_fixture["tenants"]["own"]
        row = forecast_fixture["staging"]()
        base = {"line_index": 0, "quantity": 1, "certainty": "forecast"}

        for period in (
            {"period_start": "2026-11-15", "period_end": "2026-11-15"},
            {"period_start": "2026-11-01", "period_end": None},
            {"period_start": "2026-12-01", "period_end": "2026-11-01"},
        ):
            with pytest.raises(APIError):
                _replace(admin_db, own, row["id"], [{**base, **period}])
        assert _forecasts(admin_db, own) == []


@pytest.mark.integration
class TestOrderForecastsRls:
    def _seed(self, admin_db, forecast_fixture) -> None:
        for key in ("own", "other"):
            row = forecast_fixture["staging"](key)
            _replace(
                admin_db,
                forecast_fixture["tenants"][key],
                row["id"],
                [
                    {
                        "line_index": 0,
                        "extracted_product_name": f"P-{key}",
                        "quantity": 1,
                        "certainty": "forecast",
                    }
                ],
            )

    def test_user_jwt_sees_only_own_tenant(
        self, real_supabase_client, admin_db, forecast_fixture
    ):
        self._seed(admin_db, forecast_fixture)
        tenants = forecast_fixture["tenants"]

        visible = _rows(
            real_supabase_client.table("order_forecasts")
            .select("tenant_id, extracted_product_name")
            .in_("tenant_id", [tenants["own"], tenants["other"]])
            .execute()
        )

        assert visible == [
            {"tenant_id": tenants["own"], "extracted_product_name": "P-own"}
        ]

    def test_user_jwt_cannot_write(
        self, real_supabase_client, admin_db, forecast_fixture
    ):
        self._seed(admin_db, forecast_fixture)
        own = forecast_fixture["tenants"]["own"]

        deleted = _rows(
            real_supabase_client.table("order_forecasts")
            .delete()
            .eq("tenant_id", own)
            .execute()
        )
        assert deleted == []
        assert len(_forecasts(admin_db, own)) == 1

        row = forecast_fixture["staging"]()
        with pytest.raises(APIError):
            _replace(real_supabase_client, own, row["id"], [])

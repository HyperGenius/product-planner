"""日報の名寄せ API のテスト (Issue #488)。"""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from app.dependencies import (
    get_current_tenant_id,
    get_current_user_id,
    get_supabase_client,
)
from app.main import app
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

client = TestClient(app)

ROUTER = "app.routers.daily_reports.name_matching"
TENANT = "tenant-1"
USER = "user-1"


def _tables(mock_client: MagicMock) -> dict[str, MagicMock]:
    tables: dict[str, MagicMock] = {}

    def table(name: str) -> MagicMock:
        return tables.setdefault(name, MagicMock())

    mock_client.table.side_effect = table
    return tables


def _target_exists(tables: dict[str, MagicMock], name: str, exists: bool) -> None:
    tables.setdefault(
        name, MagicMock()
    ).select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": 1}] if exists else []
    )


@pytest.mark.api
class TestDailyReportNameMatchingRouter:
    @pytest.fixture
    def mock_client(self):
        return MagicMock()

    @pytest.fixture(autouse=True)
    def override_dependency(self, mock_client):
        app.dependency_overrides[get_current_tenant_id] = lambda: TENANT
        app.dependency_overrides[get_current_user_id] = lambda: USER
        app.dependency_overrides[get_supabase_client] = lambda: mock_client
        with patch(f"{ROUTER}.get_current_user_role", return_value="order_handler"):
            yield
        app.dependency_overrides = {}

    # --- 未照合の表記 ---------------------------------------------------------

    def test_unmatched_names(self, mock_client):
        items = [
            {
                "kind": "product",
                "raw_text": "短いピン",
                "customer_raw": "顧客A",
                "customer_id": 10,
                "entry_count": 3,
                "last_work_date": "2026-09-09",
            }
        ]
        with patch(f"{ROUTER}.list_unmatched_names", return_value=items) as service:
            response = client.get("/daily-reports/unmatched-names?kind=product")

        assert response.status_code == 200
        assert response.json() == items
        service.assert_called_once_with(mock_client, TENANT, "product")

    def test_unmatched_names_rejects_unknown_kind(self):
        response = client.get("/daily-reports/unmatched-names?kind=worker")
        assert response.status_code == 422

    def test_product_candidates_never_returns_auto_confirmed_id(self, mock_client):
        result = {
            "product_id": 100,
            "candidates": [{"product_id": 100, "name": "ピン φ6×20", "score": 0.9}],
        }
        with patch(f"{ROUTER}.match_products", return_value=result) as match:
            response = client.get(
                "/daily-reports/product-candidates?raw_text= ピン6x20 "
            )

        assert response.status_code == 200
        assert response.json() == result["candidates"]
        match.assert_called_once_with(mock_client, TENANT, "ピン6x20")

    # --- 設備の別名 -----------------------------------------------------------

    def test_create_equipment_alias(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "equipments", True)
        created = {"id": str(uuid.uuid4()), "raw_text": "組立機B", "equipment_id": 2}
        tables.setdefault(
            "equipment_name_aliases", MagicMock()
        ).insert.return_value.execute.return_value = MagicMock(data=[created])

        response = client.post(
            "/daily-reports/name-aliases/equipment",
            json={"raw_text": " 組立機B ", "equipment_id": 2},
        )

        assert response.status_code == 201
        assert response.json() == created
        tables["equipment_name_aliases"].insert.assert_called_once_with(
            {
                "tenant_id": TENANT,
                "raw_text": "組立機B",
                "equipment_id": 2,
                "created_by": USER,
            }
        )
        tables["equipments"].select.return_value.eq.assert_called_once_with(
            "tenant_id", TENANT
        )

    def test_create_equipment_alias_with_unknown_equipment(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "equipments", False)

        response = client.post(
            "/daily-reports/name-aliases/equipment",
            json={"raw_text": "組立機B", "equipment_id": 999},
        )

        assert response.status_code == 422
        assert "equipment_name_aliases" not in tables

    def test_create_duplicate_alias_returns_409(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "equipments", True)
        tables.setdefault(
            "equipment_name_aliases", MagicMock()
        ).insert.return_value.execute.side_effect = APIError(
            {
                "code": "23505",
                "message": "duplicate key value violates unique constraint",
            }
        )

        response = client.post(
            "/daily-reports/name-aliases/equipment",
            json={"raw_text": "組立機B", "equipment_id": 2},
        )

        assert response.status_code == 409
        assert response.json()["detail"] == {
            "error": "duplicate_alias",
            "message": "この表記は既に登録されています",
        }

    def test_blank_raw_text_is_rejected(self):
        response = client.post(
            "/daily-reports/name-aliases/equipment",
            json={"raw_text": "   ", "equipment_id": 2},
        )
        assert response.status_code == 422

    def test_iso_officer_cannot_edit(self, mock_client):
        tables = _tables(mock_client)
        with patch(f"{ROUTER}.get_current_user_role", return_value="iso_officer"):
            response = client.post(
                "/daily-reports/name-aliases/equipment",
                json={"raw_text": "組立機B", "equipment_id": 2},
            )

        assert response.status_code == 403
        assert "equipment_name_aliases" not in tables

    @pytest.mark.parametrize("role", ["president", "platform_admin"])
    def test_other_editor_roles_can_delete(self, mock_client, role):
        tables = _tables(mock_client)
        tables.setdefault(
            "equipment_name_aliases", MagicMock()
        ).delete.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{"id": "x"}])
        )
        with patch(f"{ROUTER}.get_current_user_role", return_value=role):
            response = client.delete(
                f"/daily-reports/name-aliases/equipment/{uuid.uuid4()}"
            )

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}

    def test_update_equipment_alias(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "equipments", True)
        alias_id = uuid.uuid4()
        updated = {"id": str(alias_id), "raw_text": "組立機B", "equipment_id": 3}
        update_chain = tables.setdefault("equipment_name_aliases", MagicMock()).update
        update_chain.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[updated]
        )

        response = client.patch(
            f"/daily-reports/name-aliases/equipment/{alias_id}",
            json={"equipment_id": 3},
        )

        assert response.status_code == 200
        assert response.json() == updated
        update_chain.assert_called_once_with({"equipment_id": 3})
        update_chain.return_value.eq.assert_called_once_with("tenant_id", TENANT)
        update_chain.return_value.eq.return_value.eq.assert_called_once_with(
            "id", str(alias_id)
        )

    def test_update_missing_alias_returns_404(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "equipments", True)
        tables.setdefault(
            "equipment_name_aliases", MagicMock()
        ).update.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[])
        )

        response = client.patch(
            f"/daily-reports/name-aliases/equipment/{uuid.uuid4()}",
            json={"equipment_id": 3},
        )

        assert response.status_code == 404

    def test_invalid_alias_id_returns_422(self):
        response = client.delete("/daily-reports/name-aliases/equipment/not-a-uuid")
        assert response.status_code == 422

    # --- 工程の別名（1:N） -----------------------------------------------------

    def _process_master(self, tables, names):
        """名前ごとの存在確認（.eq("process_name", name).limit(1)）に、names に含まれるかで答える。"""
        name_filter = tables.setdefault(
            "process_routings", MagicMock()
        ).select.return_value.eq.return_value.eq

        def by_name(_column, name):
            query = MagicMock()
            query.limit.return_value.execute.return_value = MagicMock(
                data=[{"id": 1}] if name in names else []
            )
            return query

        name_filter.side_effect = by_name
        return name_filter

    def test_create_process_alias_one_to_many(self, mock_client):
        tables = _tables(mock_client)
        name_filter = self._process_master(tables, ["カシメ", "クグシ"])
        insert = tables.setdefault("process_name_aliases", MagicMock()).insert
        insert.return_value.execute.return_value = MagicMock(data=[{"id": "p"}])

        response = client.post(
            "/daily-reports/name-aliases/process",
            json={
                "raw_text": "カシメ、仕上げ加工",
                "process_names": [" カシメ", "クグシ", "カシメ"],
            },
        )

        assert response.status_code == 201
        assert insert.call_args.args[0]["process_names"] == ["カシメ", "クグシ"]
        assert [c.args for c in name_filter.call_args_list] == [
            ("process_name", "カシメ"),
            ("process_name", "クグシ"),
        ]

    def test_create_process_alias_with_unknown_process(self, mock_client):
        tables = _tables(mock_client)
        self._process_master(tables, ["カシメ"])

        response = client.post(
            "/daily-reports/name-aliases/process",
            json={
                "raw_text": "カシメ、仕上げ加工",
                "process_names": ["カシメ", "仕上げ"],
            },
        )

        assert response.status_code == 422
        assert "仕上げ" in response.json()["detail"]
        assert "process_name_aliases" not in tables

    @pytest.mark.parametrize("names", [[], ["  "]])
    def test_process_names_must_not_be_empty(self, names):
        response = client.post(
            "/daily-reports/name-aliases/process",
            json={"raw_text": "カシメ加工", "process_names": names},
        )
        assert response.status_code == 422

    # --- 顧客の別名 -----------------------------------------------------------

    def test_create_customer_alias(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "customers", True)
        insert = tables.setdefault("customer_name_aliases", MagicMock()).insert
        insert.return_value.execute.return_value = MagicMock(data=[{"id": "c"}])

        response = client.post(
            "/daily-reports/name-aliases/customer",
            json={"raw_text": "SK", "customer_id": 10},
        )

        assert response.status_code == 201
        assert insert.call_args.args[0]["customer_id"] == 10

    # --- 製品の別名 -----------------------------------------------------------

    def test_create_product_alias(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "customers", True)
        _target_exists(tables, "products", True)
        with patch(f"{ROUTER}.register_daily_report_alias") as register:
            response = client.post(
                "/daily-reports/name-aliases/product",
                json={"raw_text": " 短いピン ", "customer_id": 10, "product_id": 100},
            )

        assert response.status_code == 201
        register.assert_called_once_with(
            mock_client,
            TENANT,
            customer_id=10,
            raw_text="短いピン",
            product_id=100,
            changed_by=USER,
        )

    def test_create_product_alias_with_unknown_product(self, mock_client):
        tables = _tables(mock_client)
        _target_exists(tables, "customers", True)
        _target_exists(tables, "products", False)
        with patch(f"{ROUTER}.register_daily_report_alias") as register:
            response = client.post(
                "/daily-reports/name-aliases/product",
                json={"raw_text": "短いピン", "customer_id": 10, "product_id": 999},
            )

        assert response.status_code == 422
        register.assert_not_called()

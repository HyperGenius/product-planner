# __tests__/api/routers/master/test_scheduling_settings.py
from unittest.mock import MagicMock

import pytest
from app.dependencies import get_supabase_client
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


@pytest.fixture
def headers():
    return {
        "Authorization": "Bearer fake-token",
        "x-tenant-id": "test-tenant-uuid",
    }


@pytest.fixture
def mock_client():
    return MagicMock()


@pytest.fixture(autouse=True)
def override_dependency(mock_client):
    app.dependency_overrides[get_supabase_client] = lambda: mock_client
    yield
    app.dependency_overrides = {}


def _make_table_mock(mock_client, return_data):
    """Supabase チェーンモック: .table().select().eq().execute().data"""
    table_mock = MagicMock()
    select_mock = MagicMock()
    eq_mock = MagicMock()
    execute_mock = MagicMock()
    execute_mock.data = return_data
    eq_mock.execute.return_value = execute_mock
    select_mock.eq.return_value = eq_mock
    table_mock.select.return_value = select_mock
    mock_client.table.return_value = table_mock
    return table_mock


@pytest.mark.api
class TestSchedulingSettingsRouter:
    """スケジューリング設定ルーターのテスト"""

    def test_get_returns_defaults_when_no_settings(self, headers, mock_client):
        """設定が存在しない場合にデフォルト値を返すこと"""
        _make_table_mock(mock_client, [])

        response = client.get("/scheduling-settings", headers=headers)

        assert response.status_code == 200
        body = response.json()
        assert body["guard_time_minutes"] == 0
        assert body["min_slot_minutes"] == 0
        assert body["max_fragments"] == 10

    def test_get_returns_existing_settings(self, headers, mock_client):
        """既存設定がある場合にその値を返すこと"""
        existing = {
            "tenant_id": "test-tenant-uuid",
            "guard_time_minutes": 15,
            "min_slot_minutes": 30,
            "max_fragments": 5,
        }
        _make_table_mock(mock_client, [existing])

        response = client.get("/scheduling-settings", headers=headers)

        assert response.status_code == 200
        body = response.json()
        assert body["guard_time_minutes"] == 15
        assert body["min_slot_minutes"] == 30
        assert body["max_fragments"] == 5

    def test_put_creates_new_settings(self, headers, mock_client):
        """設定を新規作成できること"""
        call_count = [0]
        existing = {
            "tenant_id": "test-tenant-uuid",
            "guard_time_minutes": 10,
            "min_slot_minutes": 20,
            "max_fragments": 3,
        }

        def table_side_effect(name):
            call_count[0] += 1
            m = MagicMock()
            select_m = MagicMock()
            eq_m = MagicMock()
            exec_m = MagicMock()
            if call_count[0] == 1:
                exec_m.data = []  # GET: no existing
            else:
                exec_m.data = [existing]  # upsert response
            eq_m.execute.return_value = exec_m
            select_m.eq.return_value = eq_m
            m.select.return_value = select_m
            # upsert chain
            upsert_m = MagicMock()
            upsert_exec_m = MagicMock()
            upsert_exec_m.data = [existing]
            upsert_m.execute.return_value = upsert_exec_m
            m.upsert.return_value = upsert_m
            return m

        mock_client.table.side_effect = table_side_effect

        payload = {"guard_time_minutes": 10, "min_slot_minutes": 20, "max_fragments": 3}
        response = client.put("/scheduling-settings", json=payload, headers=headers)

        assert response.status_code == 200

    def test_put_partial_update_merges_with_defaults(self, headers, mock_client):
        """部分更新: 指定フィールドだけ上書きされ、未指定はデフォルト値を維持すること"""
        call_count = [0]
        upserted = {
            "tenant_id": "test-tenant-uuid",
            "guard_time_minutes": 5,
            "min_slot_minutes": 0,
            "max_fragments": 10,
        }

        def table_side_effect(name):
            call_count[0] += 1
            m = MagicMock()
            select_m = MagicMock()
            eq_m = MagicMock()
            exec_m = MagicMock()
            exec_m.data = []  # GET: no existing → use defaults
            eq_m.execute.return_value = exec_m
            select_m.eq.return_value = eq_m
            m.select.return_value = select_m
            upsert_m = MagicMock()
            upsert_exec_m = MagicMock()
            upsert_exec_m.data = [upserted]
            upsert_m.execute.return_value = upsert_exec_m
            m.upsert.return_value = upsert_m
            return m

        mock_client.table.side_effect = table_side_effect

        # guard_time_minutes だけ指定
        payload = {"guard_time_minutes": 5}
        response = client.put("/scheduling-settings", json=payload, headers=headers)

        assert response.status_code == 200

    def test_put_rejects_negative_guard_time(self, headers, mock_client):
        """ガードタイムに負の値を渡した場合は 422 を返すこと"""
        _make_table_mock(mock_client, [])
        payload = {"guard_time_minutes": -1}
        response = client.put("/scheduling-settings", json=payload, headers=headers)
        assert response.status_code == 422

    def test_put_rejects_zero_max_fragments(self, headers, mock_client):
        """最大断片数に 0 以下を渡した場合は 422 を返すこと"""
        _make_table_mock(mock_client, [])
        payload = {"max_fragments": 0}
        response = client.put("/scheduling-settings", json=payload, headers=headers)
        assert response.status_code == 422

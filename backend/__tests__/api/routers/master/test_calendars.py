# __tests__/api/routers/master/test_calendars.py
from datetime import date
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_supabase_client
from app.main import app

# テストクライアントの作成
client = TestClient(app)


@pytest.fixture
def headers():
    """共通ヘッダー"""
    return {
        "Authorization": "Bearer fake-token",
        "x-tenant-id": "test-tenant-uuid",
    }


@pytest.fixture
def mock_client():
    """Supabaseクライアントのモック"""
    return MagicMock()


@pytest.fixture
def mock_calendar_data():
    """テスト用カレンダーデータ"""
    return [
        {
            "date": "2024-01-01",
            "is_holiday": True,
            "note": "元日",
        },
        {
            "date": "2024-01-02",
            "is_holiday": True,
            "note": "休日",
        },
        {
            "date": "2024-01-15",
            "is_holiday": False,
            "note": "臨時出勤",
        },
    ]


@pytest.fixture(autouse=True)
def override_dependency(mock_client):
    """依存関係をモックに差し替え"""
    app.dependency_overrides[get_supabase_client] = lambda: mock_client
    yield
    app.dependency_overrides = {}


@pytest.mark.api
class TestCalendarRouter:
    """カレンダールーターのユニットテスト"""

    def test_get_calendars(self, headers, mock_client, mock_calendar_data):
        """GET /calendars: 月次カレンダー取得のテスト"""
        # モックの設定
        mock_response = MagicMock()
        mock_response.data = mock_calendar_data
        mock_client.table.return_value.select.return_value.gte.return_value.lte.return_value.execute.return_value = (
            mock_response
        )

        response = client.get("/calendars/?year=2024&month=1", headers=headers)

        assert response.status_code == 200
        assert response.json() == mock_calendar_data

    def test_upsert_calendar(self, headers, mock_client):
        """POST /calendars: カレンダー作成/更新のテスト"""
        payload = {
            "date": "2024-12-31",
            "is_holiday": True,
            "note": "大晦日",
        }

        # モックの設定
        mock_response = MagicMock()
        mock_response.data = [
            {
                "id": 1,
                "tenant_id": "test-tenant-uuid",
                "date": "2024-12-31",
                "is_holiday": True,
                "note": "大晦日",
            }
        ]
        mock_client.table.return_value.upsert.return_value.execute.return_value = (
            mock_response
        )

        response = client.post("/calendars/", json=payload, headers=headers)

        assert response.status_code == 200
        assert response.json()["is_holiday"] is True
        assert response.json()["note"] == "大晦日"

    def test_batch_update_calendars(self, headers, mock_client):
        """POST /calendars/batch: 一括更新のテスト"""
        payload = {
            "dates": ["2024-08-10", "2024-08-11", "2024-08-12"],
            "is_holiday": True,
            "note": "お盆休み",
        }

        # モックの設定
        mock_response = MagicMock()
        mock_response.data = [{"id": 1}]
        mock_client.table.return_value.upsert.return_value.execute.return_value = (
            mock_response
        )

        response = client.post("/calendars/batch", json=payload, headers=headers)

        assert response.status_code == 200
        result = response.json()
        assert result["updated_count"] == 3
        assert result["total_count"] == 3

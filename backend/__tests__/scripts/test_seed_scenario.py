"""
seed_scenario.py のユニットテスト

主にロジックの検証を行う。実際のデータベース接続は行わない。
"""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# プロジェクトルートをパスに追加

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.seed_scenario import (
    import_groups,
    import_products,
    import_routings,
    load_json,
    resolve_path,
)


class TestUtils:
    """ヘルパー関数のテスト"""

    def test_load_json_existing_file(self, tmp_path):
        test_file = tmp_path / "test.json"
        test_data = [{"key": "value"}]
        test_file.write_text(json.dumps(test_data), encoding="utf-8")

        assert load_json(str(tmp_path), "test.json") == test_data

    def test_load_json_missing_file(self, tmp_path):
        assert load_json(str(tmp_path), "nonexistent.json") is None

    def test_resolve_path_valid_scenario(self):
        with patch("os.path.exists", return_value=True):
            assert "data/scenarios/standard_demo" in resolve_path("standard_demo")

    def test_resolve_path_invalid_scenario(self):
        with patch("os.path.exists", return_value=False):
            with pytest.raises(ValueError, match="Scenario directory not found"):
                resolve_path("invalid_scenario")


class TestImporters:
    """インポート処理のロジックテスト"""

    def test_import_groups(self, mock_db):
        test_data = [{"name": "Group1", "machines": ["Machine1"]}]

        with patch("scripts.seed_scenario.load_json", return_value=test_data):
            result = import_groups(mock_db["client"], "tenant-1", "/path")

        assert "Group1" in result
        # upsertが呼ばれたかを確認
        assert mock_db["table"].upsert.called

    def test_import_products(self, mock_db):
        # このテスト固有のID設定
        mock_db["execute"].execute.return_value.data = [{"id": 10}]
        test_data = [{"name": "Prod A", "code": "PROD-A", "type": "std"}]

        with patch("scripts.seed_scenario.load_json", return_value=test_data):
            result = import_products(mock_db["client"], "tenant-1", "/path")

        assert result["PROD-A"] == 10

    def test_import_routings_resolves_ids(self, mock_db):
        test_data = [
            {
                "product_code": "PROD-A",
                "routings": [
                    {
                        "process_name": "Proc1",
                        "group_name": "Group1",
                        "sequence_order": 1,
                        "unit_time_seconds": 600,
                        "setup_time_seconds": 1800,
                    }
                ],
            }
        ]

        with patch("scripts.seed_scenario.load_json", return_value=test_data):
            import_routings(
                mock_db["client"], "tenant-1", "/path", {"Group1": 5}, {"PROD-A": 10}
            )

        assert mock_db["table"].upsert.called

    def test_import_routings_skips_missing_product(self, mock_db):
        test_data = [
            {
                "product_code": "MISSING",
                "routings": [{"process_name": "Proc1", "group_name": "Group1"}],
            }
        ]

        with patch("scripts.seed_scenario.load_json", return_value=test_data):
            import_routings(
                mock_db["client"], "tenant-1", "/path", {"Group1": 5}, {"PROD-A": 10}
            )

        assert not mock_db["table"].upsert.called

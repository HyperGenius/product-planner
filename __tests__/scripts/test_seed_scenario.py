"""
seed_scenario.py のユニットテスト

主にロジックの検証を行う。実際のデータベース接続は行わない。
"""

import json
import os
import sys
from unittest.mock import Mock, patch

import pytest

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.seed_scenario import (
    import_groups,
    import_orders,
    import_products,
    import_routings,
    load_json,
    resolve_path,
)


def test_load_json_existing_file(tmp_path):
    """JSONファイルが存在する場合、正しく読み込める"""
    test_file = tmp_path / "test.json"
    test_data = [{"key": "value"}]
    test_file.write_text(json.dumps(test_data), encoding="utf-8")

    result = load_json(str(tmp_path), "test.json")
    assert result == test_data


def test_load_json_missing_file(tmp_path):
    """JSONファイルが存在しない場合、Noneを返す"""
    result = load_json(str(tmp_path), "nonexistent.json")
    assert result is None


def test_resolve_path_valid_scenario():
    """有効なシナリオ名の場合、正しいパスを返す"""
    with patch("os.path.exists", return_value=True):
        result = resolve_path("standard_demo")
        assert "data/scenarios/standard_demo" in result


def test_resolve_path_invalid_scenario():
    """無効なシナリオ名の場合、ValueErrorを発生させる"""
    with patch("os.path.exists", return_value=False):
        with pytest.raises(ValueError, match="Scenario directory not found"):
            resolve_path("invalid_scenario")


def test_import_groups_creates_groups_and_machines():
    """設備グループと設備が正しく作成される"""
    # モッククライアント
    mock_client = Mock()
    mock_table = Mock()
    mock_client.table.return_value = mock_table

    # insert().execute() チェーンのモック
    mock_execute = Mock()
    mock_execute.execute.return_value.data = [{"id": 1}]
    mock_table.insert.return_value = mock_execute

    # テストデータ
    test_data = [
        {"name": "Group1", "machines": ["Machine1", "Machine2"]},
    ]

    with patch("scripts.seed_scenario.load_json", return_value=test_data):
        result = import_groups(mock_client, "tenant-123", "/fake/path")

    # グループマップが返されることを確認
    assert "Group1" in result
    assert isinstance(result["Group1"], int)


def test_import_products_creates_products():
    """製品が正しく作成される"""
    # モッククライアント
    mock_client = Mock()
    mock_table = Mock()
    mock_client.table.return_value = mock_table

    # insert().execute() チェーンのモック
    mock_execute = Mock()
    mock_execute.execute.return_value.data = [{"id": 10}]
    mock_table.insert.return_value = mock_execute

    # テストデータ
    test_data = [
        {"name": "Product A", "code": "PROD-A", "type": "standard"},
    ]

    with patch("scripts.seed_scenario.load_json", return_value=test_data):
        result = import_products(mock_client, "tenant-123", "/fake/path")

    # 製品マップが返されることを確認
    assert "PROD-A" in result
    assert result["PROD-A"] == 10


def test_import_routings_resolves_ids():
    """工程定義で製品IDとグループIDが正しく解決される"""
    # モッククライアント
    mock_client = Mock()
    mock_table = Mock()
    mock_client.table.return_value = mock_table

    # insert().execute() チェーンのモック
    mock_execute = Mock()
    mock_execute.execute.return_value.data = [{"id": 100}]
    mock_table.insert.return_value = mock_execute

    # テストデータ
    test_data = [
        {
            "product_code": "PROD-A",
            "routings": [
                {
                    "process_name": "Process1",
                    "group_name": "Group1",
                    "sequence_order": 1,
                    "unit_time_seconds": 600,
                    "setup_time_seconds": 1800,
                }
            ],
        }
    ]

    # マッピング辞書
    group_map = {"Group1": 5}
    product_map = {"PROD-A": 10}

    with patch("scripts.seed_scenario.load_json", return_value=test_data):
        import_routings(mock_client, "tenant-123", "/fake/path", group_map, product_map)

    # insert が呼ばれたことを確認
    assert mock_table.insert.called


def test_import_orders_resolves_product_ids():
    """注文データで製品IDが正しく解決される"""
    # モッククライアント
    mock_client = Mock()
    mock_table = Mock()
    mock_client.table.return_value = mock_table

    # insert().execute() チェーンのモック
    mock_execute = Mock()
    mock_execute.execute.return_value.data = [{"id": 200}]
    mock_table.insert.return_value = mock_execute

    # テストデータ
    test_data = [
        {
            "order_number": "ORD-001",
            "product_code": "PROD-A",
            "quantity": 100,
            "deadline_date": "2025-01-15",
        }
    ]

    # マッピング辞書
    product_map = {"PROD-A": 10}

    with patch("scripts.seed_scenario.load_json", return_value=test_data):
        import_orders(mock_client, "tenant-123", "/fake/path", product_map)

    # insert が呼ばれたことを確認
    assert mock_table.insert.called


def test_import_routings_skips_missing_product():
    """存在しない製品コードの場合、工程定義をスキップする"""
    mock_client = Mock()
    mock_table = Mock()
    mock_client.table.return_value = mock_table

    test_data = [
        {
            "product_code": "PROD-MISSING",
            "routings": [{"process_name": "Process1", "group_name": "Group1"}],
        }
    ]

    group_map = {"Group1": 5}
    product_map = {"PROD-A": 10}  # PROD-MISSING がない

    with patch("scripts.seed_scenario.load_json", return_value=test_data):
        import_routings(mock_client, "tenant-123", "/fake/path", group_map, product_map)

    # insert が呼ばれないことを確認
    assert not mock_table.insert.called


def test_import_orders_skips_missing_product():
    """存在しない製品コードの場合、注文をスキップする"""
    mock_client = Mock()
    mock_table = Mock()
    mock_client.table.return_value = mock_table

    test_data = [
        {
            "order_number": "ORD-001",
            "product_code": "PROD-MISSING",
            "quantity": 100,
        }
    ]

    product_map = {"PROD-A": 10}  # PROD-MISSING がない

    with patch("scripts.seed_scenario.load_json", return_value=test_data):
        import_orders(mock_client, "tenant-123", "/fake/path", product_map)

    # insert が呼ばれないことを確認
    assert not mock_table.insert.called

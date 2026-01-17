# __tests__/scripts/conftest.py
from unittest.mock import Mock

import pytest


@pytest.fixture
def mock_db():
    """DBクライアントとテーブル、実行結果のモックをまとめて返す"""
    client = Mock()
    table = Mock()
    execute = Mock()

    client.table.return_value = table
    table.insert.return_value = execute
    # デフォルトの返り値 (必要に応じてテスト内で上書き可能)
    execute.execute.return_value.data = [{"id": 1}]

    return {"client": client, "table": table, "execute": execute}

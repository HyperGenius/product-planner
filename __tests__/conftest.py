import pytest


def pytest_addoption(parser):
    """--run-integration オプションを追加"""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="run integration tests",
    )


def pytest_collection_modifyitems(config, items):
    """オプションが指定された場合のみ、integrationマーカーが付いたテストを実行"""

    # オプションが指定されていない場合、integrationマーカーが付いたテストをスキップ
    if config.getoption("--run-integration"):
        return

    skip_integration = pytest.mark.skip(reason="need --run-integration option to run")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_integration)

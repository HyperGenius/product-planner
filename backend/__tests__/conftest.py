import uuid

import pytest


def pytest_addoption(parser):
    """--run-integration / --run-e2e オプションを追加"""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="run integration tests (requires Supabase)",
    )
    parser.addoption(
        "--run-e2e",
        action="store_true",
        default=False,
        help="run E2E tests (requires Gmail + Supabase)",
    )


def pytest_collection_modifyitems(config, items):
    """オプションが指定されていない場合、対応するマーカーのテストをスキップ"""
    run_integration = config.getoption("--run-integration")
    run_e2e = config.getoption("--run-e2e")

    skip_integration = pytest.mark.skip(reason="need --run-integration option to run")
    skip_e2e = pytest.mark.skip(reason="need --run-e2e option to run")

    for item in items:
        if "integration" in item.keywords and not run_integration:
            item.add_marker(skip_integration)
        if "e2e" in item.keywords and not run_e2e:
            item.add_marker(skip_e2e)


@pytest.fixture
def headers():
    """共通のヘッダーフィクスチャ"""
    return {"x-tenant-id": str(uuid.uuid4())}

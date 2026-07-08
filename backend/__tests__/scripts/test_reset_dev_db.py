"""
reset_dev_db.py のユニットテスト

主に安全チェック（SUPABASE_URL がローカルを指しているか）のロジックを検証する。
実際の supabase CLI 呼び出しやDB接続は行わない。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.reset_dev_db import assert_local_supabase_url


class TestAssertLocalSupabaseUrl:
    """SUPABASE_URL のローカル判定のテスト"""

    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1:54321",
            "http://localhost:54321",
            "https://localhost",
        ],
    )
    def test_allows_local_urls(self, monkeypatch, url):
        monkeypatch.setenv("SUPABASE_URL", url)
        assert_local_supabase_url()  # 例外が発生しなければOK

    @pytest.mark.parametrize(
        "url",
        [
            "https://xyzcompany.supabase.co",
            "https://staging.example.com",
            "",
        ],
    )
    def test_rejects_non_local_urls(self, monkeypatch, url):
        monkeypatch.setenv("SUPABASE_URL", url)
        with pytest.raises(ValueError, match="ローカル"):
            assert_local_supabase_url()

"""
agent_token_service の単体テスト (Issue #469)
"""

import re

import pytest
from app.services.agent_token_service import generate_agent_token, hash_agent_token


@pytest.mark.unit
class TestGenerateAgentToken:
    def test_token_is_urlsafe_and_long_enough(self):
        """32バイトの token_urlsafe は43文字の URL 安全な文字列になる"""
        token = generate_agent_token()
        assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)

    def test_tokens_are_unique(self):
        tokens = {generate_agent_token() for _ in range(100)}
        assert len(tokens) == 100


@pytest.mark.unit
class TestHashAgentToken:
    def test_known_vector(self):
        """SHA-256("abc") の既知の値と一致する（ハッシュ方式が変わっていないことの回帰）"""
        assert hash_agent_token("abc") == (
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )

    def test_hash_is_64_lowercase_hex(self):
        """DB の CHECK 制約 (^[0-9a-f]{64}$) を満たす形式で返す"""
        assert re.fullmatch(r"[0-9a-f]{64}", hash_agent_token(generate_agent_token()))

    def test_hash_is_deterministic(self):
        token = generate_agent_token()
        assert hash_agent_token(token) == hash_agent_token(token)

    def test_different_tokens_have_different_hashes(self):
        assert hash_agent_token("token-a") != hash_agent_token("token-b")

    def test_hash_does_not_contain_plaintext(self):
        token = generate_agent_token()
        assert token not in hash_agent_token(token)

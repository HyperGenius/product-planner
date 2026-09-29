# backend/app/services/agent_token_service.py
"""日報取り込みエージェント用トークンの生成・ハッシュ化 (Issue #469)。

平文トークンは発行時に1回表示するだけで保存せず、DB (`agent_tokens.token_hash`)
には SHA-256 の hex だけを保存する。トークンは高エントロピーな乱数なので
bcrypt 等の低速ハッシュは不要で、ハッシュ値の UNIQUE インデックスで直接引ける。

発行 CLI (`backend/scripts/issue_agent_token.py`) と、リクエスト認証の
dependency の両方がこのモジュールを使う（ハッシュ方式を1箇所に揃えるため）。
"""

import hashlib
import secrets

# secrets.token_urlsafe の引数（バイト数）。32バイト = 256bit
_TOKEN_BYTES = 32


def generate_agent_token() -> str:
    """新しいエージェントトークン（平文）を生成する。"""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_agent_token(token: str) -> str:
    """エージェントトークンを DB 保存・照合用の SHA-256 hex に変換する。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

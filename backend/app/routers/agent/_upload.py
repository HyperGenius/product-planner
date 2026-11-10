"""raw body（octet-stream）でファイルを受けるエンドポイントの共通処理 (Issue #471 / #662)。

日報（`daily_reports.py`）と弥生の送品ファイル（`shipment_files.py`）、アプリからの
アップロードで同じ検証を使う。`UploadFile` を使わないのは、サイズ上限と SHA-256 を
ボディを読みながら検証するため（CLAUDE.md「raw body を受けるエンドポイント」）。
"""

import hashlib

from fastapi import HTTPException, Request, status


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def too_large() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail="File too large.",
    )


def required_header(request: Request, name: str) -> str:
    value = request.headers.get(name)
    if value is None or not value.strip():
        raise bad_request(f"Missing required header: {name}.")
    return value


def declared_content_length(request: Request) -> int | None:
    raw = request.headers.get("Content-Length")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


async def read_body_with_limit(request: Request, max_bytes: int) -> tuple[bytes, str]:
    """上限を超えた時点で 413 を投げながらボディを読み、`(content, sha256)` を返す。

    `Content-Length` 省略（チャンク転送）にも対応するため、宣言値ではなく
    実際に読んだ累計バイト数で判定する。
    """
    hasher = hashlib.sha256()
    buf = bytearray()
    async for chunk in request.stream():
        if len(buf) + len(chunk) > max_bytes:
            raise too_large()
        hasher.update(chunk)
        buf.extend(chunk)
    return bytes(buf), hasher.hexdigest()

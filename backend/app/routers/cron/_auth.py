import os
import secrets

from fastapi import HTTPException, Request, status


def validate_cron_secret(request: Request) -> None:
    cron_secret = os.environ.get("CRON_SECRET")
    if not cron_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CRON_SECRET not configured.",
        )
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )
    token = auth_header.removeprefix("Bearer ")
    if not secrets.compare_digest(token.encode(), cron_secret.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid CRON_SECRET.",
        )

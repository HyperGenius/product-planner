import os
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.utils.logger import get_logger

logger = get_logger(__name__)

_GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


def _build_gmail_client():
    client_id = os.environ.get("GMAIL_CLIENT_ID")
    client_secret = os.environ.get("GMAIL_CLIENT_SECRET")
    refresh_token = os.environ.get("GMAIL_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        raise ValueError(
            "Missing Gmail OAuth env vars: GMAIL_CLIENT_ID, "
            "GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN must all be set."
        )

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=_GMAIL_SCOPES,
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def poll_unread_emails() -> dict[str, Any]:
    """未読メールを取得し、処理済みラベルを付与して件数を返す。"""
    query_filter = os.environ.get("GMAIL_QUERY_FILTER", "is:unread")
    label_processed = os.environ.get("GMAIL_LABEL_PROCESSED", "Label_processed")

    logger.info(f"Gmail poll: query='{query_filter}' label='{label_processed}'")

    service = _build_gmail_client()
    messages: list[dict] = []
    page_token: str | None = None

    while True:
        kwargs: dict[str, Any] = {
            "userId": "me",
            "q": query_filter,
            "maxResults": 500,
        }
        if page_token:
            kwargs["pageToken"] = page_token

        result = service.users().messages().list(**kwargs).execute()
        messages.extend(result.get("messages", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    if not messages:
        logger.info("Gmail poll: no unread messages.")
        return {"processed": 0}

    msg_ids = [m["id"] for m in messages]
    logger.info(f"Gmail poll: {len(msg_ids)} messages to process.")

    for i in range(0, len(msg_ids), 1000):
        service.users().messages().batchModify(
            userId="me",
            body={
                "ids": msg_ids[i : i + 1000],
                "addLabelIds": [label_processed],
                "removeLabelIds": ["UNREAD"],
            },
        ).execute()

    logger.info(f"Gmail poll: labeled {len(msg_ids)} messages.")
    return {"processed": len(msg_ids)}

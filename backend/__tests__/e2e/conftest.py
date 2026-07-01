"""
E2E テスト共通フィクスチャ

実際の Gmail API と Supabase（開発環境）に接続して動作を検証する。
以下の環境変数がすべて設定されている必要がある:

  GMAIL_CLIENT_ID           Gmail OAuth クライアントID
  GMAIL_CLIENT_SECRET       Gmail OAuth クライアントシークレット
  GMAIL_REFRESH_TOKEN       Gmail OAuth リフレッシュトークン
  SUPABASE_URL              Supabase プロジェクト URL
  SUPABASE_SERVICE_ROLE_KEY Supabase サービスロールキー
  E2E_GMAIL_TENANT_NAME     Gmailラベルのテナント名部分 (例: "株式会社テスト")
                            このテナントが gmail_label_tenants テーブルに登録済みであること

テスト実行:
  cd backend && pytest __tests__/e2e/ -v --run-e2e
"""

import base64
import email.mime.application
import email.mime.multipart
import email.mime.text
import os
import uuid
from collections.abc import Generator
from typing import Any, cast

import pytest
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from supabase import Client, create_client

load_dotenv()

# 最小限の有効な PDF (1ページ、白紙)
_MINIMAL_PDF = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f\x20
0000000009 00000 n\x20
0000000058 00000 n\x20
0000000115 00000 n\x20
trailer
<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF
"""

_GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
_LABEL_PREFIX_PENDING = os.environ.get("GMAIL_LABEL_PREFIX_PENDING", "pp-pending")
_LABEL_PREFIX_DONE = os.environ.get("GMAIL_LABEL_PREFIX_DONE", "pp-done")
_LABEL_PREFIX_ERROR = os.environ.get("GMAIL_LABEL_PREFIX_ERROR", "pp-error")


# ---------------------------------------------------------------------------
# 環境変数チェック
# ---------------------------------------------------------------------------

_REQUIRED_VARS = [
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "E2E_GMAIL_TENANT_NAME",
]


@pytest.fixture(scope="session")
def e2e_config() -> dict[str, str]:
    """必須環境変数を読み込み、未設定のものがあれば skip する。"""
    missing = [v for v in _REQUIRED_VARS if not os.environ.get(v)]
    if missing:
        pytest.skip(f"E2E env vars not set: {', '.join(missing)}")
    return {v: os.environ[v] for v in _REQUIRED_VARS}


# ---------------------------------------------------------------------------
# Gmail API クライアント
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def gmail_service(e2e_config: dict[str, str]):
    """認証済み Gmail API サービスオブジェクトを返す。"""
    creds = Credentials(
        token=None,
        refresh_token=e2e_config["GMAIL_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=e2e_config["GMAIL_CLIENT_ID"],
        client_secret=e2e_config["GMAIL_CLIENT_SECRET"],
        scopes=_GMAIL_SCOPES,
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


@pytest.fixture(scope="session")
def label_id_map(gmail_service) -> dict[str, str]:
    """ラベル名 → Gmail label ID の全件マップを返す。"""
    result = gmail_service.users().labels().list(userId="me").execute()
    return {lbl["name"]: lbl["id"] for lbl in result.get("labels", [])}


@pytest.fixture(scope="session")
def pending_label_id(label_id_map: dict[str, str], e2e_config: dict[str, str]) -> str:
    """
    テスト用テナントの pending ラベル ID を返す。
    ラベルが存在しない場合はスキップする。
    """
    tenant_name = e2e_config["E2E_GMAIL_TENANT_NAME"]
    label_name = f"{_LABEL_PREFIX_PENDING}/{tenant_name}"
    label_id = label_id_map.get(label_name)
    if not label_id:
        pytest.skip(
            f"Gmail label '{label_name}' not found. "
            "Create the label in Gmail and register it in gmail_label_tenants."
        )
    return label_id


# ---------------------------------------------------------------------------
# Supabase 管理クライアント
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def admin_db(e2e_config: dict[str, str]) -> Client:
    """Service Role Key を使った Supabase 管理者クライアントを返す。"""
    return create_client(
        e2e_config["SUPABASE_URL"],
        e2e_config["SUPABASE_SERVICE_ROLE_KEY"],
    )


# ---------------------------------------------------------------------------
# Gmail メッセージ注入ヘルパー
# ---------------------------------------------------------------------------


def _build_raw_email(
    subject: str,
    body: str,
    sender: str,
    pdf_bytes: bytes | None = None,
    pdf_filename: str = "order.pdf",
) -> str:
    """RFC 2822 形式のメールを base64url エンコードした文字列を返す。"""
    msg = email.mime.multipart.MIMEMultipart()
    msg["To"] = "me"
    msg["From"] = sender
    msg["Subject"] = subject
    msg.attach(email.mime.text.MIMEText(body, "plain", "utf-8"))

    if pdf_bytes is not None:
        attachment = email.mime.application.MIMEApplication(pdf_bytes, _subtype="pdf")
        attachment.add_header(
            "Content-Disposition", "attachment", filename=pdf_filename
        )
        msg.attach(attachment)

    return base64.urlsafe_b64encode(msg.as_bytes()).decode()


@pytest.fixture()
def inject_email_with_pdf(
    gmail_service,
    pending_label_id: str,
    e2e_config: dict[str, str],
    admin_db: Client,
) -> Generator[dict[str, Any], None, None]:
    """
    PDF 添付付きテストメールを Gmail に注入し、テスト後にクリーンアップする。

    yield するdict:
        message_id: Gmail メッセージ ID
        run_id:     このテスト実行を識別するユニーク文字列 (件名に埋め込み済み)
        sender:     送信者メールアドレス
    """
    run_id = uuid.uuid4().hex[:8]
    sender = f"e2e-test-{run_id}@example.com"
    subject = f"【E2Eテスト】注文書 {run_id}"
    body = (
        f"E2Eテストメールです。run_id={run_id}\n\n"
        "製品: テスト製品A\n"
        "数量: 5\n"
        "希望納期: 2026-12-31\n"
    )
    pdf_filename = f"order_{run_id}.pdf"

    raw = _build_raw_email(subject, body, sender, _MINIMAL_PDF, pdf_filename)
    response = (
        gmail_service.users()
        .messages()
        .insert(
            userId="me",
            body={"raw": raw, "labelIds": [pending_label_id]},
        )
        .execute()
    )
    message_id = response["id"]

    context: dict[str, Any] = {
        "message_id": message_id,
        "run_id": run_id,
        "sender": sender,
        "pdf_filename": pdf_filename,
    }
    yield context

    # --- teardown: Gmail メッセージを削除 ---
    try:
        gmail_service.users().messages().delete(userId="me", id=message_id).execute()
    except Exception:
        pass  # already deleted or label moved — ignore

    # --- teardown: Supabase の order / order_attachments / Storage を削除 ---
    _cleanup_supabase(admin_db, e2e_config, run_id)


@pytest.fixture()
def inject_email_without_attachment(
    gmail_service,
    pending_label_id: str,
    e2e_config: dict[str, str],
    admin_db: Client,
) -> Generator[dict[str, Any], None, None]:
    """
    添付なしテストメールを Gmail に注入し、テスト後にクリーンアップする。
    """
    run_id = uuid.uuid4().hex[:8]
    sender = f"e2e-test-{run_id}@example.com"
    subject = f"【E2Eテスト】添付なし {run_id}"
    body = (
        f"E2Eテストメール（添付なし）。run_id={run_id}\n\n"
        "製品: テスト製品B\n"
        "数量: 3\n"
        "希望納期: 2026-11-30\n"
    )

    raw = _build_raw_email(subject, body, sender, pdf_bytes=None)
    response = (
        gmail_service.users()
        .messages()
        .insert(
            userId="me",
            body={"raw": raw, "labelIds": [pending_label_id]},
        )
        .execute()
    )
    message_id = response["id"]

    context: dict[str, Any] = {
        "message_id": message_id,
        "run_id": run_id,
        "sender": sender,
    }
    yield context

    # --- teardown ---
    try:
        gmail_service.users().messages().delete(userId="me", id=message_id).execute()
    except Exception:
        pass

    _cleanup_supabase(admin_db, e2e_config, run_id)


def _cleanup_supabase(
    admin_db: Client, e2e_config: dict[str, str], run_id: str
) -> None:
    """
    E2E テストで作成した Supabase レコードと Storage ファイルを削除する。
    source_raw に run_id が含まれる order / order_attachments (ステージング行) を
    特定して削除する。
    """
    # run_id を含む order を検索（非PDF添付・添付なしメールの既存フロー）
    order_result = (
        admin_db.table("orders")
        .select("id, tenant_id")
        .like("source_raw", f"%run_id={run_id}%")
        .execute()
    )
    order_rows = cast(list[dict[str, Any]], order_result.data or [])

    for row in order_rows:
        order_id = row["id"]

        # order_attachments の storage_path を取得してから Storage を削除
        att_result = (
            admin_db.table("order_attachments")
            .select("storage_path")
            .eq("order_id", order_id)
            .execute()
        )
        for att in cast(list[dict[str, Any]], att_result.data or []):
            path = str(att.get("storage_path", ""))
            if path:
                try:
                    admin_db.storage.from_("order-attachments").remove([path])
                except Exception:
                    pass

        # order を削除 (order_attachments は cascade で削除される)
        admin_db.table("orders").delete().eq("id", order_id).execute()

    # run_id を含む order_attachments ステージング行を検索（PDF添付メールの新フロー）
    staging_result = (
        admin_db.table("order_attachments")
        .select("id, storage_path")
        .is_("order_id", "null")
        .like("source_raw", f"%run_id={run_id}%")
        .execute()
    )
    for att in cast(list[dict[str, Any]], staging_result.data or []):
        path = str(att.get("storage_path", ""))
        if path:
            try:
                admin_db.storage.from_("order-attachments").remove([path])
            except Exception:
                pass
        admin_db.table("order_attachments").delete().eq("id", att["id"]).execute()

"""
Integration テスト: 顧客ごとの抽出指示の編集・試し読み（Issue #602）

以下は実際の Postgres (RLS込み)・Storage でしか検証できないため integration tier に置く。
- RPC save_customer_extraction_prompt が顧客の指示の更新と履歴の追記を行い、画面以外で入った値を
  「変更前」の版として残すこと。同じ内容なら何も書かないこと。platform_admin 以外は 42501
- 履歴はユーザー JWT で直接追記・変更できないこと（追記のみ）
- order-attachments バケットをユーザー JWT で自テナントだけ読めること（試し読みのダウンロード）
- 試し読みに選べる添付が同じテナント・同じ顧客の受信PDFに限られること

実行:
  supabase start
  cd backend && pytest __tests__/integration/test_customer_extraction_prompt.py -v --run-integration
"""

import os
import uuid
from typing import Any, cast

import pytest
from app.services.attachment_service import download_attachment
from app.services.extraction_prompt_preview_service import (
    find_customer_pdf_attachment,
    list_customer_pdf_attachments,
)
from postgrest.exceptions import APIError
from storage3.exceptions import StorageApiError

from supabase import Client, ClientOptions, create_client

_BUCKET = "order-attachments"


def _rows(res) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], res.data)


def _insert(admin_db, table: str, values: dict[str, Any] | list[dict[str, Any]]):
    return _rows(admin_db.table(table).insert(values).execute())


@pytest.fixture(scope="module")
def user_db(auth_token) -> Client:
    """アプリの get_supabase_client と同じく、ユーザー JWT をヘッダーに載せたクライアント。"""
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_ANON_KEY"],
        options=ClientOptions(headers={"Authorization": f"Bearer {auth_token}"}),
    )


def _create_tenant(admin_db, auth_user_id, role: str | None) -> str:
    tenant_id = _insert(
        admin_db, "tenants", {"name": f"integration extraction prompt {uuid.uuid4()}"}
    )[0]["id"]
    if role is not None:
        _insert(
            admin_db,
            "organization_members",
            {"user_id": auth_user_id, "tenant_id": tenant_id, "role": role},
        )
    return tenant_id


def _cleanup_tenant(admin_db, auth_user_id, tenant_id: str) -> None:
    for table in ("orders", "order_attachments", "customers"):
        admin_db.table(table).delete().eq("tenant_id", tenant_id).execute()
    admin_db.table("organization_members").delete().eq("user_id", auth_user_id).eq(
        "tenant_id", tenant_id
    ).execute()
    admin_db.table("tenants").delete().eq("id", tenant_id).execute()


@pytest.fixture()
def seeded(admin_db, auth_user_id):
    """ログインユーザーが platform_admin のテナントと、所属していない他テナント。"""
    tenant_id = _create_tenant(admin_db, auth_user_id, "platform_admin")
    other_tenant_id = _create_tenant(admin_db, auth_user_id, None)
    customer_id, other_customer_id = (
        c["id"]
        for c in _insert(
            admin_db,
            "customers",
            [
                {
                    "tenant_id": tenant_id,
                    "name": "顧客A社",
                    "order_extraction_prompt": "SQLで入れた指示",
                },
                {"tenant_id": tenant_id, "name": "顧客B社"},
            ],
        )
    )
    foreign_customer_id = _insert(
        admin_db, "customers", {"tenant_id": other_tenant_id, "name": "他社の顧客"}
    )[0]["id"]

    yield {
        "tenant_id": tenant_id,
        "other_tenant_id": other_tenant_id,
        "customer_id": customer_id,
        "other_customer_id": other_customer_id,
        "foreign_customer_id": foreign_customer_id,
    }

    _cleanup_tenant(admin_db, auth_user_id, tenant_id)
    _cleanup_tenant(admin_db, auth_user_id, other_tenant_id)


def _save(db: Client, tenant_id: str, customer_id: int, prompt: str | None):
    return _rows(
        db.rpc(
            "save_customer_extraction_prompt",
            {
                "p_tenant_id": tenant_id,
                "p_customer_id": customer_id,
                "p_prompt": prompt,
            },
        ).execute()
    )[0]


def _history(admin_db, customer_id: int) -> list[dict[str, Any]]:
    return _rows(
        admin_db.table("customer_extraction_prompt_history")
        .select("prompt, changed_by")
        .eq("customer_id", customer_id)
        .order("id")
        .execute()
    )


def _current_prompt(admin_db, customer_id: int) -> str | None:
    return _rows(
        admin_db.table("customers")
        .select("order_extraction_prompt")
        .eq("id", customer_id)
        .execute()
    )[0]["order_extraction_prompt"]


@pytest.mark.integration
class TestSaveCustomerExtractionPrompt:
    def test_save_records_previous_value_and_new_version(
        self, admin_db, user_db, auth_user_id, seeded
    ):
        customer_id = seeded["customer_id"]

        result = _save(user_db, seeded["tenant_id"], customer_id, "  新しい指示 ")

        assert result == {"changed": True, "saved_prompt": "新しい指示"}
        assert _current_prompt(admin_db, customer_id) == "新しい指示"
        # マイグレーションより後に SQL で入った値は、変更前の版（changed_by NULL）として残る
        assert _history(admin_db, customer_id) == [
            {"prompt": "SQLで入れた指示", "changed_by": None},
            {"prompt": "新しい指示", "changed_by": auth_user_id},
        ]

    def test_same_prompt_writes_nothing(self, admin_db, user_db, seeded):
        customer_id = seeded["customer_id"]
        _save(user_db, seeded["tenant_id"], customer_id, "新しい指示")

        result = _save(user_db, seeded["tenant_id"], customer_id, "新しい指示\n")

        assert result == {"changed": False, "saved_prompt": "新しい指示"}
        assert len(_history(admin_db, customer_id)) == 2

    def test_empty_prompt_clears_to_null_and_revert_is_a_new_version(
        self, admin_db, user_db, auth_user_id, seeded
    ):
        customer_id = seeded["customer_id"]
        _save(user_db, seeded["tenant_id"], customer_id, "新しい指示")

        assert _save(user_db, seeded["tenant_id"], customer_id, "   ")["changed"]
        assert _current_prompt(admin_db, customer_id) is None

        _save(user_db, seeded["tenant_id"], customer_id, "SQLで入れた指示")
        assert [h["prompt"] for h in _history(admin_db, customer_id)] == [
            "SQLで入れた指示",
            "新しい指示",
            None,
            "SQLで入れた指示",
        ]

    def test_customer_without_prompt_has_no_snapshot(self, admin_db, user_db, seeded):
        customer_id = seeded["other_customer_id"]

        _save(user_db, seeded["tenant_id"], customer_id, "指示")

        assert [h["prompt"] for h in _history(admin_db, customer_id)] == ["指示"]

    def test_too_long_prompt_is_rejected(self, admin_db, user_db, seeded):
        with pytest.raises(APIError) as exc_info:
            _save(user_db, seeded["tenant_id"], seeded["customer_id"], "あ" * 2001)

        assert exc_info.value.code == "22001"
        assert _current_prompt(admin_db, seeded["customer_id"]) == "SQLで入れた指示"

    @pytest.mark.parametrize("role", ["president", "order_handler"])
    def test_non_platform_admin_is_rejected(
        self, admin_db, user_db, auth_user_id, seeded, role
    ):
        admin_db.table("organization_members").update({"role": role}).eq(
            "user_id", auth_user_id
        ).eq("tenant_id", seeded["tenant_id"]).execute()

        with pytest.raises(APIError) as exc_info:
            _save(user_db, seeded["tenant_id"], seeded["customer_id"], "指示")

        assert exc_info.value.code == "42501"
        assert _history(admin_db, seeded["customer_id"]) == []

    def test_customer_of_other_tenant_is_not_found(self, user_db, seeded):
        # 他テナントの顧客を自テナントの ID で指定しても更新できない
        with pytest.raises(APIError) as exc_info:
            _save(user_db, seeded["tenant_id"], seeded["foreign_customer_id"], "指示")

        assert exc_info.value.code == "P0002"

    def test_history_cannot_be_written_directly(
        self, admin_db, user_db, auth_user_id, seeded
    ):
        _save(user_db, seeded["tenant_id"], seeded["customer_id"], "新しい指示")
        table = user_db.table("customer_extraction_prompt_history")

        with pytest.raises(APIError):
            table.insert(
                {
                    "tenant_id": seeded["tenant_id"],
                    "customer_id": seeded["customer_id"],
                    "prompt": "偽の版",
                    "changed_by": auth_user_id,
                }
            ).execute()
        updated = (
            table.update({"prompt": "書き換え"})
            .eq("customer_id", seeded["customer_id"])
            .execute()
        )
        deleted = table.delete().eq("customer_id", seeded["customer_id"]).execute()

        assert updated.data == [] and deleted.data == []
        assert len(_history(admin_db, seeded["customer_id"])) == 2


@pytest.fixture()
def stored_pdfs(admin_db, seeded):
    """自テナント・他テナントの受信PDF（Storage とステージング行）。"""
    paths = {
        "own": f"{seeded['tenant_id']}/inbox/msg-{uuid.uuid4()}/order.pdf",
        "foreign": f"{seeded['other_tenant_id']}/inbox/msg-{uuid.uuid4()}/order.pdf",
    }
    storage = admin_db.storage.from_(_BUCKET)
    for path in paths.values():
        storage.upload(
            path=path,
            file=b"%PDF-1.4 test",
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
    yield paths
    storage.remove(list(paths.values()))


@pytest.mark.integration
class TestAttachmentAccess:
    def test_user_jwt_reads_only_own_tenant_objects(self, user_db, stored_pdfs):
        assert download_attachment(user_db, stored_pdfs["own"]) == b"%PDF-1.4 test"

        with pytest.raises(StorageApiError):
            download_attachment(user_db, stored_pdfs["foreign"])

    def test_attachments_are_limited_to_same_tenant_and_customer(
        self, admin_db, user_db, seeded, stored_pdfs
    ):
        base = {
            "storage_path": stored_pdfs["own"],
            "content_type": "application/pdf",
            "parse_status": "success",
        }
        own, other_customer, via_order, not_pdf = (
            row["id"]
            for row in _insert(
                admin_db,
                "order_attachments",
                [
                    {
                        **base,
                        "tenant_id": seeded["tenant_id"],
                        "customer_id": seeded["customer_id"],
                        "original_filename": "own.pdf",
                    },
                    {
                        **base,
                        "tenant_id": seeded["tenant_id"],
                        "customer_id": seeded["other_customer_id"],
                        "original_filename": "other.pdf",
                    },
                    # メール単位の顧客は別だが、PDFの文面から顧客A社の受注を起票した（Issue #385）
                    {
                        **base,
                        "tenant_id": seeded["tenant_id"],
                        "customer_id": seeded["other_customer_id"],
                        "original_filename": "bundled.pdf",
                    },
                    {
                        **base,
                        "tenant_id": seeded["tenant_id"],
                        "customer_id": seeded["customer_id"],
                        "original_filename": "body.txt",
                        "content_type": "text/plain",
                    },
                ],
            )
        )
        foreign = _insert(
            admin_db,
            "order_attachments",
            {
                **base,
                "storage_path": stored_pdfs["foreign"],
                "tenant_id": seeded["other_tenant_id"],
                "customer_id": seeded["foreign_customer_id"],
                "original_filename": "foreign.pdf",
            },
        )[0]["id"]
        _insert(
            admin_db,
            "orders",
            {
                "tenant_id": seeded["tenant_id"],
                "customer_id": seeded["customer_id"],
                "status": "draft",
                "source_type": "email",
                "source_attachment_id": via_order,
            },
        )

        listed = list_customer_pdf_attachments(
            user_db, seeded["tenant_id"], seeded["customer_id"]
        )

        assert sorted(row["original_filename"] for row in listed) == [
            "bundled.pdf",
            "own.pdf",
        ]
        find = lambda attachment_id: find_customer_pdf_attachment(  # noqa: E731
            user_db, seeded["tenant_id"], seeded["customer_id"], attachment_id
        )
        assert find(own) is not None
        assert find(via_order) is not None
        assert find(other_customer) is None
        assert find(not_pdf) is None
        assert find(foreign) is None

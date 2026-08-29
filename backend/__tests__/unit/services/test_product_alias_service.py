from unittest.mock import MagicMock

import pytest
from app.services.product_alias_service import record_correction_if_applicable
from postgrest.exceptions import APIError

_ALIASES = "product_name_aliases"
_HISTORY = "product_name_alias_history"
_PRODUCTS = "products"
_CUSTOMERS = "customers"


@pytest.mark.unit
class TestRecordCorrectionIfApplicable:
    def _mock_db(
        self, existing_alias_rows=None, product_name="製品A", customer_name="顧客X"
    ):
        """テーブル名ごとに独立したモックを返す db クライアント。

        MagicMock().table("x") と .table("y") は既定では同一の子モックを
        返してしまい、テーブルを跨いだ呼び出し（product_name_aliases /
        product_name_alias_history / products / customers）を区別できないため、
        テーブル名で分岐する side_effect を設定する。
        """
        tables: dict[str, MagicMock] = {
            _ALIASES: MagicMock(),
            _HISTORY: MagicMock(),
            _PRODUCTS: MagicMock(),
            _CUSTOMERS: MagicMock(),
        }

        # 別名は (tenant_id, customer_id, raw_text) でスコープするため eq が3段（Issue #349）
        tables[_ALIASES].select().eq().eq().eq().execute.return_value = MagicMock(
            data=existing_alias_rows or []
        )
        tables[_PRODUCTS].select().eq().single().execute.return_value = MagicMock(
            data={"name": product_name}
        )
        tables[_CUSTOMERS].select().eq().single().execute.return_value = MagicMock(
            data={"name": customer_name}
        )

        mock_db = MagicMock()
        mock_db.table.side_effect = lambda name: tables[name]
        mock_db._tables = tables
        return mock_db

    def test_skips_when_source_type_is_not_email(self):
        mock_db = self._mock_db()
        order_before = {"id": 1, "product_id": 1}
        order_after = {
            "id": 1,
            "product_id": 2,
            "source_type": "manual",
            "extracted_product_name": "製品A",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", order_before, order_after, "user-1"
        )

        mock_db._tables[_HISTORY].insert.assert_not_called()

    def test_skips_when_extracted_product_name_missing(self):
        mock_db = self._mock_db()
        order_before = {"id": 1, "product_id": 1}
        order_after = {
            "id": 1,
            "product_id": 2,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": None,
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", order_before, order_after, "user-1"
        )

        mock_db._tables[_HISTORY].insert.assert_not_called()

    def test_skips_when_product_id_unchanged(self):
        mock_db = self._mock_db()
        order_before = {"id": 1, "product_id": 2}
        order_after = {
            "id": 1,
            "product_id": 2,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "製品A",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", order_before, order_after, "user-1"
        )

        mock_db._tables[_HISTORY].insert.assert_not_called()

    def test_creates_alias_and_history_when_new(self):
        mock_db = self._mock_db(existing_alias_rows=[])
        order_before = {"id": 1, "product_id": None}
        order_after = {
            "id": 1,
            "product_id": 2,
            "order_number": "ORD-001",
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "  セイヒンA  ",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", order_before, order_after, "user-1"
        )

        alias_insert_call = mock_db._tables[_ALIASES].insert.call_args
        assert alias_insert_call.args[0]["raw_text"] == "セイヒンA"
        assert alias_insert_call.args[0]["product_id"] == 2
        assert alias_insert_call.args[0]["created_by"] == "user-1"
        # 別名は顧客単位でスコープする（Issue #349）
        assert alias_insert_call.args[0]["customer_id"] == 55

        history_insert_call = mock_db._tables[_HISTORY].insert.call_args
        history_data = history_insert_call.args[0]
        assert history_data["action"] == "created"
        assert history_data["raw_text"] == "セイヒンA"
        assert history_data["product_name_snapshot"] == "製品A"
        assert history_data["customer_id"] == 55
        assert history_data["customer_name_snapshot"] == "顧客X"
        assert history_data["source_order_id"] == 1
        assert history_data["source_order_label_snapshot"] == "ORD-001"
        assert history_data["changed_by"] == "user-1"

    def test_skips_when_customer_id_missing(self):
        """customer_id は下書き注文の自動作成時に必ず解決される前提だが、
        万一欠落している場合は customer_id NOT NULL の product_name_aliases へ
        INSERT できないため記録を諦める（Issue #349）。"""
        mock_db = self._mock_db(existing_alias_rows=[])
        order_after = {
            "id": 1,
            "product_id": 2,
            "source_type": "email",
            "extracted_product_name": "セイヒンA",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", None, order_after, "user-1"
        )

        mock_db._tables[_ALIASES].insert.assert_not_called()
        mock_db._tables[_HISTORY].insert.assert_not_called()

    def test_customer_name_fetch_failure_falls_back_to_unknown(self):
        """customer_name_snapshot の取得失敗（.single() は該当0件でも APIError を
        送出する）は表示用付随情報の欠落に過ぎないため、別名UPSERT/履歴追記は
        '不明' で継続する（Issue #349 / PRレビュー指摘対応）。"""
        mock_db = self._mock_db(existing_alias_rows=[])
        mock_db._tables[
            _CUSTOMERS
        ].select().eq().single().execute.side_effect = APIError(
            {"code": "PGRST116", "message": "0 rows"}
        )
        order_after = {
            "id": 1,
            "product_id": 2,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "セイヒンA",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", None, order_after, "user-1"
        )

        alias_insert_call = mock_db._tables[_ALIASES].insert.call_args
        assert alias_insert_call.args[0]["customer_id"] == 55
        history_data = mock_db._tables[_HISTORY].insert.call_args.args[0]
        assert history_data["customer_id"] == 55
        assert history_data["customer_name_snapshot"] == "不明"

    def test_updates_existing_alias_when_raw_text_already_registered(self):
        mock_db = self._mock_db(existing_alias_rows=[{"id": "alias-1"}])
        order_before = {"id": 1, "product_id": 3}
        order_after = {
            "id": 1,
            "product_id": 2,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "セイヒンA",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", order_before, order_after, "user-1"
        )

        mock_db._tables[_ALIASES].insert.assert_not_called()
        mock_db._tables[_ALIASES].update.assert_called_with({"product_id": 2})

        history_insert_call = mock_db._tables[_HISTORY].insert.call_args
        assert history_insert_call.args[0]["action"] == "updated"

    def test_concurrent_insert_conflict_falls_back_to_update(self):
        mock_db = self._mock_db(existing_alias_rows=[])
        mock_db._tables[_ALIASES].insert.side_effect = APIError(
            {"code": "23505", "message": "duplicate key"}
        )
        order_before = None
        order_after = {
            "id": 1,
            "product_id": 2,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "セイヒンA",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", order_before, order_after, "user-1"
        )

        mock_db._tables[_ALIASES].update.assert_called_with({"product_id": 2})
        history_insert_call = mock_db._tables[_HISTORY].insert.call_args
        assert history_insert_call.args[0]["action"] == "updated"

    def test_order_before_none_records_created_action(self):
        """split_order のような新規作成経路（order_before なし）でも記録されること"""
        mock_db = self._mock_db(existing_alias_rows=[])
        order_after = {
            "id": 5,
            "product_id": 9,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "セイヒンB",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", None, order_after, "user-1"
        )

        history_insert_call = mock_db._tables[_HISTORY].insert.call_args
        assert history_insert_call.args[0]["action"] == "created"
        assert history_insert_call.args[0]["source_order_label_snapshot"] == "注文 #5"

    def test_updating_existing_alias_does_not_overwrite_created_by(self):
        """created_by は最初の登録者を表す監査カラムのため、再修正時に
        上書きしないこと（PRレビュー指摘対応）。"""
        mock_db = self._mock_db(existing_alias_rows=[{"id": "alias-1"}])
        order_before = {"id": 1, "product_id": 3}
        order_after = {
            "id": 1,
            "product_id": 2,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "セイヒンA",
        }

        record_correction_if_applicable(
            mock_db, "tenant-1", order_before, order_after, "user-2"
        )

        update_call_args = mock_db._tables[_ALIASES].update.call_args.args[0]
        assert "created_by" not in update_call_args

    def test_unexpected_error_is_logged_and_not_raised(self):
        """記録処理は注文更新とは別トランザクションのベストエフォート処理のため、
        例外を送出せずログに記録するのみとする（PRレビュー指摘対応: これにより
        呼び出し元 update_order/split_order のレスポンスが誤って500にならない）。"""
        mock_db = self._mock_db(existing_alias_rows=[])
        mock_db._tables[_HISTORY].insert.side_effect = RuntimeError("boom")
        order_after = {
            "id": 1,
            "product_id": 2,
            "customer_id": 55,
            "source_type": "email",
            "extracted_product_name": "セイヒンA",
        }

        # 例外が外へ伝播しないこと
        record_correction_if_applicable(
            mock_db, "tenant-1", None, order_after, "user-1"
        )

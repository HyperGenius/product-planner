# orders ルーターのパッケージ構成 (Issue #376)

`backend/app/routers/transaction/orders.py`（単一ファイル、最終的に約1,900行）が
責務ごとに肥大化していたため、`backend/app/routers/transaction/orders/` パッケージへ分割した。
**挙動（エンドポイントのパス・レスポンス・権限・エラー）は変更していない。**
公開インターフェース `from app.routers.transaction import orders_router` もそのまま。

## 構成

```text
backend/app/routers/transaction/orders/
├── __init__.py            # orders_router を組み立て、各サブルーターを include
├── _shared.py             # _map_order_response, _duplicate_order_conflict_exception,
│                           # _deadline_from_schedules, _require_role, _require_any_role,
│                           # get_settings_repo（複数サブルーターで共有するヘルパー）
├── scheduling_start.py    # 作業開始日の検証・過去日監査ヘルパー（Issue #372）。
│                           # crud と simulation の両方から使う
├── crud.py                # POST/GET /orders, GET/PATCH/DELETE /orders/{order_id}
├── routing_queue.py        # GET /orders/unconfirmed-routing-queue
├── approval_logs.py        # GET /orders/approval-logs(/export)
├── email_intake.py         # POST /orders/email-intake, GET /orders/email-intake-results,
│                           # POST /orders/{order_id}/split
├── attachments.py          # GET /orders/{order_id}/attachments
├── simulation.py            # POST /orders/simulate, POST /orders/{order_id}/simulate
└── approval_workflow.py    # request-approval / confirm / approve-bulk / reject /
                            # withdraw-approval / ship / ship-overdue-drafts
```

## ルート解決順序

FastAPI/Starlette はパステンプレートを登録順に評価するため、`/{order_id}` のような
単一動的セグメントと衝突しうる静的パス（`/unconfirmed-routing-queue`, `/approval-logs`,
`/approval-logs/export`, `/email-intake-results`）は、`crud`（`/{order_id}`）より前に
`include_router()` する必要がある。`orders/__init__.py` は以下の順で include している。

```python
orders_router.include_router(routing_queue_router, prefix="/orders")
orders_router.include_router(approval_logs_router, prefix="/orders")
orders_router.include_router(email_intake_router, prefix="/orders")
orders_router.include_router(crud_router, prefix="/orders")
orders_router.include_router(attachments_router, prefix="/orders")
orders_router.include_router(simulation_router, prefix="/orders")
orders_router.include_router(approval_workflow_router, prefix="/orders")
```

`APIRouter.include_router()` は自身に渡した `prefix` 引数のみをサブルーターの
パスへ適用し、親ルーター自身のコンストラクタに渡した `prefix` は流用されない
（親に直接登録したルートにしか効かない）ため、各 include で明示的に
`prefix="/orders"` を渡している。

`__tests__/api/routers/transaction/test_orders.py` の
`test_unconfirmed_routing_queue_route_resolves_before_order_id` で、この順序が
壊れていないこと（静的パスが `/{order_id}` に奪われないこと）を確認している。

## テストファイルの互換性

`test_orders.py` は分割せずそのまま1ファイルで維持した。`get_settings_repo` や
`_derive_email_intake_outcome` は `_shared.py` / `email_intake.py` から
パッケージの `__init__.py` で再エクスポートしており、既存の import 文
（`from app.routers.transaction.orders import get_settings_repo`）は変更不要。

一方、`monkeypatch.setattr(orders_module, "schedule_order", ...)` のように
関数を直接差し替えるテストは、パッケージ分割後は実際に呼び出しているサブモジュール
（`orders.simulation` / `orders.approval_workflow`）を import してパッチする必要がある
（Python の名前解決は呼び出し元モジュール自身の名前空間を見るため、パッケージの
`__init__.py` へのパッチは各サブモジュール内の呼び出しには影響しない）。該当する
3箇所のテストのみ import 先を修正した。

## 未対応（別Issue）

Issue #376 の「3. ルーター層からサービス層へのロジック抽出」は任意対応とされており、
本PRでは見送った。`approval_workflow.py`（約490行）・`email_intake.py`（約600行）は
他ファイルより大きいままだが、これは Issue が提案したファイル構成（1エンドポイント1関数を
そのまま責務単位でまとめる方針）に忠実に従った結果であり、挙動変更を伴うロジック抽出を
同時に行わないための意図的な判断。必要になれば別Issueで
`_confirm_single_order` → `services/order_confirm_service.py` 等の抽出を検討する。

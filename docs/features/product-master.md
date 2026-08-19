# 製品マスタ機能

## 概要

製品・品番の登録・管理を行うマスタデータ画面。
`/master/products` からアクセスし、製品の CRUD 操作・工程管理・有効/無効切り替えを提供する。
マスタ画面の**基準実装**として設計されており、他マスタ画面のリファクタリング時の参照元となる（→ [マスタ管理画面 設計ガイド](./master-screen-design.md)）。

## URL

| パス | 説明 |
|---|---|
| `/master` | マスタデータカード一覧（各マスタへのナビゲーション） |
| `/master/products` | 製品マスタ一覧 |
| `/master/products?sort=product_code&page=2` | ソート・ページ状態付き URL の例 |

## データモデル

```typescript
interface Product {
  id: number
  name: string        // 品番（実運用データでは品番がここに入る）
  code: string        // 製品名（任意。旧データでは製品コードが入っている）
  type: string        // 種別（旧フィールド。新規データでは空）
  is_active: boolean
  has_process: boolean  // 工程が1件以上登録されているか（#223 追加）
  tenant_id: string
  created_at: string
}
```

## 表示ロジック

`code` の有無によって表示を切り替える：

```typescript
const displayCode = product.code || product.name  // 品番として表示
const displayName = product.code ? product.name : null  // 製品名として表示
```

- `code` あり: 品番 = `code`、製品名 = `name`
- `code` なし: 品番 = `name`、製品名 = 「製品名未設定」（グレーイタリック）

## 機能一覧

### 一覧表示

- 4列構成：品番/製品名 / 工程登録状況 / 状態 / 操作メニュー
- 1ページ `PAGE_SIZE = 20` 件。件数が超えた場合のみページネーション表示
- コンテンツ幅上限 `max-w-[860px]`（`master/layout.tsx` で全マスタ共通適用）

### 検索・フィルター・ソート

- テキスト検索：品番・製品名を横断検索
- ステータスフィルター：すべて / 有効 / 無効
- 並べ替えセレクト：登録順 / 品番順 / 製品名順
- ソート・ページ状態は URL クエリパラメータ（`?sort=`, `?page=`）に保持
- テキスト検索・ステータスフィルターを変更すると `page` を自動的に `1` にリセットする（#309）。ただし `?page=N` を含む URL への直接アクセス（初回マウント時）はリセット対象外

### ケバブメニュー（⋮）

| 項目 | 権限 | 動作 |
|---|---|---|
| 編集 | 全員 | 品番・製品名を変更するダイアログ |
| 工程管理 | 全員 | 製造工程ルーティングを管理（`ProductRoutingsDialog`） |
| 表記ゆれ履歴 | 全員 | メール起票時の製品名表記ゆれ修正履歴を表示（`ProductNameAliasHistoryDialog`、#347） |
| 有効化 / 無効化 | admin のみ | 確認モーダル経由で状態変更 |
| 削除 | admin のみ | 確認ダイアログ付き（取り消し不可） |

### 有効/無効切り替え

- 確認モーダルで製品名・影響範囲（新規受注の選択候補から除外）を表示してから実行
- 無効化した製品は `product-selector.tsx` のコンボボックスから自動的に除外される

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `frontend/src/app/master/layout.tsx` | 全マスタ共通幅制限 |
| `frontend/src/app/master/page.tsx` | マスタデータトップ（カード一覧） |
| `frontend/src/app/master/products/page.tsx` | 製品マスタ一覧ページ（基準実装） |
| `frontend/src/hooks/use-products.ts` | TanStack Query フック群 |
| `frontend/src/hooks/use-tenant-members.ts` | `useCurrentMember()` フック（権限制御） |
| `frontend/src/components/master-pagination.tsx` | 共通ページネーション |
| `frontend/src/components/product-routings-dialog.tsx` | 工程管理ダイアログ |
| `frontend/src/components/product-name-alias-history-dialog.tsx` | 表記ゆれ履歴ダイアログ（#347） |
| `frontend/src/components/product-selector.tsx` | 受注入力の製品選択（有効製品のみ表示） |
| `backend/app/routers/master/products.py` | REST API エンドポイント（`GET /products/{id}/aliases` を含む） |
| `backend/app/services/product_alias_service.py` | 製品名別名の記録サービス（#347） |

## 工程ルーティング (process_routings)

製品ごとの製造工程を管理する。工程管理ダイアログ（`ProductRoutingsDialog`）から CRUD 操作を行う。

### データモデル

| カラム | 型 | 説明 |
|---|---|---|
| `id` | `bigint PK` | |
| `product_id` | `bigint FK` | |
| `sequence_order` | `int` | 工程の実行順序（製品内でユニーク制約） |
| `process_name` | `text` | 工程名 |
| `equipment_group_id` | `bigint FK \| NULL` | NULL = 設備不要工程 |
| `setup_time_seconds` | `int` | 段取り時間（秒） |
| `unit_time_seconds` | `numeric(10,4)` | 1個あたり加工時間（秒） |
| `is_confirmed` | `boolean DEFAULT false` | 工程確定フラグ（#197 追加） |
| `confirmed_by` | `uuid FK \| NULL` | 確定したユーザーの ID（audit 用、#197 追加） |
| `confirmed_at` | `timestamptz \| NULL` | 確定日時（audit 用、#197 追加） |

### 工程確定フラグ (`is_confirmed`) について

工程情報はベテラン社員の暗黙知であるため、初期登録時点で完全でなくてよい設計になっている（詳細: [`docs/specs/ROUTING_INPUT_FLOW_AND_CONFLICT.md`](../specs/ROUTING_INPUT_FLOW_AND_CONFLICT.md)）。

- `is_confirmed=false` の工程を含む製品の受注は、シミュレーションは実行できるが**ガントチャートへの確定登録ができない**
- 工程が 0 件の製品も同様にガント登録不可
- 確定操作時は `confirmed_by`（ユーザー ID）と `confirmed_at`（タイムスタンプ）が自動記録される

admin ロール限定の確定 UI はダイアログに実装済み（✅ Issue #199）。

### `has_process` フラグ（#223 追加）

`ProductRepository.get_all()` が `process_routings` リレーションの件数を見て `has_process: bool` を計算して返す。
工程が 1 件以上登録されていれば `true`。

製品一覧では「工程登録状況」列として表示する。`has_process=false` の製品は、新規注文フォームの製品プルダウンで警告アイコンを表示する（#224）。

---

## 別名辞書 (product_name_aliases)（Issue #347）

メールから受注下書きを自動起票する際に製品名の表記ゆれで未マッチ・誤マッチと
なった明細を、担当者（`order_handler`）が下書きの `product_id` を選び直すことで
修正するフローがある（詳細: [email-order-intake.md](./email-order-intake.md)）。
この修正結果を「生テキスト（`raw_text`）→ 製品」の対応として蓄積し、以後の
自動マッチングで pg_trgm 曖昧検索より優先して使う。別名登録自体は
`president` の承認を必要とせず、`order_handler` 権限で完結する。

### データモデル

| テーブル | カラム | 説明 |
|---|---|---|
| `product_name_aliases` | `id`, `tenant_id`, `product_id` (FK, `ON DELETE CASCADE`), `raw_text`, `created_by`, `created_at`, `updated_at` | `raw_text`（`extracted_product_name` と同じ `TRIM()` のみの正規化）ごとに最新の対応を1件保持。`(tenant_id, raw_text)` UNIQUE。同一 `raw_text` への再修正は UPSERT（上書き） |
| `product_name_alias_history` | `id`, `tenant_id`, `product_id` (FK, `ON DELETE SET NULL`), `product_name_snapshot`, `raw_text`, `changed_by`, `changed_at`, `action` (`created`/`updated`), `source_order_id` (FK, `ON DELETE SET NULL`), `source_order_label_snapshot` | 追記のみの修正履歴。製品削除・注文削除で行が消えないよう `ON DELETE SET NULL` とし、削除後も文脈が読めるようスナップショット列（製品表示名・注文ラベル）を保持する |

### 記録経路

`backend/app/services/product_alias_service.py` の
`record_correction_if_applicable(client, tenant_id, order_before, order_after, changed_by)`
が唯一の記録経路。以下の2箇所（`backend/app/routers/transaction/orders.py`）から
呼ばれる。今後 `orders.product_id` を更新する処理を追加する場合も、この関数を
通すこと（登録漏れ防止のため個別実装しない）。

- `PATCH /orders/{id}`（`update_order`）: 修正前後の `product_id` が異なる場合
- `POST /orders/{id}/split`（`split_order`）: 分割後の各明細に `product_id` が
  設定される場合（元の下書きの `extracted_product_name` を明細ごとに引き継ぐ）

発火条件（いずれかに該当する場合は記録しない）:

- 対象注文の `source_type` が `email` 以外（手動起票の注文編集では発火しない）
- `extracted_product_name` が未設定
- 変更前後の `product_id` が同一（実質的な修正でない）

### マッチングへの反映

`backend/app/services/product_matching_service.py` の `match_product_by_alias()` が
`product_name_aliases` の完全一致検索を行う。`pdf_order_parsing_service.py` の
`_resolve_product_id()` はこれを `products.code` 完全一致・pg_trgm 曖昧検索より
前段で呼び出し、一致すればそれらをスキップして即採用する。

### 履歴の閲覧

`GET /products/{product_id}/aliases` が `product_name_alias_history` の生データ
ではなく、`changed_by` を担当者の表示名に、`source_order_id` を注文へのリンクに
解決した集約レスポンスを返す。フロントエンドは製品マスタのケバブメニュー
「表記ゆれ履歴」から `ProductNameAliasHistoryDialog`（`useProductNameAliasHistory`
フック）で一覧表示する。

---

## 変更履歴

| PR | 内容 |
|---|---|
| #105 | 製品マスタ画面の再設計（Issue #104）。テーブル列統合・ケバブメニュー・検索フィルター追加 |
| #106 | 並べ替え機能・状態変更モーダル化・ページネーション・幅制限追加（Issue #106） |
| #204 | 工程確定フラグ（`is_confirmed` / `confirmed_by` / `confirmed_at`）をDBに追加（Issue #197） |
| #226 | 製品マスタ画面に工程登録状況（`has_process`）を表示（Issue #223） |
| #227 | 新規注文フォームの製品プルダウンに工程未登録警告を表示（Issue #224） |
| #310 | フィルタ変更時に `page` を1にリセットするよう修正（Issue #309） |
| #347 | メール起票の製品名修正結果を別名辞書（`product_name_aliases`）として蓄積・履歴管理する機能を追加（Issue #347） |

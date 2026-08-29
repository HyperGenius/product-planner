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
  name: string        // 品名（図面管理アプリ「ズメーン」の品名）
  code: string | null // 図番（ズメーンの図番）。未突合・未移行テナントの既存行は NULL があり得る
  is_active: boolean
  has_process: boolean  // 工程が1件以上登録されているか（#223 追加）
  tenant_id: string
  created_at: string
}
```

### カラムの意味（Issue #352）

`products` の各レコードは図面管理アプリ **「ズメーン」** の図番・品名を正とする。

| カラム | 対応するズメーンの項目 | 備考 |
|---|---|---|
| `code` | 図番 | 実質的な識別子。`unique(tenant_id, code)` があるが `code IS NULL` の行同士は重複可（Postgres の UNIQUE は NULL を対象外にするため）。未突合・未移行テナントの既存行は NULL のまま残る。全テナントの図番が揃った時点で `NOT NULL` 化を別 Issue で検討 |
| `name` | 品名 | `NOT NULL` |

- カラム名のリネームは行わず、意味を上表に固定した。旧 `type` 列は #352 で `DROP COLUMN` 済み。
- ズメーンからの取り込みは 1 回限りのスクリプト `backend/scripts/import_zumen_products.py`
  で行う。ズメーン側・products 側ともに表記揺れが多く機械的な完全同期は危険なため、
  **正規化（NFKC＋空白除去＋大文字化）した完全一致で突合できた既存 `products` の `code` に
  図番を書き込むだけ**にとどめる。品名 (`name`) の同期・CSV にしか無い図番の新規作成・
  曖昧一致の適用は行わない（必要が発生した段階で個別対応）。継続同期は別 Issue。
- 上記の結果、`code` が入るのは Tier 1 で突合できた行のみ。突合できなかった既存行や
  未移行テナントには旧データ（`code` が NULL で `name` に図番が入っている）が残るため、
  下記の表示ヒューリスティックと `product_matching_service.py` のフォールバックは当面維持する
  （全テナント移行後に別 Issue で撤去）。

## 表示ロジック

未移行テナント向けに、`code` の有無によって表示を切り替える（全テナント移行後に撤去予定）：

```typescript
const displayCode = product.code || product.name  // 品番として表示
const displayName = product.code ? product.name : null  // 製品名として表示
```

- `code` あり: 品番 = `code`、製品名 = `name`
- `code` なし: 品番 = `name`、製品名 = 「製品名未設定」（グレーイタリック）

## 機能一覧

### 一覧表示

- 4列構成：図番/品名 / 工程登録状況 / 状態 / 操作メニュー
- 1ページ `PAGE_SIZE = 20` 件。件数が超えた場合のみページネーション表示
- コンテンツ幅上限 `max-w-[860px]`（`master/layout.tsx` で全マスタ共通適用）

### 検索・フィルター・ソート

- テキスト検索：図番・品名を横断検索
- ステータスフィルター：すべて / 有効 / 無効 / 工程未登録。**既定は「有効」**で、無効な製品は
  明示的にフィルタを切り替えたときだけ表示される（製品マスタ以外の画面には一切出さない方針）。
  例外として `?highlight=<id>` が無効な製品を指す場合のみ、その行を見せるため自動で「すべて」に切り替える
- 並べ替えセレクト：登録順 / 図番順 / 品名順（URL の `?sort=` 値は `created_at` / `product_code` / `name` のまま）
- ソート・ページ状態は URL クエリパラメータ（`?sort=`, `?page=`）に保持
- テキスト検索・ステータスフィルターを変更すると `page` を自動的に `1` にリセットする（#309）。ただし `?page=N` を含む URL への直接アクセス（初回マウント時）はリセット対象外

### ケバブメニュー（⋮）

| 項目 | 権限 | 動作 |
|---|---|---|
| 編集 | 全員 | 図番・品名を変更するダイアログ（作成・編集とも 図番=`code` / 品名=`name` に統一。作成時は図番必須、編集時は品名必須） |
| 工程管理 | 全員 | 製造工程ルーティングを管理（`ProductRoutingsDialog`） |
| 表記ゆれ履歴 | 全員 | メール起票時の製品名表記ゆれ修正履歴を表示（`ProductNameAliasHistoryDialog`、#347） |
| 有効化 / 無効化 | admin のみ | 確認モーダル経由で状態変更 |
| 削除 | admin のみ | 確認ダイアログ付き（取り消し不可） |

### 有効/無効切り替え

- 確認モーダルで製品名・影響範囲（新規受注の選択候補から除外）を表示してから実行
- 無効化した製品は製品選択プルダウン（`product-selector.tsx` ＝ 新規受注・受注編集・受注分割で共用）から
  自動的に除外される。製品を列挙する UI は全てこのコンポーネント経由のため、無効な製品が
  プルダウンに出るのは製品マスタ画面の「すべて」「無効」フィルタ選択時のみ

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

## 別名辞書 (product_name_aliases)（Issue #347 / 顧客スコープ化: Issue #349）

メールから受注下書きを自動起票する際に製品名の表記ゆれで未マッチ・誤マッチと
なった明細を、担当者（`order_handler`）が下書きの `product_id` を選び直すことで
修正するフローがある（詳細: [email-order-intake.md](./email-order-intake.md)）。
この修正結果を「生テキスト（`raw_text`）→ 製品」の対応として蓄積し、以後の
自動マッチングで pg_trgm 曖昧検索より優先して使う。別名登録自体は
`president` の承認を必要とせず、`order_handler` 権限で完結する。

別名は**顧客単位でスコープする**（Issue #349）。「同じ顧客の中でも複数の呼び方を
する（1顧客:N別名）」「別の顧客が同じ表記で別の製品を指す」実態があり、
テナント単位（`(tenant_id, raw_text)` UNIQUE）のままだと顧客間の表記衝突で
後勝ちの上書き・誤マッチが起きるため。`customer_id` はメール/PDF起票パイプラインで
明細ごとに既に解決済み（[customer-draft-auto-create.md](./customer-draft-auto-create.md)
により下書き顧客を含め必ず解決される）で、辞書検索・UPSERT に渡すだけでよい。
下書き顧客（`customers.status='draft'`）でも別名登録は行い、顧客が後日「正規顧客」に
確定されても `customer_id` は不変のため別名は引き継がれる。

### データモデル

| テーブル | カラム | 説明 |
|---|---|---|
| `product_name_aliases` | `id`, `tenant_id`, `customer_id` (FK, `ON DELETE CASCADE`, `NOT NULL`), `product_id` (FK, `ON DELETE CASCADE`), `raw_text`, `created_by`, `created_at`, `updated_at` | `(tenant_id, customer_id, raw_text)` ごとに最新の対応を1件保持（`raw_text` は `extracted_product_name` と同じ `TRIM()` のみの正規化）。`(tenant_id, customer_id, raw_text)` UNIQUE。同一キーへの再修正は UPSERT（上書き） |
| `product_name_alias_history` | `id`, `tenant_id`, `customer_id` (FK, `ON DELETE SET NULL`), `customer_name_snapshot`, `product_id` (FK, `ON DELETE SET NULL`), `product_name_snapshot`, `raw_text`, `changed_by`, `changed_at`, `action` (`created`/`updated`), `source_order_id` (FK, `ON DELETE SET NULL`), `source_order_label_snapshot` | 追記のみの修正履歴。製品削除・注文削除・顧客削除で行が消えないよう `ON DELETE SET NULL` とし、削除後も文脈が読めるようスナップショット列（顧客名・製品表示名・注文ラベル）を保持する |

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

`backend/app/services/product_matching_service.py` の `match_product_by_alias(db, tenant_id, customer_id, raw_text)` が
`(tenant_id, customer_id, raw_text)` の完全一致検索を行う。`pdf_order_parsing_service.py` の
`_resolve_product_id(db, tenant_id, customer_id, ...)` はこれを `products.code` 完全一致・pg_trgm 曖昧検索より
前段で呼び出し、一致すればそれらをスキップして即採用する。**該当顧客の別名が無い
場合に他顧客の別名へフォールバックはしない**（誤爆防止。従来通り `products.code`
完全一致 → pg_trgm 曖昧検索へフォールバックする）。

### 履歴の閲覧

`GET /products/{product_id}/aliases` が `product_name_alias_history` の生データ
ではなく、`changed_by` を担当者の表示名に、`source_order_id` を注文へのリンクに
解決した集約レスポンスを返す（`customer_id` / `customer_name_snapshot` も含む）。
フロントエンドは製品マスタのケバブメニュー「表記ゆれ履歴」から
`ProductNameAliasHistoryDialog`（`useProductNameAliasHistory` フック）で一覧表示し、
顧客名列の表示と顧客での絞り込みができる。

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
| #349 | 別名辞書を顧客単位でスコープ（`customer_id` 追加・UNIQUE を `(tenant_id, customer_id, raw_text)` に変更）。他顧客の別名へフォールバックしない。履歴に `customer_id` / `customer_name_snapshot` を追加し画面で顧客ごとに確認可能に（Issue #349） |
| #352 | カラムの意味を `code`=図番 / `name`=品名（図面管理アプリ「ズメーン」を正）に固定。旧 `type` 列を `DROP COLUMN`。ズメーン CSV と既存 `products` を正規化完全一致で突合し、一致した行の `code` にだけ図番を書き込む 1 回限りスクリプト `backend/scripts/import_zumen_products.py` を追加（品名同期・新規作成・曖昧一致は行わない。カラムリネーム／ヒューリスティック撤去も見送り、全テナント移行後に別 Issue）。あわせて製品マスタのステータスフィルタ既定を「有効」に変更し、無効な製品は製品マスタ以外に一切表示しない方針を明文化。作成ダイアログが `name`/`code` を旧UI前提で逆に書き込んでいた不整合を修正し、作成・編集とも 図番=`code` / 品名=`name` にラベル・バリデーション・ペイロードを統一。編集で図番を空にした場合は空文字ではなく `null` を送る（`UNIQUE(tenant_id, code)` 対策）。読み取りモデル `Product.code` / フロント型 / `ProductUpdate.code` を nullable にし、作成時のみ `code` 必須（`ProductCreateSchema`）。突合スクリプトは CSV の図番重複を正規化キーで判定して非決定的 UPDATE を防止（Issue #352） |

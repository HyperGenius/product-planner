# 受注管理画面 UI 設計ガイド

受注管理画面（`/orders`）を「ユーザーの関心ごとベース」で再設計する際の設計思想・改善方針・実装パターンをまとめる。

---

## 設計の基本方針

受注管理は「今何をすべきか」が常にわかる画面を目指す。マスタ管理が「探して編集する」操作主体であるのに対し、受注管理は「未対応の受注を見つけて次の行動を取る」ことが主体。

1. **関心ごとを先に見せる** — 画面上部に「対応が必要な受注」のサマリーを表示し、一覧を下にスクロールする前に状況を把握できるようにする
2. **欠けた情報を促す** — 入力が任意のフィールド（顧客・希望納期）が未設定の注文は警告を表示し、補完を促す
3. **次のアクションを文脈で変える** — 注文のステータス・シミュレーション実行状況に応じて表示するボタンを変える
4. **確定納期を永続化する** — シミュレーション確定時に算出された生産完了予定日を `confirmed_deadline` として保存し、一覧で参照できるようにする

---

## 現状の課題

| 課題 | 詳細 |
|---|---|
| 確定ボタンのみ | 下書き注文への操作が「確定」しかない。再シミュレーション・編集ができない |
| 欠損情報が見えない | 顧客未設定・希望納期未設定の注文が視覚的に区別されない |
| 確定納期が保存されない | confirm 実行後に生産完了予定日が DB に残らず、一覧で確認できない |
| ステータスフィルターなし | draft/confirmed/completed/canceled を絞り込む手段がない |
| 注文の編集手段がない | 一度作成した注文を修正するには API を直接叩くしかない |

---

## 注文一覧ページ改善設計 (`/orders`)

### ページ構成

```
[ページヘッダー] 受注管理                     [+ 新規注文]

┌─────────────────────────────────────────────────────────┐
│  アテンションカード（サマリー）                          │
│  ┌─────────────────────┐  ┌────────────────────────────┐│
│  │ 下書き               │  │ 情報不足                   ││
│  │ 3件 未確定           │  │ 2件（顧客・希望納期 未設定）││
│  │ [下書きを見る]       │  │ [確認する]                 ││
│  └─────────────────────┘  └────────────────────────────┘│
└─────────────────────────────────────────────────────────┘

[ステータスフィルター: すべて | 下書き | 確定済 | 完了 | キャンセル]

[注文テーブル]

[ページネーション]
```

### アテンションカード

画面上部に 2 枚のサマリーカードを並べる。

**カード1: 下書き件数 (STEP 2)**
- `status === 'draft'` の件数を表示
- カード自体はクリック不可（ナビゲーション役割なし）
- カード内の「下書きを確定する →」ボタンを押すとステータスフィルターを「下書き」に絞り込み

**カード2: 情報不足件数 (STEP 1)**
- `customer_id === null` または `desired_deadline === null` の件数を表示（ステータス問わず）
- カード自体はクリック不可（ナビゲーション役割なし）
- 「情報不足」はフィルタータブに存在しないため、カードは件数の認知・注意喚起のみを担う
  - 内訳（顧客未設定 N 件 / 希望納期未設定 N 件）を補足テキストで表示する

件数が 0 の場合はカードを非表示にする（画面を圧迫しない）。

### ステータスフィルター

URL クエリパラメータ `?status=` で管理（マスタ画面と同じパターン）。

フィルタータブは `orders.status` の値のみに限定する。「情報不足」「工程未確認」は `orders.status` に存在しない派生的な概念であり、同列に扱うと軸が混在してユーザーを混乱させる（詳細は「設計上の決定事項」参照）。唯一の例外が次項の「対応が必要」（ロール依存の派生フィルタ）。

| フィルター値 | 表示ラベル | 対象 |
|---|---|---|
| `action_required` | 対応が必要 | ロールに応じた要対応の注文（下記参照） |
| (なし) | すべて | 全注文 |
| `draft` | 下書き | status='draft' |
| `pending_approval` | 承認待ち | status='pending_approval' |
| `confirmed` | 確定済 | status='confirmed' |
| `shipped` | 送品済み | status='shipped' |
| `completed` | 完了 | status='completed' |
| `canceled` | キャンセル | status='canceled' |

#### デフォルトフィルタ「対応が必要」(Issue #460)

一覧を開いた瞬間に未整理の全件が並ぶと「今日やるべきこと」が埋もれるため、`?status=` を**指定せずに** `/orders` を開いた場合のみ `action_required` をデフォルト適用する（`use-orders-page.ts`）。`?status=` を明示指定した遷移・ブックマークはその値を優先する。「すべて」タブ自体は削除しない。

ロールごとの対象（`order-utils.ts` の `filterOrder` / `isActionRequiredForRole`）:

| ロール | 対象 |
|---|---|
| `order_handler` | `status === 'draft'`（未シミュレーション・差し戻し済み・シミュ済みを含む） |
| `iso_officer` | 同上（下書き全般） |
| `president` | `status === 'pending_approval'` |
| `platform_admin` | `status === 'confirmed'` |
| ロール未取得（`null`） | 対象なし（0件） |

「対応が必要」はログイン中のロールにより中身の `status` が単一に定まる（下書き／承認待ち／確定済みのいずれか）ため、納期列は行ごとに `usesSimulatedDeadlineForOrder()` でシミュ納期／確定納期を出し分け、列見出しは汎用の「納期」にする（`getDeadlineColumnLabel` / `getDeadlineForTab`）。

「すべて」タブ選択時は `?status=`（空文字）を URL に明示的に残す（`setParam` で `status` キーのみ削除せず維持）。削除すると「`?status=` 無し」と区別が付かず、リロードで「対応が必要」に戻ってしまうため。

### テーブル設計

横に長く冗長だったため、Issue #397 で関連情報を2行表示に畳んで列数を減らし、視認性を上げた。

| 列 | 表示内容 | 補足 |
|---|---|---|
| 注文番号<br>顧客注番 | 1行目 order_no（+ 自動起票アイコン）<br>2行目 customer_order_no（`text-xs text-muted-foreground`。無ければ `-`） | 旧「注文番号」列と「顧客注文番号」列を統合（Issue #397） |
| 製品 | 1行目 図番（code）<br>2行目 品名（name、`text-xs text-muted-foreground`） | 製品マスタ一覧と同じ2行表示。`getProductDisplayParts()` / `splitProductCodeName()`。未移行データ（code=NULL）は品名を1行目へ繰り上げ |
| 通称 | 顧客の通称（`customer.alias`）/ ⚠ 未設定 | 旧「顧客」列。`alias` 未設定時は正式名（`customer.name`）にフォールバック（`getCustomerDisplayName()`）。顧客未設定時は警告アイコン |
| 数量 | quantity（3桁カンマ区切り、`toLocaleString("ja-JP")`） | |
| 希望納期<br>シミュ納期 / 確定納期 | 1行目 desired_deadline / ⚠ 未設定<br>2行目 タブ依存の納期（Issue #394-B）/ `-` | 旧「希望納期」列と「シミュ納期 / 確定納期」列を統合（Issue #397）。日付は当年 `M/D`・他年 `YY/M/D` に短縮（`formatDeadlineShort()`。`title` 属性でフル日付）。遅延強調は2行目（実績側）にのみ適用 |
| ステータス | バッジ（色分け）+ 顧客側の確度バッジ | 下記参照。確度が「顧客確定」(`customer_certainty === "confirmed"`) の行は確度バッジを非表示にしノイズを減らす（Issue #397） |
| 自動起票 | メール受信で起票された行はメールアイコンのみ（旧: アイコン + 「自動起票」ラベル）+ 行背景 `bg-blue-50/60`。意味は Tooltip「自動起票（メール受信）」で担保（Issue #397） | 注文番号セルの1行目に表示 |

**シミュ納期 / 確定納期カラムのタブ依存出し分け（Issue #394-B）**

`confirmed_deadline` は承認確定時（`POST /orders/{id}/confirm`）にしか書き込まれないため、承認前（下書き・シミュ済・承認待ち）の行では常に空になる。そのフェーズで社長が知りたいのは「シミュレーション上いつ完成する見込みか（＝希望納期に間に合うか）」なので、タブに応じてこのカラムを出し分ける。

| タブ（`StatusFilter`） | ヘッダ | 値 |
|---|---|---|
| 下書き / シミュ済 / 承認待ち / キャンセル | 「シミュ納期」 | `simulated_deadline`（Issue #394-A で永続化） |
| すべて / 確定済 / 送品済み / 完了 | 「確定納期」 | `confirmed_deadline` |

- 判定は `lib/order-utils.ts` の `usesSimulatedDeadline(statusFilter)` / `getDeadlineColumnLabel` / `getDeadlineForTab`。受注詳細・承認モーダルなどタブ文脈のない画面は `usesSimulatedDeadlineForOrder(order)`（`confirmed` / `shipped` / `completed` 以外はシミュ納期）で出し分ける。
- 表示中の納期（シミュ納期・確定納期のどちらでも）が `desired_deadline` より後の行は、その値を**赤字（`text-destructive` + 太字）**で表示する（`isDeadlineOverdue(order, deadline)`。クライアント側の日付文字列比較、不正日付は非強調）。
- 承認確認モーダル（単体 `approve-confirm-dialog.tsx` / 一括 `bulk-approve-confirm-dialog.tsx`）・受注詳細（`orders/[id]/page.tsx`）・新規作成のシミュ結果プレビュー（`orders/new/page.tsx`）も「シミュ納期」表記に統一。
| 操作 | プライマリボタン + ケバブメニュー | 下記参照 |

**ステータスバッジ配色**

| ステータス | ラベル | バッジカラー |
|---|---|---|
| `draft` | 下書き | `bg-yellow-100 text-yellow-800` |
| `pending_approval` | 承認待ち | `bg-orange-100 text-orange-800` |
| `confirmed` | 確定済 | `bg-green-100 text-green-800` |
| `shipped` | 送品済み | `bg-teal-100 text-teal-800` |
| `completed` | 完了 | `bg-blue-100 text-blue-800` |
| `canceled` | キャンセル | `bg-gray-100 text-gray-500` |

`confirmed` の注文には「送品済みにする」ボタン（`president` / `order_handler` のみ）を表示し、`POST /orders/{id}/ship` で `shipped` へ遷移させる。

**見出し行の固定表示（Issue #463）**

行数が多い状態でページ全体をスクロールすると列見出し行が画面外に流れて見えなくなっていたため、テーブルを包む `div` に `max-h-[calc(100vh-20rem)] overflow-y-auto` を付与してテーブル本体のみを内部スクロール化し、`TableHeader` に `sticky top-0 z-10 bg-card` を付けて見出し行を画面内に固定した（ダイアログ内スクロール領域での先例は `product-routings-dialog.tsx`）。ページ全体のヘッダー・通知カード・フィルタタブ・ページネーションはこのスクロール領域の外にあるため、位置は変わらない。共通コンポーネント `components/ui/table.tsx` 自体は変更しておらず、`className` で個別ページからスタイルを上書きしているため他の一覧画面（マスタ系等）には影響しない。

**読む列/触る列のスタイル分離（Issue #462）**

全列が同じ文字色・太さだと、識別のための静的情報（注文番号・製品・通称・数量・希望納期）と操作の起点になる情報（ステータス・操作列）が同じ視覚的重みで並んでしまう。`OrderTableRow` の各 `TableCell` で以下のように区別する。

- 読む列（識別情報）: セル本体のテキストを `text-muted-foreground` にする（注文番号セル本体・製品名・通称・数量・希望納期の2行目=タブ依存納期）。ただし未設定を示す警告表示（`AlertCircle` + `text-yellow-500`、顧客・数量・希望納期セル）と、納期超過の強調（`font-semibold text-destructive`）はアクションを促す要素のため対象外（控えめ化しない）
- 触る列（アクションの起点）: ステータスバッジ列・操作列はセル側で色を変えず、`TableCell` のデフォルト文字色（`text-foreground`）のままにする。他列を `text-muted-foreground` にした結果、相対的にコントラストが上がって視線を誘導する。バッジ配色自体（`getStatusBadgeClass` 等）は変更しない。ヘッダー行（`page.tsx`）もステータス・操作の2列だけ `TableHead` のデフォルト（`text-muted-foreground`）を明示的に `text-foreground` で上書きし、見出しの時点から強弱を出す

**緊急度の段階的な行背景色（Issue #461）**

一覧をスクロールするだけで「今日／今週対応が必要な行」を視認できるよう、表示中の納期（`getDeadlineForTab(order, statusFilter)`。無ければ `desired_deadline`）を基準に行背景を段階的に強調する。

- 判定は `lib/order-utils.ts` の `getOrderUrgency(order, statusFilter, todayIso = jstTodayIso())`。`jstTodayIso()` からの残日数で `today`（当日〜納期超過）／`this_week`（今週中。日曜始まりの暦週で `date-fns` の `startOfWeek(..., { locale: ja })` と揃える。ダッシュボード `use-dashboard-metrics.ts` の `weekStart`/`weekEnd` と同じ定義）／`next_week_or_later`（来週以降）／`unset`（納期未設定・不正な日付文字列）に分類する
- `shipped` / `completed` / `canceled` は既に対応不要なため対象外（`null` を返し強調しない）
- 行背景（`order-table-row.tsx` の `rowClassName`）の優先順位（高い順）: バルクシミュレーション失敗行（`hasBulkSimFailed`、赤系ボーダー+背景）＞ 緊急度（`today` = `bg-red-50` / `this_week` = `bg-amber-50`）＞ 自動起票行（`isEmailOrder`、`bg-blue-50/60`）。自動起票かどうかは注文番号セルのメールアイコンで別途判別できるため、背景色の優先度は最下位でよい
- グルーピング（見出し行方式）はページネーション（20件/ページ）を跨ぐとグループが分断されるため見送り、段階的な背景色案を採用した

### アクション体系

注文の状態・ロールによってプライマリアクションを切り替える。操作カラムを圧縮するため、
主要アクション以外（取り下げ・差し戻し・送品済みにする・再シミュレーション・編集）は
ケバブメニューへ寄せ、常時表示するボタンは最大1個に抑える（Issue #397）。

| 状態 / ロール | プライマリボタン | ケバブメニュー |
|---|---|---|
| `draft` かつ `is_scheduled=false`（メール起票） | 確認 | 編集 / 削除 |
| `draft` かつ `is_scheduled=false`（手動起票） | シミュレーション実行 | 編集 / 削除 |
| `draft` かつ `is_scheduled=true` / `order_handler` | 承認依頼を送信 | 再シミュレーション / 編集 / 削除 |
| `pending_approval` / `order_handler` | (なし) | 取り下げ / 削除 |
| `pending_approval` / `president` | 承認 | 差し戻し / 削除 |
| `confirmed` / `president`・`order_handler` | (なし) | 送品済みにする / 削除 |
| `completed` | (なし) | (メニューなし) |
| その他 | (なし) | 削除 |

**確定済み・生産中の行のクリック（Issue #527）**
`confirmed` / `in_progress` は編集できないため、行（`TableRow`）のクリックで読み取り専用の確認モーダル（`OrderViewDialog`）を開く。
行は `tabIndex=0` で、フォーカスして Enter / Space でも開ける（`aria-label="注文 {注文番号} の内容を確認"`）。
- 行内の操作要素（ボタン・リンク・メニュー項目等。`order-table-row.tsx` の `INTERACTIVE_SELECTOR`）のクリックでは開かない
- ケバブメニューの項目はポータルに描画されるが、React の合成イベントはポータルからも行まで伝播する。行の DOM に含まれない
  クリック（`!e.currentTarget.contains(e.target)`）は無視して、「送品済みにする」「削除」で確認モーダルが開かないようにしている
- キー操作は `e.target === e.currentTarget`（行そのものにフォーカスがあるとき）だけ扱う
- それ以外のステータスの行はクリックしても何も起きない（`tabIndex` も付けない）

**シミュレーション実行**（`POST /orders/{order_id}/simulate`）の結果は、画面右からスライドインするサイドシート（shadcn/ui `Sheet`）で表示する。Sheet フッターに「閉じる」「この内容で確定」ボタンを固定表示し、シミュレーション結果を確認後に confirm へ移行する。同時に開けるシートは 1 件のみで、別の注文のシミュレーション実行で自動的に切り替わる。

### 入力不足の警告表示

```tsx
// 顧客未設定
{!order.customer_id && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <AlertCircle className="h-3 w-3 text-yellow-500" />
      </TooltipTrigger>
      <TooltipContent>顧客が設定されていません</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

---

## 新規注文ページ改善設計 (`/orders/new`)

### ステップ表示

現在はフォームとシミュレーション結果が横並びになっているが、「何をするべきか」が分かりにくい。ステップインジケーターで手順を明示する。

```
① 注文情報入力  →  ② シミュレーション実行  →  ③ 確認・確定
```

各ステップのアクティブ状態：
- ① 初期表示時はアクティブ
- ② シミュレーション実行後にアクティブ
- ③ シミュレーション結果が出たらアクティブ（確定ボタンが有効化）

### 入力フォームの改善

**必須フィールドのマーキング**

必須: 製品・数量  
任意（ただし推奨）: 注文番号・顧客・希望納期

注文番号は #155 で任意化済み。空白の場合は NULL で保存される。

**任意フィールドへの促し**

希望納期が空のままシミュレーション実行ボタンを押した場合、インラインヒントを表示する：

```
ℹ 希望納期を入力すると、納期に間に合うかどうかを判定できます
```

顧客が未設定の場合も同様のヒントを表示。

### 確定前確認画面

シミュレーション結果が表示された後、確定ボタンを押す前に以下の情報をサマリー表示する：

- 注文番号・製品・数量
- 希望納期 vs 確定納期（計算値）
- 間に合う / 間に合わない のバッジ
- 未入力フィールドの警告（「このまま確定しますか？」）

---

## 注文編集ダイアログ（新規追加）

一覧ページのケバブメニュー「編集」から開くダイアログ。マスタ管理と同じ Dialog パターンを使用。

### 編集可能フィールド

| フィールド | 編集可否 | 備考 |
|---|---|---|
| 注文番号 | ✅ | ユニーク制約あり |
| 製品 | ✅ | 変更後は is_scheduled をリセット |
| 顧客 | ✅ | |
| 数量 | ✅ | 変更後は is_scheduled をリセット |
| 希望納期 | ✅ | |
| ステータス | ❌ | 専用操作（確定・キャンセル）経由 |

**製品・数量を変更した場合の注意**
スケジュール計算結果が無効になる。変更後は「再シミュレーションが必要です」の警告を表示し、is_scheduled を false にリセットする。

エンドポイント: `PATCH /orders/{order_id}`（実装済み）

**保存時の重複（UNIQUE 衝突）ハンドリング (#415 PR1 / PR2)**
`orders` には UNIQUE が2本あり、編集ダイアログはどちらの列も変更できる:

| 制約 | キー | 発生条件 |
|---|---|---|
| `orders_dedupe_key` | `(tenant_id, customer_id, product_id, deadline_date)` | 顧客／製品／希望納期を既存注文と一致させた |
| `orders_dedupe_key_unmatched_product` | `(tenant_id, customer_id, deadline_date, extracted_product_name)`（`product_id IS NULL`） | 製品未マッチ注文で顧客／希望納期／抽出製品名を既存注文と一致させた |
| `orders_tenant_id_order_number_idx` | `(tenant_id, order_number)`（`order_number IS NOT NULL`） | 注文番号を既存注文と一致させた |

- バックエンド: `BaseRepository.update()` / `create()` はいずれも Postgres の unique_violation（`23505`）を `DuplicateRecordError`（`constraint` に元の例外文言＝制約名を保持）へ変換する（PR1 で `update()`、PR2 で `create()` を統一。`create()` は以前 `ValueError` を投げていたため、生の DB 制約文言を含んだメッセージがそのまま 400 detail に載っていた）。
- 4 経路（`PATCH /orders/{id}` / `POST /orders` / `POST /orders/email-intake` / `POST /orders/{id}/split`）すべてで **409 Conflict** の構造化 detail を共通ヘルパー `_duplicate_order_conflict_exception()`（`routers/transaction/orders/_shared.py`）で組み立てる。`DuplicateRecordError.constraint` に `order_number` が含まれるかで振り分ける:
  - dedupe_key 系: `{"error": "duplicate_order", "message": "同じ 顧客 × 製品 × 納期 の注文がすでに存在します", "conflicting_order": {...}}`
  - 注文番号: `{"error": "duplicate_order_number", "message": "この注文番号はすでに使用されています"}`（`conflicting_order` は付与しない）
  - `conflicting_order`（`id` / `order_no` / `customer_name` / `product_name` / `quantity` / `deadline_date` / `status`）は `OrderRepository.find_dedupe_conflict()` で衝突先レコードを再検索して組み立てる（RLS 下のユーザー JWT クライアントで顧客名・製品名も解決）。衝突先が見つからない場合（同時更新等）は `conflicting_order` を省略し固定文言のみ返す。
  - `POST /orders/email-intake` は明細単位で作成するため、`line_item_index`（0始まり）を detail に追加し、どの明細が重複したか判別できるようにしている。
  - レスポンスに生の DB 制約名・例外文言は含めない。
- フロントエンド: `ApiError`（`lib/api-client.ts`）に `errorCode`（`detail.error`）に加え `conflictingOrder`（`detail.conflicting_order`）・`lineItemIndex`（`detail.line_item_index`、email-intake のみ）の getter を追加した（#415 PR3）。
- `duplicate_order`（dedupe_key 系）は共通コンポーネント `DuplicateOrderDialog`（`components/orders/duplicate-order-dialog.tsx`）で衝突先レコードの識別情報（注文番号・顧客名・製品名・数量・希望納期・ステータス）を一覧表示する。情報表示専用（フッターは「閉じる」のみ）で、マージ等の自動解決は行わない。`conflicting_order` が取得できなかった場合（同時更新等）は固定文言のみ表示する。
- `duplicate_order_number`（注文番号重複）は `conflicting_order` を持たないため従来通りトースト表示のまま（`DuplicateOrderDialog` は使わない）。
- 4 呼び出し元すべてで `errorCode === "duplicate_order"` を判定して `DuplicateOrderDialog` を開く: `EditOrderDialog`（以前は注文番号欄の下に「この注文番号はすでに使用されています」というインライン文言を、`message` に `"400"` / `"duplicate"` / `"already"` を含むかどうかという曖昧な判定で出しており、dedupe_key 衝突でも「注文番号が重複」と誤表示していた。この分岐と state は PR1 で削除済み）／`SplitOrderDialog`／`orders/new/page.tsx`（`POST /orders` の下書き保存・確定、`POST /orders/email-intake`。email-intake のみ `lineItemIndex` を渡し「明細 N: 」を案内文に含める）。

**内部状態のリセット**
`EditOrderDialog` は開くたびに `key` に `editDialogGeneration`（ダイアログを開く操作のたびにインクリメントするカウンタ）を含めて再マウントされる。同一注文を「未保存でキャンセル→再オープン」した場合でも、DB上の値で初期化し直される (#277)。
一覧ページ (`orders/page.tsx`) は `key={`${selectedOrder.id}-${editDialogGeneration}`}`、注文詳細ページ (`orders/[id]/page.tsx`) は `key={editDialogGeneration}` を使用。

**希望納期・確定納期の日付/時刻の扱い (#293)**
`desired_deadline`（DB上は `deadline_date`）・`confirmed_deadline` はいずれも「日付のみ」(`YYYY-MM-DD`) で、時刻情報を持たない。`new Date(dateStr)` でパースして `format` すると環境のタイムゾーンによって存在しない時刻が表示されてしまうため、`lib/order-utils.ts` の `formatDeadlineDate`（表示用、文字列の先頭10文字をそのまま整形）・`toDateInputValue`（`<input type="date">` バインド用）に処理を統一した。`EditOrderDialog` と新規注文作成ページの希望納期入力欄も `type="datetime-local"` から `type="date"` に変更している。`BulkSimulateSummaryDialog` の希望納期表示も同様に対応済み。なお、シミュレーション結果の `calculated_deadline` はスケジューラが計算した実際の日時（時刻を持つ）のため対象外。

**Dialog 内プルダウンのマウスホイールスクロール不具合 (#319)**
`Dialog`（`@radix-ui/react-dialog`）が modal 表示中に行うボディスクロールロック（`react-remove-scroll`）は、`Portal` 経由で `document.body` 直下に描画される要素へのホイールイベントもブロックしてしまう。このため `ProductSelector`（`Popover` + `Command`）・`CustomerSelector`（当時は `Select`。#509 で `Popover` + `Command` に変更）を `Dialog` 内（`EditOrderDialog`・`SplitOrderDialog`）で使うと、一覧をマウスホイールでスクロールできない不具合があった（矢印キーでの操作は影響を受けないため気づきにくい）。
対応として、共通コンポーネント側でスクロール対象要素に対しネイティブ（非 passive）の `wheel` イベントリスナーを登録し、`scrollTop` を直接更新することでロックを迂回している。
- `frontend/src/components/ui/command.tsx` の `CommandList`
- `frontend/src/components/ui/select.tsx` の `SelectContent`（内部の `SelectPrimitive.Viewport`）

いずれも共通 UI コンポーネント側の対応のため、`Dialog` 内外を問わず両セレクタを使う画面すべてに適用される。

**顧客選択の検索付きコンボボックス化 (#509)**
顧客数が増え、`Select` のプルダウン（`SelectContent` は `position="popper"` で最大高さの指定が無く、項目数ぶん伸びる）が編集・分割ダイアログでブラウザの表示領域からはみ出していた。`CustomerSelector`（`components/customer-selector.tsx`）を `ProductSelector` と同じ `Popover` + `Command` に置き換え、候補リストは `CommandList` の `max-h-[300px]` でポップオーバー内スクロールにした。共通部品のため、編集ダイアログ・分割ダイアログ・新規受注・メール起票のすべてに反映される。
- 検索は顧客名（`name`）・略称（`alias`）の部分一致（大文字小文字無視）。`CommandItem` の `value` は顧客 ID なので、`keywords` に名前・略称を渡し `Command` の `filter` で照合する（cmdk 既定の `value` 照合だと ID で検索されてしまう）
- 顧客は任意項目なので、選択中のときだけ先頭に「選択を解除」を出し、選ぶと `onValueChange("")` を呼ぶ。`keywords` を持たないので検索中は出ない
- 該当なしは「顧客が見つかりません」、顧客0件は「顧客が登録されていません」。下書き顧客（`status === "draft"`）は候補・トリガーの両方に「下書き」バッジを出す
- トリガーとラベルの `id` は `React.useId()`。分割ダイアログのように1画面に複数並ぶため、固定 `id` だと重複してラベルのクリックが1つ目に飛ぶ
- `value` / `onValueChange`（空文字＝未選択）の props は従来どおりで、呼び出し側の変更は無い

---

## 注文の確認ダイアログ（読み取り専用、Issue #527）

一覧で確定済み・生産中の行をクリックすると開くダイアログ（`components/orders/order-view-dialog.tsx`）。

- 外枠（幅・メール起票時の参照元メール2カラム・ヘッダー・フッター）は編集ダイアログと共通の `OrderDialogLayout`
  （`components/orders/order-dialog-layout.tsx`）を使い、見た目を揃える。外枠を変えるときはこのファイルだけを直す
- 項目は編集ダイアログと同じ順（注文番号 / 製品 / 顧客 / 数量 / 希望納期 / 作業開始日）に、確定納期・ステータス・顧客側の確度を足す。
  入力欄は `Input` の `readOnly` で、製品・顧客はコンボボックスではなく表示名を入れる。入力用の注記（「（任意）」「*」・作業開始日の説明・警告）は出さない
- 未設定の項目は空欄＋プレースホルダ「未設定」（メール起票で顧客不明なら「顧客不明」、Issue #521）。確度 NULL は「－」（Issue #474）
- フッターは「閉じる」と「詳細ページを開く」（`/orders/{id}`）。保存ボタンは無い
- 一覧の `use-orders-page.ts` は表示中の注文を **ID**（`viewingOrderId`）で持ち、`orders` から引き直す。送品済み等で一覧が再取得されたときに古い内容を出さないため
- 編集ダイアログに `readOnly` フラグを足す案は採らなかった（保存・409 の重複ハンドリング・作業開始日の権限チェック等、編集専用の処理が多いため）

---

## 一覧の顧客・製品フィルタ（Issue #546）

受注一覧（`/orders`）のフィルタバーに、顧客・製品の検索付きコンボボックス（`components/orders/filter-combobox.tsx`、`Popover` + `Command`）を追加した。Backend の変更は無く、`GET /orders` の全件をフロントで絞り込む。

- 状態は URL クエリ `?customer=<id>` / `?product=<id>`。ステータスタブ・並び替えと AND で組み合わせる。変更時は `setParam` が `page` を消して 1 ページ目に戻り、一括選択は `useEffect`（`[page, statusFilter, customerFilterId, productFilterId]`）でクリアされる
- `toValidMasterId()`（`lib/order-utils.ts`）が正の整数以外・マスタに存在しない ID を未指定にクランプする。判定は `matchesCustomerProductFilter()`（ID 一致）で、`filterOrder()` のシグネチャは変えず `useOrdersPage` の `filteredOrders` で後段に適用する
- 顧客不明（`customer_id` NULL）・製品未照合（`product_id` NULL）・修理注文は、該当フィルタを指定中は表示されない（「顧客未設定」「未照合の部分一致」は対象外）
- 通知カードの件数（`draftCount` 等）は全件基準のまま
- 該当なしのときは「顧客・製品の絞り込みを解除」ボタンを出す。2 つを同時に消すため `clearMasterFilters()`（`setParam` を続けて呼ぶと 2 回目が古い `searchParams` で 1 回目を巻き戻すので 1 回の `router.push` にまとめる）

## 起票の確認（`/orders/intake`、Issue #555）

Epic #553 の1画面目。受注担当・ISO担当が、起票された下書きを確認して承認依頼まで進める。Backend の変更は無く、`GET /orders` と `GET /orders/email-intake-results` の全件をフロントで区分する。

### 下書きの区分

`getIntakeCategory(order)`（`lib/order-utils.ts`）が `status === "draft"` の注文を次の優先順で最初に当たった区分にだけ振る（下書き以外は `null`）。ラベル・説明・色は `INTAKE_CATEGORY_META`（`Record<IntakeCategory, ...>`）で引く。

| 優先 | 区分（`IntakeCategory`） | 条件 | 行に出す操作 |
|---|---|---|---|
| 1 | 製品未確定（`no_product`） | `product_id` が NULL（修理注文を除く） | 「製品を選ぶ」（編集ダイアログ）・「製品マスタに登録」・例外送品（社長）・削除 |
| 2 | 工程未登録（`no_routing`） | `has_no_routings`（修理注文を除く） | 「工程を登録」（`/master/products?highlight=<product_id>`）・編集・例外送品（社長）・削除 |
| 3 | 情報不足（`incomplete`） | 顧客か希望納期が未設定 | 「編集」・削除 |
| 4 | シミュ未実行（`unsimulated`） | `is_scheduled` が false | シミュ（メール起票は「確認」）・編集・削除・一括シミュ |
| 5 | シミュ納期の確認（`simulated`） | `is_scheduled` が true | 承認依頼（受注担当）・再シミュ・編集・削除・一括承認依頼 |

- `has_no_routings` は `product_id` が NULL のときも true なので、製品未確定を先に判定する。工程未登録は `isNoRoutingOrder()`（`is_scheduled` を除外する）ではなく `has_no_routings` を直接見る
- 修理注文（`isRepairOrder()`＝`order_type === "repair"`）は製品・工程を持たないので 1・2 に入れない。修理の `is_scheduled` は実施開始日と完了予定日がそろっているかで立つので 4・5 はそのまま使える
- 差し戻された下書き（`rejection_reason`）は区分を変えず、行に「差し戻し」バッジと理由を出す（`OrderTableRow` の `showRejectionReason`）
- シミュ納期の「確認済み」は持たない。承認依頼を出すと下書きでなくなり、この画面から外れる（Epic の決定事項）

### 画面の構成

```
frontend/src/
  app/orders/intake/page.tsx                    # 下記を組み合わせる
  hooks/use-orders-intake.ts                    # 下書きの区分け（区分内は希望納期の近い順）
  components/orders/intake/
    intake-category-summary.tsx                 # 区分ごとの件数。押すとその区分の表へページ内リンクで移動（0件はリンクにしない）
    intake-category-section.tsx                 # 区分ごとの表。区分ごとの操作は INTAKE_CATEGORY_CONFIG
    failed-email-intake-notice.tsx              # 起票失敗メールへの導線
```

- 行操作・一括操作・確認ダイアログは #554 の `useOrderActions()` / `useOrderBulkActions()` / `OrderActionDialogs` / `OrderBulkActionDialogs` をそのまま使う。#554 の部品には次を足した（どれも省略時は従来どおり）
  - `OrderTableRow`: `leadingActions`（操作カラムの先頭に出す画面固有の操作）・`selectable`（一括選択のチェックボックスを出すか）・`showRejectionReason`
  - `OrdersTable`: `totalCount` / `pageSize` を省略するとページングを出さない。ページは URL の `?page=` 1つで持つので、1画面に表を複数並べるときは省略する
  - `useOrderBulkActions()`: `getSelectAllState(orders)` / `handleToggleSelectAllOf(orders)`（表ごとの全選択）
- 列は5区分で共通（`OrderTableHeaderRow` に `statusFilter="draft"` を渡し、納期の2段目はシミュ納期）。一括選択はシミュ未実行・シミュ納期の確認の表だけ（製品・工程・情報が欠けた下書きを一括シミュに混ぜない）
- 「…」メニューの「納期超過の下書きを送品済みにする」（社長・プラットフォーム管理者、Issue #367）と「＋ 新規注文」を置く。#558 で注文一覧から外すまでは注文一覧にも残る
- 起票失敗メール（`outcome === "failed"`）は**直近7日（`RECENT_FAILED_EMAIL_INTAKE_DAYS`）に受信したものだけを数える**（`countRecentFailedEmailIntakes()`）。失敗には「対応済み」の状態が無く、手動起票しても件数が減らないため。1件以上なら件数付きで強調し、0件でも「受信メール処理結果を見る」のリンクは常に置く

### サイドバー

- 「受注管理」をサブメニュー付きにした（`app-sidebar.tsx`）。親を押すとロールにかかわらず `/orders` を開き、開閉は右端のシェブロン（`SidebarMenuAction`）で行う。サブメニューは初めから展開する（`defaultOpen`）
- サブメニュー: 「起票の確認」・「受信メール処理結果」（トップレベルから移動）
- `SubMenuItem` に `allowedRoles` と `badge: { key, roles }` を足した。件数は `useSidebarBadgeCounts()`（`hooks/use-sidebar-badge-counts.ts`）が `SidebarBadgeKey` ごとに返す。バッジを出す項目が無いロールでは `useOrders({ enabled: false })` で注文を取得しない
- 「起票の確認」の件数バッジ（下書きの件数）は受注担当・ISO担当にだけ出す。#557（送品の消し込み）は `SidebarBadgeKey` に値を足して項目を追加する

## 承認（`/orders/approval`、Issue #556）

Epic #553 の2画面目。社長が承認待ちの注文を、希望納期とシミュ納期を見比べながら承認・一括承認・差し戻しする。Backend の変更は無く、`GET /orders` の全件から `status === "pending_approval"` を絞る（依頼者 `approval_requested_by_name`・依頼日時 `approval_requested_at` は Issue #402 で返している）。

### 一覧

- 並びは承認依頼の古い順（`compareApprovalRequests()`、`lib/order-utils.ts`）。`approval_requested_at` が未設定・解釈できない注文（Issue #402 以前の既存データ）は末尾に置き、同順位は注文 ID 順
- 列: 選択・注文番号（顧客注番）・顧客・製品・数量・希望納期・シミュ納期（希望納期との差）・依頼者（依頼日時）・操作。列が注文一覧と違うので `OrderTableRow` ではなく専用の `ApprovalOrderRow` を使う（行操作・一括選択の props は `useOrderActions().getRowProps()` / `useOrderBulkActions().getRowProps()` をそのまま展開する）
- シミュ納期の差は `getSimulatedDeadlineDiffDays()`（`lib/deadline-risk.ts`、ダッシュボードの承認待ちキューと共有）。超過は「N日超過」を赤字で出し、行の背景も赤くする。それ以外は「希望納期どおり」/「N日前」
- 依頼日時は JST の「M/D HH:mm」（当年以外は「YY/M/D HH:mm」、`formatDateTimeShort()`）
- 注文番号は受注詳細（`/orders/{id}`）へのリンク

### 操作

| ロール | 操作 |
|---|---|
| 社長（`president`） | 承認（確認モーダル、Issue #338）・差し戻し（理由入力）・一括承認（選択して確認モーダル） |
| 受注担当（`order_handler`） | 取り下げ |
| それ以外（`iso_officer` / `platform_admin`） | 閲覧のみ（選択欄も出さない） |

- 権限の判定は `canApproveOrder()` / `canRejectOrder()` / `canWithdrawApproval()`（`lib/order-utils.ts`）に切り出し、注文一覧の `OrderTableRow` と共有する。承認は `president` 限定で `platform_admin` を含めない（Issue #323）
- 取り下げは注文一覧・バックエンド（`withdraw-approval`）と同じく受注担当なら依頼者本人かを問わない
- 承認待ちだけを並べる画面なので、一括操作バーの「一括シミュレーション」は出さない（`OrderBulkActionDialogs` / `BulkActionBar` の `showBulkSimulate={false}`。省略時は従来どおり出す）
- 承認・差し戻し・取り下げた注文は承認待ちでなくなるので、注文の再取得でこの画面から外れる

### 画面の構成

```
frontend/src/
  app/orders/approval/page.tsx                  # 下記を組み合わせる
  hooks/use-orders-approval.ts                  # 承認待ちの絞り込みと並び
  components/orders/approval/
    approval-order-row.tsx                      # ApprovalOrderHeaderRow / ApprovalOrderRow
```

### 導線

- サイドバーの「受注管理」配下に「承認」を「起票の確認」の次に置く。件数バッジ（`SidebarBadgeKey` の `pending_approval`＝承認待ちの件数）は**社長にだけ**出す
- ダッシュボードの承認待ちキュー（`ApprovalQueueCard`）の見出しの遷移先を `/orders?status=pending_approval` からこの画面に変えた
- 注文一覧（`/orders`）の「承認待ち」タブ・「対応が必要」タブ（社長）は #558 で整理するまで残る

## バックエンド追加事項

### `confirmed_deadline` カラム追加

現在、注文確定時にスケジュール計算で算出された「生産完了予定日」が注文テーブルに保存されていない。

**マイグレーション**

```sql
-- supabase/migrations/YYYYMMDD000000_add_confirmed_deadline_to_orders.sql
ALTER TABLE orders ADD COLUMN confirmed_deadline date;
```

**confirm エンドポイントの更新**

`POST /orders/{order_id}/confirm` の処理に以下を追加：

```python
# schedules の最終終了日時から confirmed_deadline を算出
last_end = max(s["end_datetime"] for s in result)
confirmed_deadline = datetime.fromisoformat(last_end).date().isoformat()

order_repo.update(
    order_id,
    {
        "status": "confirmed",
        "is_scheduled": True,
        "confirmed_at": datetime.now(UTC).isoformat(),
        "confirmed_deadline": confirmed_deadline,  # 追加
    },
)
```

**Pydantic スキーマ**

`backend/app/models/transaction/order_schema.py` の `OrderResponse` に `confirmed_deadline: str | None = None` を追加。

### キャンセルエンドポイント（将来対応）

現在 `status='canceled'` への変更は `PATCH /orders/{order_id}` で `{"status": "canceled"}` を送れば可能だが、専用エンドポイント `POST /orders/{order_id}/cancel` を追加すると、キャンセル時の副作用（スケジュール削除等）を整理しやすい。現時点では PATCH で対応。

---

## 実装パターン

### URL クエリパラメータ

マスタ画面と統一した管理。

```tsx
const searchParams = useSearchParams()
const router = useRouter()

// ステータスフィルター変更
const params = new URLSearchParams(searchParams.toString())
params.set("status", newStatus)
router.push(`?${params.toString()}`)
```

| パラメータ | 用途 | 例 |
|---|---|---|
| `?status=` | ステータスフィルター | `?status=draft` |
| `?page=` | ページ番号 | `?page=2` |
| `?sort=` | ソートキー | `?sort=created_at` |

### フィルター実装パターン

```tsx
const PAGE_SIZE = 20

// フィルター（サマリーカードのカウントにも使用）
const draftOrders = useMemo(() =>
  orders?.filter(o => o.status === 'draft') ?? [], [orders])

const incompleteOrders = useMemo(() =>
  orders?.filter(o => !o.customer_id || !o.desired_deadline) ?? [], [orders])

// 表示用フィルター（statusFilter は orders.status の値のみ）
const filteredOrders = useMemo(() => {
  if (!orders) return []
  return orders.filter(order => {
    if (statusFilter) return order.status === statusFilter
    return true
  })
}, [orders, statusFilter])

// ページスライス
const pagedOrders = useMemo(() => {
  const offset = (page - 1) * PAGE_SIZE
  return filteredOrders.slice(offset, offset + PAGE_SIZE)
}, [filteredOrders, page])
```

### `useUpdateOrder` フック追加

`frontend/src/hooks/use-orders.ts` に追加：

```tsx
export function useUpdateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<OrderCreate> }) =>
      apiClient.patch(`/orders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] })
    },
  })
}
```

---

## フロントエンド コード構成

### orders/page.tsx リファクタリング後の構成 (#130)

`page.tsx` の肥大化（645行）を解消するため、責務ごとにファイルを分割。

```
frontend/src/
  app/orders/
    page.tsx                              # エントリーポイント（~160行）
  components/orders/
    edit-order-dialog.tsx                 # 注文編集ダイアログ
    order-view-dialog.tsx                 # 注文の確認ダイアログ（読み取り専用、#527）
    order-dialog-layout.tsx               # 編集・確認ダイアログ共通の外枠（#527）
    delete-order-dialog.tsx               # 削除確認 AlertDialog（注文番号/製品/顧客/数量/希望納期/確定納期のサマリー表示、#284）
    order-notification-cards.tsx          # 下書き/情報不足サマリーカード
    orders-filter-bar.tsx                 # ステータスタブ + ソートセレクト
    order-table-row.tsx                   # テーブル行
    simulation-side-sheet.tsx             # シミュレーション結果サイドシート
    bulk-simulate-summary-dialog.tsx      # 一括シミュレーション結果サマリーモーダル
  hooks/
    use-orders-page.ts                    # URL state・データ取得・ハンドラー一式（#554 で行操作・一括操作を分離）
  lib/
    order-utils.ts                        # filterOrder / compareOrders / 定数・型
```

### 行・操作の共通部品化 (#554)

Epic #553 で注文一覧を「起票の確認」「承認」「送品の消し込み」「すべての注文」に分けるため、
行の操作と確認ダイアログを、どの画面からも呼べる部品にした（挙動は変えていない）。

```
frontend/src/
  app/orders/page.tsx                     # 下記を組み合わせるだけ
  hooks/
    use-orders-page.ts                    # URL の状態・絞り込み・ページング・通知カードの件数
    use-order-actions.ts                  # 行操作の mutation・確認ダイアログの対象・トースト
    use-order-bulk-actions.ts             # 一括選択・一括シミュ／承認依頼／承認・納期超過の下書きの一括送品
  components/orders/
    order-action-dialogs.tsx              # 行操作の確認ダイアログ群（useOrderActions の戻り値を受け取る）
    order-bulk-action-dialogs.tsx         # 一括操作バーと確認ダイアログ群（useOrderBulkActions の戻り値を受け取る）
    orders-table.tsx                      # 表の外枠（読み込み中・空状態・ページング）と既定の列見出し
    order-table-row.tsx                   # visibleActions で出す操作を絞れる（省略時は従来どおり全部）
```

新しい画面での組み立て方:

```tsx
const actions = useOrderActions(orders)
const bulk = useOrderBulkActions({ orders, pageOrders, selectionResetKey })

<OrdersTable header={<OrderTableHeaderRow statusFilter={...} selectAll={...} />} ...>
  {pageOrders.map((order) => (
    <OrderTableRow
      key={order.id}
      order={order}
      visibleActions={["approve", "reject", "view"]}   // 画面で出す操作だけ
      {...actions.getRowProps(order)}
      {...bulk.getRowProps(order)}
      ...
    />
  ))}
</OrdersTable>
<OrderActionDialogs actions={actions} ... />
<OrderBulkActionDialogs bulk={bulk} ... />
```

- `visibleActions` は表示の絞り込みだけで、ステータス・ロールの条件は従来どおり行の中でかかる。
  `"simulate"` は下書きのシミュレーション実行・メール起票の「確認」・再シミュレーションをまとめて指す。
  メニューに出す操作が1つも無ければケバブメニュー自体を出さない。`"view"` を含めないと確定済みの行はクリックできない
- 一括選択は `selectionResetKey` が変わると解除される（一覧ページはページ・タブ・顧客・製品の絞り込みを連結した値を渡す）
- 行操作と一括操作は別々の mutation インスタンスを持つ。一括処理中の行のボタンは `isBulkOperationInProgress` で無効化する

---

## 設計上の決定事項

### フィルタータブは `orders.status` のみに限定する (#215)

**背景**

かつてフィルタータブには「情報不足」（`incomplete`）と「工程未確認」（`unconfirmed_routing`）が含まれていた。しかしこれらは `orders.status` とは本来異なる軸である。

| 軸 | 内容 | 管理場所 |
|---|---|---|
| ライフサイクル状態 | draft → confirmed → completed / canceled | `orders.status`（enum） |
| 入力完全性 | customer_id / desired_deadline の充足状況 | 派生チェック（アプリ側計算） |
| 工程確定状態 | process_routings の is_confirmed | 別テーブルとの JOIN が必要 |

この混在により「下書きタブと情報不足タブの違いが分からない」状態になっていた（下書きタブの行はほぼ全行が顧客未設定であり、両タブが実質同じ集合）。

**方針**

- フィルタータブは `orders.status` の値のみ（すべて / 下書き / 確定済み / 完了 / キャンセル）
- 「情報不足」「工程未確認」は STEP1〜3 バナー経由でのみ認知する
- バナーの件数カウント・導線はフィルタータブと独立して動作する

**将来の検討事項（今回スコープ外）**

- 情報不足・工程未確認のバッジ/インジケーター化（行ごとの表示追加）
  - うち「工程未入力・起票不可」（`has_no_routings`）は Issue #406 で対応済み。一覧行のバッジ＋通知カード＋シミュレーション実行ボタンの無効化で認知させ、専用フィルタタブは追加しない（本決定に準拠）。詳細は [process-routing-confirmation.md](process-routing-confirmation.md) の「注文一覧画面での『工程未入力・起票不可』表示（Issue #406）」
- チップ形式の複数選択フィルタへの置き換え

---

## 実装状況

| 機能 | 優先度 | 状況 |
|---|---|:---:|
| confirmed_deadline カラム追加 | 高 | ✅ 実装済 (#153) |
| confirm エンドポイントの confirmed_deadline 保存 | 高 | ✅ 実装済 (#153) |
| 一覧ページ: アテンションカード | 高 | ✅ 実装済 (#113) |
| 一覧ページ: ステータスフィルター（タブ形式） | 高 | ✅ 実装済 (#114) |
| 一覧ページ: ソート（登録日・希望納期） | 高 | ✅ 実装済 (#114) |
| 一覧ページ: ページネーション (PAGE_SIZE=20) | 低 | ✅ 実装済 (#114) |
| 一覧ページ: 入力不足の警告表示（Tooltip付き） | 高 | ✅ 実装済 (#115) |
| 一覧ページ: ステータスバッジのカラーコード化 | 高 | ✅ 実装済 (#115) |
| 一覧ページ: アクション体系の整備（is_scheduled連動） | 高 | ✅ 実装済 (#115) |
| 一覧ページ: シミュレーション結果の行内展開 | 高 | ✅ 実装済 (#115) |
| 一覧ページ: シミュレーション結果をサイドシート方式に変更 | 高 | ✅ 実装済 (#132) |
| 一覧ページ: AlertDialogによる削除確認 | 高 | ✅ 実装済 (#115) |
| 注文編集ダイアログ | 中 | ✅ 実装済 (#116) |
| 一覧ページ: 確定済み・生産中の行クリックで読み取り専用の確認ダイアログ | 中 | ✅ 実装済 (#527) |
| 一覧ページ: 顧客・製品での絞り込みフィルタ（`?customer=` / `?product=`） | 中 | ✅ 実装済 (#546) |
| 新規注文: 3ステップインジケーター | 中 | ✅ 実装済 (#117) |
| 新規注文: 入力促進ヒント | 中 | ✅ 実装済 (#117) |
| 新規注文: 確定前サマリー表示 | 中 | ✅ 実装済 (#117) |
| 一覧ページ: コード分割リファクタリング | - | ✅ 実装済 (#130) |
| 一覧ページ: 行・操作・確認ダイアログの共通部品化（Epic #553 の画面分割の準備） | - | ✅ 実装済 (#554) |
| 起票の確認画面（下書きの5区分・起票失敗メールへの導線・サイドバーのサブメニューと件数バッジ） | 高 | ✅ 実装済 (#555) |
| 承認画面（承認依頼の古い順・シミュ納期の超過日数・ロール別の承認／差し戻し／取り下げ・社長だけの件数バッジ） | 高 | ✅ 実装済 (#556) |
| 一覧ページ: シミュレーション行ごとローディング・エラーフィードバック | 中 | ✅ 実装済 (#133) |
| 一覧ページ: 一括操作（チェックボックス・一括シミュレーション・一括確定） | 中 | ✅ 実装済 (#135) |
| 一括シミュレーション: サマリーモーダル + NG行ハイライト | 中 | ✅ 実装済 (#140) |
| 一括シミュレーション: 再実行時に1ページ目・NGのみ表示オフへ戻す（結果が null の間は内容コンポーネントをアンマウントして state を初期化、現在ページは総ページ数でクランプ） | 低 | ✅ 実装済 (#551) |
| 注文番号の任意化・メール起票対応 (source_type / source_raw) | 高 | ✅ 実装済 (#155) |
| キャンセル専用エンドポイント | 低 | ❌ 未実装 |
| 工程未確定の確定ブロック（422 routing_unconfirmed） | 高 | ✅ 実装済 (#205) |
| 工程確定UIの追加とロール制限 (admin限定) | 高 | ✅ 実装済 (#199) |
| 工程未確定注文の専門家キューとダッシュボードKPI | 高 | ✅ 実装済 (#200) |
| 工程未確定注文の希望納期フォールバック表示 | 中 | ❌ 未実装 (#201) |
| シミュレーション結果での設備衝突警告 | 中 | ❌ 未実装 (#202) |
| フィルタータブを orders.status のみに限定（情報不足・工程未確認タブ削除） | 中 | ❌ 未実装 (#215) |
| 一覧ページ: 「工程未入力・起票不可」バッジ＋通知カード＋シミュレーション無効化 | 中 | ✅ 実装済 (#406) |
| 削除確認ダイアログの注文サマリー表示・削除トーストの簡略化 | 中 | ✅ 実装済 (#284) |
| 希望納期・確定納期の日付/時刻表示の統一（タイムゾーンズレ修正） | 高 | ✅ 実装済 (#293) |

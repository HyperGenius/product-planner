# 製品マスタ機能

## 概要

製品・品番の登録・管理を行うマスタデータ画面。
`/master/products` からアクセスし、製品の CRUD 操作と工程管理を提供する。

## URL

| パス | 説明 |
|---|---|
| `/master` | マスタデータカード一覧（各マスタへのナビゲーション） |
| `/master/products` | 製品マスタ一覧 |

## データモデル

```typescript
interface Product {
  id: number
  name: string       // 品番（実運用データでは品番がここに入る）
  code: string       // 製品名（任意。旧データでは製品コードが入っている）
  type: string       // 種別（旧フィールド。新規データでは空）
  is_active: boolean
  tenant_id: string
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
- 3列構成：品番/製品名 / 状態 / 操作メニュー
- 品番はモノスペースフォントで表示
- 状態はドット（緑/グレー）＋テキスト（有効/無効）で表示

### 検索・フィルター
- テキスト検索：品番・製品名を横断検索
- 状態フィルター：すべて / 有効 / 無効

### ケバブメニュー（⋮）
- **編集**: 品番・製品名を変更するダイアログ
- **工程管理**: 製造工程ルーティングを管理（`ProductRoutingsDialog`）
- **有効化 / 無効化**: 状態をトグル
- **削除**: 確認ダイアログ付き（取り消し不可）

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `frontend/src/app/master/page.tsx` | マスタデータトップ（カード一覧） |
| `frontend/src/app/master/products/page.tsx` | 製品マスタ一覧ページ |
| `frontend/src/hooks/use-products.ts` | TanStack Query フック群 |
| `frontend/src/components/product-routings-dialog.tsx` | 工程管理ダイアログ |
| `backend/app/routers/master/products.py` | REST API エンドポイント |

## 変更履歴

| PR | 内容 |
|---|---|
| #105 | 製品マスタ画面の再設計（Issue #104）。テーブル列統合・ケバブメニュー・検索フィルター追加 |

# テナントメンバー管理機能 仕様書

## 概要

テナント（工場・会社）の管理者（`admin`）が、同じテナントでシステムを利用する従業員を管理するページ（`/settings/members`）の仕様を定義します。

管理者が直接アカウント（メールアドレス・氏名・初期パスワード）を発行し、メンバーを追加・管理するフローを提供します。

---

## 機能一覧

### 1. メンバー一覧表示

- **URL**: `/settings/members`
- **アクセス制限**: `admin` 権限を持つユーザーのみアクセス可能
- **表示内容**: 氏名、メールアドレス、権限（管理者 / メンバー）
- **エラー表示**: 403 エラー時は「この画面は管理者のみアクセスできます」と表示

### 2. メンバーの直接登録（アカウント発行）

- **操作**: 「メンバーを追加」ボタンからダイアログを開く
- **入力項目**:
  - 氏名（必須）
  - メールアドレス（必須）
  - 権限（`admin` / `member`、デフォルト `member`）
  - 初期パスワード（自動生成 or 手動入力、8文字以上）
- **パスワード自動生成**: 英字大文字・小文字・数字・記号を含む12文字のランダム文字列を生成
- **登録後**: 初期パスワードを画面に表示（コピーボタン付き）。ダイアログを閉じると確認不可
- **エラーハンドリング**: 重複メールアドレス入力時に「このメールアドレスはすでに登録されています」を表示

### 3. メンバー情報の編集

- **操作**: 一覧の編集ボタン（鉛筆アイコン）からダイアログを開く
- **編集可能項目**: 氏名、権限
- **制約**:
  - 自分自身の権限を `admin` → `member` に降格させることは不可
  - テナントの `admin` が0人になるような変更は不可

### 4. メンバーの削除

- **操作**: 一覧の削除ボタン（ゴミ箱アイコン）から確認ダイアログを開く
- **削除内容**: テナントからの紐付け解除（`organization_members` レコードの削除）
- **制約**:
  - 自分自身の削除は不可
  - テナントの `admin` が0人になるような削除は不可

---

## データモデル

### `profiles` テーブル（新規）

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| `id` | UUID | PK, FK(auth.users.id) ON DELETE CASCADE | ユーザーID |
| `full_name` | TEXT | - | 氏名 |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | 作成日時 |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | 更新日時 |

#### RLS ポリシー

- **SELECT**: 同じテナントのメンバーはプロフィールを参照できる（`organization_members` 経由で同テナント判定）
- **UPDATE**: 自分自身のプロフィールのみ更新可能

### `organization_members` テーブル（既存）

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | BIGINT | 主キー |
| `user_id` | UUID | ユーザーID（auth.users 参照）|
| `tenant_id` | UUID | テナントID |
| `role` | TEXT | 権限（`admin` / `member`） |
| `created_at` | TIMESTAMPTZ | 作成日時 |

---

## API エンドポイント

### GET `/tenant/members`

テナントのメンバー一覧を取得する。

- **認証**: Bearer Token 必須
- **ヘッダー**: `x-tenant-id: {tenant_id}`
- **権限**: `admin` のみ
- **レスポンス**:

```json
[
  {
    "user_id": "uuid",
    "email": "user@example.com",
    "full_name": "山田 太郎",
    "role": "admin"
  }
]
```

### POST `/tenant/members`

新規メンバーのアカウントを発行してテナントに追加する。

- **認証**: Bearer Token 必須
- **ヘッダー**: `x-tenant-id: {tenant_id}`
- **権限**: `admin` のみ
- **リクエストボディ**:

```json
{
  "email": "newuser@example.com",
  "password": "SecureP@ss1",
  "full_name": "鈴木 一郎",
  "role": "member"
}
```

- **レスポンス**: `201 Created`、メンバー情報
- **エラー**: `409 Conflict`（メールアドレス重複）、`403 Forbidden`（権限不足）

### PATCH `/tenant/members/{user_id}`

メンバーの氏名・権限を変更する。

- **認証**: Bearer Token 必須
- **ヘッダー**: `x-tenant-id: {tenant_id}`
- **権限**: `admin` のみ
- **リクエストボディ**:

```json
{
  "full_name": "鈴木 花子",
  "role": "admin"
}
```

- **レスポンス**: 更新後のメンバー情報
- **エラー**: `400 Bad Request`（自己降格・admin 0人になる場合）

### DELETE `/tenant/members/{user_id}`

メンバーをテナントから削除する。

- **認証**: Bearer Token 必須
- **ヘッダー**: `x-tenant-id: {tenant_id}`
- **権限**: `admin` のみ
- **レスポンス**: `204 No Content`
- **エラー**: `400 Bad Request`（自己削除・admin 0人になる場合）

---

## セキュリティ設計

1. **Service Role Key の使用**: ユーザー作成（`supabase.auth.admin.create_user`）と `profiles`/`organization_members` への直接書き込みには Service Role Key を使用する。この処理は FastAPI バックエンドのみで実行し、フロントエンドには公開しない。

2. **権限チェック**: 全エンドポイントで、リクエストした本人が対象テナントの `admin` であることを検証してから処理を実行する。

3. **RLS**: `profiles` テーブルは RLS が有効。`organization_members` 経由で同テナントメンバーかどうかを判定する。

4. **自己操作の禁止**: 自分自身の権限降格・削除を禁止して、テナントの `admin` が0人になることを防ぐ。

---

## フロントエンド実装

- **ページ**: `src/app/settings/members/page.tsx`
- **フック**: `src/hooks/use-tenant-members.ts`（React Query）
- **型定義**: `src/types/member.ts`
- **パスワード生成**: `generatePassword()` ユーティリティ（英字大小・数字・記号を含む12文字）
- **ナビゲーション**: サイドバーの「Settings > Members」からアクセス可能

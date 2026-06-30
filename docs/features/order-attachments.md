# 受注メール添付ファイルの Supabase Storage 保存 + UI リンク表示

Gmail 自動伝票起票フローで受信した注文書 PDF を Supabase Storage に保存し、
注文詳細画面からダウンロードできるようにする。
将来の PDF パース処理（Issue B）の前提インフラでもある。

---

## 背景と目的

Gmail 自動起票フロー（`gmail_service.py`）は現状メール本文のテキスト抽出のみを対象としており、添付 PDF は破棄されている。
以下の要件から原本保管と UI 表示が必要になった。

- **ISO 対応**: 注文書の原本保管が必要（社長承認フローの証跡）
- **パース元の参照**: 担当者が UI 上から添付ファイルを確認・ダウンロードできる必要がある
- **将来の PDF パース基盤**: Issue B で実装する PDF パース処理の前提インフラ

---

## ストレージ設計

### バケット

- バケット名: `order-attachments`
- テナント分離バケットポリシーにより、`tenant_id` prefix 以外のパスへのアクセスを拒否

### パス構造

```
{tenant_id}/orders/{order_id}/{original_filename}
```

`order_id` は orders INSERT 後に確定するため、Storage 保存は INSERT の後に実施する。

---

## DB スキーマ

### 新規テーブル: `order_attachments`

```sql
create table order_attachments (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  tenant_id         uuid not null references tenants(id),
  storage_path      text not null,
  original_filename text not null,
  content_type      text,
  size_bytes        bigint,
  parse_status      text not null default 'pending',
  created_at        timestamptz not null default now()
);

alter table order_attachments enable row level security;
create policy "tenant isolation" on order_attachments
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

### `parse_status` の定義

| 値                       | 意味                            |
|--------------------------|---------------------------------|
| `pending`                | 未処理（Issue B で更新）        |
| `success`                | テキスト抽出成功                |
| `failed_encrypted`       | PPAP などパスワード保護         |
| `failed_image`           | 画像 PDF で抽出不可             |
| `failed_no_attachment`   | 添付なし（本文のみで処理）      |

---

## バックエンド処理フロー

既存の `_process_message()` (`backend/app/services/gmail_service.py:107`) に以下を追加:

```
1. Gmail API で添付ファイルを取得（payload.parts から attachmentId を収集）
2. orders INSERT（既存処理: 行 162-175）
3. 添付ファイルを Supabase Storage にアップロード
   パス: {tenant_id}/orders/{order_id}/{original_filename}
4. order_attachments に INSERT（parse_status='pending'）
5. 添付なしの場合は parse_status='failed_no_attachment' で INSERT
```

### 新規ファイル: `backend/app/services/attachment_service.py`

- `upload_attachment(admin_client, tenant_id, order_id, filename, content, content_type) -> str`
- `create_signed_url(admin_client, storage_path, expires_in=3600) -> str`

### 新規 API エンドポイント

`GET /orders/{order_id}/attachments`

- `order_attachments` テーブルから取得
- 各レコードに署名付き URL（有効期限 60 分）を付与して返す

---

## フロントエンド

### 注文詳細ページ (`frontend/src/app/orders/[id]/page.tsx`)

メール本文パネル（行 175-183）の直後に「添付ファイル」セクションを追加。
`source_type === 'email'` の場合のみ表示。

| `parse_status`             | 表示内容                                              |
|----------------------------|-------------------------------------------------------|
| `pending` / `success`      | ファイル名 + ダウンロードリンク（署名付き URL）       |
| `failed_encrypted`         | ⚠ 自動読み取り不可 — ファイルを直接確認してください  |
| `failed_image`             | ⚠ 自動読み取り不可 — ファイルを直接確認してください  |
| `failed_no_attachment`     | 添付ファイルなし                                      |

### 新規型定義 (`frontend/src/types/order.ts`)

```typescript
export interface OrderAttachment {
  id: string;
  order_id: number;
  storage_path: string;
  original_filename: string;
  content_type: string | null;
  size_bytes: number | null;
  parse_status: 'pending' | 'success' | 'failed_encrypted' | 'failed_image' | 'failed_no_attachment';
  signed_url: string;
  created_at: string;
}
```

### 新規フック (`frontend/src/hooks/use-orders.ts`)

`useOrderAttachments(orderId: number)` を TanStack Query `useQuery` で追加。

---

## 受け入れ条件

- [ ] Supabase Storage に `order-attachments` バケットが作成されている
- [ ] テナント分離のバケットポリシーが設定されている
- [ ] `order_attachments` テーブルが作成されている（マイグレーション済み）
- [ ] メール処理時に添付 PDF が Storage に保存される
- [ ] 添付なしメールでも処理が継続する（エラーにならない）
- [ ] 注文詳細画面から添付ファイルをダウンロードできる
- [ ] `parse_status` が失敗系の場合、UI に警告が表示される

---

## スコープ外

- PDF の内容パース・テキスト抽出（→ Issue B）
- PPAP（パスワード付き PDF）の自動復号
- 複数添付ファイルへの対応（まず 1 メール 1 添付を前提）
- 注文変更時の添付ファイル更新（→ Issue C）

---

## 関連

- Issue B: PDF パース＋複数 order 生成
- Issue C: 既存 order upsert（予定）
- [email-order-intake.md](email-order-intake.md): メール起票基盤の設計

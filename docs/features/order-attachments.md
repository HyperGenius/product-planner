# 受注メール添付ファイルの Supabase Storage 保存 + UI リンク表示

Gmail 自動伝票起票フローで受信した注文書 PDF を Supabase Storage に保存し、
注文詳細画面からダウンロードできるようにする。

> [!IMPORTANT]
> Issue #248 により、PDF 添付メールの取り込みフローは「メール受信時点で即時 order 作成」から
> 「PDF をステージング保存し、パース処理（後続Issue）完了後に order を作成」に変更された。
> 添付なし・非PDF添付メールの既存フロー（即時 order 作成）は変更されていない。
> 詳細は本ドキュメント内の「PDF添付メールのステージング保存（Issue #248）」を参照。
>
> [!IMPORTANT]
> Issue #254 により、非PDF添付メール（本文テキスト抽出ルート）で `product_name` /
> `quantity` / `deadline_date` / `order_number` が全て抽出できなかった場合、
> order 作成・添付保存・`order_attachments` INSERT を含む処理全体をスキップし、
> 通知記録のみ行うよう変更された。詳細は本ドキュメント内の「対象外メール検知
> （Issue #254）」および [notifications.md](notifications.md) を参照。

---

## 背景と目的

Gmail 自動起票フロー（`gmail_service.py`）は現状メール本文のテキスト抽出のみを対象としており、添付 PDF は破棄されている。
以下の要件から原本保管と UI 表示が必要になった。

- **ISO 対応**: 注文書の原本保管が必要（社長承認フローの証跡）
- **パース元の参照**: 担当者が UI 上から添付ファイルを確認・ダウンロードできる必要がある
- **将来の PDF パース基盤**: 後続Issue（PDF パース＋複数 order 生成）の前提インフラ

---

## ストレージ設計

### バケット

- バケット名: `order-attachments`
- テナント分離バケットポリシーにより、`tenant_id` prefix 以外のパスへのアクセスを拒否

### パス構造

- 非PDF添付・添付なしメール（既存フロー、`order_id` 確定済み）:
  ```
  {tenant_id}/orders/{order_id}/{original_filename}
  ```
  `order_id` は orders INSERT 後に確定するため、Storage 保存は INSERT の後に実施する。

- PDF添付メール（ステージング、`order_id` 未確定。Issue #248 で追加）:
  ```
  {tenant_id}/inbox/{gmail_message_id}/{original_filename}
  ```
  いずれのパスも `tenant_id` prefix を維持するため、既存のバケットポリシーでカバーされる。

---

## DB スキーマ

### `order_attachments` テーブル

```sql
create table order_attachments (
  id                uuid primary key default gen_random_uuid(),
  order_id          bigint references orders(id) on delete cascade,  -- nullable (Issue #248)
  tenant_id         uuid not null references tenants(id),
  customer_id       bigint references customers(id),                 -- Issue #248 で追加
  source_raw        text,                                             -- Issue #248 で追加
  gmail_message_id  text,                                             -- Issue #248 で追加
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

`order_id` は当初 NOT NULL だったが、Issue #248 で nullable 化された。PDF添付メールの
ステージング行は `order_id=NULL` で作成され、後続Issue（PDFパース）が実際の `orders` 行を
生成した時点で `order_id` を持つ行が別途 INSERT される想定。

**RLSポリシー修正（Issue #280 Phase3）**: 上記の `auth.jwt() ->> 'tenant_id'` は
実際には発行されないクレームであり、他の全テーブルが使う `is_tenant_member(tenant_id)`
とは異なる方式だったため、通常のユーザーJWTクライアントでは SELECT/INSERT が常に
RLS違反になっていた（`GET /orders/{id}/attachments` はこれを service role キーで
回避していた）。`supabase/migrations/20260710000000_fix_order_attachments_rls_tenant_member.sql`
でポリシーを `is_tenant_member(tenant_id)` に統一し、通常のユーザークライアントで
扱えるように修正した。詳細は [pdf-order-parsing.md](pdf-order-parsing.md) の
「手動分割UI（Issue #280 Phase3）」を参照。

### `parse_status` の定義

| 値                       | 意味                            |
|--------------------------|---------------------------------|
| `pending`                | 未処理（後続Issueで更新）       |
| `success`                | テキスト抽出成功                |
| `failed_encrypted`       | PPAP などパスワード保護         |
| `failed_image`           | 画像 PDF で抽出不可             |
| `failed_no_attachment`   | 添付なし（本文のみで処理）      |

`failed_encrypted` / `failed_image` は Issue #254 でアプリ内通知（`notifications` テーブル）
にも記録されるようになった。`order_attachments.parse_status` が一次情報として残る点は変わらず、
`notifications` は横断的な「担当者への通知」専用の薄いテーブルとして別途書き込まれる
（詳細は [notifications.md](notifications.md) 参照）。

`failed_encrypted` / `failed_image` は Issue #304 より、判明している情報だけの下書き
`orders` 行にも紐づけられるようになった（`order_id` が設定された `order_attachments` 行が
追加作成される）。詳細は [pdf-order-parsing.md](pdf-order-parsing.md) の
「PDF自体が読めない場合の下書き起票（Issue #304）」を参照。

---

## バックエンド処理フロー

### 非PDF添付・添付なしメール（既存フロー、変更なし）

`_process_message()` (`backend/app/services/gmail_service.py`):

```
1. Gmail API で添付ファイルを取得（payload.parts から attachmentId を収集）
2. Claude で単一フィールド抽出 → 製品・顧客照合 → orders INSERT
3. 添付ファイルを Supabase Storage にアップロード
   パス: {tenant_id}/orders/{order_id}/{original_filename}
4. order_attachments に INSERT（parse_status='pending'）
5. 添付なしの場合は parse_status='failed_no_attachment' で INSERT
```

### PDF添付メール（ステージング、Issue #248 で追加）

添付に `content_type == 'application/pdf'` のパートが含まれる場合、上記とは別の分岐に入る:

```
1. 送信者アドレスから顧客照合（既存 resolve_or_create_customer を再利用）
2. Claudeによる単一フィールド抽出（extract_email_fields）は呼ばない
3. orders 行は作成しない
4. PDFを Storage の {tenant_id}/inbox/{gmail_message_id}/{filename} に保存
   （upload_staged_attachment()）
5. order_attachments にステージング行を INSERT:
   order_id=NULL, tenant_id, customer_id, gmail_message_id, source_raw=body,
   storage_path, original_filename, content_type, size_bytes, parse_status='pending'
```

このステージング行から実際の `orders` 行を生成する処理（PDFテキスト抽出・複数明細パース）は
後続Issueで実装する。

### 対象外メール検知（Issue #254）

添付なし・非PDF添付メールの既存フロー内、Claude による単一フィールド抽出（`extract_email_fields`）
直後・製品マッチングより前に判定ゲートを追加した（`_process_message`、
`backend/app/services/gmail_service.py`）。

`product_name` / `quantity` / `deadline_date` / `order_number` が全て `None`
（`<UNKNOWN>`）の場合、「受注メールでない」と判定し以下のように挙動を変更する:

- `orders` INSERT・添付ファイルの Storage 保存・`order_attachments` INSERT を
  いずれも行わない（従来は添付なしでも `parse_status='failed_no_attachment'` で
  `order_attachments` に行が作成されていたが、対象外メールの場合はこの行自体を作らない）
- 顧客レコード（`resolve_or_create_customer`）も作成しない
  （迷惑メール送信元で顧客テーブルを汚染しないため）
- 代わりに `notification_service.create_notification()` で `notif_type='non_order_email'`
  （`source_table='gmail_message'`, `source_id=msg_id`）の通知を1件記録する
- 処理済みラベルへ移動して return する（エラー扱いにはしない）

詳細は [notifications.md](notifications.md) を参照。

### 新規ファイル: `backend/app/services/attachment_service.py`

- `upload_attachment(admin_client, tenant_id, order_id, filename, content, content_type) -> str`
  — 既存フロー用（`order_id` 確定済み）
- `upload_staged_attachment(admin_client, tenant_id, gmail_message_id, filename, content, content_type) -> str`
  — PDFステージング用（Issue #248 で追加）
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

- [x] Supabase Storage に `order-attachments` バケットが作成されている
- [x] テナント分離のバケットポリシーが設定されている
- [x] `order_attachments` テーブルが作成されている（マイグレーション済み）
- [x] 添付なしメールでも処理が継続する（エラーにならない）
- [x] 注文詳細画面から添付ファイルをダウンロードできる
- [x] `parse_status` が失敗系の場合、UI に警告が表示される
- [x] PDF添付メール受信時、`orders` 行が作成されない（Issue #248）
- [x] PDF添付メール受信時、`order_attachments` にステージング行
      （`order_id=NULL`, `parse_status='pending'`）が作成される（Issue #248）
- [x] PDFが `{tenant_id}/inbox/{gmail_message_id}/{filename}` に保存される（Issue #248）
- [x] `order_attachments.order_id` が nullable になっている（Issue #248）
- [x] 非PDF添付メールで注文項目が全く抽出できない場合、`orders` / `order_attachments`
      いずれも作成されず `non_order_email` 通知のみ記録される（Issue #254）
- [x] `failed_encrypted` / `failed_image` の発生時、`order_attachments.parse_status`
      更新に加えてアプリ内通知が記録される（Issue #254）

---

## スコープ外

- PDF の内容パース・テキスト抽出・ステージング行からの複数 order 生成（→ 後続Issue）
- PPAP（パスワード付き PDF）の自動復号
- 複数添付ファイルへの対応（まず 1 メール 1 添付を前提）
- 注文変更時の添付ファイル更新（→ 将来Issue）
- ステージング行が長時間 `pending` のまま停滞した場合のリトライ・タイムアウト処理

---

## 関連

- Issue B: PDF パース＋複数 order 生成
- Issue C: 既存 order upsert（予定）
- [email-order-intake.md](email-order-intake.md): メール起票基盤の設計
- [notifications.md](notifications.md): 自動処理パイプラインの通知UI（Issue #254）。
  `failed_encrypted` / `failed_image` / `non_order_email` の通知記録の詳細はこちらを参照

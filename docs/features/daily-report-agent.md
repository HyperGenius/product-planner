# 日報Excel取り込みPoC（Issue #468）

共有Windows PC上のエージェント（PowerShell 5.1、タスクスケジューラ起動）が、ファイルサーバ上の日報Excel
（その日に作った製品と個数）をバックエンド経由で Supabase Storage へ送る。現状 ProductPlanner に無い
「現場の生産実績」を補えるかを検証するための PoC で、**生ファイルを確実に・重複なく・継続的に集めることだけ**を
目的とする。Excel のパースや生産実績への突き合わせは、集まったデータを見てから別 Issue で設計する。

## 実装の進め方（サブIssue）

| Issue | 内容 | 状態 |
|---|---|---|
| #469 | DB・Storage 基盤とエージェントトークン発行 CLI | 本ドキュメントに記載 |
| #470 | エージェント認証と `POST /api/agent/heartbeat` | 本ドキュメントに記載 |
| #471 | 日報ファイル受信 `POST /api/agent/daily-reports` | 未着手 |
| #472 | 共有PCエージェントの配置と設置手順（`tools/daily-report-agent/`） | 未着手 |

## 認証とテナント分離の方針

- エージェントはユーザー JWT を持たないため、**テナント単位のエージェントトークン**（`Authorization: Bearer <token>`）
  で認証する。バックエンドは service role（`get_supabase_admin_client()`）でトークンを照合する
- **`tenant_id` は必ずトークンから解決し、リクエストの値は信用しない**。service role は RLS をバイパスするので、
  以降のクエリはすべて `.eq("tenant_id", tenant_id)` でアプリ側から明示的に絞り込む
  （前例: 端末信頼の PIN ログイン `routers/auth/device.py`、[device-trust-pin-auth.md](device-trust-pin-auth.md)）
- トークンは**平文で保存しない**。`agent_tokens.token_hash` に SHA-256 の hex だけを保存し、照合時は受け取った
  トークンを同じ方式でハッシュ化して引く。トークンは `secrets.token_urlsafe(32)`（256bit）の乱数なので
  bcrypt 等の低速ハッシュは不要。生成・ハッシュ化は `backend/app/services/agent_token_service.py` に集約し、
  発行 CLI と認証 dependency の両方がこれを使う
  - 端末信頼の `device_trust_registrations.device_id` は平文で保存しているが、エージェントトークンは
    共有PC上に長期間置かれる秘密情報なので、この点は前例と変えている

## データモデル

`supabase/migrations/20260929000000_add_daily_report_agent.sql`

| テーブル | 内容 | RLS |
|---|---|---|
| `agent_tokens` | `tenant_id`, `name`（設置場所のメモ）, `token_hash`（UNIQUE、`^[0-9a-f]{64}$` の CHECK）, `created_at`, `last_used_at`, `revoked_at` | 有効・**ポリシー無し**（ユーザー JWT からは SELECT も不可。`member_pins` と同じ扱い） |
| `daily_report_files` | `tenant_id`, `agent_token_id`, `sha256`, `storage_path`, `original_path`, `file_name`, `size_bytes`, `file_modified_at`, `received_at`。**UNIQUE (`tenant_id`, `sha256`)** | 有効・`is_tenant_member(tenant_id)` の SELECT のみ |
| `agent_heartbeats` | `tenant_id`, `agent_token_id`, `received_at`, `scanned_count` / `sent_count` / `duplicate_count` / `error_count`, `agent_version`, `payload jsonb` | 有効・`is_tenant_member(tenant_id)` の SELECT のみ |

- 3テーブルとも INSERT/UPDATE/DELETE ポリシーは作らず、書き込みは service role 経由のバックエンドに限定する
- `daily_report_files` の重複排除（同一内容の再送・同時送信）は UNIQUE (`tenant_id`, `sha256`) で担保する。
  別テナントで同じ内容のファイルがあっても衝突しない
- `original_path` は URL エンコードされて送られてくるファイルパスを復元した値。日本語を含みうるので
  Storage のキーには使わず、テーブル側に保存する
- `agent_heartbeats` の集計値の列は、エージェントスクリプト（#472 で配置）の実際の出力に合わせて調整してよい。
  それ以外の項目は `payload` にそのまま保存する
- `agent_token_id` の外部キーは `ON DELETE` を指定していない（NO ACTION）。トークンは削除ではなく
  `revoked_at` で失効させる運用とし、どのトークンから送られたかの記録を残す

### Storage バケット `daily-reports`

- private。`file_size_limit` は 20MB（20971520 バイト）で、バックエンドの受信上限と揃える
- オブジェクトのキーは `{tenant_id}/{sha256}`（ASCII 安全）。`tenant_id` をプレフィックスにする形は `order-attachments` と同じ
- 読み書きはバックエンド（service role）のみ。`storage.objects` に `authenticated` 向けのポリシーは付けない
- Terraform（`infra/terraform/`）の `supabase/supabase` provider はバケットを管理できないため、
  `order-attachments` と同じくマイグレーションの `INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING` で作る

## エージェント API（`/api/agent/*`）

`backend/app/routers/agent/`。マシン間通信のため `/api/cron/*` に揃えて `/api/agent/*` とし、`/v1` は付けない。
ルーターはエンドポイントごとに `APIRouter(prefix="/api/agent")` を持ち、`app/main.py` に個別に登録する（cron と同じ形）。

### 認証 dependency `get_agent_context`（`routers/agent/_auth.py`）

1. `Authorization: Bearer <token>` を取り出す
2. `hash_agent_token()` でハッシュ化し、`agent_tokens.token_hash` で1行引く（service role）
3. 該当行が未失効（`revoked_at IS NULL`）なら `AgentContext(tenant_id, agent_token_id)` を返す
4. `agent_tokens.last_used_at` を現在時刻で更新する（`id` と `tenant_id` で絞り込む）。
   稼働状況の目安にすぎないので、**更新に失敗しても warning ログを残して本処理は続行**する

| ケース | レスポンス |
|---|---|
| ヘッダ無し・`Bearer ` 以外の形式・空トークン | 401 `{"detail": "Invalid agent token."}` |
| 該当トークン無し | 同上 |
| 失効済み | 同上（該当なしと区別しない） |
| トークン照合時の DB エラー | 500 `{"detail": "Agent authentication failed."}`（詳細はログのみ） |

- 401 には `WWW-Authenticate: Bearer` を付ける。detail は固定文言で、例外文言や失効済みかどうかを返さない
- **`tenant_id` は `AgentContext` からだけ取る**。ボディ・ヘッダ（`x-tenant-id`）・クエリに `tenant_id` が
  含まれていても参照しない。エンドポイント側のクエリはすべて `.eq("tenant_id", ctx.tenant_id)` で明示的に絞り込む
- テストで admin client を差し替えられるよう、admin client は `Depends(get_supabase_admin_client)` で受け取る

### `POST /api/agent/heartbeat`（`routers/agent/heartbeat.py`）

エージェントの実行ごとのサマリを `agent_heartbeats` に1行記録する。スキーマは `app/models/agent.py`。

```json
{
  "scanned_count": 12,
  "sent_count": 3,
  "duplicate_count": 8,
  "error_count": 1,
  "agent_version": "0.1.0",
  "hostname": "（未知のフィールドは payload に保存）"
}
```

- 集計値4つは省略時 0、負数は 422。`agent_version` は任意（最大100文字）
- スキーマに無いフィールド（`extra="allow"`）は `payload` にそのまま保存する。ただし `tenant_id` /
  `agent_token_id` はトークンから解決する値なので、送られてきても `payload` にも残さず捨てる
- `tenant_id` / `agent_token_id` の列は `AgentContext` の値で埋める
- レスポンス: `200 {"status": "ok"}`
- INSERT 失敗時は 500 `{"detail": "Failed to record heartbeat."}`。例外の詳細は `logger.error(..., exc_info=True)`
  にのみ残す（cron と同じ規約）

## トークンの発行・失効

`backend/scripts/issue_agent_token.py`（使い方は [backend/scripts/USAGE.md](../../backend/scripts/USAGE.md)）

- `issue --tenant-id <uuid> --name <メモ>`: 平文トークンを1回だけ表示し、DB にはハッシュのみ保存する
- `list --tenant-id <uuid>`: 有効/失効済み・`last_used_at` を表示する（ハッシュは表示しない）
- `revoke --token-id <uuid>`: `revoked_at` をセットする。紛失・漏洩・共有PCの入れ替え時は revoke してから issue し直す

`create_tenant.py` には組み込んでいない。エージェントを使うのは一部のテナントだけで、発行・再発行・失効は
テナント作成とは別のタイミングで起きるため。

## テスト

- `backend/__tests__/unit/services/test_agent_token_service.py`: トークン生成・ハッシュ形式
- `backend/__tests__/scripts/test_issue_agent_token.py`: CLI が平文を DB に渡さないこと、失効処理の分岐
- `backend/__tests__/api/routers/agent/test_heartbeat.py`: 認証（ヘッダ不正・該当なし・失効済みがすべて同じ 401）、
  トークンのテナントへの記録（リクエストの `tenant_id` を無視）、`last_used_at` 更新、`payload` への未知フィールド保存、
  DB エラー時の固定文言
- `backend/__tests__/integration/test_daily_report_agent_rls.py`（`--run-integration`）: RLS（ユーザー JWT から
  書き込めない・他テナントの行が見えない・`agent_tokens` が見えない）、UNIQUE (`tenant_id`, `sha256`)、
  `token_hash` の CHECK 制約、バケット設定

## スコープ外（PoC ではやらない）

- Excel のパース、製品マスタとの照合、実績テーブルへの展開
- 同一パスの新旧版の判定、注文・工程への配賦
- heartbeat 途絶のアラート通知（記録のみ行い、PoC 期間中は手動で確認）
- エージェントの自動アップデート、管理画面UI

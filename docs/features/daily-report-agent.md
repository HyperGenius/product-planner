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
| #471 | 日報ファイル受信 `POST /api/agent/daily-reports` | 本ドキュメントに記載 |
| #472 | 共有PCエージェントの配置と設置手順（`tools/daily-report-agent/`） | 本ドキュメントに記載 |
| #478 | タスクスケジューラ登録スクリプト | 未着手 |

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
- `agent_heartbeats` の集計値の列は、エージェント（#472）の出力と揃えてある（各値の意味は「共有PCエージェント」を参照）。
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

### `POST /api/agent/daily-reports`（`routers/agent/daily_reports.py`）

日報ファイル1件を受信し、Storage に保存して `daily_report_files` に1行記録する。ボディはファイル本体
（`application/octet-stream`）、メタデータはヘッダで受け取る。保存・重複判定は
`app/services/daily_report_service.py`、レスポンススキーマは `app/models/agent.py` の `DailyReportUploadResponse`。

| ヘッダ | 必須 | 内容 |
|---|---|---|
| `Authorization` | ○ | `Bearer <エージェントトークン>`（`get_agent_context`） |
| `X-File-Sha256` | ○ | ファイル本体の SHA-256（hex 64桁）。大文字小文字は問わず、小文字に正規化して保存する（PowerShell の `Get-FileHash` は大文字を返す） |
| `X-File-Path` | ○ | 元のファイルパスを UTF-8 で URL エンコードした値（PS 5.1 の `[System.Uri]::EscapeDataString()`）。`urllib.parse.unquote()` で復元して `original_path` に、`PureWindowsPath(...).name` を `file_name` に保存する |
| `X-File-Modified-At` | 任意 | ファイルの更新日時（ISO 8601。PS の `ToString("o")` の小数7桁も可）。オフセット無しは JST とみなす。**解釈できない値はファイル受信を止めず NULL で保存**する（参考情報のため） |

処理の流れ:

1. 認証（401 は heartbeat と同じ）。ボディを読む前にヘッダを検証する
2. `Content-Length` が上限を超えていれば、ボディを読まずに 413
3. `request.stream()` で読みながら累計バイト数を数えて上限超過で 413（`Content-Length` 省略のチャンク転送対策）、
   同時に SHA-256 を計算する。`X-File-Sha256` と一致しなければ 400
4. `store_daily_report()`（同期の supabase-py を使うので `run_in_threadpool` で実行）
   1. `(tenant_id, sha256)` の既存行があれば `duplicate`（Storage・テーブルとも触らない）
   2. `upsert=false` でキー `{tenant_id}/{sha256}` にアップロードする。既存オブジェクトなら Storage は
      `StorageApiError(status="409", code="Duplicate")` を返すので、上書きせずに次へ進む
      （前回 INSERT に失敗して Storage にだけ残ったケース。キーが sha256 なので中身は同一）
   3. INSERT する。`23505`（unique_violation、同時送信で先を越された）なら `duplicate`

| ケース | レスポンス |
|---|---|
| 新規保存 | 200 `{"status": "stored", "sha256": "<小文字hex>"}` |
| 同一テナントで同一 sha256 を受信済み | 200 `{"status": "duplicate", "sha256": "..."}` |
| 必須ヘッダ無し | 400 `Missing required header: X-File-Sha256.` 等 |
| `X-File-Sha256` が hex 64桁でない | 400 `Invalid X-File-Sha256 header.` |
| `X-File-Path` が UTF-8 として復元できない・ファイル名部分が空 | 400 `Invalid X-File-Path header.` |
| ボディのハッシュ不一致 | 400 `X-File-Sha256 does not match the request body.` |
| 上限超過（宣言値・実測値とも） | 413 `File too large.` |
| Storage・DB エラー | 500 `Failed to store daily report.`（詳細はログのみ） |

- 上限は `MAX_DAILY_REPORT_BYTES`（環境変数 `DAILY_REPORT_MAX_BYTES`、デフォルト 20MB）。バケットの
  `file_size_limit` と揃えること。上げる場合はバケット設定とホスティング先のリクエストボディ上限も確認する
- ボディは上限までメモリに載せる（Storage へのアップロードが bytes を要求するため）
- `tenant_id` はトークンからのみ解決し、Storage のキー・テーブルの行・既存行の検索のすべてに使う

## 共有PCエージェント（`tools/daily-report-agent/`、Issue #472）

設置手順・設定項目・ログ・終了コードは [tools/daily-report-agent/README.md](../../tools/daily-report-agent/README.md)
（設置作業者向け）を参照。ここでは実装上の判断だけを書く。

- `DailyReportAgent.ps1` は PowerShell 5.1・追加モジュール無しで動く。1回の実行で走査・送信・heartbeat を行って
  終了し、定期実行はタスクスケジューラに任せる（登録スクリプトは #478）
- **送信済みの判定はローカルの状態ファイル（`state/sent-files.json`、パス → SHA-256）で行う**。サーバが
  `stored` / `duplicate` を返したときだけ記録し、4xx/5xx・通信エラーは記録しない（次回の実行で再送）。
  状態ファイルを消しても、サーバ側の UNIQUE (`tenant_id`, `sha256`) で `duplicate` になるだけで重複保存はされない
- サイズと更新日時が前回送信時と同じファイルはハッシュを計算しない（ファイルサーバからの毎時の全件読み込みを避ける）。
  更新日時だけ変わって中身が同じ場合は、送らずに状態だけ更新する
- **ファイルは1回だけメモリに読み込み、同じバイト列から SHA-256 を計算して送る**。ハッシュ計算と送信で
  ファイルを別々に開くと、その間に保存されたときに `X-File-Sha256` とボディが食い違って 400 になるため
- 記入中の判定: `FileShare.Read`（他プロセスの書き込みを許さない）で開き、共有違反・ロック違反
  （Win32 エラー 32 / 33）になったら Excel が書き込み用に開いている＝記入中としてスキップする（エラーに数えない）。
  `~$` で始まる Excel の一時ファイルは走査対象から外す
- HTTP は `Invoke-WebRequest` ではなく `System.Net.HttpWebRequest` を使う。PS 5.1 の `Invoke-WebRequest` は
  4xx/5xx で例外になり、ステータスコードとボディを扱いにくいため。TLS 1.2 は明示的に有効にしている
- heartbeat の4つの集計値の意味: `scanned_count` ＝走査した対象ファイル数、`sent_count` ＝ `stored` の数、
  `duplicate_count` ＝ `duplicate` の数、`error_count` ＝送信失敗・読み取り失敗・フォルダ走査失敗・
  サイズ上限超過の合計。変更なし・記入中のスキップ数、実行時刻、ホスト名等は `payload` に入る
- 401 を受けたらその回の残りの送信を打ち切る（トークンが無効なら全件失敗するため）
- `.ps1` は **BOM 付き UTF-8**。PS 5.1 は BOM 無しの UTF-8 を ANSI（日本語 Windows では Shift-JIS）として読み、
  日本語の文字列リテラルが化けるため。改行は `.gitattributes` で CRLF に固定している
- トークンを含む `config.json`・状態ファイル・ログは `tools/daily-report-agent/.gitignore` でコミット対象外

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
- `backend/__tests__/api/routers/agent/test_daily_reports.py`: 保存・重複（既存行／既存オブジェクト／
  unique_violation）、トークンのテナントへの保存、ヘッダ検証・ハッシュ不一致の 400、`Content-Length` 超過と
  チャンク転送での超過の 413、日本語パスの復元、401、Storage・DB エラー時の固定文言
- `backend/__tests__/unit/services/test_daily_report_service.py`: ヘッダ値のパース（sha256 正規化・パス復元・更新日時）
- `backend/__tests__/integration/test_daily_report_agent_rls.py`（`--run-integration`）: RLS（ユーザー JWT から
  書き込めない・他テナントの行が見えない・`agent_tokens` が見えない）、UNIQUE (`tenant_id`, `sha256`)、
  `token_hash` の CHECK 制約、バケット設定、`store_daily_report()` の実 Storage での重複排除

## スコープ外（PoC ではやらない）

- Excel のパース、製品マスタとの照合、実績テーブルへの展開
- 同一パスの新旧版の判定、注文・工程への配賦
- heartbeat 途絶のアラート通知（記録のみ行い、PoC 期間中は手動で確認）
- エージェントの自動アップデート、管理画面UI

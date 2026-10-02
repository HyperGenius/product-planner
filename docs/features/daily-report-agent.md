# 日報Excel取り込みPoC（Issue #468）

共有Windows PC上のエージェント（PowerShell 5.1、タスクスケジューラ起動）が、ファイルサーバ上の日報Excel
（その日に作った製品と個数）をバックエンド経由で Supabase Storage へ送る。現状 ProductPlanner に無い
「現場の生産実績」を補えるかを検証するための PoC で、**生ファイルを確実に・重複なく・継続的に集めることだけ**を
目的とする。集まった日報の活用（パース・マスタとの照合・受注への割り付け・ガントへの進捗表示）は
Epic #485「日報進捗反映」で進めており、パースと明細の保存（#487）は本ドキュメントの
「[日報のパースと明細の保存](#日報のパースと明細の保存issue-487)」に、名寄せと別名辞書（#488）は
「[日報の名寄せと別名辞書](#日報の名寄せと別名辞書issue-488)」に、未照合キューの画面（#489）は
「[未照合キューの画面](#未照合キューの画面issue-489)」に、受注への割り付けと進捗（#490）は
「[受注への割り付けと進捗の算出](#受注への割り付けと進捗の算出issue-490)」に、ガントチャート・受注詳細への進捗表示（#491）は
「[ガントチャート・受注詳細への進捗表示](#ガントチャート受注詳細への進捗表示issue-491)」に記載する。

## 実装の進め方（サブIssue）

| Issue | 内容 | 状態 |
|---|---|---|
| #469 | DB・Storage 基盤とエージェントトークン発行 CLI | 本ドキュメントに記載 |
| #470 | エージェント認証と `POST /api/agent/heartbeat` | 本ドキュメントに記載 |
| #471 | 日報ファイル受信 `POST /api/agent/daily-reports` | 本ドキュメントに記載 |
| #472 | 共有PCエージェントの配置と設置手順（`tools/daily-report-agent/`） | 本ドキュメントに記載 |
| #478 | タスクスケジューラ登録スクリプト | 本ドキュメントに記載 |
| #487 | 日報のパースと明細の保存（Epic #485 の 2/6） | 本ドキュメントに記載 |
| #488 | 名寄せ（設備・工程・顧客・製品）と別名辞書（Epic #485 の 3/6） | 本ドキュメントに記載 |
| #489 | 未照合キューの画面（Epic #485 の 4/6） | 本ドキュメントに記載 |
| #490 | 受注への割り付けと進捗の算出（Epic #485 の 5/6） | 本ドキュメントに記載 |
| #491 | ガントチャート・受注詳細への進捗表示（Epic #485 の 6/6） | 本ドキュメントに記載 |

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
- オブジェクトのキーは `{tenant_id}/{sha256}{拡張子}`（例: `.../{sha256}.xlsx`、ASCII 安全）。`tenant_id` をプレフィックスにする形は `order-attachments` と同じ
  - 日本語を含むファイル名はキーに使わないが、ダウンロードしたファイルをそのまま開けるよう**元ファイル名の拡張子だけ**を
    小文字化して付ける（`storage_extension()`）。ASCII 英数字 1〜10 文字以外の拡張子（日本語・記号入り）や拡張子無しの場合は付けない
  - `content-type` も拡張子から決める（`content_type_for()`。`.xlsx` / `.xlsm` / `.xls` / `.csv` / `.pdf` 以外は
    `application/octet-stream`）。`mimetypes` はホストの Python バージョン・`/etc/mime.types` の有無で `.xlsx` 等の
    解決結果が変わるため使わず、明示的なテーブルで持つ
  - 拡張子付与の導入前に保存されたオブジェクトは拡張子無しのキーのまま。参照は常に `daily_report_files.storage_path` 経由で行うこと
- 読み書きはバックエンド（service role）のみ。`storage.objects` に `authenticated` 向けのポリシーは付けない
- Terraform（`infra/terraform/`）の `supabase/supabase` provider はバケットを管理できないため、
  `order-attachments` と同じくマイグレーションの `INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING` で作る

## 受付口 Edge Function `agent-gateway`

エージェントはバックエンド（Render）を直接叩かず、Supabase Edge Function
`supabase/functions/agent-gateway/index.ts` を経由する。エージェントの `api_base_url` は
`https://<project-ref>.supabase.co/functions/v1/agent-gateway` で、バックエンドのホスト先を変えても
共有PC側の設定を変えずに済む（切り替えは Edge Function Secrets の `BACKEND_URL` だけ）。

- ロジックは持たない薄いプロキシ。`/api/agent/heartbeat` と `/api/agent/daily-reports` の POST だけを
  `BACKEND_URL` へ中継し、それ以外は 404 / 405（任意のバックエンド API への踏み台にしない）
- 転送するリクエストヘッダは `Authorization` / `Content-Type` / `User-Agent` / `X-File-*` の許可リストのみ。
  ステータスとボディはそのまま返す
- **`verify_jwt = false` でデプロイする**。エージェントは Supabase の JWT ではなく独自のエージェントトークンを
  `Authorization` に載せるため、既定の JWT 検証が有効だとゲートウェイで 401 になる。認証はバックエンドの
  `get_agent_context` が行う。Terraform provider（`supabase/supabase` 1.9.x）の `supabase_edge_function` には
  `verify_jwt` 属性が無いため、この関数は Terraform 管理にせず CLI でデプロイする:

  ```bash
  supabase functions deploy agent-gateway --no-verify-jwt --project-ref <project-ref>
  ```

- **ボディは上限（既定 20MB、Secrets の `AGENT_MAX_BODY_BYTES`）付きで読み切ってから転送する**。Edge Runtime は
  クライアントのボディを読み切らずに応答すると応答を返せず、Kong のタイムアウト（約60秒）で 504 になる。
  ストリームのまま中継すると、バックエンドがボディを読む前に応答するケース（トークン不正の 401、上限超過の 413）で
  これを踏み、トークン設定ミスが「毎回タイムアウト」に見える（ローカルで 15MB＋不正トークンで再現）。
  上限超過も読み捨ててから 413 を返す。バックエンドの `DAILY_REPORT_MAX_BYTES` を変えたときは合わせて変える
- `BACKEND_URL` は `parse-order-pdfs-trigger` と共用の Secret
- ローカル確認: `supabase functions serve --env-file <file>`（関数名は指定できず全関数が起動する。
  `config.toml` の `verify_jwt = false` が効く）。`<file>` に `BACKEND_URL=http://host.docker.internal:8000` を書き、
  `http://127.0.0.1:54321/functions/v1/agent-gateway/api/agent/heartbeat` へ POST する

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
   2. `upsert=false` でキー `{tenant_id}/{sha256}{拡張子}` にアップロードする。既存オブジェクトなら Storage は
      `StorageApiError(status="409", code="Duplicate")` を返すので、上書きせずに次へ進む
      （前回 INSERT に失敗して Storage にだけ残ったケース。キーが sha256 を含むので中身は同一）
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
  終了し、定期実行はタスクスケジューラに任せる（登録スクリプトは #478、下記「タスクスケジューラ登録」）
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

### タスクスケジューラ登録（Issue #478）

`Install-DailyReportAgentTask.ps1`（登録・更新）／`Uninstall-DailyReportAgentTask.ps1`（削除）。使い方は README、
顧客先での作業手順と確認用 SQL は
[tools/daily-report-agent/SETUP_CHECKLIST.md](../../tools/daily-report-agent/SETUP_CHECKLIST.md) を参照。

- タスクは `\ProductPlanner\DailyReportAgent` 固定。`Register-ScheduledTask -Force` で上書きするので何度実行しても1つ
- 既定のトリガーは平日 9:00 開始・1時間間隔・8時間継続。開始時刻・間隔・継続時間・曜日・実行時間の上限はパラメータで
  変えられる（終了を18時まで延ばすかは `-DurationHours 9` で調整）。PS 5.1 の `New-ScheduledTaskTrigger -Weekly` は
  `-RepetitionInterval` を受け付けないため、`-Once` で作ったトリガーの `.Repetition` を週次トリガーに代入している
- 設定: `MultipleInstances IgnoreNew`（多重起動しない。エージェント側のロックファイルと二重の防止）、
  `ExecutionTimeLimit` 30分、`StartWhenAvailable`（予定時刻に PC が起動していなければ起動後に実行）、バッテリー駆動でも止めない
- **実行アカウント**: ファイルサーバ（UNC パス）を読むためネットワーク資格情報を持つユーザーで動かす。`SYSTEM` と S4U は
  ファイル共有にアクセスできないので使わない。`-LogonMode` で2方式を選ぶ
  - `Interactive`（既定）: ログオン中のみ実行・パスワード不要。#468 の未決事項（共用アカウントか・パスワード有効期限）が
    決まるまでは、パスワードの保存・期限切れによる停止が起きないこちらを既定にした
  - `Password`: ログオンしていなくても実行。パスワードは `Get-Credential` で対話的に受け取り、引数・ファイルでは
    受け取らない（コマンド履歴に残さない）。パスワード変更で失敗し始めるので再登録が必要（README に手順）
  - `-User` 省略時は `Win32_ComputerSystem.UserName`（コンソールにログオン中のユーザー）を使う。「管理者として実行」で
    別の管理者アカウントに昇格すると `$env:USERNAME` は管理者になり、共有PCのアカウントではなく管理者でタスクが
    登録されてしまうため
- 実行内容には仕様の `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File` に加えて `-WindowStyle Hidden` を付けている。
  `Interactive` では毎時コンソール画面が現場の作業画面の前面に出るため（一瞬は表示される）
- `[CmdletBinding(SupportsShouldProcess)]` で `-WhatIf` / `-Confirm` に対応。`-WhatIf` では `New-ScheduledTask` で
  組み立てたタスク定義を表示するだけで登録しない
- 登録失敗時は HRESULT で対処を出し分ける（0x80070005 権限不足 → 管理者で実行、0x8007052E パスワード誤り、
  0x80070569「バッチ ジョブとしてログオン」権限なし、0x80070534 アカウントなし）
- 削除スクリプトはタスクが無くてもエラーにしない。`\ProductPlanner\` フォルダが空になれば `Schedule.Service` COM で
  フォルダも消す（`ScheduledTasks` モジュールにフォルダ削除のコマンドが無いため）。`config.json`・`state\`・`logs\` は消さない
- macOS / Linux の `pwsh` には `ScheduledTasks` モジュールが無い。構文と PS 5.1 互換性は `mcr.microsoft.com/dotnet/sdk:8.0`
  コンテナの `pwsh` で PSScriptAnalyzer（`PSUseCompatibleSyntax`、TargetVersions 5.1）にかけ、実際の登録は Windows 実機で確認する
- `.ps1` の CRLF は `tools/daily-report-agent/.gitattributes`（#472 で追加済み）で固定しているため、リポジトリ直下の
  `.gitattributes` は追加していない

## トークンの発行・失効

`backend/scripts/issue_agent_token.py`（使い方は [backend/scripts/USAGE.md](../../backend/scripts/USAGE.md)）

- `issue --tenant-id <uuid> --name <メモ>`: 平文トークンを1回だけ表示し、DB にはハッシュのみ保存する
- `list --tenant-id <uuid>`: 有効/失効済み・`last_used_at` を表示する（ハッシュは表示しない）
- `revoke --token-id <uuid>`: `revoked_at` をセットする。紛失・漏洩・共有PCの入れ替え時は revoke してから issue し直す

`create_tenant.py` には組み込んでいない。エージェントを使うのは一部のテナントだけで、発行・再発行・失効は
テナント作成とは別のタイミングで起きるため。

## 日報のパースと明細の保存（Issue #487）

`daily_report_files` に保存された日報Excelを cron でパースし、1行ずつ `daily_report_entries` に保存する。
ここでは**名寄せ（マスタとの照合）は行わず**、日報の値をそのまま（前後の空白除去・数値セルの文字列化と、
日付・数量の解釈のみ）保存する。名寄せ（#488）・受注への割り付け（#490）は Excel ではなくこの明細を入力にする。

### データモデル

`supabase/migrations/20261003000000_add_daily_report_entries.sql`

| テーブル／列 | 内容 | RLS |
|---|---|---|
| `daily_report_files.parse_status` | `pending`（未処理・既定値）/ `parsed` / `unsupported`（`.xls` 等）/ `failed`。`parsed_at`・`parse_error` も追加 | 既存（SELECT のみ） |
| `daily_report_entries` | 1行＝日報の1行。`source_file_id` / `sheet_name` / `row_no`（Excel の行番号）/ `work_date`（解釈できなければ NULL）/ `work_date_raw` / `worker_raw` / `customer_raw` / `homeworker_raw`（内職者名）/ `product_raw` / `process_raw` / `equipment_raw` / `processed_qty` / `defect_qty` / `good_qty` / `setup_qty` / `lot_no` / `note` / `parse_issues`（jsonb）。UNIQUE (`tenant_id`, `sheet_name`, `row_no`) | 有効・`is_tenant_member(tenant_id)` の SELECT のみ |
| `daily_report_sheets` | PK (`tenant_id`, `sheet_name`)。そのシートの明細がどのファイル（`source_file_id`）の内容か、その版（`source_version_at` = `file_modified_at`、無ければ `received_at`）と `entry_count` | 有効・`is_tenant_member(tenant_id)` の SELECT のみ |

- 書き込みは cron（service role）のみ。既存テーブルと同じく INSERT/UPDATE/DELETE ポリシーは作らない
- 既存の `daily_report_files` の行はマイグレーションで `pending` になり、デプロイ後の cron で順次取り込まれる
- `daily_report_entries` / `daily_report_sheets` は `daily_report_files` から `ON DELETE CASCADE`（派生データのため）

### パース（`services/daily_report_parser.py`）

Storage・DB から切り離した純粋関数（`parse_daily_report_workbook()` / `parse_sheet_rows()` / `parse_work_date()`）。
`openpyxl` の `load_workbook(..., read_only=True, data_only=True)` で読む。

- **対象シート**は名前が `^\d{4}製造$`（`YYMM製造`）のものだけ。`原紙`（テンプレート）・`リスト`・`設備台帳目次` は読まない
- **ヘッダ行**は固定の行番号ではなく、先頭30行から `加工日` のセルを探して特定する（上部に集計値・注意書きの行がある）。
  見つからないシートは明細を置き換えずに飛ばす（既存の明細を消さないため）
- **列はヘッダ名で引く**（NFKC・空白除去後に完全一致）。備考欄はヘッダが説明文（「…を記載する備考欄」）なので `備考` の部分一致
- `read_only` モードはファイルに記録された使用範囲（dimensions）だけを読むので、`reset_dimensions()` してから全行を読む
- **良品数** `good_qty = 加工数 − 不適合合計数`（0未満は0 ＋ `negative_clamped`）。`不適合合計数` は数式セルなので、
  キャッシュ値が無い（Excel 以外で保存された）場合は同名の個別列 `不適合数`（複数列）の合計で代替する
- 加工数が空の行は `good_qty = NULL` で保存する（進捗に数えない）
- 商品名が数値セル（`1234`）なら文字列化する。担当者の複数名表記（`A・B` / `A/B`）は raw のまま
- 数量の文字列（全角数字・桁区切りのカンマ）は整数に正規化し、整数にできない値は NULL ＋ `invalid`

**加工日**（`YYYY.MM.DD` の文字列。日付セルでも可）は行を捨てずに `parse_issues` に記録する:

| ケース | 例（シート `2609製造`） | 結果 | `parse_issues` |
|---|---|---|---|
| 連結 | `2026.09.232026.09.18` | 先頭の 2026-09-23 | `concatenated` |
| 前月・翌月の行 | `2026.08.31` | そのまま | `outside_sheet_month` |
| 年の誤記 | `2029.09.02` | 2026-09-02 | `year_corrected` |
| 年をまたぐ前月 | `2025.12.31`（シート `2601製造`） | そのまま（誤記扱いしない） | `outside_sheet_month` |
| 範囲外で補正もできない | `2026.03.05` | そのまま | `outside_sheet_month` |
| 日付として読めない | `9/1`、`2026.09.31` | NULL | `invalid` |

年の補正は「シートの年月の前月初〜翌月末」に収まらない日付だけが対象で、年をシートの年（またはその前後の年）に
置き換えると収まる場合に補正する。

**明細にしない行**: 日付として解釈できず商品名・加工数も空の行（シート下部のメモ行・空行）と、加工日だけが入った行。
メモ行には `2026.07.06 ～を変更した` のように日付で始まるものがあるため、加工日は**セル全体が日付（の連結）**で
あるときだけ解釈する。

`parse_issues` は `[{"field": "work_date", "code": "year_corrected"}, ...]` の配列で、`field` は `work_date` /
`processed_qty`（`missing` / `invalid`）/ `defect_qty`（`invalid`）/ `setup_qty`（`invalid`）/ `good_qty`（`negative_clamped`）。

### シート単位で最新版を正とする（RPC `replace_daily_report_sheet_entries`）

同じブックは保存のたびに別ファイル（別 sha256）として届くため、全ファイルの行を足すと二重計上になる。
**(テナント, シート名) の明細は、最新のファイルの内容で丸ごと置き換える**（足し込まない）。過去の行の修正・削除もこれで反映される。

- 「最新」は `file_modified_at`、無ければ `received_at`（同時刻なら `received_at`）。比較は RPC が
  `daily_report_files` から引いた値で行い、呼び出し側の値は使わない
- RPC は古い明細の DELETE と新しい明細の INSERT、`daily_report_sheets` の更新を1トランザクションで行う
  （途中で失敗しても明細が消えない）。現在の版より古いファイルなら何もせず `stale` を返す。同じファイルの再処理は冪等
- 同じシートを並行して処理しても順序が崩れないよう、(テナント, シート名) で `pg_advisory_xact_lock` を取る
- ファイルが `p_tenant_id` 以外のテナントのものなら例外。実行権限は `service_role` のみ（`anon` / `authenticated` から REVOKE）
- 同じテナントで同名のシートを持つ別のブックがあると互いに置き換え合う。現状の想定（1テナント1ブック）では問題ないが、
  複数ブックを扱うことになったらキーにブックの識別子を加える

### cron `GET /api/cron/parse-daily-reports`（`routers/cron/parse_daily_reports.py`）

`services/daily_report_parsing_service.py` の `parse_pending_daily_reports()`。`parse-order-pdfs-trigger` から
他の cron と一緒に呼ばれる（[supabase-pgcron-parse-order-pdfs.md](../infra/supabase-pgcron-parse-order-pdfs.md)）。

1. `parse_status = 'pending'` のファイルを `received_at` 順に最大 `PARSE_DAILY_REPORTS_BATCH_LIMIT`（既定 10）件取得。残りは次回へ持ち越す
2. 拡張子が `.xlsx` / `.xlsm` 以外（`.xls` 等）は Storage から取得せず `unsupported`
3. Storage（`daily-reports`）から取得してパースし、シートごとに RPC で置き換える
4. 成功したら `parsed`（対象シートが無い・古い版だった場合も `parsed`）、失敗したら `failed`

- `tenant_id` は `daily_report_files` の行から取り、更新はすべて `.eq("tenant_id", tenant_id)` で絞る
- 1ファイルの失敗で他のファイルの処理は止めない。例外の詳細はログにのみ残し、`parse_error` には固定文言
  （`unsupported file type` / `unable to open workbook` / `parse failed`）を入れる（テナントのメンバーが参照できる列のため）。
  全体が失敗したときのレスポンスも固定文言（502 `parse-daily-reports failed`）
- `failed` のファイルは自動では再処理しない。原因を直したら `parse_status` を `pending` に戻すと次の cron で再処理される
- レスポンスは件数のサマリ: `processed` / `parsed` / `unsupported` / `failed` / `sheets_replaced` / `sheets_stale` /
  `sheets_without_header` / `entries_saved`

## 日報の名寄せと別名辞書（Issue #488）

日報の明細（`daily_report_entries`）の設備・工程・顧客・製品の表記をマスタに照合する。照合できなかった表記は
事務担当者が別名辞書に登録し、以後は自動で照合されるようにする（現場の日報の書き方は変えない）。

### 照合結果は明細に保存せず都度解決する

照合結果（`equipment_id` / `customer_id` / `product_id` / マスタの工程名）は `daily_report_entries` に保存しない。
割り付け（#490）・未照合一覧の取得のたびに **明細＋マスタ＋辞書から解決する**。

- 辞書だけでなくマスタの変更（設備の台帳番号・製品の追加・工程名の変更）も、再照合の処理を挟まずに過去の明細へ反映される
  （保存方式だと、どの変更で再照合するかの取りこぼしが起きうる）
- 照合は表記単位で決まる（同じ表記は同じ結果）ので、未照合一覧は明細を全件読まず、RPC `daily_report_name_stats` で
  表記ごとに集計した一覧（数百件程度）だけを照合する
- #490 は明細を読んだうえで `load_matcher(db, tenant_id).match_entry(entry)` で1行ずつ解決する
  （`EntryMatch(equipment_id, customer_id, product_id, process_names)`）

### 照合ロジック（`services/daily_report_name_matcher.py`）

DB から切り離した純粋なロジック。マスタと辞書のスナップショット（`NameMatchingSnapshot`。読み込みは
`services/daily_report_name_matching_service.py` の `load_snapshot()`）から照合する。
**いずれの種別も別名辞書が最優先**（誤った自動照合を辞書で上書きできるようにする）。

| 種別 | 照合の順序 |
|---|---|
| 設備 | 別名辞書 → 「N号機」の N と `equipments.ledger_no`（#486）→ 設備名・呼称（`short_name`）の一致 |
| 工程 | 別名辞書（1:N）→ `process_routings.process_name` の一致 |
| 顧客 | 別名辞書 → `customers.name` / `alias` の一致（`normalize_company_name()`。法人格・記号・空白を無視。部分一致は使わない） |
| 製品 | `product_name_aliases`（顧客単位。顧客が照合できたときだけ）→ 製品名・品番の完全一致 → 正規化後の一致 |

- 設備・工程・顧客の名前の一致は NFKC・空白・英字の大小を無視する（`normalize_name_key()`）
- 製品の正規化（`normalize_product_name()`）は NFKC・英字の大小・空白に加え、径の記号（`φ`/`Φ`/`ø`/`⌀`）の有無、
  掛け算の記号（`x`/`×`/`*`/`✕`）、区切りの記号（`+`/`,`/`.`）、ハイフンの字形（`−`/`–`/`‐` 等）を無視する。
  長音記号「ー」はカタカナの一部なのでハイフンに寄せない
- 「N号機」の番号が台帳に無い場合は名前の一致も見ない（別の設備に誤って付けない）。番号が複数ある表記は照合しない
- **候補が複数あるときは照合しない**。ただし製品は廃番（`is_active=false`）以外、顧客は下書き（`status='draft'`）以外が
  1件に絞れればそれを採る
- **pg_trgm の類似候補（`match_products()`）は自動では使わない**。誤った照合で他の受注に実績が付くのを避けるため、
  未照合キュー（#489）での候補表示（`GET /daily-reports/product-candidates`）にだけ使う
- 顧客が照合できない明細は、製品を名前・正規化の一致だけで照合する（顧客は割り付けの絞り込みに使う任意の条件、#490）
- 別名辞書のキーは日報の表記そのもの（前後の空白のみ除去）。日報の設備・工程・顧客は `リスト` シートの選択肢から
  入力されるので、正規化はせず完全一致で引く

### データモデル

`supabase/migrations/20261004000000_add_daily_report_name_aliases.sql`

| テーブル | 内容 |
|---|---|
| `equipment_name_aliases` | `raw_text` → `equipment_id`。UNIQUE (`tenant_id`, `raw_text`) |
| `process_name_aliases` | `raw_text` → `process_names text[]`（1件以上）。1つの表記が複数の工程を指しうる（「カシメ、仕上げ加工」→ {カシメ, クグシ}）。対応は工程名のレベル（製品をまたいで共通）で持ち、製品ごとの `process_routings` の行には割り付け時（#490）に引き当てる |
| `customer_name_aliases` | `raw_text` → `customer_id`。製品の別名が顧客単位なので、顧客を照合できないと製品の別名も引けない |
| `product_name_aliases`（既存） | `source` に `daily_report` を追加。日報の商品名の別名は専用の辞書に分けず、既存の顧客単位の辞書に登録する（メール起票の照合からも同じ顧客の表記として使われる） |

- 3テーブルとも RLS 有効・`is_tenant_member(tenant_id)` の SELECT / INSERT / UPDATE / DELETE。INSERT は
  `created_by = auth.uid()` を強制し、UPDATE では `created_by` を変えない（`product_name_aliases` と同じ方針）
- 照合先（設備・顧客）を削除すると別名も消える（`ON DELETE CASCADE`）。工程名は配列で持つので、マスタの工程名を
  変えた・消した場合は辞書の工程名が浮く（照合結果にはその名前がそのまま入る。#490 の引き当てで該当なしになる）
- `daily_report_name_stats(p_tenant_id)`: 表記ごとの `entry_count` / `last_work_date`。製品は (`customer_raw`, `product_raw`)
  の組で集計する。SECURITY INVOKER で、ユーザー JWT から呼ぶと `daily_report_entries` の RLS が効く
- 「対象外」（無視する表記）は #489 の `daily_report_ignored_names` に持つ（[未照合キューの画面](#未照合キューの画面issue-489) を参照）

### API（`routers/daily_reports/name_matching.py`）

参照はテナントメンバー全員、辞書の書き込みは **`order_handler` / `president` / `platform_admin`**（事務担当者。
`iso_officer` は 403）。製品の別名の承認は不要（#347 の方針を踏襲）。

| メソッド・パス | 内容 |
|---|---|
| `GET /daily-reports/unmatched-names?kind=` | 照合できなかった表記の一覧（`kind` / `raw_text` / `entry_count` / `last_work_date`。製品は `customer_raw` と、その照合結果 `customer_id`）。出現件数の多い順（同数は最終出現日の新しい順） |
| `GET /daily-reports/product-candidates?raw_text=` | pg_trgm の類似候補（`product_id` / `name` / `score`）。自動確定の結果は返さない |
| `GET` / `POST /daily-reports/name-aliases/equipment`、`PATCH` / `DELETE .../{alias_id}` | 設備の別名。body は `raw_text` / `equipment_id` |
| `GET` / `POST /daily-reports/name-aliases/process`、`PATCH` / `DELETE .../{alias_id}` | 工程の別名。body は `raw_text` / `process_names`（重複・空白は除去。マスタに無い工程名は 422） |
| `GET` / `POST /daily-reports/name-aliases/customer`、`PATCH` / `DELETE .../{alias_id}` | 顧客の別名。body は `raw_text` / `customer_id` |
| `GET` / `POST /daily-reports/name-aliases/product` | 製品の別名（`product_name_aliases`）。POST は `raw_text` / `customer_id` / `product_id` で UPSERT し、履歴に `source='daily_report'`・「日報からの登録」で追記する（`register_daily_report_alias()`）。変更・削除は製品マスタの `PATCH` / `DELETE /products/{product_id}/aliases/{alias_id}` |

- 照合先の ID はリクエストのテナントに存在することを確かめる（ユーザーが複数テナントに所属していても他テナントの行を指させない）。無ければ 422
- 同じ表記の二重登録は 409 `{"error": "duplicate_alias", "message": ...}`（製品の POST は UPSERT なので 409 にならない）
- 未照合の製品で `customer_id` が `null` のものは、先に顧客の別名を登録しないと製品の別名を登録できない

## 未照合キューの画面（Issue #489）

画面は `/master/daily-report-names`（マスタ配下。設備・顧客・製品マスタと並べて置き、マスタのナビから辿れる）。
事務担当者が照合できなかった表記を、別名辞書への登録（対応付け）か「対象外」で片付ける。1回対応付ければ
照合は都度解決なので、過去・今後の明細にも反映される。割り付け・進捗（#490）は次回の再計算で反映される。

| タブ | 内容 |
|---|---|
| 未照合キュー | 種別（設備・工程・顧客・製品。製品の別名は顧客単位なので顧客を製品より前に置く）ごとに、出現件数の多い順。表記をクリックすると、その表記が使われている日報の行（加工日・顧客先・商品・工程・設備・加工数・良品数、新しい順に最大100件）を開く。行ごとに対応付け先を選ぶと即登録する（一覧で一気に片付けられるよう、ダイアログを挟まない） |
| 登録済みの対応付け | 種別ごとの別名の一覧（表記で絞り込み）。対応先の変更・削除（確認ダイアログ付き）。製品の別名はメール起票と共通なので由来（日報／メール起票）を出し、変更・削除は製品マスタの別名 API（監査履歴が残る）を使う |
| 対象外 | 「対象外」にした表記の一覧。「戻す」で解除すると、照合できていなければ未照合キューに戻る |

- 設備・顧客は検索付きのコンボボックス（設備は呼称＝`equipmentDisplayName()` と台帳番号）、工程は**複数選択**して「決定」（1:N）
- 製品は pg_trgm の類似候補（`GET /daily-reports/product-candidates`）の上位3件を行内のボタンで出し、**押すだけで対応付ける**。
  それ以外は「他の製品から選択」（類似候補＋有効な製品すべて）。候補での自動確定はしない（#488 の方針）。
  顧客先が未照合の行は候補を取得せず「先に顧客を対応付けてください」、顧客先が空欄の行は「登録できません」を出す
  （どちらも「対象外」にはできる）
- 操作できるのは `order_handler` / `president` / `platform_admin`（`DAILY_REPORT_NAME_EDITOR_ROLES`、Backend の
  `_ALIAS_EDITOR_ROLES` と揃える）。それ以外のロールには閲覧のみで操作ボタンを出さない
- 登録・変更・削除・対象外の後は `["daily-report-names"]` 配下のクエリ（未照合一覧・登録済みの一覧・対象外の一覧）を
  まとめて無効化する。製品の別名を変えたときは製品マスタの別名履歴（`["products"]`）も無効化する
- 製品の類似候補は未照合の製品の行ごとに取得する（押すだけで対応付けられるよう行内に出すため）。候補は商品名と製品マスタ
  だけで決まり別名・対象外の登録では変わらないので、クエリキーを `["daily-report-product-candidates", raw_text]` と
  `["daily-report-names"]` の外に置き、登録のたびに行数分の類似検索（pg_trgm）を再実行しないようにしている。
  `staleTime` は5分（タブの切り替えでも再検索しない。製品マスタの変更は最大5分遅れて候補に反映される）

### 「対象外」の持ち方

`supabase/migrations/20261005000000_add_daily_report_ignored_names.sql` の `daily_report_ignored_names`
（`kind` / `raw_text` / `customer_raw` / `created_by`）。

- 別名辞書（#488 の3テーブル）に列を足さず専用テーブルにした。製品の別名辞書は既存の `product_name_aliases`
  （`product_id` NOT NULL・メール起票の照合と共有）で「対象外」を表せないため、4種別を同じ形で扱えるよう1テーブルにまとめた
- キーは未照合キューの1行と同じ: 設備・工程・顧客は表記、製品は (顧客先, 商品名) の組。顧客先が空欄の製品もあるので
  `UNIQUE NULLS NOT DISTINCT (tenant_id, kind, raw_text, customer_raw)`。`customer_raw` は製品のときだけ持てる（CHECK）
- 照合結果には影響しない（未照合キューに出さないだけ。対象外の表記は照合されないままで、割り付け #490 の対象にもならない）。
  後から別名を登録すれば照合される
- RLS は別名辞書と同じ（テナントメンバーが読み書き、INSERT は `created_by = auth.uid()`）。行は登録・削除のみ

### 追加した API（`routers/daily_reports/name_matching.py`）

| メソッド・パス | 内容 |
|---|---|
| `GET /daily-reports/name-entries?kind=&raw_text=&customer_raw=` | 表記が使われている明細（加工日の新しい順に最大100件）。製品は顧客先との組で絞り、`customer_raw` 省略時は顧客先が空欄（NULL）の行 |
| `GET /daily-reports/process-names` | マスタの工程名の一覧（`process_routings.process_name` の重複を除いて名前順）。工程の別名の対応付け先 |
| `GET` / `POST /daily-reports/ignored-names`、`DELETE .../{id}` | 対象外の一覧・登録・解除。POST は `kind` / `raw_text` / `customer_raw`（製品以外では無視して NULL）。書き込みは別名辞書と同じロール。二重登録は 409 `{"error": "duplicate_ignored_name", ...}` |

`GET /daily-reports/unmatched-names` は対象外の表記を除いて返す（`list_unmatched_names()`）。

## 受注への割り付けと進捗の算出（Issue #490）

照合済みの明細の良品数（`good_qty`）を受注の工程に割り付け、受注×工程ごとの進捗（実績数量・初回／最終実績日・状態）を
算出して保存する。日報には受注番号が無いので、どの受注のどの工程がどこまで進んでいるかを (製品, 工程) から推定する。
ガントチャートの進捗表示（#491）の元データ。100%正確な進捗は求めない（Epic の決定事項）。

### 割り付けの規則（`services/daily_report_allocator.py`）

DB から切り離した純粋関数 `allocate_actuals(entries, orders, routings)`。入力は照合済みの明細（`ActualEntry`）・
候補の受注（`OrderRef`）・工程ルート（`RoutingRef`）、出力は進捗（`ProcessProgress`）と未割当（`UnallocatedActual`）。

- 単位は **(製品, マスタの工程名)**。明細を加工日の古い順（同日は明細 ID 順）に、その製品の候補の受注へ
  **納期の早い順**に充当する。受注数量を満たしたら、あふれた分を次の受注へ回す
- 候補の受注: 同じ製品で `status` が `confirmed` / `in_progress` のもの（工程ルートは製品単位なので、その工程の
  `process_routings` の行を持つかは製品で決まる）。**顧客が照合できている明細は同じ顧客の受注に絞る**
  （顧客が照合できない明細は絞らない）
- 納期は `deadline_date`（顧客希望納期）、無ければ `confirmed_deadline`。どちらも無い受注は最後、同じ納期は受注 ID 順
- 1つの日報の工程名が複数の工程に対応する場合（工程の別名辞書の 1:N、「カシメ、仕上げ加工」→ カシメ・クグシ）は、
  **各工程に同じ数量を計上**する
- **加工日が受注日（`order_date` の JST 暦日）より前の実績はその受注に充当しない**（Issue で「実装時に決める」とされた点）。
  `order_date` はシステムへの登録日時で、候補は確定済み・生産中だけなので、出荷済みになって候補から外れた過去の受注の実績や
  在庫の先行生産が、後から登録した受注を完了に見せてしまうのを避けるため。充当できなかった分は未割当（`before_order_date`）に
  残り、見込み生産・登録の遅れの発見に使える
- 同じ製品に同じ工程名の行が複数ある場合は、日報からはどの行か区別できないので `sequence_order` の最も小さい行に計上する
- 良品数が 0・空の明細、製品か工程が照合できない明細（未照合キュー #489 で解消するもの）は割り付けに使わない。
  後者は未割当にも含めない（cron のサマリの `unmatched_entries` に件数だけ出す）

### 進捗の状態

受注×工程ごと。候補の受注は**全工程の行**を持つ（実績の無い工程も `not_started`）。

| 状態 | 条件 | `completed_by` |
|---|---|---|
| `completed` | 割り付けた良品数が受注数量以上 | `quantity` |
| `completed` | 後の工程（`sequence_order` が大きい工程）に実績がある。**日報に出てこない工程（洗浄・内職・検査など）も同じ規則** | `later_process` |
| `in_progress` | 実績が1件以上あり、完了でない | なし |
| `not_started` | それ以外（後の工程に実績が無い日報に出ない工程も、計画どおり未着手のまま） | なし |

- 「後の工程に実績がある」は**同じ受注に割り付いた実績**で判定する（別の受注に割り付いた実績では完了にしない）
- 割り付けの良品数は受注数量が上限（あふれた分は次の受注か未割当）
- 受注のステータス（`orders.status`）はこの処理では変更しない（実績による `completed` への自動遷移は別途検討）

### 未割当の理由（`daily_report_unallocated_actuals.reason`）

| reason | 意味 |
|---|---|
| `no_candidate_order` | 同じ製品（顧客が照合できていれば同じ顧客）の確定済み・生産中の受注が無い、またはその製品の工程ルートにその工程名が無い |
| `before_order_date` | 候補の受注はあるが、加工日がどの候補の受注日よりも前 |
| `exceeds_order_qty` | 候補の受注の数量をすべて満たしてもあふれた（あふれた数量だけを記録） |
| `no_work_date` | 加工日が読めない明細（受注日と比べられないので充当しない） |

### 全量再計算（`services/daily_report_allocation_service.py`）

- 差分更新せず、**テナント単位で毎回全量を再計算して丸ごと置き換える**（Epic の方針）。`recompute_tenant_allocation()` が
  明細（`good_qty > 0`）・候補の受注・工程ルートを `fetch_all_rows()` で読み、明細を `load_matcher().match_entry()` で照合してから
  `allocate_actuals()` に渡す。辞書の修正・受注の追加／ステータス変更・明細の置き換え・マスタの変更が、次の再計算でそのまま反映される
- 置き換えは RPC `replace_daily_report_allocation(p_tenant_id, p_computed_at, p_progress, p_unallocated)` で1トランザクション
  （途中で失敗しても進捗が空にならない）。テナントで advisory lock を取り、`p_computed_at`（読み込み開始時刻）が載っている結果より
  古ければ `'stale'` を返して置き換えない（cron の実行が重なったとき、後から終わった古い計算で上書きしない）
- 計算に使ったデータを読んだ後で受注・工程・明細が削除されることがあるので、RPC は**このテナントに現存する行に結合して INSERT** する
  （外部キー違反で全体を失敗させない。他テナントの ID も入らない）
- 再計算のタイミング: cron `GET /api/cron/compute-daily-report-progress`（`routers/cron/compute_daily_report_progress.py`）。
  Edge Function `parse-order-pdfs-trigger` が `parse-daily-reports` の**直後**に呼ぶので、パースされた明細はその回で反映される。
  別名辞書の変更・受注の追加は次の cron 実行（10〜15分間隔）で反映される
  - 辞書の変更 API（ユーザー JWT）から同期的に再計算しないのは、進捗テーブルの書き込みを service role に限るため
    （ユーザー JWT の API から service role を使わない規約、CLAUDE.md）
- 対象テナントは `daily_report_sheets` のあるテナントと、前回の計算結果（`daily_report_allocation_runs`）が残っているテナント
  （明細が無くなったテナントも前回の結果を空で置き換える）。1テナントの失敗はログに残して他のテナントを続ける
- cron のレスポンスはサマリ（`tenants` / `replaced` / `stale` / `failed` / `progress` / `unallocated` / `unmatched_entries`）。
  エラー時は 502 `{"detail": "compute-daily-report-progress failed"}`（詳細はログのみ）

### データモデル

`supabase/migrations/20261006000000_add_daily_report_allocation.sql`。3テーブルとも RLS 有効・`is_tenant_member(tenant_id)` の
SELECT のみ（書き込みは RPC 経由の service role のみ。RPC の実行権限も `service_role` だけ）。

| テーブル | 内容 |
|---|---|
| `order_process_progress` | PK (`order_id`, `process_routing_id`)。`good_qty` / `first_actual_date` / `last_actual_date` / `status`（`not_started` / `in_progress` / `completed`）/ `completed_by`（`quantity` / `later_process`、`completed` のときだけ）/ `computed_at`。受注・工程の削除で消える（CASCADE） |
| `daily_report_unallocated_actuals` | 明細1行×マスタの工程名ごと。`entry_id`（明細の置き換えで消える）/ `product_id` / `customer_id` / `process_name` / `work_date` / `qty` / `reason` / `computed_at` |
| `daily_report_allocation_runs` | PK `tenant_id`。最終計算の `computed_at` と件数（`progress_count` / `unallocated_count`）。古い計算での上書き防止と、API の「いつ時点の進捗か」の表示に使う |

### API

参照のみ（ユーザー JWT・RLS）。テナントメンバー全員が読める。

| メソッド・パス | 内容 |
|---|---|
| `GET /orders/{order_id}/progress`（`routers/transaction/orders/progress.py`） | `{order_id, computed_at, processes: [...]}`。`processes` は工程順で、各行は `process_routing_id` / `sequence_order` / `process_name` / `good_qty` / `order_quantity` / `first_actual_date` / `last_actual_date` / `status` / `completed_by` / `planned_end_datetime`（#491 で `order_quantity`・`planned_end_datetime` を追加）。割り付けの対象外（確定済み・生産中以外）の受注は空配列、他テナント・存在しない受注は 404。`computed_at` は一度も計算していなければ `null` |
| `GET /daily-reports/order-progress?order_id=1&order_id=2`（`routers/daily_reports/progress.py`） | ガントチャート向けに複数受注をまとめて返す `{computed_at, items: [...]}`（`items` の各行は上と同じ＋`order_id`）。`order_id` 省略時は全件、指定は500件まで |
| `GET /daily-reports/unallocated-actuals` | 未割当の実績を加工日の新しい順に。日報上の位置と表記（`sheet_name` / `row_no` / `customer_raw` / `product_raw` / `process_raw`）を添える |

## ガントチャート・受注詳細への進捗表示（Issue #491）

#490 で保存した受注×工程の進捗を、ガントチャート（`/schedule`）のバーと受注詳細の「工程の進捗」に表示する。

### API（#490 の参照 API に列を追加）

- スケジュール取得 API（`GET /production-schedules`）には進捗を含めず、ガントは表示中のスケジュールの受注 ID をまとめて
  `GET /daily-reports/order-progress?order_id=...` で**1リクエスト**取得し、(`order_id`, `process_routing_id`) で結合する（N+1 にしない。
  500件を超えるときはフロントで分割して並列に取得し結合する、`hooks/use-daily-report-progress.ts`）
- `fetch_order_progress()`（`services/daily_report_allocation_service.py`）の各行に2列を追加
  - `order_quantity`: 受注数量（`orders(quantity)` を埋め込み）。進捗率の分母
  - `planned_end_datetime`: 計画の終了日時＝その受注×工程の `production_schedules` の `end_datetime` の最大（未スケジュールは `null`）。
    ガントは表示範囲のセグメントしか取得しないので、範囲の外へ続く工程（週末をまたぐ等）の終了日時はフロントでは求められず、
    表示中のセグメントだけで判定すると誤って遅れになるためバックエンドで求める

### 表示の規則（`lib/daily-report-progress-utils.ts`）

| 項目 | 規則 |
|---|---|
| 進捗率 | `good_qty ÷ order_quantity`（上限 100%）。`completed` は 100%（`later_process` も含む）。`not_started`・受注数量不明は塗らない（現状どおりの表示） |
| 遅れ | `planned_end_datetime` を過ぎても `completed` でない工程（未着手を含む）。タイムスタンプ同士の比較なので端末の TZ に依存しない（JST 基準と同じ結果） |
| 進捗の行が無い工程 | 割り付けの対象外（確定済み・生産中以外）の受注、一度も計算していないテナント等。塗り・遅れとも出さない（日報を使っていないテナントで全工程が遅れに見えないように） |

- ガントのバー（`gantt/components/task-bar.tsx`）: `GanttTask.progress`（0〜1）の割合をバーの左から暗いレイヤーで塗り、
  `GanttTask.isDelayed` で赤枠＋ラベルを赤字にする。マイルストーンは遅れ（ひし形を赤）だけ、グループヘッダーは何も出さない。
  `src/gantt` はドメイン非依存のまま（進捗の算出・結合は `components/schedule/gantt-chart.tsx` の `progress` prop 側で行う）
- 進捗は工程単位なので、日次・月次で工程が複数のセグメントに分かれる場合は各セグメントに同じ進捗を出す。週次の集約バーは先頭セグメントの (受注, 工程) で引く
- ツールチップ: 状態・実績数量（`良品数 / 受注数量`、進行中は %）・初回〜最終実績日、遅れのときは計画終了日時
- **後工程の実績から推定した完了**（日報に出てこない工程を含む）はバーでは区別せず（100% の塗り）、ツールチップ・受注詳細の状態を
  「完了（後工程の実績から推定）」と表示して分かるようにした
- **実績の設備が計画の設備と違う場合の印**は付けない（#490 で進捗に実績の設備を持たせていないため）
- ガントの上に凡例と「何時点の日報か」（`computed_at`）を出す（一度も計算していないテナントでは出さない）

### 受注詳細（`components/orders/order-process-progress.tsx`）

- 確定済み・生産中の受注（割り付けの対象）でだけ「工程の進捗」カードを出す。`GET /orders/{order_id}/progress` で取得し、
  工程・実績数量・状態（遅れのときは「遅れ」バッジ）・実績日を工程順に表示する

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
- `backend/__tests__/unit/services/test_daily_report_parser.py`: 対象シートの選別、ヘッダ行の探索・ヘッダ名での列の解決、
  加工日の異常（年の誤記・連結・前月・年をまたぐ前月・読めない値）、良品数（0未満の切り上げ・数式のキャッシュ値が無いときの代替）、
  加工数の空欄・不正値、商品名の数値セル、メモ行・空行の除外、読めないファイル
- `backend/__tests__/unit/services/test_daily_report_parsing_service.py`: pending の処理、`stale` の扱い、`.xls` 等の
  `unsupported`、パース失敗・想定外エラー時の `failed` と固定文言、ヘッダの無いシートで置き換えないこと
- `backend/__tests__/api/routers/cron/test_parse_daily_reports.py`: `CRON_SECRET` 認証、サマリの返却、エラー時の固定文言
- `backend/__tests__/integration/test_daily_report_entries.py`（`--run-integration`）: RPC の置き換え（新しい版で置き換え・
  古い版は `stale`・同じ版の再処理は冪等・`file_modified_at` が無いときは `received_at`・他テナントのファイルは拒否・
  テナント間の分離）、パーサーの出力がそのまま保存されること、RLS（所属テナントの行のみ見える・書き込めない・RPC を実行できない）
- `backend/__tests__/unit/services/test_daily_report_name_matcher.py`: 製品名の正規化（全角半角・径の記号・掛け算・区切り・
  ハイフン）、台帳番号の抽出、種別ごとの照合の順序（辞書優先）・候補が複数のとき照合しないこと・廃番／下書きの除外、1:N の工程
- `backend/__tests__/unit/services/test_daily_report_name_matching_service.py`: ページングでの全件読み込み、スナップショットの
  テナントでの絞り込み、未照合一覧の抽出・並び順・種別の絞り込み、辞書の追加が明細を書き換えずに反映されること
- `backend/__tests__/api/routers/daily_reports/test_daily_report_names_router.py`: 別名の登録・変更・削除、ロール（`iso_officer` は 403）、
  照合先が無い・マスタに無い工程名の 422、二重登録の 409、製品の類似候補が自動確定の結果を返さないこと
- `backend/__tests__/integration/test_daily_report_name_matching.py`（`--run-integration`）: `daily_report_name_stats` の集計と RLS、
  別名辞書の RLS（他テナント・`created_by` のなりすまし・UNIQUE）、`source='daily_report'`、API で別名を登録すると未照合一覧から外れること、
  `daily_report_ignored_names` の RLS・UNIQUE（顧客先 NULL 同士も重複）・CHECK、対象外の登録/解除で未照合一覧から外れる/戻ること、表記の明細の取得
- 上記の unit / API テストに #489 分（対象外の除外・製品は顧客先との組で対象外・明細の絞り込み・工程名の一覧・対象外 API のロール/409/404）を追加
- Frontend（Vitest + MSW）: `lib/daily-report-name-utils.test.ts`（行のキー・日付の整形・製品の別名を登録できない理由・エラー文言）、
  `hooks/use-daily-report-names.test.ts`（明細のクエリ文字列・対象外の後の再取得）、`components/daily-report-names/*.test.tsx`
  （種別ごとの件数・出現件数順、明細の展開、設備の登録、工程の複数選択、製品の類似候補からの登録、顧客未照合の製品、対象外、
  登録済みの変更・削除（確認）・製品の付け替えは製品マスタの API・絞り込み、対象外の解除、閲覧のみのロール）

- `backend/__tests__/unit/services/test_daily_report_allocator.py`: 納期順の充当・あふれ（次の受注／未割当）・加工日順の適用・
  納期が無い受注は最後・1:N の工程・顧客での絞り込み・候補なし・受注日より前・加工日なし・同名工程・後工程の実績による完了
  （日報に出ない工程を含む、受注ごとの判定）・全工程の行・再計算の決定性
- `backend/__tests__/unit/services/test_daily_report_allocation_service.py`: 読み込みのテナント・ステータスでの絞り込み、照合できない
  明細の除外、RPC への受け渡し、別名辞書の追加が再計算で反映されること、受注日の JST 変換、対象テナントの列挙、1テナントの失敗で止めないこと、参照系の整形
- `backend/__tests__/api/routers/daily_reports/test_daily_report_progress_router.py` / `.../cron/test_compute_daily_report_progress.py`:
  進捗・未割当の API（受注1件の 404 を含む）、cron の認証・サマリ・固定文言
- `backend/__tests__/integration/test_daily_report_allocation.py`（`--run-integration`）: 実 DB での割り付けと保存、再計算の冪等性、
  別名辞書の追加・明細の置き換え・受注の出荷後の再計算、RPC の `stale` と消えた／他テナントの ID の除外、RLS（所属テナントのみ・
  書き込み不可・RPC 実行不可）、ユーザー JWT での進捗 API
- #491: 上記の unit / integration テストに `order_quantity`・`planned_end_datetime`（複数セグメントの最大・他テナント／他の受注を使わない）を追加。
  Frontend（Vitest + MSW）: `lib/daily-report-progress-utils.test.ts`（進捗率・遅れ・ラベル・日付の整形）、
  `hooks/use-daily-report-progress.test.ts`（1リクエストへのまとめ・500件超の分割）、`gantt/components/task-bar.test.tsx`（塗り・遅れの強調）、
  `components/schedule/gantt-chart.test.tsx`（進捗の結合・週次の集約バー・ツールチップ）、`components/orders/order-process-progress.test.tsx`

## スコープ外（PoC ではやらない）

- 実績の設備と計画の設備の違いの表示（進捗に実績の設備を持たせていない）。Excel のパースと明細の保存は #487、マスタとの照合は #488、
  未照合キューの画面は #489、受注への割り付けと進捗の算出は #490、ガントチャート・受注詳細への進捗表示は #491 で実装済み
- heartbeat 途絶のアラート通知（記録のみ行い、PoC 期間中は手動で確認）
- エージェントの自動アップデート、管理画面UI

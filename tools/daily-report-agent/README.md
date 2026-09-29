# 日報取り込みエージェント（共有PC用）

共有Windows PC上で動き、ファイルサーバ上の日報Excelを ProductPlanner のバックエンドへ送る PowerShell スクリプトです
（Issue #472、親 Issue #468）。バックエンド側の仕様は
[docs/features/daily-report-agent.md](../../docs/features/daily-report-agent.md) を参照してください。

| ファイル | 内容 |
|---|---|
| `DailyReportAgent.ps1` | エージェント本体（PowerShell 5.1、追加モジュール不要） |
| `config.sample.json` | 設定ファイルのひな形。`config.json` にコピーして使う |
| `config.json` | 実際の設定（トークンを含むため**コミットしない**。`.gitignore` 済み） |
| `state/sent-files.json` | 送信済みファイルの記録（実行時に作成） |
| `logs/agent-yyyyMMdd.log` | 実行ログ（実行時に作成） |

## 動作

1回の実行で次のことを行って終了します。定期実行はタスクスケジューラで行います（登録手順は #478 で追記予定）。

1. `target_folders` 配下の `*.xlsx` / `*.xlsm` / `*.xls` を走査する（`recurse: true` ならサブフォルダも）
2. 各ファイルについて
   - サイズと更新日時が前回送信時と同じなら、読み込まずにスキップする（変更なし）
   - `~$` で始まるファイル（Excel の一時ファイル）は対象外
   - Excel で開かれている（記入中の）ファイルは読み込めないのでスキップし、次回の実行で改めて確認する
   - SHA-256 を計算し、前回送信時と同じならスキップする（上書き保存したが中身は同じ場合）
   - 変わっていれば `POST /api/agent/daily-reports` に送る
3. サーバが `stored`（新規保存）または `duplicate`（同じ内容を受信済み）を返したファイルだけを
   `state/sent-files.json` に記録する。それ以外（4xx/5xx・通信エラー）は記録しないので、**次回の実行で再送**される
4. 最後に `POST /api/agent/heartbeat` に実行サマリを送る

ファイルパスは日本語を含みうるため、`X-File-Path` ヘッダには `[System.Uri]::EscapeDataString()` で
UTF-8 URL エンコードした値を送ります（バックエンドで復元して `daily_report_files.original_path` に保存）。

### heartbeat の内容

| 項目 | 内容 |
|---|---|
| `scanned_count` | 走査した対象ファイル数（`~$` の一時ファイルを除く） |
| `sent_count` | サーバが `stored` を返したファイル数 |
| `duplicate_count` | サーバが `duplicate` を返したファイル数 |
| `error_count` | 送信失敗・読み取り失敗・フォルダ走査失敗・サイズ上限超過・状態ファイル保存失敗の合計 |
| `agent_version` | スクリプトのバージョン |
| `unchanged_count` / `locked_count` / `too_large_count` / `folder_error_count` | 変更なし／記入中でスキップ／サイズ上限超過／走査できなかったフォルダの数 |
| `started_at` / `finished_at` / `hostname` / `powershell_version` | 実行時刻と実行環境 |

上4つと `agent_version` は `agent_heartbeats` の列に、残りは `payload`（jsonb）に保存されます。

### 終了コード

タスクスケジューラの「前回の実行結果」で確認できます。

| コード | 意味 |
|---|---|
| 0 | 正常終了 |
| 1 | 一部のファイルの送信・読み取り・フォルダの走査、または heartbeat に失敗した（失敗したファイルは次回再送） |
| 2 | 設定不備・前回の実行が終わっていない等で、走査を行わずに終了した |

## 設置手順

### 1. トークンを発行する（開発者が行う）

テナントごと・設置する共有PCごとにエージェントトークンを発行します。

```bash
cd backend
python scripts/issue_agent_token.py issue --tenant-id <tenant_uuid> --name "工場1F 共有PC"
```

表示されたトークンは再表示できません。設置作業まで安全な方法で受け渡し、作業後は控えを残さないでください。
詳細（一覧・失効）は [backend/scripts/USAGE.md](../../backend/scripts/USAGE.md) を参照してください。

### 2. スクリプトを配置する

共有PCの任意のフォルダ（例: `C:\ProductPlanner\daily-report-agent\`）に `DailyReportAgent.ps1` と
`config.sample.json` をコピーします。

- `DailyReportAgent.ps1` は **BOM 付き UTF-8** で保存されています。PowerShell 5.1 は BOM 無しの UTF-8 を
  Shift-JIS として読み、日本語のログが文字化けするため、編集する場合も BOM 付きのまま保存してください
- インターネットからダウンロードしたファイルはブロックされていることがあります。その場合はファイルのプロパティで
  「許可する」にチェックするか、`Unblock-File .\DailyReportAgent.ps1` を実行してください

### 3. 設定ファイルを作る

`config.sample.json` を `config.json` にコピーして編集します。

| 項目 | 必須 | 既定値 | 内容 |
|---|---|---|---|
| `api_base_url` | ○ | － | バックエンドの URL（例: `https://api.example.com`）。末尾の `/` は不要。`/api/agent/...` はスクリプトが付ける |
| `token` | ○（※） | － | 手順1で発行したトークン |
| `target_folders` | ○ | － | 日報Excelを置いているフォルダ（複数可）。UNC パス（`\\server\share\日報`）も可 |
| `recurse` | | `true` | サブフォルダも走査するか |
| `state_path` | | `state\sent-files.json` | 送信済みファイルの記録 |
| `log_dir` | | `logs` | ログの出力先 |
| `log_retention_days` | | `30` | この日数より古いログを削除する（0 なら削除しない） |
| `max_file_bytes` | | `20971520`（20MB） | これより大きいファイルは送らずエラーとして記録する。バックエンドの受信上限（`DAILY_REPORT_MAX_BYTES`）と揃える |
| `timeout_seconds` | | `120` | 1リクエストのタイムアウト |

- JSON 内の `\` は `\\` と書きます（例: `"C:\\Share\\日報"`、UNC パスなら `"\\\\server\\share\\日報"`）
- 相対パスはスクリプトのあるフォルダが基準です
- ※ トークンは環境変数 `DAILY_REPORT_AGENT_TOKEN` でも渡せます（設定されていれば `config.json` より優先）
- `config.json` にはトークンが平文で入るため、実行アカウントと管理者以外が読めないようにフォルダのアクセス権を
  絞ってください。例:

  ```powershell
  icacls C:\ProductPlanner\daily-report-agent\config.json /inheritance:r /grant:r "<実行アカウント>:R" "Administrators:F"
  ```

### 4. 手動で実行して確認する

まず `-DryRun` で送信対象のファイルを確認します（送信・記録・heartbeat は行いません）。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProductPlanner\daily-report-agent\DailyReportAgent.ps1 -DryRun
```

問題なければ `-DryRun` を外して実行し、ログに `stored: ...` と `heartbeat を送信しました` が出ることを確認します。
もう一度実行すると、変更の無いファイルは送信されません（ログの「変更なし」に数えられる）。

設定ファイルを別の場所に置く場合は `-ConfigPath <パス>` を指定します。

### 5. タスクスケジューラに登録する

#478 で登録用スクリプトと手順を追加する予定です。

## 運用

### ログの場所

`log_dir`（既定はスクリプトのフォルダの `logs\`）に日付ごとのファイル `agent-yyyyMMdd.log` が出力されます。
送信に失敗したファイルは `送信に失敗しました（次回再送）` の行に HTTP ステータスとサーバの応答が出ます。

サーバ側では `agent_heartbeats`（実行ごとのサマリ）と `agent_tokens.last_used_at` で稼働状況を確認できます。

### よくある状況

| ログ・状況 | 対応 |
|---|---|
| `HTTP 401` と `トークンが無効です` | トークンが失効・誤っている。再発行して `config.json` を更新する（401 の場合はその回の残りの送信を打ち切る） |
| `HTTP 0`（通信エラー） | ネットワーク・プロキシ・`api_base_url` を確認する。失敗したファイルは次回再送される |
| `フォルダを走査できません` | ファイルサーバに接続できない、または実行アカウントにフォルダの読み取り権限が無い |
| `サイズ上限を超えるため送信しません` | 20MB を超える日報は送れない。毎回エラーとして記録され続けるので、ファイルの分割等を顧客と相談する |
| `記入中のためスキップします` | Excel で開かれている。閉じられた後の実行で送信される |
| `前回の実行が終わっていないため終了します` | 前回の実行が長引いている。続く場合はファイル数・回線速度を確認する |
| 全ファイルを送り直したい | `state\sent-files.json` を削除する。サーバ側で受信済みのものは `duplicate` になるだけで重複保存はされない |

### トークンの入れ替え

共有PCの入れ替えやトークンの漏洩時は、`issue_agent_token.py revoke` で古いトークンを失効させてから
新しいトークンを発行し、`config.json` を更新します。

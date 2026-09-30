# 日報取り込みエージェント（共有PC用）

共有Windows PC上で動き、ファイルサーバ上の日報Excelを ProductPlanner のバックエンドへ送る PowerShell スクリプトです
（Issue #472、親 Issue #468）。バックエンド側の仕様は
[docs/features/daily-report-agent.md](../../docs/features/daily-report-agent.md) を参照してください。

| ファイル | 内容 |
|---|---|
| `DailyReportAgent.ps1` | エージェント本体（PowerShell 5.1、追加モジュール不要） |
| `Install-DailyReportAgentTask.ps1` | 定期実行タスクの登録・更新（Issue #478） |
| `Uninstall-DailyReportAgentTask.ps1` | 定期実行タスクの削除（Issue #478） |
| `SETUP_CHECKLIST.md` | 顧客先での設置作業チェックリスト（作業当日に上から順に実施する） |
| `config.sample.json` | 設定ファイルのひな形。`config.json` にコピーして使う |
| `config.json` | 実際の設定（トークンを含むため**コミットしない**。`.gitignore` 済み） |
| `state/sent-files.json` | 送信済みファイルの記録（実行時に作成） |
| `logs/agent-yyyyMMdd.log` | 実行ログ（実行時に作成） |

## 動作

1回の実行で次のことを行って終了します。定期実行はタスクスケジューラで行います（「5. タスクスケジューラに登録する」）。

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

`Install-DailyReportAgentTask.ps1` で、タスク `\ProductPlanner\DailyReportAgent` を登録します。
GUI で手作業で設定する必要はありません。

| 設定 | 既定値 | 変更するパラメータ |
|---|---|---|
| 曜日 | 月〜金 | `-DaysOfWeek Monday,Tuesday,...` |
| 開始時刻 | 9:00 | `-StartTime 08:30` |
| 間隔 | 1時間 | `-IntervalMinutes 30` |
| 継続時間 | 8時間（9:00 開始なら 17:00 まで） | `-DurationHours 9`（18:00 まで） |
| 1回の実行時間の上限 | 30分 | `-ExecutionTimeLimitMinutes 60` |
| 実行アカウント | この PC にログオン中のユーザー | `-User PC名\user` |
| ログオン方式 | ログオン中のみ実行（`Interactive`） | `-LogonMode Password` |
| 多重起動 | しない（前回の実行が続いていれば新しい実行はスキップ） | － |
| 予定時刻に PC が起動していなかった場合 | 起動後に実行する | － |
| バッテリー駆動 | 止めない | － |
| 実行内容 | `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "<DailyReportAgent.ps1 の絶対パス>"` | `-AgentPath` / `-ConfigPath` |

#### 実行アカウントとログオン方式を決める

エージェントはファイルサーバ（UNC パス）を読むため、**ファイル共有を読めるユーザーアカウント**で実行します。
`SYSTEM` や「パスワードを保存しない」設定ではファイル共有にアクセスできないので使いません。

| ログオン方式 | 向いている運用 | 注意 |
|---|---|---|
| `Interactive`（既定）: ログオン中のみ実行 | 共有PCが業務時間中、常に同じアカウントでログオンしている | パスワード不要。ログオフ・サインアウト中は実行されない。サインアウトせずに画面ロックしているだけなら実行される |
| `Password`: ログオンしていなくても実行 | 誰もログオンしていない時間帯がある、PC を再起動したままにすることがある | パスワードをタスクスケジューラに保存する。**そのアカウントのパスワードを変えるとタスクが失敗し始める**（「再登録が必要な場面」参照） |

- 実行アカウントは `config.json` を読める必要があります（手順3で `icacls` でアクセス権を絞った場合は、そのアカウントを含めること）
- 「管理者として実行」で別の管理者アカウントに昇格しても、`-User` 省略時の既定は**画面にログオン中のユーザー**です
  （昇格した管理者アカウントにはなりません）

#### 登録する

1. スタートメニューで「Windows PowerShell」を右クリック →「管理者として実行」で開きます
2. まず `-WhatIf` で設定内容を確認します（登録はされません）

   ```powershell
   cd C:\ProductPlanner\daily-report-agent
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-DailyReportAgentTask.ps1 -WhatIf
   ```

3. 問題なければ `-WhatIf` を外して登録します。登録後に、トリガー・実行アカウント・次回実行予定が表示されます

   ```powershell
   # ログオン中のみ実行（既定）
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-DailyReportAgentTask.ps1

   # ログオンしていなくても実行（パスワードの入力画面が出る）
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-DailyReportAgentTask.ps1 -LogonMode Password

   # 18:00 まで実行する
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-DailyReportAgentTask.ps1 -DurationHours 9
   ```

- パスワードはスクリプトの引数やファイルでは受け取りません。`-LogonMode Password` のときだけ入力画面（`Get-Credential`）で
  入力し、タスクスケジューラに保存します（コマンド履歴・ログには残りません）
- **設定を変えるときも同じスクリプトを実行し直します**。既存のタスクは上書きされ、タスクが2つになることはありません。
  パラメータは毎回すべて指定し直してください（省略したものは既定値に戻ります）
- `Password` での登録には、実行アカウントに「バッチ ジョブとしてログオン」の権限が必要です。
  失敗した場合はメッセージに対処が表示されます

| 登録時のメッセージ | 対処 |
|---|---|
| `エージェントスクリプトが見つかりません` | `Install-DailyReportAgentTask.ps1` を `DailyReportAgent.ps1` と同じフォルダに置くか、`-AgentPath` で指定する |
| `権限が不足しています` | PowerShell を「管理者として実行」で開き直す |
| `ユーザー名またはパスワードが正しくありません` | `-LogonMode Password` の入力をやり直す |
| `「バッチ ジョブとしてログオン」の権限がありません` | 管理者として実行する。ドメインのポリシーで禁止されている場合は顧客の管理者に相談する |
| `config.json がまだありません`（警告） | 登録はされる。手順3で `config.json` を作るまで、タスクは終了コード 2 で終わる |

#### 動作確認

登録したらすぐに1回実行して、結果を確認します。

```powershell
# すぐに1回実行する（予定時刻を待たない）
Start-ScheduledTask -TaskPath '\ProductPlanner\' -TaskName 'DailyReportAgent'

# 数十秒待ってから、前回の実行結果と次回実行予定を確認する
Get-ScheduledTaskInfo -TaskPath '\ProductPlanner\' -TaskName 'DailyReportAgent' |
    Format-List LastRunTime, LastTaskResult, NextRunTime

# トリガー（平日9:00開始・1時間間隔・8時間継続）と実行アカウントを確認する
$task = Get-ScheduledTask -TaskPath '\ProductPlanner\' -TaskName 'DailyReportAgent'
$task.Triggers | Format-List StartBoundary, DaysOfWeek, @{n='Interval';e={$_.Repetition.Interval}}, @{n='Duration';e={$_.Repetition.Duration}}
$task.Principal | Format-List UserId, LogonType
```

- `LastTaskResult` はエージェントの終了コード（`0` / `1` / `2`、上の「終了コード」参照）か、タスクスケジューラの値です

  | `LastTaskResult` | 意味 |
  |---|---|
  | `0` | 正常終了 |
  | `1` / `2` | エージェントが一部失敗／走査せずに終了。ログ（`logs\agent-yyyyMMdd.log`）を確認する |
  | `267009`（0x41301） | 実行中 |
  | `267011`（0x41303） | まだ一度も実行されていない |
  | `267014`（0x41306） | 実行時間の上限（30分）で停止された |

- `DaysOfWeek` は曜日のビットの合計で、月〜金なら `62` です（日=1, 月=2, 火=4, 水=8, 木=16, 金=32, 土=64）。
  `Interval` が `PT1H`、`Duration` が `PT8H` なら1時間間隔・8時間継続です
- GUI で確認する場合は「タスク スケジューラ」→「タスク スケジューラ ライブラリ」→「ProductPlanner」→
  「DailyReportAgent」を開き、「トリガー」タブと「履歴」タブを見ます（履歴が「無効」の場合は右側の
  「すべてのタスク履歴を有効にする」をクリック）
- heartbeat が届いているかはサーバ側（`agent_heartbeats`）で確認します。SQL は
  [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) の「サーバ側の確認」を参照してください
- `Interactive` の場合、実行のたびに PowerShell の画面が一瞬表示されることがあります（`-WindowStyle Hidden` で
  すぐに隠れます）。現場の方には「1時間に1回、黒い画面が一瞬出るが触らなくてよい」と伝えてください

#### 削除する

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-DailyReportAgentTask.ps1
```

- タスクを削除します（実行中なら停止してから削除）。タスクが無い状態で実行してもエラーにはなりません。
  `\ProductPlanner\` フォルダが空になればフォルダも削除します
- `config.json`・`state\`・`logs\` は削除しません。エージェントを撤去する場合は、タスクを削除したあとで
  フォルダごと削除してください（`config.json` にはトークンが入っているため、撤去時は必ず消し、
  `issue_agent_token.py revoke` でトークンも失効させる）

  ```powershell
  Remove-Item -Recurse -Force C:\ProductPlanner\daily-report-agent
  ```

- 設定の変更だけなら削除は不要です（登録スクリプトを実行し直せば上書きされます）

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
| タスクの `LastTaskResult` が 0 以外なのにログが無い | タスクがエージェントを起動できていない。`Get-ScheduledTask` の実行内容のパスが正しいか、実行アカウントがスクリプトのフォルダを読めるかを確認する |
| ログオフ中・再起動後に実行されない | `Interactive`（ログオン中のみ実行）の仕様。ログオンしていない時間帯も動かす場合は `-LogonMode Password` で登録し直す |
| 全ファイルを送り直したい | `state\sent-files.json` を削除する。サーバ側で受信済みのものは `duplicate` になるだけで重複保存はされない |

### 再登録が必要な場面

| 場面 | 手順 |
|---|---|
| 実行アカウントのパスワードを変えた（`Password` の場合） | タスクが起動できなくなる（`LastTaskResult` が 0 以外になり、エージェントのログが出なくなる。履歴にはログオン失敗が残る）。新しいパスワードで `Install-DailyReportAgentTask.ps1 -LogonMode Password`（他のパラメータも前回と同じもの）を実行し直す。パスワードに有効期限がある場合は、期限の前に顧客側で変更→再登録の段取りを決めておく |
| 実行アカウントを変えた | 新しいアカウントに `config.json`・`state\`・`logs\` の読み書き権限と、ファイルサーバの読み取り権限があることを確認してから、`-User` を指定して登録し直す |
| 開始・終了時刻や間隔を変える | パラメータを変えて登録スクリプトを実行し直す（上書きされる） |
| エージェントのフォルダを移動した | 新しい場所で登録スクリプトを実行し直す（タスクは絶対パスでエージェントを起動するため） |
| 共有PCを入れ替えた | 新しい PC で「設置手順」の2〜5を行う。トークンは PC ごとに発行し直し、古い PC のタスクは `Uninstall-DailyReportAgentTask.ps1` で削除、フォルダも削除、古いトークンは revoke する。`state\sent-files.json` は移さなくてよい（サーバ側で `duplicate` になるだけ） |

### トークンの入れ替え

共有PCの入れ替えやトークンの漏洩時は、`issue_agent_token.py revoke` で古いトークンを失効させてから
新しいトークンを発行し、`config.json` を更新します。

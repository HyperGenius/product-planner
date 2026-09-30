# 設置作業チェックリスト（顧客先の共有PC）

日報取り込みエージェントを顧客の共有PCに設置する日に、上から順に実施するチェックリストです。
各手順の詳細・設定項目の意味は [README.md](README.md) を参照してください。

- 所要時間の目安: 顧客PCでの作業 30〜45分（事前準備を済ませた場合）
- 例のパスは `C:\ProductPlanner\daily-report-agent`、日報フォルダは `\\fileserver\share\日報` としています。
  現地の値に読み替えてください
- 顧客のファイルパス・ホスト名・アカウント名・トークンは、Issue・PR・チャット等に貼らないでください

---

## 0. 出発前（開発者の手元で）

- [ ] 顧客に次のことを確認した
  - [ ] 日報Excelを置いているフォルダ（UNC パス。複数あればすべて）
  - [ ] 共有PCにログオンしているアカウント（共用アカウントか、個人アカウントか）
  - [ ] 業務時間中はそのアカウントでログオンしたままか（→ `Interactive` / `Password` のどちらで登録するか決める。README「実行アカウントとログオン方式を決める」）
  - [ ] そのアカウントのパスワードに有効期限があるか（`Password` の場合、期限切れで止まる）
  - [ ] 当日、共有PCの管理者権限（管理者アカウントのパスワード）を使えるか
  - [ ] 共有PCの電源を入れる／落とす時刻（9:00 より前に起動しているか）
- [ ] 本番のバックエンドが動いていて、エージェント API が有効なことを確認した（`401` が返れば OK）

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST <api_base_url>/api/agent/heartbeat
  ```

- [ ] トークンを発行した（設置する PC ごとに1つ。表示は1回きり）

  ```bash
  cd backend
  python scripts/issue_agent_token.py issue --tenant-id <tenant_uuid> --name "工場1F 共有PC"
  ```

  トークンはパスワードマネージャ等で持参し、紙・チャット・メールには残さない
- [ ] 次のファイルを `main` の最新から USB メモリ等にコピーした
  - `DailyReportAgent.ps1` / `Install-DailyReportAgentTask.ps1` / `Uninstall-DailyReportAgentTask.ps1`
  - `config.sample.json` / `README.md` / この `SETUP_CHECKLIST.md`
  - `.ps1` は BOM 付き UTF-8 のままコピーする（エディタで開いて保存し直さない）
- [ ] サーバ側の確認（手順3）に使う SQL を実行できる状態にした（Supabase ダッシュボードの SQL Editor に
  ログインできる、または手元から `supabase db query --db-url ...` を実行できる）

---

## 1. 顧客PCでの作業

1-1〜1-3 は、共有PCに**普段ログオンしているアカウント（タスクの実行アカウント）で開いた PowerShell** で行います。
「管理者として実行」で開くと管理者アカウントとして動き、ファイルサーバへのアクセス権や資格情報が変わるため、
日報フォルダが読めるかどうかを正しく確認できません。管理者として開くのは 1-4 だけです。

### 1-1. 環境の確認

- [ ] PowerShell が 5.1 である（`Major` が `5`、`Minor` が `1`）

  ```powershell
  $PSVersionTable.PSVersion
  ```

- [ ] 日報フォルダが読める（ファイル名が表示される）

  ```powershell
  Get-ChildItem '\\fileserver\share\日報' | Select-Object -First 5
  ```

- [ ] バックエンドに接続できる（`TcpTestSucceeded : True`）

  ```powershell
  Test-NetConnection <api のホスト名> -Port 443
  ```

### 1-2. 配置と設定

- [ ] フォルダを作り、ファイルをコピーした

  ```powershell
  New-Item -ItemType Directory -Force C:\ProductPlanner\daily-report-agent
  # USB 等から *.ps1 / config.sample.json / README.md をコピーしたあと
  Get-ChildItem C:\ProductPlanner\daily-report-agent\*.ps1 | Unblock-File
  ```

- [ ] `config.sample.json` を `config.json` にコピーし、メモ帳で `api_base_url`・`token`・`target_folders` を書き換えた
  - JSON の中の `\` は `\\` と書く（`"\\\\fileserver\\share\\日報"`）
  - 保存時の文字コードは「UTF-8」
- [ ] `config.json` のアクセス権を、実行アカウントと管理者だけに絞った

  ```powershell
  icacls C:\ProductPlanner\daily-report-agent\config.json /inheritance:r /grant:r "<実行アカウント>:R" "Administrators:F"
  ```

- [ ] トークンの控え（コピー元のメモ・クリップボード）を消した

### 1-3. 手動で実行する

- [ ] `-DryRun` で、送信対象のファイル一覧が出る（エラーが出ない）

  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProductPlanner\daily-report-agent\DailyReportAgent.ps1 -DryRun
  ```

- [ ] `-DryRun` なしで実行し、ログに `stored: ...` と `heartbeat を送信しました` が出る。日本語が文字化けしていない

  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProductPlanner\daily-report-agent\DailyReportAgent.ps1
  ```

  初回はファイル数によって数分かかります

- [ ] もう一度実行すると、送信件数が 0 で「変更なし」に数えられる

### 1-4. タスクスケジューラに登録する

ここからは、スタートメニューの「Windows PowerShell」を右クリック →「管理者として実行」で開いた PowerShell で行います。

- [ ] `-WhatIf` で設定内容を確認した（トリガーが「毎週 月火水木金 09:00 開始、1時間ごとに 8時間継続」、
  実行アカウントが共有PCのアカウントになっている）

  ```powershell
  cd C:\ProductPlanner\daily-report-agent
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-DailyReportAgentTask.ps1 -WhatIf
  ```

- [ ] 登録した（`Password` の場合は `-LogonMode Password` を付け、入力画面で実行アカウントのパスワードを入れる）

  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-DailyReportAgentTask.ps1
  ```

- [ ] タスクで1回実行し、`LastTaskResult` が `0` になった（`267009` は実行中なので少し待って再確認）

  ```powershell
  Start-ScheduledTask -TaskPath '\ProductPlanner\' -TaskName 'DailyReportAgent'
  Get-ScheduledTaskInfo -TaskPath '\ProductPlanner\' -TaskName 'DailyReportAgent' | Format-List LastRunTime, LastTaskResult, NextRunTime
  ```

- [ ] ログ（`C:\ProductPlanner\daily-report-agent\logs\agent-yyyyMMdd.log`）に、今のタスク実行の分が追記されている
- [ ] `NextRunTime` が次の平日の予定時刻（または今日の次の毎時）になっている

---

## 2. サーバ側の確認（Supabase）

1-3・1-4 の実行がサーバに届いているかを確認します。Supabase ダッシュボード → SQL Editor で実行するか、
手元から `supabase db query --db-url "<セッションプーラーの接続文字列>" "<SQL>"` で実行します
（接続方法はリポジトリ直下の `CLAUDE.md`「本番 Supabase への接続」。**SELECT だけ**を実行する）。

`<tenant_uuid>` は顧客テナントの UUID に置き換えてください。

- [ ] トークンが使われている（`last_used_at` がタスクを実行した時刻になっている、`revoked_at` が空）

  ```sql
  SELECT name, created_at, last_used_at, revoked_at
  FROM agent_tokens
  WHERE tenant_id = '<tenant_uuid>'
  ORDER BY created_at DESC;
  ```

- [ ] heartbeat が届いている（手動実行・タスク実行の回数分の行がある。`error_count` が 0、
  `hostname` が設置した PC）

  ```sql
  SELECT received_at, scanned_count, sent_count, duplicate_count, error_count, agent_version,
         payload->>'hostname'       AS hostname,
         payload->>'unchanged_count' AS unchanged,
         payload->>'locked_count'    AS locked,
         payload->>'folder_error_count' AS folder_error
  FROM agent_heartbeats
  WHERE tenant_id = '<tenant_uuid>'
  ORDER BY received_at DESC
  LIMIT 10;
  ```

- [ ] 日報ファイルが記録されている（件数が1回目の実行の `sent_count` と一致する。`original_path` の日本語が化けていない）

  ```sql
  SELECT received_at, file_name, original_path, size_bytes, file_modified_at
  FROM daily_report_files
  WHERE tenant_id = '<tenant_uuid>'
  ORDER BY received_at DESC
  LIMIT 20;

  SELECT count(*) FROM daily_report_files WHERE tenant_id = '<tenant_uuid>';
  ```

- [ ] Storage に同じ件数のファイルがある（上の `count(*)` と一致する）

  ```sql
  SELECT count(*) AS objects, sum((metadata->>'size')::bigint) AS total_bytes
  FROM storage.objects
  WHERE bucket_id = 'daily-reports' AND name LIKE '<tenant_uuid>/%';
  ```

`original_path` には顧客のファイルパスが入っています。結果を Issue・PR・チャットに貼るときは伏せてください。

---

## 3. 現場への説明・片付け

- [ ] 現場の方に次のことを伝えた
  - 平日 9:00〜17:00 の毎時、日報を自動で送る。操作は不要
  - `Interactive` の場合: 1時間に1回、黒い画面が一瞬表示されることがあるが触らなくてよい。
    サインアウトすると送られない（画面ロックは問題ない）
  - Excel で日報を開いたままだとそのファイルは送られない（閉じたあとの回で送られる）
  - 日報の保存場所・ファイル形式（.xlsx/.xlsm/.xls）を変えるときは事前に連絡してほしい
- [ ] `Password` で登録した場合: パスワードを変えたら連絡してもらう（再登録が必要）ことを、顧客の管理者に伝えた
- [ ] USB メモリ等のコピー元を回収した。PC に残した作業用のメモ（トークン等）が無い

---

## 4. 翌営業日以降の確認（開発者の手元で）

- [ ] 平日の毎時、heartbeat が届いている（1時間に1行。9時台〜16時台、延長した場合はその時刻まで）

  ```sql
  SELECT date_trunc('hour', received_at AT TIME ZONE 'Asia/Tokyo') AS hour_jst,
         count(*) AS runs, sum(sent_count) AS sent, sum(error_count) AS errors
  FROM agent_heartbeats
  WHERE tenant_id = '<tenant_uuid>' AND received_at > now() - interval '3 days'
  GROUP BY 1
  ORDER BY 1 DESC;
  ```

- [ ] 同じ時間帯に2行以上ない（多重起動していない）
- [ ] 9:00 より後に PC を起動した日も、起動後から実行されている（その日の最初の行が起動時刻の直後にある）
- [ ] `error_count` が続けて 0 以外になっていない。なっていれば顧客にログ（`logs\`）を送ってもらうか、
  リモートで README「よくある状況」を確認する

### heartbeat が来ないときの切り分け

| 確認すること | 結果 | 考えられる原因 |
|---|---|---|
| `Get-ScheduledTaskInfo` の `LastRunTime` | 更新されていない | PC が起動していない／`Interactive` でサインアウトしていた／タスクが無効 |
| `LastTaskResult` | `2` | `config.json` の不備。ログの `設定の読み込みに失敗しました` を確認 |
| `LastTaskResult` | `1` | 一部失敗。ログの `ERROR` 行を確認（HTTP 401 ならトークン、HTTP 0 なら通信） |
| `LastTaskResult` | 0 以外でログが無い | タスクがエージェントを起動できていない（パス・アクセス権・`Password` のパスワード変更） |
| ログ | `フォルダを走査できません` | 実行アカウントがファイルサーバを読めない |

---

## 付録: 登録スクリプトの受け入れ確認（初回設置時のみ）

Issue #478 の完了条件のうち、Windows の実機でしか確認できない項目です。検証用の Windows PC・VM で済ませていれば、
顧客先では不要です。

- [ ] 登録スクリプトを2回実行しても、タスクスケジューラの「ProductPlanner」フォルダのタスクは1つのまま
- [ ] `-DurationHours 9` で登録し直すと、トリガーが9時間継続（`Duration` が `PT9H`）になる
- [ ] `-WhatIf` ではタスクが作られない（または既存のタスクの設定が変わらない）
- [ ] タスク実行中に `Start-ScheduledTask` をもう一度実行しても、2つ目は起動しない（履歴に「既に実行中のため起動しなかった」）
- [ ] 9:00 より後に PC を起動すると、起動後に実行される
- [ ] 削除スクリプトでタスクが消え、もう一度実行してもエラーにならない
- [ ] 日本語版 Windows で、登録・削除スクリプトのメッセージが文字化けしない

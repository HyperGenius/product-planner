<#
.SYNOPSIS
    日報Excelをバックエンド（POST /api/agent/daily-reports）へ送る共有PC用エージェント（Issue #472）。

.DESCRIPTION
    設定ファイルの target_folders 配下の *.xlsx / *.xlsm / *.xls を走査し、前回送信時から
    SHA-256 が変わったファイルだけを送信する。最後に POST /api/agent/heartbeat で実行サマリを送る。

    - PowerShell 5.1 で動く（追加モジュールに依存しない）
    - サーバが stored / duplicate を返したファイルだけを送信済みとして状態ファイルに記録する。
      それ以外（4xx/5xx・通信エラー）は記録せず、次回の実行で再送する
    - 記入中のファイル（他のプロセスが書き込み用に開いているファイル・~$ で始まる一時ファイル）はスキップする
    - トークンはスクリプトに書かず、設定ファイル（config.json）または環境変数 DAILY_REPORT_AGENT_TOKEN で渡す

    設置手順・設定項目は同じフォルダの README.md を参照。

.PARAMETER ConfigPath
    設定ファイルのパス。省略時はスクリプトと同じフォルダの config.json。

.PARAMETER DryRun
    送信対象のファイルを一覧表示するだけで、送信・状態ファイルの更新・heartbeat を行わない（設置時の確認用）。

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\DailyReportAgent.ps1

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\DailyReportAgent.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$AgentVersion = '0.1.0'
$TargetExtensions = @('.xlsx', '.xlsm', '.xls')

# 終了コード（タスクスケジューラの「前回の実行結果」で確認できる）
$ExitOk = 0
$ExitPartialFailure = 1   # 一部のファイル送信・フォルダ走査・heartbeat に失敗した（次回再送）
$ExitFatal = 2            # 設定不備・多重起動などで走査自体を行わなかった

# ---------------------------------------------------------------------------
# ログ
# ---------------------------------------------------------------------------

$script:LogFile = $null

function Write-AgentLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    $line = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    if ($script:LogFile) {
        try {
            [System.IO.File]::AppendAllText($script:LogFile, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
        } catch {
            Write-Host ('ログファイルに書き込めません: {0}' -f $_.Exception.Message)
        }
    }
}

function Initialize-Log {
    param([string]$LogDir, [int]$RetentionDays)
    if (-not (Test-Path -LiteralPath $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    $script:LogFile = Join-Path $LogDir ('agent-{0}.log' -f (Get-Date).ToString('yyyyMMdd'))
    if ($RetentionDays -gt 0) {
        $threshold = (Get-Date).AddDays(-$RetentionDays)
        Get-ChildItem -LiteralPath $LogDir -Filter 'agent-*.log' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt $threshold } |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------

function Get-ConfigValue {
    param($Config, [string]$Name, $Default)
    $prop = $Config.PSObject.Properties[$Name]
    if ($null -eq $prop -or $null -eq $prop.Value) { return $Default }
    return $prop.Value
}

function Resolve-AgentPath {
    # 相対パスはスクリプトのフォルダ基準にする（タスクスケジューラの作業フォルダに依存させない）
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $PSScriptRoot $Path
}

function Read-AgentConfig {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw ('設定ファイルが見つかりません: {0}（config.sample.json をコピーして作成してください）' -f $Path)
    }
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $json = $raw | ConvertFrom-Json

    $apiBaseUrl = [string](Get-ConfigValue $json 'api_base_url' '')
    if (-not $apiBaseUrl) { throw '設定 api_base_url がありません' }
    $apiBaseUrl = $apiBaseUrl.TrimEnd('/')

    # 環境変数があれば設定ファイルより優先する
    $token = $env:DAILY_REPORT_AGENT_TOKEN
    if (-not $token) { $token = [string](Get-ConfigValue $json 'token' '') }
    if (-not $token -or $token -like '<*>') {
        throw 'トークンが設定されていません（config.json の token または環境変数 DAILY_REPORT_AGENT_TOKEN）'
    }

    $folders = @(@(Get-ConfigValue $json 'target_folders' @()) | Where-Object { $_ })
    if ($folders.Count -eq 0) { throw '設定 target_folders が空です' }

    return [pscustomobject]@{
        ApiBaseUrl       = $apiBaseUrl
        Token            = $token.Trim()
        TargetFolders    = [string[]]$folders
        Recurse          = [bool](Get-ConfigValue $json 'recurse' $true)
        StatePath        = Resolve-AgentPath ([string](Get-ConfigValue $json 'state_path' 'state\sent-files.json'))
        LogDir           = Resolve-AgentPath ([string](Get-ConfigValue $json 'log_dir' 'logs'))
        LogRetentionDays = [int](Get-ConfigValue $json 'log_retention_days' 30)
        MaxFileBytes     = [long](Get-ConfigValue $json 'max_file_bytes' 20971520)
        TimeoutSeconds   = [int](Get-ConfigValue $json 'timeout_seconds' 120)
    }
}

# ---------------------------------------------------------------------------
# 状態ファイル（送信済みファイルのパス → SHA-256）
# ---------------------------------------------------------------------------

function Read-AgentState {
    # キーはファイルのフルパス。PowerShell のハッシュテーブルは大文字小文字を区別しないので
    # Windows のパスの比較と揃う。
    param([string]$Path)
    $state = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $state }
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    if (-not $raw.Trim()) { return $state }
    $json = $raw | ConvertFrom-Json
    $files = Get-ConfigValue $json 'files' $null
    if ($null -eq $files) { return $state }
    foreach ($prop in $files.PSObject.Properties) {
        $state[$prop.Name] = [pscustomobject]@{
            sha256          = [string]$prop.Value.sha256
            size_bytes      = [long]$prop.Value.size_bytes
            last_write_utc  = [string]$prop.Value.last_write_utc
            sent_at         = [string]$prop.Value.sent_at
        }
    }
    return $state
}

function Save-AgentState {
    # 一時ファイルに書いてから置き換える（書き込み途中で落ちても前回の状態が残るように）
    param([string]$Path, [hashtable]$State)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $files = [ordered]@{}
    foreach ($key in ($State.Keys | Sort-Object)) { $files[$key] = $State[$key] }
    $doc = [ordered]@{ version = 1; updated_at = (Get-Date).ToString('o'); files = $files }
    $json = ConvertTo-Json -InputObject $doc -Depth 5
    $tmp = $Path + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) {
        # .NET メソッドの string 引数に $null を渡すと PowerShell が "" に変換するため [NullString] を使う
        [System.IO.File]::Replace($tmp, $Path, [NullString]::Value)
    } else {
        [System.IO.File]::Move($tmp, $Path)
    }
}

# ---------------------------------------------------------------------------
# ファイル読み取り
# ---------------------------------------------------------------------------

function Read-FileIfNotLocked {
    # 他のプロセスに書き込みを許さない共有モードで開く。Excel で記入中のファイルは
    # Excel が書き込み用に開いているので IOException になる → 記入中としてスキップする。
    # 読み取れた場合は同じバイト列からハッシュを計算して送るので、ヘッダの SHA-256 と
    # ボディが食い違うことはない。
    param([string]$Path)
    $stream = $null
    try {
        $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $buffer = New-Object byte[] $stream.Length
        $offset = 0
        while ($offset -lt $buffer.Length) {
            $read = $stream.Read($buffer, $offset, $buffer.Length - $offset)
            if ($read -le 0) { break }
            $offset += $read
        }
        if ($offset -ne $buffer.Length) { throw 'ファイルの読み取り中にサイズが変わりました' }
        return , $buffer
    } catch [System.IO.IOException] {
        # 共有違反（ERROR_SHARING_VIOLATION=32）・ロック違反（ERROR_LOCK_VIOLATION=33）だけを記入中とみなす。
        # ファイル消失やネットワークエラー等は読み取り失敗として呼び出し側でエラーに数える。
        $win32Error = $_.Exception.HResult -band 0xFFFF
        if ($win32Error -eq 32 -or $win32Error -eq 33) { return $null }
        throw
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
    } finally {
        $sha.Dispose()
    }
    return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

function Invoke-AgentRequest {
    # PS 5.1 の Invoke-WebRequest は 4xx/5xx で例外になりボディを読みにくいので、
    # HttpWebRequest で送り、ステータスコードとボディを返す。通信エラーは StatusCode = 0。
    param(
        [string]$Url,
        [string]$Token,
        [string]$ContentType,
        [byte[]]$Body,
        [hashtable]$Headers,
        [int]$TimeoutSeconds
    )
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Method = 'POST'
    $request.ContentType = $ContentType
    $request.Timeout = $TimeoutSeconds * 1000
    $request.ReadWriteTimeout = $TimeoutSeconds * 1000
    $request.UserAgent = 'ProductPlannerDailyReportAgent/' + $AgentVersion
    $request.Headers.Add('Authorization', 'Bearer ' + $Token)
    if ($Headers) {
        foreach ($key in $Headers.Keys) { $request.Headers.Add($key, [string]$Headers[$key]) }
    }
    $request.ContentLength = $Body.Length

    $response = $null
    try {
        $requestStream = $request.GetRequestStream()
        try {
            $requestStream.Write($Body, 0, $Body.Length)
        } finally {
            $requestStream.Dispose()
        }
        $response = $request.GetResponse()
    } catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) {
            return [pscustomobject]@{ StatusCode = 0; Body = ''; Error = $_.Exception.Message }
        }
    }

    try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try {
            $text = $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
        return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = $text; Error = $null }
    } finally {
        $response.Close()
    }
}

function Get-ResponseDetail {
    param($Result)
    if ($Result.StatusCode -eq 0) { return $Result.Error }
    try {
        $json = $Result.Body | ConvertFrom-Json
        $detail = Get-ConfigValue $json 'detail' $null
        if ($null -ne $detail) { return ($detail | ConvertTo-Json -Compress -Depth 5) }
    } catch {
        # JSON でないボディ（リバースプロキシのエラーページ等）はそのまま短く切って返す
    }
    $text = [string]$Result.Body
    if ($text.Length -gt 200) { $text = $text.Substring(0, 200) }
    return $text
}

function Send-DailyReport {
    param($Config, [string]$Path, [byte[]]$Bytes, [string]$Sha256, [datetime]$LastWriteTime)
    $headers = @{
        'X-File-Sha256'      = $Sha256
        # 日本語を含むパスをヘッダで送るため UTF-8 でパーセントエンコードする
        'X-File-Path'        = [System.Uri]::EscapeDataString($Path)
        'X-File-Modified-At' = $LastWriteTime.ToString('o')
    }
    return Invoke-AgentRequest -Url ($Config.ApiBaseUrl + '/api/agent/daily-reports') -Token $Config.Token `
        -ContentType 'application/octet-stream' -Body $Bytes -Headers $headers -TimeoutSeconds $Config.TimeoutSeconds
}

function Send-Heartbeat {
    param($Config, $Summary)
    $json = ConvertTo-Json -InputObject $Summary -Depth 5 -Compress
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json)
    return Invoke-AgentRequest -Url ($Config.ApiBaseUrl + '/api/agent/heartbeat') -Token $Config.Token `
        -ContentType 'application/json; charset=utf-8' -Body $bytes -Headers $null -TimeoutSeconds $Config.TimeoutSeconds
}

# ---------------------------------------------------------------------------
# 走査
# ---------------------------------------------------------------------------

function Get-TargetFiles {
    param([string]$Folder, [bool]$Recurse)
    $items = Get-ChildItem -LiteralPath $Folder -File -Recurse:$Recurse -Force -ErrorAction Stop
    return @($items | Where-Object {
            $TargetExtensions -contains $_.Extension.ToLowerInvariant() -and -not $_.Name.StartsWith('~$')
        })
}

# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

function Invoke-Agent {
    if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'config.json' }

    try {
        $config = Read-AgentConfig -Path $ConfigPath
    } catch {
        Write-AgentLog -Level ERROR -Message ('設定の読み込みに失敗しました: {0}' -f $_.Exception.Message)
        return $ExitFatal
    }

    try {
        Initialize-Log -LogDir $config.LogDir -RetentionDays $config.LogRetentionDays
    } catch {
        Write-AgentLog -Level WARN -Message ('ログフォルダを準備できません（標準出力のみに出力します）: {0}' -f $_.Exception.Message)
    }

    # TLS 1.2 を明示的に有効にする（.NET Framework の既定では無効な環境がある）
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
    # .NET Framework は POST で Expect: 100-continue を付けて応答を待つため、無効にして余計な待ち時間を避ける
    [System.Net.ServicePointManager]::Expect100Continue = $false

    # 多重起動の防止（前回の実行が長引いてタスクスケジューラの次の起動と重なった場合など）
    $lockPath = $config.StatePath + '.lock'
    $lockDir = Split-Path -Parent $lockPath
    if (-not (Test-Path -LiteralPath $lockDir)) { New-Item -ItemType Directory -Path $lockDir -Force | Out-Null }
    try {
        $lock = New-Object System.IO.FileStream($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch [System.IO.IOException] {
        Write-AgentLog -Level WARN -Message '前回の実行が終わっていないため終了します'
        return $ExitFatal
    }

    try {
        return Invoke-AgentRun -Config $config
    } finally {
        $lock.Dispose()
    }
}

function Invoke-AgentRun {
    param($Config)
    $startedAt = Get-Date
    Write-AgentLog -Message ('開始 version={0} dry_run={1} api={2}' -f $AgentVersion, [bool]$DryRun, $Config.ApiBaseUrl)

    try {
        $state = Read-AgentState -Path $Config.StatePath
    } catch {
        # 状態ファイルが壊れていても止めずに全件送り直す（サーバ側で duplicate になるだけ）
        Write-AgentLog -Level WARN -Message ('状態ファイルを読めないため空の状態で続行します: {0}' -f $_.Exception.Message)
        $state = @{}
    }

    $counts = [ordered]@{
        scanned   = 0
        sent      = 0   # サーバが stored を返した
        duplicate = 0   # サーバが duplicate を返した
        error     = 0   # 送信失敗・読み取り失敗・フォルダ走査失敗・サイズ超過
        unchanged = 0   # 前回送信時から変わっていないので送らなかった
        locked    = 0   # 記入中のためスキップした
        too_large = 0   # max_file_bytes を超えるため送らなかった（error にも数える）
        folder_error = 0
    }
    $authFailed = $false

    foreach ($folder in $Config.TargetFolders) {
        try {
            $files = Get-TargetFiles -Folder $folder -Recurse $Config.Recurse
        } catch {
            $counts.folder_error++
            $counts.error++
            Write-AgentLog -Level ERROR -Message ('フォルダを走査できません: {0}: {1}' -f $folder, $_.Exception.Message)
            continue
        }

        foreach ($file in $files) {
            if ($authFailed) { break }
            $counts.scanned++
            $path = $file.FullName
            $lastWriteUtc = $file.LastWriteTimeUtc.ToString('o')
            $previous = $state[$path]

            # サイズと更新日時が前回送信時と同じならハッシュ計算（ファイルサーバからの読み取り）を省く
            if ($previous -and $previous.size_bytes -eq $file.Length -and $previous.last_write_utc -eq $lastWriteUtc) {
                $counts.unchanged++
                continue
            }

            if ($file.Length -gt $Config.MaxFileBytes) {
                $counts.too_large++
                $counts.error++
                Write-AgentLog -Level ERROR -Message ('サイズ上限を超えるため送信しません: {0} ({1} bytes)' -f $path, $file.Length)
                continue
            }

            try {
                $bytes = Read-FileIfNotLocked -Path $path
            } catch {
                $counts.error++
                Write-AgentLog -Level ERROR -Message ('読み取りに失敗しました: {0}: {1}' -f $path, $_.Exception.Message)
                continue
            }
            if ($null -eq $bytes) {
                $counts.locked++
                Write-AgentLog -Message ('記入中のためスキップします: {0}' -f $path)
                continue
            }

            $sha256 = Get-Sha256Hex -Bytes $bytes
            if ($previous -and $previous.sha256 -eq $sha256) {
                # 更新日時だけ変わった（上書き保存したが中身は同じ）→ 送らずに状態だけ更新する
                $counts.unchanged++
                if (-not $DryRun) {
                    $previous.size_bytes = $file.Length
                    $previous.last_write_utc = $lastWriteUtc
                }
                continue
            }

            if ($DryRun) {
                Write-AgentLog -Message ('[DryRun] 送信対象: {0} sha256={1}' -f $path, $sha256)
                continue
            }

            $result = Send-DailyReport -Config $Config -Path $path -Bytes $bytes -Sha256 $sha256 -LastWriteTime $file.LastWriteTime
            $status = $null
            if ($result.StatusCode -eq 200) {
                try { $status = [string](($result.Body | ConvertFrom-Json).status) } catch { $status = $null }
            }

            if ($status -eq 'stored' -or $status -eq 'duplicate') {
                if ($status -eq 'stored') { $counts.sent++ } else { $counts.duplicate++ }
                $state[$path] = [pscustomobject]@{
                    sha256         = $sha256
                    size_bytes     = [long]$file.Length
                    last_write_utc = $lastWriteUtc
                    sent_at        = (Get-Date).ToString('o')
                }
                Write-AgentLog -Message ('{0}: {1}' -f $status, $path)
            } else {
                # 状態に記録しない → 次回の実行で再送する
                $counts.error++
                Write-AgentLog -Level ERROR -Message ('送信に失敗しました（次回再送）: {0}: HTTP {1} {2}' -f $path, $result.StatusCode, (Get-ResponseDetail $result))
                if ($result.StatusCode -eq 401) {
                    # トークンが無効なら残りのファイルも全て失敗するので打ち切る
                    $authFailed = $true
                    Write-AgentLog -Level ERROR -Message 'トークンが無効です。トークンを再発行して config.json を更新してください'
                }
            }
        }
        if ($authFailed) { break }
    }

    if (-not $DryRun) {
        try {
            Save-AgentState -Path $Config.StatePath -State $state
        } catch {
            # 保存できなくても送信済みのファイルは次回 duplicate になるだけ
            $counts.error++
            Write-AgentLog -Level ERROR -Message ('状態ファイルを保存できません: {0}' -f $_.Exception.Message)
        }
    }

    $finishedAt = Get-Date
    Write-AgentLog -Message ('走査={0} 送信={1} 重複={2} 変更なし={3} 記入中={4} エラー={5}' -f `
            $counts.scanned, $counts.sent, $counts.duplicate, $counts.unchanged, $counts.locked, $counts.error)

    if ($DryRun) {
        Write-AgentLog -Message '[DryRun] heartbeat は送信しません'
        return $ExitOk
    }

    # 集計値4つ・agent_version 以外は agent_heartbeats.payload にそのまま保存される
    $summary = [ordered]@{
        scanned_count      = $counts.scanned
        sent_count         = $counts.sent
        duplicate_count    = $counts.duplicate
        error_count        = $counts.error
        agent_version      = $AgentVersion
        unchanged_count    = $counts.unchanged
        locked_count       = $counts.locked
        too_large_count    = $counts.too_large
        folder_error_count = $counts.folder_error
        started_at         = $startedAt.ToString('o')
        finished_at        = $finishedAt.ToString('o')
        hostname           = $env:COMPUTERNAME
        powershell_version = $PSVersionTable.PSVersion.ToString()
    }
    $heartbeat = Send-Heartbeat -Config $Config -Summary $summary
    $heartbeatOk = $heartbeat.StatusCode -eq 200
    if ($heartbeatOk) {
        Write-AgentLog -Message 'heartbeat を送信しました'
    } else {
        Write-AgentLog -Level ERROR -Message ('heartbeat の送信に失敗しました: HTTP {0} {1}' -f $heartbeat.StatusCode, (Get-ResponseDetail $heartbeat))
    }

    if ($counts.error -gt 0 -or -not $heartbeatOk) { return $ExitPartialFailure }
    return $ExitOk
}

$exitCode = $ExitFatal
try {
    $exitCode = Invoke-Agent
} catch {
    Write-AgentLog -Level ERROR -Message ('予期しないエラーで終了します: {0}' -f $_.Exception.ToString())
    $exitCode = $ExitFatal
}
exit $exitCode

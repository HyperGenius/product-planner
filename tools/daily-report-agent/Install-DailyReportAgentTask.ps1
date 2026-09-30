<#
.SYNOPSIS
    日報取り込みエージェント（DailyReportAgent.ps1）の定期実行タスクをタスクスケジューラに登録する（Issue #478）。

.DESCRIPTION
    タスク \ProductPlanner\DailyReportAgent を作成する。同じタスクが既にあれば設定を上書きする（何度実行しても1つのまま）。

    - 既定のトリガー: 平日（月〜金）9:00 開始、1時間間隔、8時間継続
    - 多重起動しない（前回の実行が続いていれば新しい実行はスキップ）、実行時間の上限 30分、
      予定時刻に PC が起動していなかった場合は起動後に実行、バッテリー駆動でも止めない
    - 実行アカウントはファイルサーバ（UNC パス）を読めるユーザーアカウントにする。SYSTEM や
      「パスワードを保存しない（S4U）」ではファイル共有にアクセスできないので使わない
      - Interactive（既定）: ログオン中のみ実行。パスワード不要
      - Password: ログオンしていなくても実行。パスワードは Get-Credential で対話的に入力し、タスクスケジューラに保存する

    PowerShell 5.1・標準の ScheduledTasks モジュールだけで動く。設置手順は同じフォルダの README.md を参照。

.PARAMETER AgentPath
    エージェントスクリプトのパス。省略時はこのスクリプトと同じフォルダの DailyReportAgent.ps1。

.PARAMETER ConfigPath
    エージェントに -ConfigPath として渡す設定ファイルのパス。省略時はエージェントの既定（同じフォルダの config.json）。

.PARAMETER StartTime
    1日の最初の実行時刻（HH:mm）。既定は 09:00。

.PARAMETER IntervalMinutes
    実行間隔（分）。既定は 60。

.PARAMETER DurationHours
    StartTime から繰り返しを続ける時間（時間）。既定は 8（9:00 開始なら 17:00 まで）。18時まで延ばすなら 9。

.PARAMETER DaysOfWeek
    実行する曜日。既定は月〜金。

.PARAMETER ExecutionTimeLimitMinutes
    1回の実行時間の上限（分）。超えるとタスクスケジューラが停止する。既定は 30。

.PARAMETER LogonMode
    Interactive（ログオン中のみ実行、既定）または Password（ログオンしていなくても実行、パスワードを保存）。

.PARAMETER User
    実行アカウント（DOMAIN\user または PC名\user）。省略時はこの PC にログオン中のユーザー
    （「管理者として実行」で別の管理者アカウントに昇格していても、ログオン中のユーザーになる）。
    Password では入力画面の初期値になる。

.EXAMPLE
    .\Install-DailyReportAgentTask.ps1 -WhatIf
    登録せずに設定内容だけを表示する。

.EXAMPLE
    .\Install-DailyReportAgentTask.ps1
    ログオン中のユーザーで、平日 9:00〜17:00 に1時間ごとに実行するタスクを登録する。

.EXAMPLE
    .\Install-DailyReportAgentTask.ps1 -DurationHours 9 -LogonMode Password
    18:00 まで実行し、ログオンしていなくても実行する（パスワードを入力する）。
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$AgentPath,
    [string]$ConfigPath,
    [ValidatePattern('^([01]?\d|2[0-3]):[0-5]\d$')]
    [string]$StartTime = '09:00',
    [ValidateRange(5, 1440)]
    [int]$IntervalMinutes = 60,
    [ValidateRange(1, 24)]
    [int]$DurationHours = 8,
    [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
    [string[]]$DaysOfWeek = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'),
    [ValidateRange(1, 1440)]
    [int]$ExecutionTimeLimitMinutes = 30,
    [ValidateSet('Interactive', 'Password')]
    [string]$LogonMode = 'Interactive',
    [string]$User
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# 削除スクリプト（Uninstall-DailyReportAgentTask.ps1）と揃えること
$TaskPath = '\ProductPlanner\'
$TaskName = 'DailyReportAgent'
$TaskDescription = 'ProductPlanner 日報取り込みエージェント（Install-DailyReportAgentTask.ps1 で登録）'

function Exit-WithError {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Get-LogonUserName {
    # 「管理者として実行」で別の管理者アカウントに昇格していても、コンソールにログオン中のユーザーを返す
    try {
        $name = (Get-CimInstance -ClassName Win32_ComputerSystem).UserName
        if ($name) { return [string]$name }
    } catch {
        Write-Verbose ('ログオン中のユーザーを取得できません（現在のユーザーを使います）: {0}' -f $_.Exception.Message)
    }
    return '{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME
}

function Test-IsAdministrator {
    # 判定できない場合は $true を返し、警告を出さない（登録に失敗すれば Get-RegisterErrorHint が対処を示す）
    try {
        $identity = New-Object System.Security.Principal.WindowsPrincipal([System.Security.Principal.WindowsIdentity]::GetCurrent())
        return $identity.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $true
    }
}

function Get-RegisterErrorHint {
    # Register-ScheduledTask の失敗から、作業者が取るべき対処を返す（該当しなければ $null）
    param($ErrorRecord, [string]$UserName)
    $ex = $ErrorRecord.Exception
    $text = '{0} 0x{1:X8}' -f $ex.Message, $ex.HResult
    $nativeCode = ''
    if ($ex.PSObject.Properties['NativeErrorCode']) { $nativeCode = [string]$ex.NativeErrorCode }

    if ($nativeCode -eq 'AccessDenied' -or $text -match '0x80070005') {
        return '権限が不足しています。PowerShell を「管理者として実行」で開き直して、もう一度実行してください'
    }
    if ($text -match '0x8007052E') {
        return 'ユーザー名またはパスワードが正しくありません。入力し直してください'
    }
    if ($text -match '0x80070569') {
        return ('{0} に「バッチ ジョブとしてログオン」の権限がありません。管理者として実行するか、ローカル セキュリティ ポリシーで権限を付与してください' -f $UserName)
    }
    if ($text -match '0x80070534') {
        return ('アカウント {0} が見つかりません。-User の指定（DOMAIN\user または PC名\user）を確認してください' -f $UserName)
    }
    return $null
}

function Format-Duration {
    # タスク定義の期間（ISO 8601 の "PT1H" 等）を読みやすくする
    param([string]$Value)
    if (-not $Value) { return '（なし）' }
    try {
        $span = [System.Xml.XmlConvert]::ToTimeSpan($Value)
    } catch {
        return $Value
    }
    if ($span.TotalMinutes -lt 60) { return '{0}分' -f [int]$span.TotalMinutes }
    if ($span.Minutes -eq 0) { return '{0}時間' -f [int][Math]::Floor($span.TotalHours) }
    return '{0}時間{1}分' -f [int][Math]::Floor($span.TotalHours), $span.Minutes
}

function Show-TaskSummary {
    param($Task, [string]$RunAs, [string]$LogonLabel, $TaskInfo)
    $taskAction = @($Task.Actions)[0]
    Write-Host ''
    Write-Host ('タスク          : {0}{1}' -f $TaskPath, $TaskName)
    Write-Host ('実行内容        : {0} {1}' -f $taskAction.Execute, $taskAction.Arguments)
    Write-Host ('作業フォルダ    : {0}' -f $taskAction.WorkingDirectory)
    foreach ($taskTrigger in @($Task.Triggers)) {
        $days = @()
        if ($taskTrigger.PSObject.Properties['DaysOfWeek'] -and $taskTrigger.DaysOfWeek) {
            # DaysOfWeek はビットフラグ（日=1, 月=2, ... 土=64）
            $names = @('日', '月', '火', '水', '木', '金', '土')
            for ($i = 0; $i -lt 7; $i++) {
                if ([int]$taskTrigger.DaysOfWeek -band (1 -shl $i)) { $days += $names[$i] }
            }
        }
        $start = [datetime]::Parse($taskTrigger.StartBoundary)
        Write-Host ('トリガー        : 毎週 {0} {1} 開始、{2}ごとに {3}継続' -f ($days -join ''), $start.ToString('HH:mm'),
            (Format-Duration $taskTrigger.Repetition.Interval), (Format-Duration $taskTrigger.Repetition.Duration))
    }
    Write-Host ('実行アカウント  : {0}（{1}）' -f $RunAs, $LogonLabel)
    $taskSettings = $Task.Settings
    # MultipleInstances は環境により名前（IgnoreNew）または数値（2）で返る
    $ignoreNew = @('IgnoreNew', '2') -contains [string]$taskSettings.MultipleInstances
    Write-Host ('多重起動        : {0}' -f $(if ($ignoreNew) { '実行中なら新しい実行をスキップ' } else { [string]$taskSettings.MultipleInstances }))
    Write-Host ('実行時間の上限  : {0}' -f (Format-Duration $taskSettings.ExecutionTimeLimit))
    Write-Host ('起動遅れの実行  : {0}' -f $(if ($taskSettings.StartWhenAvailable) { '予定時刻に起動していなければ起動後に実行' } else { 'しない' }))
    Write-Host ('バッテリー駆動  : {0}' -f $(if (-not $taskSettings.DisallowStartIfOnBatteries -and -not $taskSettings.StopIfGoingOnBatteries) { '止めない' } else { '止める' }))
    if ($TaskInfo) {
        $next = if ($TaskInfo.NextRunTime) { $TaskInfo.NextRunTime.ToString('yyyy-MM-dd HH:mm') } else { '（なし）' }
        Write-Host ('次回実行予定    : {0}' -f $next)
    }
    Write-Host ''
}

# ---------------------------------------------------------------------------
# 入力の検証
# ---------------------------------------------------------------------------

if (-not (Get-Command -Name Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    Exit-WithError 'ScheduledTasks モジュールが使えません。Windows 10 / 11 の Windows PowerShell 5.1 で実行してください'
}

if (-not $AgentPath) { $AgentPath = Join-Path $PSScriptRoot 'DailyReportAgent.ps1' }
if (-not (Test-Path -LiteralPath $AgentPath -PathType Leaf)) {
    Exit-WithError ('エージェントスクリプトが見つかりません: {0}（タスクは登録していません）' -f $AgentPath)
}
# タスクスケジューラは作業フォルダに依存しない絶対パスで起動する
$AgentPath = (Resolve-Path -LiteralPath $AgentPath).ProviderPath
$agentDir = Split-Path -Parent $AgentPath

if ($ConfigPath) {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        Exit-WithError ('設定ファイルが見つかりません: {0}（タスクは登録していません）' -f $ConfigPath)
    }
    $ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
} elseif (-not (Test-Path -LiteralPath (Join-Path $agentDir 'config.json'))) {
    Write-Warning ('{0} がまだありません。タスクは登録しますが、config.json を作るまでエージェントは終了コード 2 で終わります' -f (Join-Path $agentDir 'config.json'))
}

$interval = New-TimeSpan -Minutes $IntervalMinutes
$duration = New-TimeSpan -Hours $DurationHours
if ($interval -ge $duration) {
    Exit-WithError ('実行間隔（{0}分）は継続時間（{1}時間）より短くしてください' -f $IntervalMinutes, $DurationHours)
}

# Password モードでは入力画面の初期値になる（入力画面で変更できる）
if (-not $User) { $User = Get-LogonUserName }

# ---------------------------------------------------------------------------
# タスク定義
# ---------------------------------------------------------------------------

# -WindowStyle Hidden: Interactive モードで毎時コンソール画面が前面に出て現場の作業を妨げないようにする
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $AgentPath
if ($ConfigPath) { $arguments += ' -ConfigPath "{0}"' -f $ConfigPath }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $agentDir

# PS 5.1 の New-ScheduledTaskTrigger -Weekly は -RepetitionInterval を受け付けないため、
# -Once で作ったトリガーの繰り返し設定を週次トリガーに移す
$at = [datetime]::ParseExact($StartTime, 'H:mm', [System.Globalization.CultureInfo]::InvariantCulture)
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $DaysOfWeek -At $at
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $at -RepetitionInterval $interval -RepetitionDuration $duration).Repetition

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $ExecutionTimeLimitMinutes) `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

function New-AgentTask {
    param([string]$UserId)
    $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType $LogonMode -RunLevel Limited
    return New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $TaskDescription
}

$logonLabel = if ($LogonMode -eq 'Password') { 'ログオンしていなくても実行・パスワード保存' } else { 'ログオン中のみ実行' }

if (-not $PSCmdlet.ShouldProcess(('{0}{1}（実行アカウント: {2}）' -f $TaskPath, $TaskName, $User), 'タスクを登録（既存なら上書き）')) {
    Write-Host '次の設定で登録します（今回は登録していません）:'
    Show-TaskSummary -Task (New-AgentTask -UserId $User) -RunAs $User -LogonLabel $logonLabel
    exit 0
}

if (-not (Test-IsAdministrator)) {
    Write-Warning '管理者として実行されていません。権限不足で登録に失敗した場合は「管理者として実行」で開き直してください'
}

# ---------------------------------------------------------------------------
# 登録
# ---------------------------------------------------------------------------

$registerParams = @{
    TaskName = $TaskName
    TaskPath = $TaskPath
    Force    = $true
}

if ($LogonMode -eq 'Password') {
    # パスワードは引数やファイルでは受け取らず、ここで対話的に入力する（コマンド履歴・ログに残さない）
    $credential = $null
    try {
        $credential = Get-Credential -UserName $User -Message 'タスクの実行アカウントのパスワードを入力してください（ファイルサーバを読めるアカウント）'
    } catch {
        $credential = $null
    }
    if (-not $credential) {
        Exit-WithError 'パスワードの入力が取り消されました（タスクは登録していません）'
    }
    $User = $credential.UserName
    $registerParams['User'] = $credential.UserName
    $registerParams['Password'] = $credential.GetNetworkCredential().Password
    $credential = $null
}
$registerParams['InputObject'] = New-AgentTask -UserId $User

$registerError = $null
try {
    Register-ScheduledTask @registerParams | Out-Null
} catch {
    $registerError = $_
} finally {
    # 平文のパスワードをできるだけ早く手放す
    $registerParams.Remove('Password')
}
if ($registerError) {
    $hint = Get-RegisterErrorHint -ErrorRecord $registerError -UserName $User
    if (-not $hint) { $hint = $registerError.Exception.Message }
    Exit-WithError ('タスクを登録できませんでした: {0}' -f $hint)
}

$registered = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskPath $TaskPath -TaskName $TaskName
Write-Host 'タスクを登録しました:'
Show-TaskSummary -Task $registered -RunAs $registered.Principal.UserId -LogonLabel $logonLabel -TaskInfo $info
Write-Host ("すぐに1回実行して確認するには: Start-ScheduledTask -TaskPath '{0}' -TaskName '{1}'" -f $TaskPath, $TaskName)
exit 0

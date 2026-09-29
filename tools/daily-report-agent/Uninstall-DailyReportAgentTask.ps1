<#
.SYNOPSIS
    Install-DailyReportAgentTask.ps1 で登録したタスク \ProductPlanner\DailyReportAgent を削除する（Issue #478）。

.DESCRIPTION
    タスクが無くてもエラーにしない。実行中であれば停止してから削除する。
    タスクを削除したあと \ProductPlanner\ フォルダが空になれば、フォルダも削除する。

    エージェントの config.json・状態ファイル（state\）・ログ（logs\）は削除しない。
    消す場合の手順は同じフォルダの README.md を参照。

.EXAMPLE
    .\Uninstall-DailyReportAgentTask.ps1

.EXAMPLE
    .\Uninstall-DailyReportAgentTask.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# 登録スクリプト（Install-DailyReportAgentTask.ps1）と揃えること
$TaskPath = '\ProductPlanner\'
$TaskName = 'DailyReportAgent'

function Exit-WithError {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Remove-EmptyTaskFolder {
    # ScheduledTasks モジュールにはフォルダを消すコマンドが無いため、Schedule.Service COM を使う。
    # 他のタスクが残っていれば消さない。失敗してもタスクの削除自体は済んでいるので警告に留める
    $folderName = $TaskPath.Trim('\')
    try {
        $service = New-Object -ComObject 'Schedule.Service'
        $service.Connect()
        $folder = $service.GetFolder($TaskPath.TrimEnd('\'))
        # GetTasks(1): 非表示のタスクも含める
        if ($folder.GetTasks(1).Count -eq 0 -and $folder.GetFolders(0).Count -eq 0) {
            $service.GetFolder('\').DeleteFolder($folderName, 0)
            Write-Host ('空になったフォルダ \{0}\ を削除しました' -f $folderName)
        }
    } catch {
        Write-Warning ('フォルダ \{0}\ を削除できませんでした（タスクは削除済みです）: {1}' -f $folderName, $_.Exception.Message)
    }
}

if (-not (Get-Command -Name Unregister-ScheduledTask -ErrorAction SilentlyContinue)) {
    Exit-WithError 'ScheduledTasks モジュールが使えません。Windows 10 / 11 の Windows PowerShell 5.1 で実行してください'
}

$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host ('タスク {0}{1} は登録されていません（何もしませんでした）' -f $TaskPath, $TaskName)
    exit 0
}

if (-not $PSCmdlet.ShouldProcess(('{0}{1}' -f $TaskPath, $TaskName), 'タスクを削除')) {
    exit 0
}

try {
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    }
    Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false
} catch {
    $ex = $_.Exception
    if ($ex.Message -match '0x80070005' -or ('0x{0:X8}' -f $ex.HResult) -eq '0x80070005' -or
        ($ex.PSObject.Properties['NativeErrorCode'] -and [string]$ex.NativeErrorCode -eq 'AccessDenied')) {
        Exit-WithError 'タスクを削除できませんでした: 権限が不足しています。PowerShell を「管理者として実行」で開き直して、もう一度実行してください'
    }
    Exit-WithError ('タスクを削除できませんでした: {0}' -f $ex.Message)
}
Write-Host ('タスク {0}{1} を削除しました' -f $TaskPath, $TaskName)

Remove-EmptyTaskFolder

Write-Host 'エージェントの config.json・state\・logs\ は残しています。不要なら README.md の手順で削除してください'
exit 0

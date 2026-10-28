/* frontend/src/app/schedule/page.tsx */
"use client"

import { useState, useMemo, useCallback, useEffect, useEffectEvent } from "react"
import { format, addDays, addWeeks, addMonths, startOfDay, endOfDay, startOfWeek, endOfWeek, parseISO, isValid } from "date-fns"
import { ja } from "date-fns/locale"
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ChevronsUpDown, Info, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { GanttChart } from "@/components/schedule/gantt-chart"
import { formatProgressComputedAt, ProgressLegend } from "@/components/schedule/progress-legend"
import { ScheduleDetailSheet } from "@/components/schedule/schedule-detail-sheet"
import { ScheduleEditDialog } from "@/components/schedule/schedule-edit-dialog"
import { SegmentedControl } from "@/components/schedule/segmented-control"
import { useProcessShiftPreview, useSchedules, useShiftProcess, useUpdateSchedule } from "@/hooks/use-schedules"
import { useOrderProgressList } from "@/hooks/use-daily-report-progress"
import { useLocalStorageState } from "@/hooks/use-local-storage-state"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useEquipmentGroups } from "@/lib/hooks/use-equipment-groups"
import { useCalendars } from "@/hooks/use-calendars"
import { buildScheduleDetail, type ScheduleSelection } from "@/lib/schedule-detail-utils"
import {
  DEFAULT_SCHEDULE_VIEW_PREFS,
  MAX_COLLAPSED_GROUP_IDS,
  SCHEDULE_VIEW_PREFS_STORAGE_KEY,
  parseScheduleViewPrefs,
  type ScheduleViewPrefs,
} from "@/lib/schedule-view-prefs"
import { SCHEDULE_EDITOR_ROLES } from "@/types/member"
import type { GanttViewMode, GroupByMode, Schedule } from "@/types/schedule"
import type { ProcessShiftTarget } from "@/types/schedule-shift"

const isSameShiftTarget = (a: ProcessShiftTarget | undefined, b: ProcessShiftTarget | null) =>
  !!a && !!b && a.orderId === b.orderId && a.processRoutingId === b.processRoutingId && a.workingDays === b.workingDays

/** 自動更新の間隔（現場ダッシュボード #440 と同じ5分） */
const REFETCH_INTERVAL_MS = 5 * 60 * 1000

/**
 * この幅以下（タブレット横向き 1180〜1366px 級）では、開いたときにサイドバーを閉じてガントの横幅を取る。
 * 画面を離れるときに元へ戻す
 */
const COLLAPSE_SIDEBAR_MAX_WIDTH_QUERY = "(max-width: 1366px)"

const GROUP_BY_OPTIONS = [
  { value: "order", label: "注文別" },
  { value: "equipment_group", label: "設備グループ別" },
  { value: "none", label: "フラット" },
] as const satisfies readonly { value: GroupByMode; label: string }[]

const VIEW_MODE_OPTIONS = [
  { value: "Day", label: "日" },
  { value: "Week", label: "週" },
  { value: "Month", label: "月" },
] as const satisfies readonly { value: GanttViewMode; label: string }[]

function useCollapseSidebarOnTablet() {
  const { open, setOpen } = useSidebar()
  const collapse = useEffectEvent(() => {
    if (!open || !window.matchMedia(COLLAPSE_SIDEBAR_MAX_WIDTH_QUERY).matches) return false
    setOpen(false)
    return true
  })
  const restore = useEffectEvent(() => setOpen(true))
  useEffect(() => {
    const collapsed = collapse()
    return () => {
      if (collapsed) restore()
    }
  }, [])
}

/**
 * スケジュール一覧画面
 * URL: /schedule
 */
export default function SchedulePage() {
  useCollapseSidebarOnTablet()

  // 状態管理。表示単位・期間・設備グループ・折りたたみは localStorage に覚える（Issue #581）
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())
  const [prefs, setPrefs] = useLocalStorageState<ScheduleViewPrefs>(
    SCHEDULE_VIEW_PREFS_STORAGE_KEY,
    DEFAULT_SCHEDULE_VIEW_PREFS,
    parseScheduleViewPrefs,
  )
  const { viewMode, groupBy } = prefs
  const updatePrefs = useCallback(
    (patch: Partial<ScheduleViewPrefs>) => setPrefs({ ...prefs, ...patch }),
    [prefs, setPrefs],
  )
  const [equipmentGroupOpen, setEquipmentGroupOpen] = useState(false)

  // 詳細シートで開いている工程・注文と、編集中のセグメント
  const [selection, setSelection] = useState<ScheduleSelection | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null)

  const updateSchedule = useUpdateSchedule()

  // 工程の前倒し・後ろ倒し（Issue #582）。ずらす量を変えるたびにプレビューし、確定で保存する。
  // 別の工程・注文を開いたら破棄する
  const [shiftDraft, setShiftDraft] = useState<ProcessShiftTarget | null>(null)
  const shiftPreview = useProcessShiftPreview()
  const shiftProcess = useShiftProcess()
  const activeShift =
    shiftDraft &&
    selection?.kind === "process" &&
    shiftDraft.orderId === selection.orderId &&
    shiftDraft.processRoutingId === selection.processRoutingId
      ? shiftDraft
      : null
  // 続けて押したときは、今の量のプレビューだけを使う
  const previewIsCurrent = isSameShiftTarget(shiftPreview.variables, activeShift)
  const shiftPreviewData = previewIsCurrent ? shiftPreview.data : undefined

  const discardShift = () => {
    setShiftDraft(null)
    shiftPreview.reset()
  }
  const handleSelect = (next: ScheduleSelection | null) => {
    setSelection(next)
    const sameProcess =
      next?.kind === "process" &&
      shiftDraft?.orderId === next.orderId &&
      shiftDraft.processRoutingId === next.processRoutingId
    if (!sameProcess) discardShift()
  }
  const handleShiftChange = (workingDays: number) => {
    if (selection?.kind !== "process") return
    if (workingDays === 0) {
      discardShift()
      return
    }
    const target = { orderId: selection.orderId, processRoutingId: selection.processRoutingId, workingDays }
    setShiftDraft(target)
    shiftPreview.mutate(target)
  }
  const handleShiftConfirm = () => {
    if (!activeShift) return
    shiftProcess.mutate(activeShift, { onSuccess: discardShift })
  }
  const { data: currentMember } = useCurrentMember()
  const canEdit = currentMember != null && SCHEDULE_EDITOR_ROLES.includes(currentMember.role)

  // 設備グループの取得
  const { data: equipmentGroups, isLoading: equipmentGroupsLoading, error: equipmentGroupsError } = useEquipmentGroups()
  // 覚えていた設備グループが削除されていたら「すべて」に戻す
  const equipmentGroupId =
    prefs.equipmentGroupId !== null &&
    (equipmentGroups === undefined || equipmentGroups.some((g) => g.id === prefs.equipmentGroupId))
      ? prefs.equipmentGroupId
      : undefined
  const collapsedGroupIds = useMemo(() => new Set(prefs.collapsedGroupIds), [prefs.collapsedGroupIds])

  // 表示モードに応じた日付範囲の計算
  const dateRange = useMemo(() => {
    let start: Date
    let end: Date

    switch (viewMode) {
      case "Day":
        // 前後1日を含む72時間分のデータをフェッチ
        start = startOfDay(addDays(currentDate, -1))
        end = endOfDay(addDays(currentDate, 1))
        break
      case "Week":
        start = startOfWeek(currentDate, { locale: ja })
        end = endOfWeek(currentDate, { locale: ja })
        break
      case "Month":
        // 当日を軸として前後15日（計31日）分のデータをフェッチ
        start = startOfDay(addDays(currentDate, -3))
        end = endOfDay(addDays(currentDate, 31))
        break
    }

    return {
      start_date: format(start, "yyyy-MM-dd"),
      end_date: format(end, "yyyy-MM-dd"),
    }
  }, [currentDate, viewMode])

  // スケジュールの取得。置きっぱなしのタブレットで古い計画を出し続けないよう自動更新する
  const schedulesQuery = useSchedules(
    { ...dateRange, equipment_group_id: equipmentGroupId },
    { refetchInterval: REFETCH_INTERVAL_MS },
  )
  const { data: schedules, isLoading: schedulesLoading, error: schedulesError } = schedulesQuery

  // 日報の実績による進捗（Issue #491）。表示中の受注をまとめて1リクエストで取得する
  const scheduleOrderIds = useMemo(
    () => (schedules ?? []).map((s) => s.order_id),
    [schedules],
  )
  const progressQuery = useOrderProgressList(scheduleOrderIds, { refetchInterval: REFETCH_INTERVAL_MS })
  const orderProgress = progressQuery.data
  const isRefreshError = schedulesQuery.isError || progressQuery.isError
  const lastUpdatedAt = schedulesQuery.dataUpdatedAt ? new Date(schedulesQuery.dataUpdatedAt) : null
  const handleRefresh = () => {
    void schedulesQuery.refetch()
    if (scheduleOrderIds.length > 0) void progressQuery.refetch()
  }

  // 遅れの判定の「今」。ガントと同じく進捗を取り直したときに更新する
  // eslint-disable-next-line react-hooks/exhaustive-deps -- orderProgress は「今」を取り直す合図（値は使わない）
  const now = useMemo(() => new Date(), [orderProgress])
  const detail = useMemo(
    () => buildScheduleDetail(selection, schedules, orderProgress?.items, now),
    [selection, schedules, orderProgress, now],
  )

  // 週次表示用カレンダーデータ（月跨ぎ対応のため2ヶ月分を取得）
  const weekStart = useMemo(() => startOfWeek(currentDate, { locale: ja }), [currentDate])
  const weekEnd = useMemo(() => endOfWeek(currentDate, { locale: ja }), [currentDate])

  const { data: calMonth1 } = useCalendars(weekStart.getFullYear(), weekStart.getMonth() + 1)
  const { data: calMonth2 } = useCalendars(weekEnd.getFullYear(), weekEnd.getMonth() + 1)

  // 非稼働日（祝日＋土日）を計算（週次モードのみ利用）
  const nonWorkingDays = useMemo<Date[]>(() => {
    const result: Date[] = []

    // カレンダーデータから祝日を抽出（重複排除のため Set を使用）
    const holidayKeys = new Set<string>()
    const allCalDays = [...(calMonth1 ?? []), ...(calMonth2 ?? [])]
    allCalDays.forEach((entry) => {
      if (entry.is_holiday && !holidayKeys.has(entry.date)) {
        holidayKeys.add(entry.date)
        result.push(parseISO(entry.date))
      }
    })

    // 当週の土日を追加
    const cur = new Date(weekStart)
    while (cur.getTime() <= weekEnd.getTime()) {
      const day = cur.getDay()
      if (day === 0 || day === 6) {
        result.push(new Date(cur))
      }
      cur.setDate(cur.getDate() + 1)
    }

    return result
  }, [calMonth1, calMonth2, weekStart, weekEnd])

  // 前の期間に移動
  const handlePrevious = useCallback(() => {
    setCurrentDate((prev) => {
      switch (viewMode) {
        case "Day":
          return addDays(prev, -1)
        case "Week":
          return addWeeks(prev, -1)
        case "Month":
          return addMonths(prev, -1)
        default:
          return prev
      }
    })
  }, [viewMode])

  // 次の期間に移動
  const handleNext = useCallback(() => {
    setCurrentDate((prev) => {
      switch (viewMode) {
        case "Day":
          return addDays(prev, 1)
        case "Week":
          return addWeeks(prev, 1)
        case "Month":
          return addMonths(prev, 1)
        default:
          return prev
      }
    })
  }, [viewMode])

  // 今日に戻る
  const handleToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  // カレンダーから選んだ日へ移動する（日付のみの値は parseISO でローカル深夜として読む）
  const handleJumpToDate = useCallback((value: string) => {
    const date = parseISO(value)
    if (isValid(date)) setCurrentDate(date)
  }, [])

  // 編集モーダルの保存ハンドラ
  const handleSave = useCallback(
    (scheduleId: number, startDatetime: string, endDatetime: string) => {
      updateSchedule.mutate(
        { scheduleId, data: { start_datetime: startDatetime, end_datetime: endDatetime } },
        { onSuccess: () => setEditingSchedule(null) },
      )
    },
    [updateSchedule],
  )

  // 表示期間のフォーマット
  const displayPeriod = useMemo(() => {
    switch (viewMode) {
      case "Day":
        return format(currentDate, "yyyy年M月d日 (E)", { locale: ja })
      case "Week":
        return `${format(weekStart, "yyyy年M月d", { locale: ja })} - ${format(weekEnd, "M月d日", { locale: ja })}`
      case "Month":
        return format(currentDate, "yyyy年M月", { locale: ja })
    }
  }, [currentDate, viewMode, weekStart, weekEnd])

  const equipmentGroupLabel =
    equipmentGroupId !== undefined
      ? (equipmentGroups?.find((g) => g.id === equipmentGroupId)?.name ?? "すべて")
      : "すべて"

  return (
    // 高さ = 画面 − レイアウトのヘッダー(3.75rem) − 上下余白(3rem)。ページ全体はスクロールさせず、ガントの中だけで動かす
    <div className="flex h-[calc(100dvh-6.75rem)] min-w-0 flex-col">
      {/* 画面名はレイアウトのヘッダーに出ている。タブレットで縦の高さを取るため見出しは読み上げ用だけにする */}
      <h1 className="sr-only">生産スケジュール</h1>

      {/* ツールバー。タップ目標は 44px（h-11）以上（Issue #581） */}
      <div className="mb-3 flex shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* 期間操作 */}
          <Button variant="outline" className="h-11 px-5" onClick={handleToday}>
            今日
          </Button>
          <Button variant="outline" className="h-11 px-3" onClick={handlePrevious} aria-label="前の期間">
            <ChevronLeft className="h-5 w-5" />
            前へ
          </Button>
          <div className="min-w-[190px] text-center text-lg font-semibold">{displayPeriod}</div>
          <Button variant="outline" className="h-11 px-3" onClick={handleNext} aria-label="次の期間">
            次へ
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Input
            type="date"
            aria-label="日付へ移動"
            className="h-11 w-[170px]"
            value={format(currentDate, "yyyy-MM-dd")}
            onChange={(e) => {
              if (e.target.value) handleJumpToDate(e.target.value)
            }}
          />

          {/* 最終更新（置きっぱなしでも、更新が止まっていることに気づけるようにする） */}
          <div className="ml-auto flex items-center gap-2" aria-live="polite">
            {/* 日報の進捗の計算時刻。凡例を閉じていても見えるようここに出す（Issue #589） */}
            {orderProgress?.computed_at && (
              <span className="text-sm text-muted-foreground">{formatProgressComputedAt(orderProgress.computed_at)} ・</span>
            )}
            {isRefreshError ? (
              <span className="flex items-center gap-1 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                取得に失敗しました
                {lastUpdatedAt && `（最終更新 ${format(lastUpdatedAt, "HH:mm:ss")}）`}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                最終更新 {lastUpdatedAt ? format(lastUpdatedAt, "HH:mm:ss") : "取得中..."}
              </span>
            )}
            <Button
              variant="outline"
              className="h-11 px-3"
              onClick={handleRefresh}
              disabled={schedulesQuery.isFetching}
              aria-label="最新の情報に更新"
            >
              <RefreshCw className={cn("h-5 w-5", schedulesQuery.isFetching && "animate-spin")} />
              更新
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">表示単位</span>
            <SegmentedControl
              label="表示単位"
              options={GROUP_BY_OPTIONS}
              value={groupBy}
              onChange={(value) => updatePrefs({ groupBy: value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">期間</span>
            <SegmentedControl
              label="期間"
              options={VIEW_MODE_OPTIONS}
              value={viewMode}
              onChange={(value) => updatePrefs({ viewMode: value })}
            />
          </div>

          {/* 設備グループは件数が増えうるので検索付きコンボボックスのまま（CLAUDE.md） */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">設備グループ</span>
            <Popover open={equipmentGroupOpen} onOpenChange={setEquipmentGroupOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={equipmentGroupOpen}
                  aria-label="設備グループ選択"
                  disabled={equipmentGroupsLoading}
                  className="h-11 w-[220px] justify-between"
                >
                  <span className="truncate">{equipmentGroupLabel}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-0">
                <Command>
                  <CommandInput placeholder="設備グループを検索..." className="h-11" />
                  <CommandList>
                    <CommandEmpty>見つかりません</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="all"
                        className="min-h-11"
                        onSelect={() => {
                          updatePrefs({ equipmentGroupId: null })
                          setEquipmentGroupOpen(false)
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", equipmentGroupId === undefined ? "opacity-100" : "opacity-0")} />
                        すべて
                      </CommandItem>
                      {equipmentGroups?.map((group) => (
                        <CommandItem
                          key={group.id}
                          value={group.name}
                          className="min-h-11"
                          onSelect={() => {
                            updatePrefs({ equipmentGroupId: group.id })
                            setEquipmentGroupOpen(false)
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", equipmentGroupId === group.id ? "opacity-100" : "opacity-0")} />
                          {group.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* 凡例の開閉（Issue #589）。タブレットでホバーに頼らず1回のタップで開閉する */}
          <div className="ml-auto">
            <Button
              variant={prefs.legendOpen ? "secondary" : "outline"}
              className="h-11 px-3"
              aria-expanded={prefs.legendOpen}
              aria-controls="schedule-legend"
              onClick={() => updatePrefs({ legendOpen: !prefs.legendOpen })}
            >
              <Info className="h-5 w-5" />
              凡例
            </Button>
          </div>
        </div>
      </div>

      {/*
        状態の凡例（日報の進捗を一度でも計算したテナントは全状態、未計算なら「計画のみ」だけ）。
        ポップオーバーにしない: パネルの外をタップすると閉じるので、ガントの行を触ると凡例と見比べられず、先頭の行も隠す
      */}
      {prefs.legendOpen && (
        <div
          id="schedule-legend"
          role="region"
          aria-label="凡例"
          className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border bg-card py-1 pl-3 pr-1"
        >
          <ProgressLegend computedAt={orderProgress?.computed_at} />
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label="凡例を閉じる"
            onClick={() => updatePrefs({ legendOpen: false })}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      )}

      {/* メインエリア - ガントチャートと、右に並べる詳細シート（ガントを隠さない） */}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-card shadow-sm">
          {schedulesError && !schedules ? (
            <div className="flex h-96 items-center justify-center">
              <div className="text-center text-destructive">
                <p>スケジュールの読み込みに失敗しました</p>
                <p className="text-sm text-muted-foreground mt-2">{schedulesError.message}</p>
              </div>
            </div>
          ) : equipmentGroupsError ? (
            <div className="flex h-96 items-center justify-center">
              <div className="text-center text-destructive">
                <p>設備グループの読み込みに失敗しました</p>
                <p className="text-sm text-muted-foreground mt-2">{equipmentGroupsError.message}</p>
              </div>
            </div>
          ) : schedulesLoading ? (
            <div className="flex h-96 items-center justify-center">
              <div className="text-center">
                <div className="text-lg text-muted-foreground">読み込み中...</div>
              </div>
            </div>
          ) : schedules && schedules.length > 0 ? (
            <GanttChart
              tasks={schedules}
              viewMode={viewMode}
              colorMode="product"
              groupBy={groupBy}
              currentDate={currentDate}
              nonWorkingDays={nonWorkingDays}
              selection={detail ? selection : null}
              onSelect={handleSelect}
              collapsedGroupIds={collapsedGroupIds}
              onCollapsedGroupIdsChange={(ids) =>
                updatePrefs({ collapsedGroupIds: Array.from(ids).slice(-MAX_COLLAPSED_GROUP_IDS) })
              }
              progress={orderProgress?.items}
              shiftPreview={shiftPreviewData}
            />
          ) : (
            <div className="flex h-96 items-center justify-center">
              <div className="text-center text-muted-foreground">
                <p>選択された期間のスケジュールがありません</p>
              </div>
            </div>
          )}
        </div>

        {/* 詳細シート。開いている工程・注文が表示中の期間に無くなったら閉じる */}
        {detail && (
          <ScheduleDetailSheet
            detail={detail}
            now={now}
            canEdit={canEdit}
            onClose={() => handleSelect(null)}
            onSelect={handleSelect}
            onEditSegment={setEditingSchedule}
            shift={{
              workingDays: activeShift?.workingDays ?? 0,
              preview: shiftPreviewData,
              isPreviewLoading: previewIsCurrent && shiftPreview.isPending,
              previewError: previewIsCurrent ? shiftPreview.error : null,
              isSaving: shiftProcess.isPending,
              onChange: handleShiftChange,
              onCancel: discardShift,
              onConfirm: handleShiftConfirm,
            }}
          />
        )}
      </div>

      {/* スケジュール編集モーダル（詳細シートの「操作」から開く。編集できるロールだけ） */}
      <ScheduleEditDialog
        key={editingSchedule?.id ?? "none"}
        schedule={editingSchedule}
        open={editingSchedule !== null}
        onOpenChange={(open) => {
          if (!open) setEditingSchedule(null)
        }}
        onSave={handleSave}
        isSaving={updateSchedule.isPending}
      />
    </div>
  )
}

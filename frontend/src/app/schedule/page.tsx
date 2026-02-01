/* frontend/src/app/schedule/page.tsx */
"use client"

import { useState, useMemo, useCallback } from "react"
import { format, addDays, addWeeks, addMonths, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns"
import { ja } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GanttChart } from "@/components/schedule/gantt-chart"
import { useSchedules } from "@/hooks/use-schedules"
import { useEquipmentGroups } from "@/lib/hooks/use-equipment-groups"
import type { GanttViewMode, GroupByMode } from "@/types/schedule"
import { useSidebar } from "@/components/ui/sidebar"

/**
 * スケジュール一覧画面
 * URL: /schedule
 */
export default function SchedulePage() {
  // 状態管理
  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [viewMode, setViewMode] = useState<GanttViewMode>("Day")
  const [equipmentGroupId, setEquipmentGroupId] = useState<number | undefined>(undefined)
  const [isEditMode, setIsEditMode] = useState<boolean>(false)
  const [groupBy, setGroupBy] = useState<GroupByMode>("none")

  // state は "expanded" | "collapsed" | "mobile" などを返す
  const { state, open } = useSidebar()

  // 設備グループの取得
  const { data: equipmentGroups, isLoading: equipmentGroupsLoading, error: equipmentGroupsError } = useEquipmentGroups()

  // 表示モードに応じた日付範囲の計算
  const dateRange = useMemo(() => {
    let start: Date
    let end: Date

    switch (viewMode) {
      case "Day":
        start = startOfDay(currentDate)
        end = endOfDay(currentDate)
        break
      case "Week":
        start = startOfWeek(currentDate, { locale: ja })
        end = endOfWeek(currentDate, { locale: ja })
        break
      case "Month":
        start = startOfMonth(currentDate)
        end = endOfMonth(currentDate)
        break
    }

    return {
      start_date: format(start, "yyyy-MM-dd"),
      end_date: format(end, "yyyy-MM-dd"),
    }
  }, [currentDate, viewMode])

  // スケジュールの取得
  const { data: schedules, isLoading: schedulesLoading, error: schedulesError } = useSchedules({
    ...dateRange,
    equipment_group_id: equipmentGroupId,
  })

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

  // 表示期間のフォーマット
  const displayPeriod = useMemo(() => {
    switch (viewMode) {
      case "Day":
        return format(currentDate, "yyyy年M月d日 (E)", { locale: ja })
      case "Week":
        const weekStart = startOfWeek(currentDate, { locale: ja })
        const weekEnd = endOfWeek(currentDate, { locale: ja })
        return `${format(weekStart, "yyyy年M月d", { locale: ja })} - ${format(weekEnd, "M月d日", { locale: ja })}`
      case "Month":
        return format(currentDate, "yyyy年M月", { locale: ja })
    }
  }, [currentDate, viewMode])

  const viewWidth = open ? '78vw' : '96vw'

  return (
    <div className="flex-2 py-6 px-4">
      <div className="flex-2-1 gap-4 py-">
        {/* ヘッダーエリア */}
        <div className="mb-6" style={{ width: viewWidth }}>
          <h1 className="text-3xl font-bold mb-4">生産スケジュール</h1>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* 期間操作 */}
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleToday}>
                今日
              </Button>
              <Button variant="outline" onClick={handlePrevious}>
                &lt; 前へ
              </Button>
              <div className="text-lg font-semibold min-w-[200px] text-center">
                {displayPeriod}
              </div>
              <Button variant="outline" onClick={handleNext}>
                次へ &gt;
              </Button>
              {/* 編集モード切替 */}
              <Button
                variant={isEditMode ? "default" : "outline"}
                onClick={() => setIsEditMode(!isEditMode)}
                style={{ minWidth: '100px' }}
              >
                {isEditMode ? "編集中" : "編集モード"}
              </Button>
            </div>
          </div>

          {/* 右側のコントロール */}
          <div className="flex items-center gap-4 mt-4">
            {/* グルーピングモード切替 */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">表示単位:</span>
              <Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupByMode)}>
                <SelectTrigger className="w-[160px]" aria-label="グルーピングモード選択">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">フラット表示</SelectItem>
                  <SelectItem value="order">オーダー別</SelectItem>
                  <SelectItem value="equipment_group">設備グループ別</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 表示モード切替 */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">期間:</span>
              <Select value={viewMode} onValueChange={(value) => setViewMode(value as GanttViewMode)}>
                <SelectTrigger className="w-[120px]" aria-label="表示モード選択">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Day">日次</SelectItem>
                  <SelectItem value="Week">週次</SelectItem>
                  <SelectItem value="Month">月次</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 設備グループフィルタ */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">設備グループ:</span>
              <Select
                value={equipmentGroupId?.toString() ?? "all"}
                onValueChange={(value) => setEquipmentGroupId(value === "all" ? undefined : Number(value))}
                disabled={equipmentGroupsLoading}
              >
                <SelectTrigger className="w-[180px]" aria-label="設備グループ選択">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  {equipmentGroups?.map((group) => (
                    <SelectItem key={group.id} value={group.id.toString()}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* メインエリア - ガントチャート */}
      <div
        className="rounded-lg border bg-card shadow-sm p-4"
        style={{ overflowX: 'auto', overflowY: 'hidden', width: viewWidth }}
      >
        {schedulesError ? (
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
          <GanttChart tasks={schedules} viewMode={viewMode} colorMode="product" isEditable={isEditMode} groupBy={groupBy} />
        ) : (
          <div className="flex h-96 items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p>選択された期間のスケジュールがありません</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

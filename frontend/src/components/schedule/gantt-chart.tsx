/* frontend/src/components/schedule/gantt-chart.tsx */
"use client"

import React, { useMemo } from "react"
import { Gantt, Task, ViewMode } from "gantt-task-react"
import "gantt-task-react/dist/index.css"
import { Schedule, GanttViewMode, GroupByMode } from "@/types/schedule"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { useUpdateSchedule } from "@/hooks/use-schedules"
import { toast } from "sonner"

/**
 * ガントチャートコンポーネントのProps
 */
export interface GanttChartProps {
  /**
   * スケジュールデータの配列
   */
  tasks: Schedule[]
  /**
   * 表示モード (Day/Week/Month)
   */
  viewMode?: GanttViewMode
  /**
   * カラーモード: 'product' (製品ごとに色分け) または 'process' (工程ごとに色分け)
   */
  colorMode?: 'product' | 'process'
  /**
   * 編集可能かどうか
   */
  isEditable?: boolean
  /**
   * グルーピングモード: 'none' (フラット表示) | 'order' (オーダー別) | 'equipment_group' (設備グループ別)
   */
  groupBy?: GroupByMode
}

/**
 * Schedule型からガントチャートのTask型に変換するユーティリティ関数
 */
export function convertScheduleToTask(
  schedule: Schedule,
  colorMode: 'product' | 'process' = 'product',
  isEditable = false
): Task {
  const startDate = new Date(schedule.start_datetime)
  const endDate = new Date(schedule.end_datetime)

  // カラーモードに応じて色を決定
  const backgroundColor = getBarColor(schedule, colorMode)

  // 顧客名を名前に含める（区切り文字として ||| を使用）
  // Note: 顧客名に ||| が含まれる可能性は極めて低いため、このシンプルな方法を採用
  const customerPart = schedule.customer_name ? `|||${schedule.customer_name}` : ''

  return {
    id: `schedule-${schedule.id}`,
    type: 'task',
    name: `${schedule.process_name || '工程'} - ${schedule.order_number || ''}${customerPart}`,
    start: startDate,
    end: endDate,
    progress: 100, // 完了済みとして表示
    isDisabled: !isEditable, // 編集可能フラグ
    styles: {
      backgroundColor,
      backgroundSelectedColor: backgroundColor,
      progressColor: backgroundColor,
      progressSelectedColor: backgroundColor,
    },
  }
}

/**
 * スケジュールに基づいてバーの色を決定する
 */
function getBarColor(schedule: Schedule, colorMode: 'product' | 'process'): string {
  if (colorMode === 'product') {
    // 製品名に基づいて色を決定（ハッシュから生成）
    const productName = schedule.product_name || 'default'
    // シンプルなハッシュ関数で製品名から色を生成
    const hash = productName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const hue = hash % 360
    return `hsl(${hue}, 70%, 50%)`
  } else {
    // 工程名に基づいて色を決定
    const processColors: Record<string, string> = {
      '切削': '#ef4444', // red-500
      '組立': '#3b82f6', // blue-500
      '検査': '#10b981', // green-500
      '塗装': '#f59e0b', // amber-500
      '梱包': '#8b5cf6', // violet-500
      default: '#6b7280', // gray-500
    }

    const processName = schedule.process_name || 'default'
    return processColors[processName] || processColors.default
  }
}

/**
 * カスタムツールチップコンポーネント
 */
function CustomTooltip({ task, fontSize, fontFamily }: {
  task: Task
  fontSize: string
  fontFamily: string
}) {
  // taskのnameからスケジュール情報を取得するため、元のScheduleオブジェクトを保持する方法が必要
  // ここでは簡易的にtask.nameから情報を抽出
  const nameParts = task.name.split('|||')
  const mainPart = nameParts[0] || ''
  const customerName = nameParts[1] || null
  const [processName, orderNumber] = mainPart.split(' - ')

  return (
    <div
      style={{
        fontFamily,
        fontSize,
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        padding: '8px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        minWidth: '200px',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
        {processName}
      </div>
      {orderNumber && (
        <div style={{ fontSize: '0.875em', color: '#666', marginBottom: '2px' }}>
          注文番号: {orderNumber}
        </div>
      )}
      {customerName && (
        <div style={{ fontSize: '0.875em', color: '#666', marginBottom: '2px' }}>
          顧客: {customerName}
        </div>
      )}
      <div style={{ fontSize: '0.875em', color: '#666' }}>
        開始: {format(task.start, 'MM/dd HH:mm', { locale: ja })}
      </div>
      <div style={{ fontSize: '0.875em', color: '#666' }}>
        終了: {format(task.end, 'MM/dd HH:mm', { locale: ja })}
      </div>
    </div>
  )
}

/**
 * スケジュールをグルーピングモードに応じてガントチャートのTask型に変換する
 */
function transformSchedulesToGroupedTasks(
  schedules: Schedule[],
  groupBy: GroupByMode,
  colorMode: 'product' | 'process',
  isEditable: boolean
): Task[] {
  if (groupBy === 'none') {
    // フラット表示: そのまま変換
    return schedules.map((schedule) => convertScheduleToTask(schedule, colorMode, isEditable))
  }

  const tasks: Task[] = []

  if (groupBy === 'order') {
    // オーダー単位でグルーピング
    const orderGroups = new Map<string, Schedule[]>()
    
    schedules.forEach((schedule) => {
      const orderKey = schedule.order_number || 'Unknown'
      if (!orderGroups.has(orderKey)) {
        orderGroups.set(orderKey, [])
      }
      const group = orderGroups.get(orderKey)
      if (group) {
        group.push(schedule)
      }
    })

    // 各オーダーごとにプロジェクトタスクと子タスクを作成
    orderGroups.forEach((orderSchedules, orderNumber) => {
      // 開始日時・終了日時の計算
      const dates = orderSchedules.map(s => ({
        start: new Date(s.start_datetime),
        end: new Date(s.end_datetime)
      }))
      const minStart = new Date(Math.min(...dates.map(d => d.start.getTime())))
      const maxEnd = new Date(Math.max(...dates.map(d => d.end.getTime())))

      // 製品名（最初のスケジュールから取得）
      const productName = orderSchedules[0]?.product_name || ''

      // 親タスク（プロジェクト）
      tasks.push({
        id: `order-${orderNumber}`,
        type: 'project',
        name: `注文: ${orderNumber} - ${productName}`,
        start: minStart,
        end: maxEnd,
        progress: 100,
        isDisabled: true,
        hideChildren: false,
      })

      // 子タスク
      orderSchedules.forEach((schedule) => {
        tasks.push({
          ...convertScheduleToTask(schedule, colorMode, isEditable),
          project: `order-${orderNumber}`,
        })
      })
    })
  } else if (groupBy === 'equipment_group') {
    // 設備グループ単位でグルーピング
    const groupMap = new Map<string, Schedule[]>()
    
    schedules.forEach((schedule) => {
      const groupKey = schedule.equipment_group_name || '未分類'
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, [])
      }
      const group = groupMap.get(groupKey)
      if (group) {
        group.push(schedule)
      }
    })

    // 各設備グループごとにプロジェクトタスクと子タスクを作成
    groupMap.forEach((groupSchedules, groupName) => {
      // 開始日時・終了日時の計算
      const dates = groupSchedules.map(s => ({
        start: new Date(s.start_datetime),
        end: new Date(s.end_datetime)
      }))
      const minStart = new Date(Math.min(...dates.map(d => d.start.getTime())))
      const maxEnd = new Date(Math.max(...dates.map(d => d.end.getTime())))

      // 親タスク（プロジェクト）
      tasks.push({
        id: `group-${groupName}`,
        type: 'project',
        name: `設備グループ: ${groupName}`,
        start: minStart,
        end: maxEnd,
        progress: 100,
        isDisabled: true,
        hideChildren: false,
      })

      // 子タスク
      groupSchedules.forEach((schedule) => {
        tasks.push({
          ...convertScheduleToTask(schedule, colorMode, isEditable),
          project: `group-${groupName}`,
        })
      })
    })
  }

  return tasks
}

/**
 * ガントチャート表示コンポーネント
 * 
 * バックエンドから取得したスケジュールデータを視覚的に表示します。
 * gantt-task-react ライブラリを使用しています。
 */
export function GanttChart({
  tasks,
  viewMode = ViewMode.Day,
  colorMode = 'product',
  isEditable = false,
  groupBy = 'none',
}: GanttChartProps) {
  const updateSchedule = useUpdateSchedule()

  // Schedule型からTask型に変換（グルーピングに対応）
  const ganttTasks: Task[] = useMemo(() => {
    return transformSchedulesToGroupedTasks(tasks, groupBy, colorMode, isEditable)
  }, [tasks, groupBy, colorMode, isEditable])

  // ViewModeの変換
  const ganttViewMode = useMemo(() => {
    const viewModeMap: Record<GanttViewMode, ViewMode> = {
      Day: ViewMode.Day,
      Week: ViewMode.Week,
      Month: ViewMode.Month,
    }
    return viewModeMap[viewMode]
  }, [viewMode])

  /**
   * 日時変更のハンドラ（ドラッグ&ドロップ時に呼ばれる）
   */
  const handleDateChange = async (task: Task, _children: Task[]): Promise<void | boolean> => {
    if (!isEditable) return

    // タスクIDから元のスケジュールを取得 (schedule-{id}の形式から抽出)
    const scheduleId = Number(task.id.replace('schedule-', ''))
    
    // タスクIDの検証
    if (isNaN(scheduleId) || scheduleId <= 0) {
      toast.error("無効なスケジュールIDです")
      return false
    }

    try {
      // ISO 8601形式に変換
      const startDatetime = task.start.toISOString()
      const endDatetime = task.end.toISOString()

      // API呼び出し
      await updateSchedule.mutateAsync({
        scheduleId,
        data: {
          start_datetime: startDatetime,
          end_datetime: endDatetime,
        },
      })

      // 成功は mutation の onSuccess で処理されるため、ここでは何もしない
    } catch (error) {
      toast.error("スケジュールの更新に失敗しました")
      console.error("Failed to update schedule:", error)
      // エラーの場合は操作を元に戻すため false を返す
      return false
    }
  }

  if (ganttTasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>スケジュールデータがありません</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <Gantt
        tasks={ganttTasks}
        viewMode={ganttViewMode}
        locale="ja"
        TooltipContent={CustomTooltip}
        columnWidth={viewMode === 'Day' ? 60 : viewMode === 'Week' ? 200 : 300}
        listCellWidth=""
        rowHeight={50}
        onDateChange={isEditable ? handleDateChange as ((task: Task, children: Task[]) => void | boolean | Promise<void> | Promise<boolean>) : undefined}
      />
    </div>
  )
}

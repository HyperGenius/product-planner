/* frontend/src/components/schedule/schedule-edit-dialog.tsx */
'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Schedule } from '@/types/schedule'

/**
 * ローカルのdatetime-local入力用フォーマット (YYYY-MM-DDTHH:mm)
 */
function toLocalDatetimeValue(isoString: string): string {
  const d = new Date(isoString)
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

export interface ScheduleEditDialogProps {
  /** 編集対象のスケジュール（nullの場合はモーダル非表示） */
  schedule: Schedule | null
  /** モーダルの開閉状態 */
  open: boolean
  /** モーダルを閉じる際のコールバック */
  onOpenChange: (open: boolean) => void
  /** 保存ボタン押下時のコールバック */
  onSave: (scheduleId: number, startDatetime: string, endDatetime: string) => void
  /** 保存処理中かどうか */
  isSaving?: boolean
}

/**
 * スケジュール編集モーダル
 *
 * ガントチャート上のタスクバーをクリックした際に開き、
 * 開始・終了日時を変更して保存できる。
 */
export function ScheduleEditDialog({
  schedule,
  open,
  onOpenChange,
  onSave,
  isSaving = false,
}: ScheduleEditDialogProps) {
  // 選択タスクが変わるたびに key 経由でコンポーネントごと再マウントされるため、
  // 初期値は useState の初期化関数でそのまま計算できる (エフェクト不要)
  const [startValue, setStartValue] = useState(() =>
    schedule ? toLocalDatetimeValue(schedule.start_datetime) : ''
  )
  const [endValue, setEndValue] = useState(() =>
    schedule ? toLocalDatetimeValue(schedule.end_datetime) : ''
  )
  const [initialStart] = useState(() =>
    schedule ? toLocalDatetimeValue(schedule.start_datetime) : ''
  )
  const [initialEnd] = useState(() =>
    schedule ? toLocalDatetimeValue(schedule.end_datetime) : ''
  )

  const handleSave = () => {
    if (!schedule) return
    const start = new Date(startValue)
    const end = new Date(endValue)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return
    // datetime-local の値をISO 8601形式に変換
    onSave(schedule.id, start.toISOString(), end.toISOString())
  }

  const isValidRange =
    !!startValue &&
    !!endValue &&
    !isNaN(new Date(startValue).getTime()) &&
    !isNaN(new Date(endValue).getTime()) &&
    new Date(startValue) < new Date(endValue)

  // 初期値から変更があるかどうか（未変更の場合は保存不要）
  const isDirty = startValue !== initialStart || endValue !== initialEnd

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>スケジュール編集</DialogTitle>
          <DialogDescription>対象スケジュールの日時を変更できます。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* 参照情報（読み取り専用） */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <div>
              <span className="font-medium text-muted-foreground">製品名</span>
              <p className="mt-0.5 truncate">{schedule?.product_name || '—'}</p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">顧客名</span>
              <p className="mt-0.5 truncate">{schedule?.customer_name || '—'}</p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">注文番号</span>
              <p className="mt-0.5 truncate">{schedule?.order_number || '—'}</p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">工程名</span>
              <p className="mt-0.5 truncate">{schedule?.process_name || '—'}</p>
            </div>
            <div className="col-span-2">
              <span className="font-medium text-muted-foreground">設備グループ名</span>
              <p className="mt-0.5 truncate">{schedule?.equipment_group_name || '—'}</p>
            </div>
          </div>

          {/* 編集フィールド */}
          <div className="grid gap-2">
            <Label htmlFor="start-datetime">開始日時</Label>
            <Input
              id="start-datetime"
              type="datetime-local"
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="end-datetime">終了日時</Label>
            <Input
              id="end-datetime"
              type="datetime-local"
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            キャンセル
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={isSaving || !isValidRange || !isDirty}
          >
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

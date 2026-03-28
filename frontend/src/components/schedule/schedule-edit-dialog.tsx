/* frontend/src/components/schedule/schedule-edit-dialog.tsx */
'use client'

import { useState, useEffect } from 'react'
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
  const [startValue, setStartValue] = useState('')
  const [endValue, setEndValue] = useState('')

  // 選択タスクが変わったらフォームの初期値をリセット
  useEffect(() => {
    if (schedule) {
      setStartValue(toLocalDatetimeValue(schedule.start_datetime))
      setEndValue(toLocalDatetimeValue(schedule.end_datetime))
    }
  }, [schedule])

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>スケジュール編集</DialogTitle>
          <DialogDescription>
            {schedule
              ? `${schedule.process_name || '工程'} - ${schedule.order_number || ''}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !isValidRange}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { processShiftErrorMessage } from '@/hooks/use-schedules'
import { formatDateTime, formatRange, MAX_SHIFT_WORKING_DAYS } from '@/lib/schedule-detail-utils'
import type { ProcessShiftResult, ShiftedProcess } from '@/types/schedule-shift'

export interface ProcessShiftControlsProps {
  /** ずらす稼働日（負は前倒し、0 はプレビューなし） */
  workingDays: number
  /** 今の workingDays のプレビュー（取得中・失敗は undefined） */
  preview: ProcessShiftResult | undefined
  isPreviewLoading: boolean
  previewError: unknown
  isSaving: boolean
  onChange: (workingDays: number) => void
  onCancel: () => void
  onConfirm: () => void
}

/** 日付のみの値（YYYY-MM-DD）。parseISO でローカル深夜として読む */
function formatDateOnly(value: string | null): string {
  return value ? format(parseISO(value), 'M/d (E)', { locale: ja }) : '－'
}

export function formatShiftAmount(workingDays: number): string {
  if (workingDays === 0) return '±0日'
  return workingDays > 0 ? `+${workingDays}日` : `−${-workingDays}日`
}

function processRange(process: ShiftedProcess, which: 'before' | 'after'): string {
  const range = process[which]
  const start = new Date(range.start_datetime)
  return process.is_milestone ? formatDateTime(start) : formatRange(start, new Date(range.end_datetime))
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ShiftWarnings({ preview }: { preview: ProcessShiftResult }) {
  const completed = preview.processes.filter((p) => p.is_completed)
  return (
    <>
      {preview.stopped_at_previous && (
        <Warning>前の工程の終了で止まりました。これ以上は前倒しできません。</Warning>
      )}
      {preview.exceeds_desired_deadline && (
        <Warning>
          完成見込みが希望納期（{formatDateOnly(preview.desired_deadline)}）を超えます。
        </Warning>
      )}
      {completed.length > 0 && (
        <Warning>
          日報で完了済みの工程も動きます（{completed.map((p) => p.process_name || '工程').join('、')}）。
        </Warning>
      )}
      {preview.overlaps.length > 0 && (
        <Warning>
          <p>同じ設備の他の注文と重なります（保存はできます）。</p>
          <ul className="mt-1 space-y-0.5">
            {preview.overlaps.map((o) => (
              <li key={`${o.process_routing_id}-${o.other_order_id}-${o.start_datetime}`}>
                {o.equipment_name || '設備'}: {o.other_order_number || `注文 ${o.other_order_id}`}
                {o.other_process_name ? `（${o.other_process_name}）` : ''}{' '}
                {formatRange(new Date(o.start_datetime), new Date(o.end_datetime))}
              </li>
            ))}
          </ul>
        </Warning>
      )}
    </>
  )
}

function ShiftPreviewBody({ preview }: { preview: ProcessShiftResult }) {
  return (
    <div className="space-y-2">
      <ShiftWarnings preview={preview} />
      <ul className="space-y-1.5" aria-label="ずらした後の計画">
        {preview.processes.map((p) => (
          <li key={p.process_routing_id} className="rounded-md border px-2.5 py-1.5 text-sm">
            <p className="font-medium">{p.process_name || '工程'}</p>
            <p className="text-xs text-muted-foreground tabular-nums line-through">{processRange(p, 'before')}</p>
            <p className="tabular-nums">{processRange(p, 'after')}</p>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 text-sm">
        <dt className="text-muted-foreground">完成見込み</dt>
        <dd>
          {formatDateOnly(preview.confirmed_deadline_before)} → <strong>{formatDateOnly(preview.confirmed_deadline_after)}</strong>
        </dd>
      </dl>
    </div>
  )
}

/**
 * 工程の前倒し・後ろ倒し（Issue #582）。1回押すごとに1稼働日ずつ量を増減してプレビューし、
 * 「確定」で保存する。ドラッグ&ドロップはしない（#438）
 */
export function ProcessShiftControls({
  workingDays,
  preview,
  isPreviewLoading,
  previewError,
  isSaving,
  onChange,
  onCancel,
  onConfirm,
}: ProcessShiftControlsProps) {
  const stopped = preview?.stopped_at_previous === true
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="h-11 flex-1"
          disabled={isSaving || stopped || workingDays <= -MAX_SHIFT_WORKING_DAYS}
          onClick={() => onChange(workingDays - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          前倒し
        </Button>
        <span
          className="w-14 shrink-0 text-center text-base font-semibold tabular-nums"
          aria-live="polite"
        >
          {formatShiftAmount(workingDays)}
        </span>
        <Button
          variant="outline"
          className="h-11 flex-1"
          disabled={isSaving || workingDays >= MAX_SHIFT_WORKING_DAYS}
          onClick={() => onChange(workingDays + 1)}
        >
          後ろ倒し
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        1回押すごとに1稼働日ずらします。同じ注文の後工程も連動し、前の工程・他の注文は動きません。
      </p>

      {workingDays !== 0 && (
        <>
          {isPreviewLoading ? (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              計算中...
            </p>
          ) : previewError ? (
            <p className="text-sm text-destructive">{processShiftErrorMessage(previewError)}</p>
          ) : preview ? (
            <ShiftPreviewBody preview={preview} />
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" disabled={isSaving} onClick={onCancel}>
              取り消し
            </Button>
            <Button className="h-11 flex-1" disabled={isSaving || isPreviewLoading || !preview} onClick={onConfirm}>
              {isSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              確定
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

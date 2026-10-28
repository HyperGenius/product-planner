'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { ChevronRight, ExternalLink, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DeadlineExceededIcon, StateBadge } from '@/components/schedule/state-badge'
import { ProcessShiftControls, type ProcessShiftControlsProps } from '@/components/schedule/process-shift-controls'
import {
  formatActualDateRange,
  formatProgressQuantity,
  orderStateLabelText,
  PROCESS_DISPLAY_STATE_LABEL,
  progressRatio,
  progressStatusLabel,
} from '@/lib/daily-report-progress-utils'
import type { ProcessDisplayState } from '@/lib/daily-report-progress-utils'
import { getStatusLabel } from '@/lib/order-utils'
import {
  isDeadlineExceeded,
  scheduleCustomerFullLabel,
  scheduleCustomerLabel,
  scheduleQuantityLabel,
} from '@/lib/schedule-label-utils'
import {
  canShiftOrderSchedule,
  formatDateTime,
  formatRange,
  type OrderDetail,
  type ProcessDetail,
  type ScheduleDetail,
  type ScheduleSelection,
} from '@/lib/schedule-detail-utils'
import type { ProcessProgress } from '@/types/daily-report-progress'
import type { Schedule } from '@/types/schedule'

export interface ScheduleDetailSheetProps {
  detail: ScheduleDetail
  /** 遅れの判定の「今」（ガントと揃える） */
  now: Date
  /** 操作（前倒し・後ろ倒し、開始・終了の編集）を出すか。`SCHEDULE_EDITOR_ROLES` のロールだけ */
  canEdit: boolean
  onClose: () => void
  /** シートの中で別の工程・注文へ移る */
  onSelect: (selection: ScheduleSelection) => void
  /** セグメントの開始・終了を編集する（`ScheduleEditDialog` を開く） */
  onEditSegment: (schedule: Schedule) => void
  /** 工程の前倒し・後ろ倒し（Issue #582）。確定済み・生産中の注文の工程で、canEdit のときだけ出す */
  shift?: ProcessShiftControlsProps
}

/** 日付のみの値（YYYY-MM-DD）。parseISO でローカル深夜として読む */
function formatDateOnly(value: string | null | undefined): string {
  return value ? format(parseISO(value), 'yyyy/M/d (E)', { locale: ja }) : '－'
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Fields({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1.5 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function processStateText(state: ProcessDisplayState, progress: ProcessProgress | undefined): string {
  if (state === 'completed' && progress) return progressStatusLabel(progress)
  return PROCESS_DISPLAY_STATE_LABEL[state]
}

/**
 * 注文の項目（工程・注文の詳細で共通）。ガントのラベルに出さない項目（正式名称・納期・注文番号）はここで見る（Issue #589）。
 * `orderEnd` は注文の最後の工程の計画終了（納期超過の判定。ガントの注文行と同じ基準）
 */
function OrderFields({ head, orderEnd }: { head: Schedule; orderEnd: Date | null }) {
  const exceeded = orderEnd !== null && isDeadlineExceeded(head, orderEnd)
  return (
    <Fields
      items={[
        ['顧客', scheduleCustomerFullLabel(head)],
        ['製品', head.product_name || '－'],
        ['数量', scheduleQuantityLabel(head) ?? '－'],
        [
          '希望納期',
          <span key="desired" className="inline-flex flex-wrap items-center gap-x-2">
            {formatDateOnly(head.desired_deadline)}
            {exceeded && <DeadlineExceededIcon withText />}
          </span>,
        ],
        ['完成見込み', formatDateOnly(head.confirmed_deadline)],
        ['注文番号', head.order_number || '－'],
        ['顧客の注文番号', head.customer_order_no || '－'],
        ...(head.order_status ? [['ステータス', getStatusLabel(head.order_status)] as [string, ReactNode]] : []),
      ]}
    />
  )
}

function OrderPageLink({ orderId }: { orderId: number }) {
  return (
    <Button asChild variant="outline" className="mt-3 h-11 w-full">
      <Link href={`/orders/${orderId}`}>
        受注詳細を開く
        <ExternalLink className="ml-1 h-4 w-4" />
      </Link>
    </Button>
  )
}

function ProgressFields({ progress, state }: { progress: ProcessProgress | undefined; state: ProcessDisplayState }) {
  if (!progress) {
    return (
      <p className="text-sm text-muted-foreground">
        日報の実績による進捗がありません（計画のみ）。進捗は確定済み・生産中の注文について定期的に計算します。
      </p>
    )
  }
  const ratio = progressRatio(progress)
  return (
    <Fields
      items={[
        ['状態', <StateBadge key="state" state={state} text={processStateText(state, progress)} />],
        [
          '実績数量',
          `${formatProgressQuantity(progress)}${ratio !== null && progress.status !== 'completed' ? `（${Math.round(ratio * 100)}%）` : ''}`,
        ],
        ['実績日', formatActualDateRange(progress) ?? '－'],
        ['計画終了', progress.planned_end_datetime ? formatDateTime(new Date(progress.planned_end_datetime)) : '－'],
        ...(progress.status === 'completed'
          ? [
              [
                '完了の根拠',
                progress.completed_by === 'later_process' ? '後工程に実績がある（推定）' : '良品数が受注数量に達した',
              ] as [string, ReactNode],
            ]
          : []),
      ]}
    />
  )
}

function ProcessDetailBody({
  detail,
  canEdit,
  onSelect,
  onEditSegment,
  shift,
}: { detail: ProcessDetail } & Pick<ScheduleDetailSheetProps, 'canEdit' | 'onSelect' | 'onEditSegment' | 'shift'>) {
  const { visibleRange, processRange, segments } = detail
  const showWholeRange =
    processRange.start.getTime() !== visibleRange.start.getTime() ||
    processRange.end.getTime() !== visibleRange.end.getTime()
  return (
    <>
      <Section title="工程">
        <Fields
          items={[
            ['工程', detail.processName],
            ['設備（グループ）', detail.equipmentGroupNames.join('、') || '－'],
            ['計画（表示中）', `${formatRange(visibleRange.start, visibleRange.end)}（${segments.length}区間）`],
            ...(showWholeRange
              ? [['計画（工程全体）', formatRange(processRange.start, processRange.end)] as [string, ReactNode]]
              : []),
          ]}
        />
      </Section>
      <Section title="実績">
        <ProgressFields progress={detail.progress} state={detail.state} />
      </Section>
      <Section title="注文">
        <OrderFields
          head={detail.head}
          orderEnd={detail.head.order_end_datetime ? new Date(detail.head.order_end_datetime) : null}
        />
        <Button
          variant="outline"
          className="mt-3 h-11 w-full justify-between"
          onClick={() => onSelect({ kind: 'order', orderId: detail.head.order_id })}
        >
          この注文の全工程を見る
          <ChevronRight className="h-4 w-4" />
        </Button>
        <OrderPageLink orderId={detail.head.order_id} />
      </Section>
      {canEdit && (
        <Section title="操作">
          {shift && canShiftOrderSchedule(detail.head.order_status) && (
            <div className="mb-4">
              <h4 className="mb-2 text-sm font-medium">計画をずらす</h4>
              <ProcessShiftControls {...shift} />
            </div>
          )}
          <h4 className="mb-1 text-sm font-medium">区間ごとの編集</h4>
          <p className="mb-2 text-xs text-muted-foreground">
            区間ごとに開始・終了を変更します。同じ注文の後工程は動きません。
          </p>
          <ul className="space-y-2">
            {segments.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm tabular-nums">
                  {s.start_datetime === s.end_datetime
                    ? formatDateTime(new Date(s.start_datetime))
                    : formatRange(new Date(s.start_datetime), new Date(s.end_datetime))}
                </span>
                <Button
                  variant="outline"
                  className="h-11 shrink-0"
                  aria-label={`区間 ${formatDateTime(new Date(s.start_datetime))} の開始・終了を編集`}
                  onClick={() => onEditSegment(s)}
                >
                  <Pencil className="mr-1 h-4 w-4" />
                  編集
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

function OrderDetailBody({
  detail,
  onSelect,
}: { detail: OrderDetail } & Pick<ScheduleDetailSheetProps, 'onSelect'>) {
  return (
    <>
      <Section title="注文">
        <OrderFields head={detail.head} orderEnd={detail.orderRange.end} />
        <div className="mt-1.5">
          <Fields items={[['計画（全体）', formatRange(detail.orderRange.start, detail.orderRange.end)]]} />
        </div>
        <OrderPageLink orderId={detail.head.order_id} />
      </Section>
      <Section title="工程">
        <ul className="space-y-1.5">
          {detail.processes.map((p) => {
            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.processName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      p.equipmentGroupName,
                      p.visibleRange
                        ? `${formatRange(p.visibleRange.start, p.visibleRange.end)}（${p.segmentCount}区間）`
                        : '表示中の期間に計画なし',
                      p.progress ? `実績 ${formatProgressQuantity(p.progress)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' ・ ')}
                  </p>
                </div>
                {p.state !== 'planned_only' && (
                  <StateBadge state={p.state} text={PROCESS_DISPLAY_STATE_LABEL[p.state]} />
                )}
              </>
            )
            return (
              <li key={p.processRoutingId}>
                {p.visibleRange ? (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left hover:bg-muted"
                    onClick={() =>
                      onSelect({ kind: 'process', orderId: detail.head.order_id, processRoutingId: p.processRoutingId })
                    }
                  >
                    {content}
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ) : (
                  <div className="flex min-h-11 items-center gap-2 rounded-md border border-dashed px-3 py-1.5">
                    {content}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          表示中の期間の計画と、日報の進捗がある工程を並べています。
        </p>
      </Section>
    </>
  )
}

/**
 * 生産スケジュールの詳細シート（Issue #581）。ガントの右に並べて開き、ガントを隠さない
 * （どの行を開いているかはガントの行のハイライトで示す）。タブレットではホバーできないので、
 * ツールチップの内容はすべてここに出す
 */
export function ScheduleDetailSheet({
  detail,
  now,
  canEdit,
  onClose,
  onSelect,
  onEditSegment,
  shift,
}: ScheduleDetailSheetProps) {
  const orderState =
    detail.kind === 'order' ? orderStateLabelText(detail.progressItems, now) : null
  const title =
    detail.kind === 'process'
      ? detail.processName
      : [scheduleCustomerLabel(detail.head), detail.head.product_name].filter(Boolean).join(' ')
  return (
    <aside
      aria-label={detail.kind === 'process' ? '工程の詳細' : '注文の詳細'}
      data-testid="schedule-detail-sheet"
      className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:w-[400px]"
    >
      <div className="flex shrink-0 items-start gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{detail.kind === 'process' ? '工程の詳細' : '注文の詳細'}</p>
          <h2 className="break-words text-lg font-semibold leading-snug">{title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {detail.kind === 'process' && detail.state !== 'planned_only' && (
              <StateBadge state={detail.state} text={processStateText(detail.state, detail.progress)} />
            )}
            {orderState && <StateBadge state={orderState.state} text={orderState.text} />}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="詳細を閉じる" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {detail.kind === 'process' ? (
          <ProcessDetailBody
            detail={detail}
            canEdit={canEdit}
            onSelect={onSelect}
            onEditSegment={onEditSegment}
            shift={shift}
          />
        ) : (
          <OrderDetailBody detail={detail} onSelect={onSelect} />
        )}
      </div>
    </aside>
  )
}

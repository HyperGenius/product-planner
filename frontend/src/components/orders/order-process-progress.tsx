"use client"

import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { StockAssignmentHint } from "@/components/orders/order-stock-assignments"
import { Badge } from "@/components/ui/badge"
import { useOrderProgress } from "@/hooks/use-daily-report-progress"
import { useProcessRoutings } from "@/hooks/use-process-routings"
import { useUntrackedProcessNames } from "@/hooks/use-untracked-process-names"
import {
  formatActualDateRange,
  formatProgressQuantity,
  isProgressDelayed,
  progressStatusLabel,
} from "@/lib/daily-report-progress-utils"
import {
  isUntrackedProcessName,
  toUntrackedNameSet,
  UNTRACKED_PROCESS_LABEL,
} from "@/lib/untracked-process-utils"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { ProcessRouting } from "@/types/process-routing"

const STATUS_BADGE_CLASS: Record<ProcessProgress["status"], string> = {
  not_started: "bg-gray-100 text-gray-700 hover:bg-gray-100",
  in_progress: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  completed: "bg-green-100 text-green-800 hover:bg-green-100",
}

type ProgressRow =
  | { kind: "progress"; key: number; sequence: number | null; progress: ProcessProgress }
  | { kind: "untracked"; key: number; sequence: number | null; routing: ProcessRouting }

/**
 * 進捗の行と、日報で追わない工程（進捗の行が作られない。Issue #681）を工程順に並べる。
 * 日報で追わない工程でも進捗の行がある（設定の直後で再計算前）ならその行を出す
 */
export function buildProgressRows(
  processes: readonly ProcessProgress[],
  routings: readonly ProcessRouting[] | undefined,
  untrackedNames: ReadonlySet<string>,
): ProgressRow[] {
  const withProgress = new Set(processes.map((p) => p.process_routing_id))
  const rows: ProgressRow[] = [
    ...processes.map((p) => ({
      kind: "progress" as const,
      key: p.process_routing_id,
      sequence: p.sequence_order,
      progress: p,
    })),
    ...(routings ?? [])
      .filter((r) => !withProgress.has(r.id) && isUntrackedProcessName(untrackedNames, r.process_name))
      .map((r) => ({
        kind: "untracked" as const,
        key: r.id,
        sequence: r.sequence_order,
        routing: r,
      })),
  ]
  return rows.sort(
    (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER),
  )
}

/**
 * 受注詳細の工程ごとの進捗（日報の実績から算出、Issue #491）。
 * 割り付けの対象（確定済み・生産中）の受注でだけ描画する想定（呼び出し側で出し分ける）。
 * 日報で追わない工程（Issue #681）は進捗の行が無いので、製品の工程ルートから「日報の対象外」として並べる
 */
export function OrderProcessProgress({
  orderId,
  productId = null,
  stockHintTargetId,
}: {
  orderId: number
  /** 受注の製品。渡すと、日報で追わない工程を「日報の対象外」として工程順に並べる */
  productId?: number | null
  /**
   * 作り置きの引き当てのカードの要素の id。渡すと、実績の付いていない工程があり引き当てられるものがあるときに
   * そのカードへの案内を出す（Issue #673）
   */
  stockHintTargetId?: string
}) {
  const { data, isLoading, isError } = useOrderProgress(orderId)
  const { data: routings } = useProcessRoutings(productId)
  const { data: untrackedNames } = useUntrackedProcessNames()
  const now = new Date()
  const rows = buildProgressRows(data?.processes ?? [], routings, toUntrackedNameSet(untrackedNames))

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">工程の進捗</h2>
        {data?.computed_at && (
          <p className="text-xs text-muted-foreground">
            {format(new Date(data.computed_at), "M/d HH:mm", { locale: ja })} 時点の日報から集計
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : isError ? (
        <p className="text-sm text-destructive">工程の進捗を取得できませんでした</p>
      ) : !data?.computed_at ? (
        <p className="text-sm text-muted-foreground">日報の進捗はまだ集計されていません</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">工程の進捗はありません</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">工程</th>
              <th className="py-2 pr-2 text-right font-medium">実績数量</th>
              <th className="py-2 pr-2 font-medium">状態</th>
              <th className="py-2 font-medium">実績日</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "untracked") {
                return (
                  <tr key={row.key} className="border-b last:border-0">
                    <td className="py-2 pr-2">{row.routing.process_name}</td>
                    <td className="py-2 pr-2 text-right text-muted-foreground">－</td>
                    <td className="py-2 pr-2">
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                        title="日報で追わない工程（工程ルートの画面で設定）なので、日報の進捗を出していません"
                      >
                        {UNTRACKED_PROCESS_LABEL}
                      </Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">－</td>
                  </tr>
                )
              }
              const p = row.progress
              const delayed = isProgressDelayed(p, now)
              return (
                <tr key={p.process_routing_id} className="border-b last:border-0">
                  <td className="py-2 pr-2">{p.process_name ?? "－"}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatProgressQuantity(p)}</td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge className={STATUS_BADGE_CLASS[p.status]}>{progressStatusLabel(p)}</Badge>
                      {delayed && (
                        <Badge
                          className="bg-red-600 text-white hover:bg-red-600"
                          title={
                            p.planned_end_datetime
                              ? `計画終了 ${format(new Date(p.planned_end_datetime), "M/d HH:mm", { locale: ja })}`
                              : undefined
                          }
                        >
                          遅れ
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-2 text-muted-foreground">{formatActualDateRange(p) ?? "－"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {stockHintTargetId && <StockAssignmentHint orderId={orderId} targetId={stockHintTargetId} />}
    </div>
  )
}

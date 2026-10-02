"use client"

import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { useOrderProgress } from "@/hooks/use-daily-report-progress"
import {
  formatActualDateRange,
  formatProgressQuantity,
  isProgressDelayed,
  progressStatusLabel,
} from "@/lib/daily-report-progress-utils"
import type { ProcessProgress } from "@/types/daily-report-progress"

const STATUS_BADGE_CLASS: Record<ProcessProgress["status"], string> = {
  not_started: "bg-gray-100 text-gray-700 hover:bg-gray-100",
  in_progress: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  completed: "bg-green-100 text-green-800 hover:bg-green-100",
}

/**
 * 受注詳細の工程ごとの進捗（日報の実績から算出、Issue #491）。
 * 割り付けの対象（確定済み・生産中）の受注でだけ描画する想定（呼び出し側で出し分ける）。
 */
export function OrderProcessProgress({ orderId }: { orderId: number }) {
  const { data, isLoading, isError } = useOrderProgress(orderId)
  const now = new Date()

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
      ) : data.processes.length === 0 ? (
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
            {data.processes.map((p) => {
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
    </div>
  )
}

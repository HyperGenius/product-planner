import { Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { STATUS_CLASS, formatDeadlineForFloorDashboard, type DeadlineStatus } from "@/lib/floor-dashboard-utils"

/**
 * 計画数量バッジ（Issue #450）。`RemainingDaysLabel`（納期状態）と同じ `Badge` コンポーネントで
 * テイストを揃えつつ、色分けが必要な状態バッジとは区別できるよう `variant="outline"` にする。
 * 数量はカンマ区切り（`toLocaleString("ja-JP")`。`order-table-row.tsx` の既存踏襲元と同じ表記）で
 * 末尾に単位「個」を付ける（Issue #452 で「数量」ラベルを削除し圧縮）。数量が未設定の場合は
 * 単位だけ残ると不自然なため「-」のみ表示する（Copilotレビュー指摘, PR #453）。
 */
export function QuantityBadge({ quantity }: { quantity: number | null | undefined }) {
  return (
    <Badge variant="outline" className="font-normal">
      {quantity != null ? `${quantity.toLocaleString("ja-JP")} 個` : "-"}
    </Badge>
  )
}

/**
 * 計画納期バッジ（Issue #450）。当年（JST基準）は "MM/DD"、翌年以降は "YYYY/MM/DD" 表示
 * （`formatDeadlineForFloorDashboard`）。「納期」テキストラベルの代わりにトラックアイコンを表示する
 * （Issue #452）。納期超過（`status === "overdue"`）時は赤背景・白文字にし、`RemainingDaysLabel` の
 * 「納期超過」ラベルに代えてこのバッジ自体で目立たせる（Issue #452）。
 */
export function DeadlineValueBadge({
  deadline,
  todayIso,
  status,
}: {
  deadline: string | undefined
  todayIso: string
  status: DeadlineStatus | null
}) {
  const formatted = formatDeadlineForFloorDashboard(deadline, todayIso)
  const overdueClass = status === "overdue" ? STATUS_CLASS.overdue : ""
  return (
    <Badge variant="outline" className={`font-normal gap-1 ${overdueClass}`}>
      <Truck className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">納期</span>
      {formatted ?? "未設定"}
    </Badge>
  )
}

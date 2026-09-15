import { Badge } from "@/components/ui/badge"
import { formatDeadlineForFloorDashboard } from "@/lib/floor-dashboard-utils"

/**
 * 計画数量バッジ（Issue #450）。`DeadlineBadge`（納期状態）と同じ `Badge` コンポーネントで
 * テイストを揃えつつ、色分けが必要な状態バッジとは区別できるよう `variant="outline"` にする。
 * 数量はカンマ区切り（`toLocaleString("ja-JP")`。`order-table-row.tsx` の既存踏襲元と同じ表記）。
 */
export function QuantityBadge({ quantity }: { quantity: number | null | undefined }) {
  return (
    <Badge variant="outline" className="font-normal">
      数量 {quantity != null ? quantity.toLocaleString("ja-JP") : "-"}
    </Badge>
  )
}

/**
 * 計画納期バッジ（Issue #450）。当年（JST基準）は "MM/DD"、翌年以降は "YYYY/MM/DD" 表示
 * （`formatDeadlineForFloorDashboard`）。`DeadlineBadge`（納期状態）の左に並べる想定。
 */
export function DeadlineValueBadge({
  deadline,
  todayIso,
}: {
  deadline: string | undefined
  todayIso: string
}) {
  const formatted = formatDeadlineForFloorDashboard(deadline, todayIso)
  return (
    <Badge variant="outline" className="font-normal">
      納期 {formatted ?? "未設定"}
    </Badge>
  )
}

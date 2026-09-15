import { Badge } from "@/components/ui/badge"
import { STATUS_CLASS, type DeadlineStatus } from "@/lib/floor-dashboard-utils"

interface RemainingDaysLabelProps {
  status: DeadlineStatus | null
  /** due_soon の場合の残り日数（「残りN日」表示用）。on_track / null では未使用 */
  daysRemaining?: number
}

/**
 * 納期までの残り日数ラベル（1週間未満＝アクセント色・「残りN日」 / 1週間以上＝通常色・「予定通り」。
 * Issue #442, #452）。納期超過（overdue）はこのラベルではなく `DeadlineValueBadge`（`PlanValueBadges.tsx`）
 * の赤塗りで表現するため、ここでは何も表示しない（旧 `DeadlineBadge` から改称・役割縮小、Issue #452）。
 * 判定ロジック自体は `lib/floor-dashboard-utils.ts` の `getDeadlineStatus`（検索・フィルタ #444 と共有）。
 * `status` が null（納期未設定）の場合も何も表示しない。
 */
export function RemainingDaysLabel({ status, daysRemaining }: RemainingDaysLabelProps) {
  if (!status || status === "overdue") return null

  const label = status === "due_soon" ? `残り${daysRemaining ?? 0}日` : "予定通り"

  return <Badge className={STATUS_CLASS[status]}>{label}</Badge>
}

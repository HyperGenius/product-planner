import { Badge } from "@/components/ui/badge"
import type { DeadlineStatus } from "@/lib/floor-dashboard-utils"

const STATUS_CLASS: Record<DeadlineStatus, string> = {
  overdue: "bg-red-600 text-white hover:bg-red-600",
  due_soon: "bg-amber-500 text-white hover:bg-amber-500",
  on_track: "bg-secondary text-secondary-foreground hover:bg-secondary",
}

interface DeadlineBadgeProps {
  status: DeadlineStatus | null
  /** due_soon の場合の残り日数（「残りN日」表示用）。overdue / on_track / null では未使用 */
  daysRemaining?: number
}

/**
 * 納期状態バッジ（納期超過＝赤・「納期超過」 / 1週間未満＝アクセント色・「残りN日」 /
 * 1週間以上＝通常色・「予定通り」。Issue #442）。
 * 判定ロジック自体は `lib/floor-dashboard-utils.ts` の `getDeadlineStatus`（検索・フィルタ #444 と共有）。
 * `status` が null（納期未設定）の場合は何も表示しない。
 */
export function DeadlineBadge({ status, daysRemaining }: DeadlineBadgeProps) {
  if (!status) return null

  const label =
    status === "overdue"
      ? "納期超過"
      : status === "due_soon"
        ? `残り${daysRemaining ?? 0}日`
        : "予定通り"

  return <Badge className={STATUS_CLASS[status]}>{label}</Badge>
}

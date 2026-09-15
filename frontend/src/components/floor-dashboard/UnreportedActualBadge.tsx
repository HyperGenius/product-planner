import { CircleDashed } from "lucide-react"
import { Badge } from "@/components/ui/badge"

/**
 * 実績「未報告」の固定バッジ（Issue #443）。
 * フェーズ1では実績入力が無いため、条件分岐や推測値は持たず常に「実績未報告」を表示する。
 * フェーズ2（実績入力、Issue #438）でこのコンポーネントごと差し替える前提のため、
 * 先回りしたprops設計は行わない。
 */
export function UnreportedActualBadge() {
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <CircleDashed className="h-3 w-3" />
      実績未報告
    </Badge>
  )
}

import { Badge } from "@/components/ui/badge"
import { getCertaintyBadgeClass, getCertaintyLabel } from "@/lib/order-utils"
import type { Order } from "@/types/order"

/**
 * 受注詳細の「顧客側の確度」の値。
 * NULL（手動起票、または PDF 解析失敗・抽出結果の確度が許容値外で判定できなかった
 * 受注）は内々示等と誤認させないよう、バッジではなくプレーンな「－」を表示する（Issue #474）。
 */
export function CustomerCertaintyValue({
  certainty,
}: {
  certainty: Order["customer_certainty"]
}) {
  if (!certainty) {
    return <span className="text-muted-foreground">－</span>
  }
  return <Badge className={getCertaintyBadgeClass(certainty)}>{getCertaintyLabel(certainty)}</Badge>
}

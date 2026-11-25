"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ListPageLayout } from "@/components/layout/list-page-layout"
import {
  ShippingPrerequisiteBanner,
  ShippingWorkQueue,
} from "@/components/orders/shipping/shipping-hub"
import { ShippingHelp } from "@/components/orders/shipping/shipping-help"
import { DataFreshness } from "@/components/orders/shipping/shipping-page-layout"
import { useLocationHash } from "@/hooks/use-location-hash"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { shippingPageFromLegacyHash, shippingPageHref } from "@/lib/shipping-review-utils"

/**
 * 送品の消し込み（Issue #557 / #692 / #693、Epic #690）
 * URL: /orders/shipping
 *
 * 順番と前提が見える作業キュー（ハブ）。件数は `classifyShippingWorklist()`（#691）の結果から出し、
 * 各作業の一覧は専用のページ（`/orders/shipping/<page>`、#693）に置く。ページの行も同じ結果から出すので件数と一致する。
 *
 * - 前提バナー: 弥生の名寄せが済んでいない得意先・商品と、送り先の受注を決められない明細があるときだけ出す
 * - ① 送品済みにする（ship）・② 出荷を確かめる（confirm）・③ 受注を起票する（register）・参考: 日報（daily-reports）
 *
 * #692 の暫定の一覧のハッシュ（`#ship` 等）・#682 の `#candidates` で開かれたら、そのページへ移る（`shippingPageFromLegacyHash()`）。
 * 画面の文言は docs/ui-writing-guidelines.md に従う。仕組み・判定条件・抽出条件は `ShippingHelp`（見出しの横の「?」）に書く
 */
export default function OrdersShippingPage() {
  const router = useRouter()
  const [hash] = useLocationHash()
  const legacyPage = shippingPageFromLegacyHash(hash)
  useEffect(() => {
    if (legacyPage) router.replace(shippingPageHref(legacyPage))
  }, [legacyPage, router])

  const {
    counts,
    worklist,
    unmatched,
    latestSalesDate,
    isShipmentError,
    computedAt,
    isProgressError,
  } = useOrdersShipping()

  return (
    <ListPageLayout title="送品の消し込み" help={<ShippingHelp />}>
      <DataFreshness
        latestSalesDate={latestSalesDate}
        isShipmentError={isShipmentError}
        computedAt={computedAt}
        isProgressError={isProgressError}
      />

      <ShippingPrerequisiteBanner
        counts={worklist.counts.prerequisite}
        isError={unmatched.isError}
        truncated={worklist.truncated}
      />

      <div className="max-w-5xl">
        <ShippingWorkQueue counts={counts} />
      </div>
    </ListPageLayout>
  )
}

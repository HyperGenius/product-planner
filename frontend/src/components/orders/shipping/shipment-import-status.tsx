"use client"

import Link from "next/link"
import { useShipmentFiles } from "@/hooks/use-shipment-files"
import { formatDateTimeShort } from "@/lib/order-utils"

/**
 * 弥生販売の売上伝票 CSV の最終取り込み日時 (Issue #662)。
 * 送品は不定期なので「何日更新が無い」という警告は出さず、日時だけを見せる。
 * 取得に失敗してもこの表示だけを消し、画面本体は止めない。
 */
export function ShipmentImportStatus() {
  const { data, isLoading, isError } = useShipmentFiles()
  if (isLoading || isError) return null
  const label = formatDateTimeShort(data?.last_received_at)
  return (
    <p className="text-xs text-muted-foreground">
      弥生の売上伝票: {label ? `${label} に取り込み` : "未取り込み"}
      {" / "}
      <Link href="/orders/shipment-import" className="underline">
        取り込み状況
      </Link>
    </p>
  )
}

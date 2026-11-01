"use client"

import { format, parseISO } from "date-fns"
import { ja } from "date-fns/locale"
import { toast } from "sonner"
import { BellRing } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useOrderDeliveryRequests,
  useResolveDeliveryRequest,
} from "@/hooks/use-order-delivery-requests"
import type { DeliveryRequestKind } from "@/types/order-delivery-request"

export const DELIVERY_REQUEST_KIND_LABELS: Record<DeliveryRequestKind, string> = {
  delivery_chase: "督促",
  split_delivery: "分納の依頼",
}

/**
 * 受注詳細の「顧客からの督促・分納の依頼」(Issue #619)。依頼が無い受注では何も描画しない。
 * 督促メールの内容を見て電話などで対応したら「対応済み」にする。納期・数量は自動では変わらない。
 */
export function OrderDeliveryRequests({ orderId }: { orderId: number }) {
  const { data } = useOrderDeliveryRequests(orderId)
  const resolve = useResolveDeliveryRequest()

  if (!data || data.length === 0) return null

  const handleToggle = (id: string, resolved: boolean) => {
    resolve.mutate(
      { id, resolved },
      { onError: () => toast.error("対応状況を更新できませんでした") },
    )
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
        <BellRing className="h-4 w-4 shrink-0" />
        顧客から督促・分納の依頼が届いています
      </p>
      <p className="mt-1 text-xs text-amber-700">
        メールの内容を確認し、対応したら「対応済み」にしてください。納期・数量は自動では変わりません。
      </p>
      <ul className="mt-3 space-y-2">
        {data.map((request) => {
          const resolved = request.resolved_at !== null
          return (
            <li
              key={request.id}
              className="flex items-start justify-between gap-3 rounded-md bg-white/70 p-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                    {DELIVERY_REQUEST_KIND_LABELS[request.kind]}
                  </Badge>
                  {request.requested_date && (
                    <span>
                      希望日: {format(parseISO(request.requested_date), "M月d日", { locale: ja })}
                    </span>
                  )}
                  {request.quantity !== null && <span>{request.quantity.toLocaleString()}個</span>}
                  <span className="text-xs text-muted-foreground">
                    受信: {format(new Date(request.created_at), "M月d日 HH:mm", { locale: ja })}
                  </span>
                </div>
                {request.body_snippet && (
                  <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {request.body_snippet}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant={resolved ? "outline" : "default"}
                disabled={resolve.isPending}
                onClick={() => handleToggle(request.id, !resolved)}
              >
                {resolved ? "未対応に戻す" : "対応済みにする"}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

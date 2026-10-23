"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { OrderDialogLayout } from "@/components/orders/order-dialog-layout"
import { RepairOrderFields } from "@/components/orders/repair-order-fields"
import { ApiError } from "@/lib/api-client"
import { useConvertOrderToRepair } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import {
  getRepairOrderErrorMessage,
  repairFormValuesFromProductionOrder,
  validateRepairOrderForm,
  type RepairOrderFormValues,
} from "@/lib/repair-order"
import type { Order } from "@/types/order"

interface ConvertToRepairDialogProps {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 変更に成功した後に呼ぶ（ダイアログはこのコンポーネントが閉じる） */
  onConverted?: (order: Order) => void
}

/**
 * 取り込みで生産として起票された下書きを修理等へ変更するモーダル（Issue #568）。
 * 修理等の編集ダイアログと同じ入力欄で、変更と同時に件名・作業内容と日付を入れる。
 * 開くたびに初期値を作り直すため、呼び出し側で `key` を注文ごとに変えて描画する
 */
export function ConvertToRepairDialog({
  order,
  open,
  onOpenChange,
  onConverted,
}: ConvertToRepairDialogProps) {
  const convertToRepair = useConvertOrderToRepair()
  const { data: currentMember } = useCurrentMember()
  const [values, setValues] = useState<RepairOrderFormValues>(() =>
    repairFormValuesFromProductionOrder(order)
  )

  const canBackdate =
    currentMember?.role === "president" || currentMember?.role === "platform_admin"

  const handleSubmit = () => {
    const validationError = validateRepairOrderForm(values, canBackdate)
    if (validationError) {
      toast.error(validationError)
      return
    }

    convertToRepair.mutate(
      {
        id: order.id,
        data: {
          order_no: values.orderNo.trim() || null,
          customer_id: values.customerId ? parseInt(values.customerId, 10) : null,
          work_description: values.workDescription.trim(),
          desired_deadline: values.desiredDeadline || null,
          scheduling_start_date: values.schedulingStartDate || null,
          simulated_deadline: values.simulatedDeadline || null,
        },
      },
      {
        onSuccess: (converted) => {
          toast.success(`注文「${converted.order_no ?? ""}」を修理等に変更しました`)
          onOpenChange(false)
          onConverted?.(converted)
        },
        onError: (error: Error) => {
          const errorCode = error instanceof ApiError ? error.errorCode : undefined
          if (errorCode === "duplicate_order_number") {
            toast.error("この注文番号はすでに使用されています")
          } else {
            toast.error(getRepairOrderErrorMessage(error) ?? "修理等への変更に失敗しました")
          }
        },
      }
    )
  }

  return (
    <OrderDialogLayout
      order={order}
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && convertToRepair.isPending) return
        onOpenChange(isOpen)
      }}
      title="修理等に変更"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={convertToRepair.isPending}
          >
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={convertToRepair.isPending}>
            {convertToRepair.isPending ? "変更中..." : "修理等に変更"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        製品の生産ではなく修理・メンテナンス・洗浄などの注文として扱います。製品・数量・シミュレーション結果は消え、
        元に戻せません。変更は承認ログに記録されます。
      </p>
      <RepairOrderFields values={values} onChange={setValues} canBackdate={canBackdate} />
    </OrderDialogLayout>
  )
}

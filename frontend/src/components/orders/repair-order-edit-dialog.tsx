"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { OrderDialogLayout } from "@/components/orders/order-dialog-layout"
import { RepairOrderFields } from "@/components/orders/repair-order-fields"
import { ApiError } from "@/lib/api-client"
import { useUpdateOrder } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { toDateInputValue } from "@/lib/order-utils"
import {
  getRepairOrderErrorMessage,
  validateRepairOrderForm,
  type RepairOrderFormValues,
} from "@/lib/repair-order"
import type { Order } from "@/types/order"

interface RepairOrderEditDialogProps {
  order: Order | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 修理・メンテナンス・洗浄など、製品を持たない注文の編集モーダル（Issue #494） */
export function RepairOrderEditDialog({ order, open, onOpenChange }: RepairOrderEditDialogProps) {
  const updateOrder = useUpdateOrder()
  const { data: currentMember } = useCurrentMember()
  const [values, setValues] = useState<RepairOrderFormValues>({
    orderNo: order?.order_no ?? "",
    customerId: order?.customer_id?.toString() ?? "",
    workDescription: order?.work_description ?? "",
    desiredDeadline: toDateInputValue(order?.desired_deadline),
    schedulingStartDate: toDateInputValue(order?.scheduling_start_date),
    simulatedDeadline: toDateInputValue(order?.simulated_deadline),
  })

  if (!order) return null

  const canBackdate =
    currentMember?.role === "president" || currentMember?.role === "platform_admin"

  const handleSubmit = () => {
    const validationError = validateRepairOrderForm(
      values,
      canBackdate,
      values.schedulingStartDate !== toDateInputValue(order.scheduling_start_date)
    )
    if (validationError) {
      toast.error(validationError)
      return
    }

    // 空欄にした任意項目は null で送って消す（undefined だとキーごと落ちて更新されない。Issue #518）
    updateOrder.mutate(
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
        onSuccess: () => {
          toast.success("注文情報を更新しました")
          onOpenChange(false)
        },
        onError: (error: Error) => {
          const errorCode = error instanceof ApiError ? error.errorCode : undefined
          if (errorCode === "duplicate_order_number") {
            toast.error("この注文番号はすでに使用されています")
          } else {
            toast.error(getRepairOrderErrorMessage(error) ?? "更新に失敗しました")
          }
        },
      }
    )
  }

  return (
      <OrderDialogLayout
        order={order}
        open={open}
        onOpenChange={onOpenChange}
        title="注文の編集"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button onClick={handleSubmit} disabled={updateOrder.isPending}>
              {updateOrder.isPending ? "保存中..." : "保存"}
            </Button>
          </>
        }
      >
        <RepairOrderFields values={values} onChange={setValues} canBackdate={canBackdate} />
      </OrderDialogLayout>
  )
}

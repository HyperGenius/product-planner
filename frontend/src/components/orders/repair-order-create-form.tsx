"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RepairOrderFields } from "@/components/orders/repair-order-fields"
import { useCreateOrder } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import {
  EMPTY_REPAIR_ORDER_FORM,
  getRepairOrderErrorMessage,
  validateRepairOrderForm,
  type RepairOrderFormValues,
} from "@/lib/repair-order"
import { ApiError } from "@/lib/api-client"

/**
 * 修理・メンテナンス・洗浄など、製品を持たない注文の起票フォーム（Issue #494）。
 * 製品・数量・シミュレーションは使わず、下書きとして登録する。日付は後から詳細で入れてもよい
 */
export function RepairOrderCreateForm() {
  const router = useRouter()
  const createMutation = useCreateOrder()
  const { data: currentMember } = useCurrentMember()
  const [values, setValues] = useState<RepairOrderFormValues>(EMPTY_REPAIR_ORDER_FORM)

  const canBackdate =
    currentMember?.role === "president" || currentMember?.role === "platform_admin"

  const handleSubmit = async () => {
    const validationError = validateRepairOrderForm(values, canBackdate)
    if (validationError) {
      toast.error(validationError)
      return
    }

    try {
      const created = await createMutation.mutateAsync({
        order_type: "repair",
        order_no: values.orderNo.trim() || undefined,
        customer_id: values.customerId ? parseInt(values.customerId, 10) : undefined,
        work_description: values.workDescription.trim(),
        desired_deadline: values.desiredDeadline || undefined,
        scheduling_start_date: values.schedulingStartDate || undefined,
        simulated_deadline: values.simulatedDeadline || undefined,
      })
      toast.success("下書きとして登録しました。実施開始日と完了予定日を入れると承認依頼できます")
      router.push(`/orders/${created.id}`)
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === "duplicate_order_number") {
        toast.error("この注文番号はすでに使用されています")
        return
      }
      toast.error(getRepairOrderErrorMessage(error) ?? "注文の登録に失敗しました")
    }
  }

  return (
    <div className="max-w-xl rounded-lg border bg-card p-6 shadow-sm space-y-4">
      <div>
        <h2 className="text-xl font-semibold">修理・メンテナンス・洗浄などの注文</h2>
        <p className="text-sm text-muted-foreground mt-1">
          製品の生産ではない作業依頼を登録します。製品・数量・シミュレーションは使いません。
        </p>
      </div>

      <RepairOrderFields values={values} onChange={setValues} canBackdate={canBackdate} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => router.back()}>
          キャンセル
        </Button>
        <Button onClick={handleSubmit} disabled={createMutation.isPending}>
          {createMutation.isPending ? "登録中..." : "下書きとして登録"}
        </Button>
      </div>
    </div>
  )
}

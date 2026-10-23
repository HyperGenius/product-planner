"use client"

import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CustomerSelector } from "@/components/customer-selector"
import { cn } from "@/lib/utils"
import { jstTodayIso } from "@/lib/order-utils"
import type { RepairOrderFormValues } from "@/lib/repair-order"

interface RepairOrderFieldsProps {
  values: RepairOrderFormValues
  onChange: (values: RepairOrderFormValues) => void
  /** 実施開始日に過去日を入れられるか（president / platform_admin、Issue #372） */
  canBackdate: boolean
}

/**
 * 修理・メンテナンス・洗浄など、製品を持たない注文の入力欄（Issue #494）。
 * 起票画面と編集ダイアログで共有する。実施開始日と完了予定日が両方入るまで承認依頼できない
 */
export function RepairOrderFields({ values, onChange, canBackdate }: RepairOrderFieldsProps) {
  const idPrefix = useId()
  const fieldId = (name: string) => `${idPrefix}-${name}`
  const set = <K extends keyof RepairOrderFormValues>(key: K, value: RepairOrderFormValues[K]) =>
    onChange({ ...values, [key]: value })

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={fieldId("work-description")}>件名・作業内容 *</Label>
        <textarea
          id={fieldId("work-description")}
          value={values.workDescription}
          onChange={(e) => set("workDescription", e.target.value)}
          rows={5}
          placeholder={"例: 部品の補修（1行目が一覧に表示されます）\n・補修部1〜3ヶ所 ×11枚"}
          className={cn(
            "border-input placeholder:text-muted-foreground w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] resize-y",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          )}
        />
        <p className="text-sm text-muted-foreground">
          1行目が件名として一覧に表示されます。内訳は2行目以降に書けます。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("order-no")}>注文番号（任意）</Label>
        <Input
          id={fieldId("order-no")}
          value={values.orderNo}
          onChange={(e) => set("orderNo", e.target.value)}
        />
      </div>

      <CustomerSelector value={values.customerId} onValueChange={(v) => set("customerId", v)} />

      <div className="space-y-2">
        <Label htmlFor={fieldId("desired-deadline")}>納期</Label>
        <Input
          id={fieldId("desired-deadline")}
          type="date"
          value={values.desiredDeadline}
          onChange={(e) => set("desiredDeadline", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("start-date")}>実施開始日</Label>
        <Input
          id={fieldId("start-date")}
          type="date"
          value={values.schedulingStartDate}
          min={canBackdate ? undefined : jstTodayIso()}
          onChange={(e) => set("schedulingStartDate", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId("completion-date")}>完了予定日</Label>
        <Input
          id={fieldId("completion-date")}
          type="date"
          value={values.simulatedDeadline}
          min={values.schedulingStartDate || undefined}
          onChange={(e) => set("simulatedDeadline", e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          実施開始日と完了予定日の両方を入力すると承認依頼できます。社長が承認すると完了予定日が確定します。
        </p>
      </div>
    </>
  )
}

"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useDeleteStockAssignment,
  useOrderStockAssignments,
  useSaveStockAssignment,
} from "@/hooks/use-daily-report-stock"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { formatWorkDate, nameMutationErrorMessage } from "@/lib/daily-report-name-utils"
import {
  STOCK_LABEL,
  initialStockAssignmentForm,
  stockPlaceLabel,
  toStockAssignmentInput,
  type StockAssignmentForm,
} from "@/lib/daily-report-stock-utils"
import { DAILY_REPORT_NAME_EDITOR_ROLES } from "@/types/member"
import type { OrderStockAssignments as OrderStockAssignmentsData } from "@/types/daily-report-stock"

/**
 * 受注詳細の「作り置きからの引き当て」(Issue #624)。
 *
 * 割り付けは受注日より前の実績を充当しないので、作り置きから出した受注は日報の進捗が付かない。
 * ここで工程と数を登録すると、次の集計で未割当の実績（顧客先・受注日を問わない）から充当される。
 * 引き当てられる受注（確定済み・生産中）でだけ描画する想定（API の `assignable` でも確かめる）。
 */
export function OrderStockAssignments({
  orderId,
  orderQuantity,
}: {
  orderId: number
  orderQuantity: number
}) {
  const { data, isLoading, isError } = useOrderStockAssignments(orderId)
  const { data: member } = useCurrentMember()
  const canEdit = member != null && DAILY_REPORT_NAME_EDITOR_ROLES.includes(member.role)
  const remove = useDeleteStockAssignment(orderId)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  if (!isLoading && !isError && data && !data.assignable && data.assignments.length === 0) {
    return null
  }

  const handleDelete = (assignmentId: string) => {
    remove.mutate(assignmentId, {
      onSuccess: () => toast.success("引き当てを取り消しました。次の集計で反映されます"),
      onError: (e) => toast.error(nameMutationErrorMessage(e, "引き当てを取り消せませんでした")),
    })
  }

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{STOCK_LABEL}からの引き当て</h2>
        {canEdit && data?.assignable && (
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            {STOCK_LABEL}から引き当てる
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        受注日より前に作った分や、日報の顧客先が違う分をこの受注に充てます。次の集計（10〜15分ごと）で工程の進捗に反映されます。
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">{STOCK_LABEL}の引き当てを取得できませんでした</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="text-muted-foreground">この製品の{STOCK_LABEL}（推定）: </span>
            {data.stock_estimates.length === 0
              ? "なし"
              : data.stock_estimates
                  .map((e) => `${stockPlaceLabel(e)} ${e.qty.toLocaleString()} 個`)
                  .join(" / ")}
          </p>
          {data.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">引き当てはありません</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">工程</th>
                  <th className="py-2 pr-2 text-right font-medium">数</th>
                  <th className="py-2 pr-2 font-medium">引き当てた日</th>
                  <th className="py-2 pr-2 font-medium">メモ</th>
                  {canEdit && <th className="py-2 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {data.assignments.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-2">{stockPlaceLabel(a)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{a.qty.toLocaleString()}</td>
                    <td className="py-2 pr-2">{formatWorkDate(a.assigned_on)}</td>
                    <td className="py-2 pr-2 break-all">{a.note ?? "－"}</td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => handleDelete(a.id)}
                        >
                          取り消す
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {dialogOpen && data && (
          <StockAssignmentDialogForm
            orderId={orderId}
            orderQuantity={orderQuantity}
            data={data}
            onClose={() => setDialogOpen(false)}
          />
        )}
      </Dialog>
    </div>
  )
}

function StockAssignmentDialogForm({
  orderId,
  orderQuantity,
  data,
  onClose,
}: {
  orderId: number
  orderQuantity: number
  data: OrderStockAssignmentsData
  onClose: () => void
}) {
  const [form, setForm] = React.useState<StockAssignmentForm>(() =>
    initialStockAssignmentForm(data, orderQuantity),
  )
  const [error, setError] = React.useState<string | null>(null)
  const save = useSaveStockAssignment(orderId)
  const ids = { qty: React.useId(), note: React.useId() }
  const estimate = data.stock_estimates.find((e) => e.process_name === form.processName)
  const existing = data.assignments.find((a) => a.process_name === form.processName)

  const update = (patch: Partial<StockAssignmentForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
  }

  const handleSave = () => {
    const result = toStockAssignmentInput(form, orderQuantity)
    if (result.error !== undefined) {
      setError(result.error)
      return
    }
    save.mutate(result.input, {
      onSuccess: () => {
        toast.success("引き当てを登録しました。次の集計で工程の進捗に反映されます")
        onClose()
      },
      onError: (e) => setError(nameMutationErrorMessage(e, "引き当てを登録できませんでした")),
    })
  }

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{STOCK_LABEL}から引き当てる</DialogTitle>
        <DialogDescription>
          どの工程まで済んだ{STOCK_LABEL}を何個この受注に充てたかを入力してください（受注数量{" "}
          {orderQuantity.toLocaleString()} 個）。前の工程は、後の工程の実績があれば完了になります。
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">どの工程まで済んだ{STOCK_LABEL}ですか</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="引き当てる工程">
            {data.process_names.map((name) => (
              <Button
                key={name}
                type="button"
                size="sm"
                variant={form.processName === name ? "secondary" : "outline"}
                aria-pressed={form.processName === name}
                onClick={() => update({ processName: name })}
              >
                {name}
              </Button>
            ))}
          </div>
          {form.processName && (
            <p className="text-xs text-muted-foreground">
              {estimate
                ? `${stockPlaceLabel(estimate)}の${STOCK_LABEL}（推定）: ${estimate.qty.toLocaleString()} 個`
                : `${stockPlaceLabel({ process_name: form.processName })}の${STOCK_LABEL}の推定はありません`}
              {existing && `。登録済みの引き当て（${existing.qty.toLocaleString()} 個）を上書きします`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="w-32 space-y-1.5">
            <Label htmlFor={ids.qty}>数</Label>
            <Input
              id={ids.qty}
              inputMode="numeric"
              value={form.qty}
              onChange={(e) => update({ qty: e.target.value })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor={ids.note}>メモ（任意）</Label>
            <Input
              id={ids.note}
              value={form.note}
              maxLength={500}
              onChange={(e) => update({ note: e.target.value })}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>
          キャンセル
        </Button>
        <Button onClick={handleSave} disabled={save.isPending}>
          引き当てる
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

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
import type {
  OrderStockAssignments as OrderStockAssignmentsData,
  StockSourceEntry,
} from "@/types/daily-report-stock"

/** 日報の明細の表記（日報の商品名・顧客先・設備）。引き当て元が正しいかを見分ける材料 */
function SourceEntries({ entries, empty }: { entries: StockSourceEntry[]; empty: string }) {
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-0.5 text-xs">
      {entries.map((e) => (
        <li key={e.entry_id} className="flex flex-wrap gap-x-3">
          <span className="tabular-nums">{formatWorkDate(e.work_date)}</span>
          <span className="break-all font-medium">{e.product_raw ?? "（商品名なし）"}</span>
          <span className="text-muted-foreground">
            {[e.customer_raw, e.equipment_raw].filter(Boolean).join(" / ") || "－"}
          </span>
          <span className="tabular-nums">{e.qty.toLocaleString()} 個</span>
        </li>
      ))}
    </ul>
  )
}

function productLabel(data: Pick<OrderStockAssignmentsData, "product_name" | "product_code">) {
  if (!data.product_name) return "－"
  return data.product_code ? `${data.product_name}（${data.product_code}）` : data.product_name
}

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
            <span className="text-muted-foreground">引き当て先（この受注の製品）: </span>
            {productLabel(data)}
          </p>
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
                  <React.Fragment key={a.id}>
                    <tr>
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
                    <tr className="border-b last:border-0">
                      <td colSpan={canEdit ? 5 : 4} className="pb-2">
                        <p className="mb-0.5 text-xs text-muted-foreground">引き当て元（日報の明細）</p>
                        <SourceEntries entries={a.sources} empty="次の集計で表示されます" />
                      </td>
                    </tr>
                  </React.Fragment>
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
  const candidates = data.candidates[form.processName] ?? []
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
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[520px]">
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
          {/* 工程を切り替えてもダイアログの高さが変わらないよう、説明文は最小高さ、候補は固定高の枠にする（Issue #633） */}
          <p className="min-h-8 text-xs text-muted-foreground">
            {form.processName
              ? `${
                  estimate
                    ? `${stockPlaceLabel(estimate)}の${STOCK_LABEL}（推定）: ${estimate.qty.toLocaleString()} 個`
                    : `${stockPlaceLabel({ process_name: form.processName })}の${STOCK_LABEL}の推定はありません`
                }${existing ? `。登録済みの引き当て（${existing.qty.toLocaleString()} 個）を上書きします` : ""}`
              : "工程を選ぶと、推定と引き当て元の候補を表示します"}
          </p>
          <div className="space-y-1 rounded-md border bg-muted/30 p-2">
            <p className="text-xs">
              <span className="text-muted-foreground">引き当て先: </span>
              {productLabel(data)}
            </p>
            <p className="text-xs text-muted-foreground">
              引き当て元の候補{form.processName ? `（${candidates.length} 件）` : ""}
              （日報の明細。新しい順に充てます）
            </p>
            <div className="h-40 overflow-y-auto" data-testid="stock-candidates">
              {form.processName ? (
                <SourceEntries
                  entries={candidates}
                  empty="この工程で未割当の日報の明細はありません"
                />
              ) : null}
            </div>
          </div>
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

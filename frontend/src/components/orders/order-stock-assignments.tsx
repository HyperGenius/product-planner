"use client"

import * as React from "react"
import { AlertTriangle } from "lucide-react"
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
import { useOrderProgress } from "@/hooks/use-daily-report-progress"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { formatWorkDate, nameMutationErrorMessage } from "@/lib/daily-report-name-utils"
import {
  STOCK_LABEL,
  distinctRawValues,
  initialStockAssignmentForm,
  plannedSourceUsage,
  stockAssignmentWarnings,
  stockPlaceLabel,
  stockProcessRows,
  suggestedStockQty,
  toStockAssignmentInput,
  type StockAssignmentForm,
} from "@/lib/daily-report-stock-utils"
import { cn } from "@/lib/utils"
import { DAILY_REPORT_NAME_EDITOR_ROLES } from "@/types/member"
import type {
  OrderStockAssignments as OrderStockAssignmentsData,
  StockSourceEntry,
} from "@/types/daily-report-stock"

/** 日報の明細の表記（日報の商品名・顧客先・設備）。引き当て元が正しいかを見分ける材料 */
function SourceEntries({
  entries,
  empty,
  usage,
}: {
  entries: StockSourceEntry[]
  empty: string
  /** 明細ごとの充当見込み（登録前のダイアログだけ。`plannedSourceUsage()`） */
  usage?: number[]
}) {
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-0.5 text-xs">
      {entries.map((e, i) => (
        <li key={e.entry_id} className="flex flex-wrap gap-x-3">
          <span className="tabular-nums">{formatWorkDate(e.work_date)}</span>
          <span className="break-all font-medium">{e.product_raw ?? "（商品名なし）"}</span>
          <span className="text-muted-foreground">
            {[e.customer_raw, e.equipment_raw].filter(Boolean).join(" / ") || "－"}
          </span>
          <span className="tabular-nums">{e.qty.toLocaleString()} 個</span>
          {usage && usage[i] > 0 && (
            <span className="font-medium tabular-nums text-primary">→ {usage[i].toLocaleString()} 個を充てる</span>
          )}
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
  orderCustomerId = null,
  orderCustomerLabel = null,
}: {
  orderId: number
  orderQuantity: number
  /** 受注の顧客（引き当て元の日報の顧客先と見比べる。Issue #673）。顧客不明なら null */
  orderCustomerId?: number | null
  /** 受注の顧客の通称（無ければ正式名） */
  orderCustomerLabel?: string | null
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
            orderCustomerId={orderCustomerId}
            orderCustomerLabel={orderCustomerLabel}
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
  orderCustomerId,
  orderCustomerLabel,
  data,
  onClose,
}: {
  orderId: number
  orderQuantity: number
  orderCustomerId: number | null
  orderCustomerLabel: string | null
  data: OrderStockAssignmentsData
  onClose: () => void
}) {
  const [form, setForm] = React.useState<StockAssignmentForm>(() =>
    initialStockAssignmentForm(data, orderQuantity),
  )
  // 数を手で変えたら、工程を切り替えても初期値で上書きしない
  const [qtyTouched, setQtyTouched] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const save = useSaveStockAssignment(orderId)
  const { data: progress } = useOrderProgress(orderId)
  const ids = { qty: React.useId(), note: React.useId(), radio: React.useId() }
  // 開いたときに初期選択の工程（工程ルートの後ろの方になりやすい）を表の中に見せる。
  // ダイアログの中身はポータルが最初の描画の後に DOM へ入れるので、useEffect ではなく枠が付いた時点（コールバック ref）で動かす。
  // scrollIntoView はダイアログ本体までスクロールさせるので、表の枠の scrollTop だけを動かす。
  // 依存なしなので枠が付いたときだけ呼ばれる（行を選んだときは見えている行を押しているので動かさない）
  const processTableRef = React.useCallback((container: HTMLDivElement | null) => {
    const row = container?.querySelector<HTMLElement>('[data-selected="true"]')
    if (container && row) {
      container.scrollTop = Math.max(0, row.offsetTop - container.clientHeight / 2)
    }
  }, [])

  const rows = stockProcessRows(data, progress?.processes)
  const selected = rows.find((r) => r.processName === form.processName)
  const candidates = data.candidates[form.processName] ?? []
  const usage = plannedSourceUsage(candidates, form.qty)
  const warnings = selected
    ? stockAssignmentWarnings({
        qtyText: form.qty,
        candidateQty: selected.candidateQty,
        usedEntries: candidates.filter((_, i) => usage[i] > 0),
        orderCustomerId,
        existingQty: selected.assignedQty,
      })
    : []

  const update = (patch: Partial<StockAssignmentForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
  }

  const selectProcess = (processName: string) => {
    update(
      qtyTouched
        ? { processName }
        : { processName, qty: suggestedStockQty(data, processName, orderQuantity) },
    )
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
    // 本文だけをスクロールさせ、見出しと「引き当てる」は常に見せる（低い画面でボタンが画面外に出ないように）
    <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-[720px]">
      <DialogHeader>
        <DialogTitle>{STOCK_LABEL}から引き当てる</DialogTitle>
        <DialogDescription>
          どの工程まで済んだものを、この受注に何個充てるかを選んでください。前の工程は、後の工程に実績があれば完了になります。
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6">
        {/* ① 工程を選ぶ（工程 × 数量の表） */}
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">① どの工程まで済んだものですか</h3>
          {/* 工程の数でダイアログの高さが変わらないよう、表は固定高でスクロールさせる（Issue #633） */}
          <div
            ref={processTableRef}
            className="h-48 overflow-y-auto rounded-md border"
            data-testid="stock-process-table"
          >
            <table className="w-full text-sm" aria-label="引き当てる工程">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="w-8 py-1.5 pl-2" />
                  <th className="py-1.5 pr-2 font-medium">済んだ工程</th>
                  <th className="py-1.5 pr-2 text-right font-medium">{STOCK_LABEL}（推定）</th>
                  <th className="py-1.5 pr-2 text-right font-medium">未割当の日報</th>
                  <th className="py-1.5 pr-2 text-right font-medium">この受注の実績</th>
                  <th className="py-1.5 pr-2 text-right font-medium">登録済み</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const checked = row.processName === form.processName
                  const radioId = `${ids.radio}-${row.processName}`
                  return (
                    <tr
                      key={row.processName}
                      data-selected={checked}
                      className={cn(
                        "cursor-pointer border-b last:border-0 hover:bg-muted/50",
                        checked && "bg-muted",
                        !row.hasStock && !checked && "text-muted-foreground",
                      )}
                      onClick={() => selectProcess(row.processName)}
                    >
                      <td className="py-1.5 pl-2">
                        <input
                          type="radio"
                          id={radioId}
                          name={ids.radio}
                          checked={checked}
                          onChange={() => selectProcess(row.processName)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <label htmlFor={radioId} className="cursor-pointer">
                          {row.processName}
                        </label>
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                        {row.estimateQty ? `${row.estimateQty.toLocaleString()} 個` : "－"}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                        {row.candidateCount > 0
                          ? `${row.candidateCount.toLocaleString()} 件 / ${row.candidateQty.toLocaleString()} 個`
                          : "－"}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                        {row.actualQty === null ? "－" : row.actualQty.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                        {row.assignedQty === null ? "" : `${row.assignedQty.toLocaleString()} 個`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ② 照合（引き当て元と引き当て先を横に並べる） */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium">② 引き当て元と引き当て先が合っているか確かめてください</h3>
          {selected ? (
            <>
              <table className="w-full table-fixed text-sm" data-testid="stock-comparison">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-14 py-1.5 pr-2 font-medium" />
                    <th className="py-1.5 pr-2 font-medium">引き当て元（日報の表記）</th>
                    <th className="py-1.5 font-medium">引き当て先（この受注）</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  <ComparisonRow
                    label="品名"
                    from={distinctRawValues(candidates, "product_raw").join(" / ") || "（日報の明細なし）"}
                    to={productLabel(data)}
                  />
                  <ComparisonRow
                    label="顧客"
                    from={distinctRawValues(candidates, "customer_raw").join(" / ") || "－"}
                    to={orderCustomerLabel ?? "顧客不明"}
                  />
                  <ComparisonRow
                    label="工程"
                    from={`「${selected.processName}」まで済み`}
                    to={
                      selected.nextProcessName
                        ? `次は「${selected.nextProcessName}」から`
                        : "残りの工程はありません"
                    }
                  />
                  <ComparisonRow
                    label="数"
                    from={`未割当の日報 合計 ${selected.candidateQty.toLocaleString()} 個（${selected.candidateCount.toLocaleString()} 件）`}
                    to={`受注数量 ${orderQuantity.toLocaleString()} 個`}
                  />
                </tbody>
              </table>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  引き当て元の明細（{selected.candidateCount.toLocaleString()} 件。新しい順に充てます
                  {selected.candidateCount > candidates.length
                    ? `。新しい ${candidates.length} 件を表示`
                    : ""}
                  ）
                </p>
                <div className="h-32 overflow-y-auto rounded-md border bg-muted/30 p-2" data-testid="stock-candidates">
                  <SourceEntries
                    entries={candidates}
                    usage={usage}
                    empty="この工程で未割当の日報の明細はありません"
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">工程を選ぶと、引き当て元と引き当て先を並べて表示します</p>
          )}
        </section>

        <div className="flex flex-wrap gap-3">
          <div className="w-32 space-y-1.5">
            <Label htmlFor={ids.qty}>引き当てる数</Label>
            <Input
              id={ids.qty}
              inputMode="numeric"
              value={form.qty}
              onChange={(e) => {
                setQtyTouched(true)
                update({ qty: e.target.value })
              }}
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
      </div>

      {/* 注意とエラーは登録の直前に必ず目に入るよう、本文のスクロールの外（ボタンの上）に出す */}
      {warnings.length > 0 && (
        <ul
          className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900"
          aria-label="注意"
        >
          {warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

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

function ComparisonRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-1.5 pr-2 text-left text-xs font-medium text-muted-foreground">
        {label}
      </th>
      <td className="break-words py-1.5 pr-2">{from}</td>
      <td className="break-words py-1.5">{to}</td>
    </tr>
  )
}

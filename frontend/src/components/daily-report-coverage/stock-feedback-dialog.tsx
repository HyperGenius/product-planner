"use client"

import * as React from "react"
import { format } from "date-fns"
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
import { useDeleteStockFeedback, useSaveStockFeedback } from "@/hooks/use-daily-report-stock"
import { useProcessRoutings } from "@/hooks/use-process-routings"
import { nameMutationErrorMessage } from "@/lib/daily-report-name-utils"
import {
  STOCK_LABEL,
  initialStockFeedbackForm,
  toStockFeedbackInput,
  type StockFeedbackForm,
} from "@/lib/daily-report-stock-utils"
import { cn } from "@/lib/utils"
import type { StockFeedback, StockFeedbackKind } from "@/types/daily-report-stock"

export interface StockFeedbackTarget {
  productId: number
  productLabel: string
  /** 選択済みにしておく工程（推定が出ている工程） */
  processName: string
}

const KIND_OPTIONS: { kind: StockFeedbackKind; label: string }[] = [
  { kind: "stock_process", label: `${STOCK_LABEL}の工程・数が違う` },
  { kind: "not_stocked", label: `${STOCK_LABEL}していない` },
]

/**
 * 作り置きの推定への「ここは違う」の指摘 (Issue #591)。
 * 製品単位で1件（登録し直すと上書き）。推定への反映は次の集計の後。
 */
export function StockFeedbackDialog({
  target,
  feedback,
  onOpenChange,
}: {
  target: StockFeedbackTarget | null
  feedback: StockFeedback | undefined
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
    >
      {target && (
        <StockFeedbackDialogForm
          key={target.productId}
          target={target}
          feedback={feedback}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

function StockFeedbackDialogForm({
  target,
  feedback,
  onClose,
}: {
  target: StockFeedbackTarget
  feedback: StockFeedback | undefined
  onClose: () => void
}) {
  const [form, setForm] = React.useState<StockFeedbackForm>(() =>
    initialStockFeedbackForm(feedback, {
      processName: target.processName,
      today: format(new Date(), "yyyy-MM-dd"),
    }),
  )
  const [error, setError] = React.useState<string | null>(null)
  const { data: routings } = useProcessRoutings(target.productId)
  const save = useSaveStockFeedback()
  const remove = useDeleteStockFeedback()
  const isPending = save.isPending || remove.isPending
  const ids = {
    qty: React.useId(),
    date: React.useId(),
    note: React.useId(),
  }

  const processNames = React.useMemo(() => {
    const names = [...(routings ?? [])]
      .sort((a, b) => a.sequence_order - b.sequence_order)
      .map((r) => r.process_name)
    // 工程ルートの読み込み前・工程名を変えた後でも、選択中の工程は選べるようにする
    if (form.processName && !names.includes(form.processName)) names.unshift(form.processName)
    return [...new Set(names)]
  }, [routings, form.processName])

  const update = (patch: Partial<StockFeedbackForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
  }

  const handleSave = () => {
    const result = toStockFeedbackInput(form)
    if (result.error !== undefined) {
      setError(result.error)
      return
    }
    save.mutate(
      { productId: target.productId, data: result.input },
      {
        onSuccess: () => {
          toast.success("指摘を登録しました。次の集計で反映されます")
          onClose()
        },
        onError: (e) => setError(nameMutationErrorMessage(e, "指摘を登録できませんでした")),
      },
    )
  }

  const handleDelete = () => {
    remove.mutate(target.productId, {
      onSuccess: () => {
        toast.success("指摘を取り消しました。次の集計で推定に戻ります")
        onClose()
      },
      onError: (e) => setError(nameMutationErrorMessage(e, "指摘を取り消せませんでした")),
    })
  }

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{STOCK_LABEL}の推定が違う</DialogTitle>
        <DialogDescription className="break-all">
          {target.productLabel}。現場で確かめた内容を入力してください。次の集計（10〜15分ごと）で推定に反映されます。
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="指摘の内容">
          {KIND_OPTIONS.map((option) => (
            <Button
              key={option.kind}
              type="button"
              variant={form.kind === option.kind ? "secondary" : "outline"}
              aria-pressed={form.kind === option.kind}
              onClick={() => update({ kind: option.kind })}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {form.kind === "stock_process" && (
          <>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">どの工程の後に置いていますか</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`${STOCK_LABEL}の工程`}>
                {processNames.map((name) => (
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
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="w-32 space-y-1.5">
                <Label htmlFor={ids.qty}>実際の数（任意）</Label>
                <Input
                  id={ids.qty}
                  inputMode="numeric"
                  value={form.baselineQty}
                  onChange={(e) => update({ baselineQty: e.target.value })}
                />
              </div>
              <div className="w-44 space-y-1.5">
                <Label htmlFor={ids.date}>いつの時点の数か</Label>
                <Input
                  id={ids.date}
                  type="date"
                  value={form.baselineDate}
                  disabled={!form.baselineQty.trim()}
                  onChange={(e) => update({ baselineDate: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              数を入れると、その日の作業を終えた時点の数として、以降の日報で増減させます。
            </p>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={ids.note}>メモ（任意）</Label>
          <textarea
            id={ids.note}
            value={form.note}
            rows={2}
            maxLength={500}
            onChange={(e) => update({ note: e.target.value })}
            className={cn(
              "border-input placeholder:text-muted-foreground w-full min-w-0 resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none",
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            )}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {feedback ? (
          <Button variant="ghost" onClick={handleDelete} disabled={isPending}>
            指摘を取り消す
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {save.isPending ? "登録中..." : "登録する"}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}

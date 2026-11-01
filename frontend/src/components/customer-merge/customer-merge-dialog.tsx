"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ApiError } from "@/lib/api-client"
import { useCustomers } from "@/hooks/use-customers"
import { useCustomerMergePreview, useMergeCustomers } from "@/hooks/use-customer-merge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { CustomerSelector } from "@/components/customer-selector"
import type { Customer, CustomerMergeCounts } from "@/types/customer"

interface CustomerMergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 付け替え件数の表示。0件の行は出さない */
export function mergeCountLines(counts: CustomerMergeCounts): string[] {
  const lines: Array<[string, number]> = [
    ["注文", counts.orders_reassigned],
    ["注文書の添付・取り込み待ち", counts.attachments_reassigned],
    ["製品の別名", counts.aliases_reassigned],
    ["製品の別名の履歴", counts.alias_history_reassigned],
    ["顧客の別名（日報）", counts.customer_aliases_reassigned],
    ["日報の未割当の実績", counts.unallocated_actuals_reassigned],
    ["抽出指示の履歴", counts.prompt_history_reassigned],
    ["担当者（メールアドレス）", counts.contacts_reassigned],
  ]
  return lines.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}件`)
}

/**
 * 重複顧客の統合ダイアログ（Issue #610）。残す顧客と統合される顧客を選び、
 * プレビュー（付け替え件数・統合できない理由）を確認してから実行する。
 */
export function CustomerMergeDialog({ open, onOpenChange }: CustomerMergeDialogProps) {
  const [keepId, setKeepId] = useState("")
  const [mergeIds, setMergeIds] = useState<number[]>([])
  const [filter, setFilter] = useState("")

  const { data: customers } = useCustomers()
  const mergeMutation = useMergeCustomers()

  const keepCustomerId = keepId ? Number(keepId) : null
  const effectiveMergeIds = mergeIds.filter((id) => id !== keepCustomerId)
  const { data: preview, isFetching, error } = useCustomerMergePreview(
    keepCustomerId !== null && effectiveMergeIds.length > 0
      ? { keep_customer_id: keepCustomerId, merge_customer_ids: effectiveMergeIds }
      : null,
  )

  const reset = () => {
    setKeepId("")
    setMergeIds([])
    setFilter("")
  }

  const handleOpenChange = (next: boolean) => {
    if (mergeMutation.isPending) return
    if (!next) reset()
    onOpenChange(next)
  }

  const toggle = (id: number, checked: boolean) =>
    setMergeIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))

  const candidates: Customer[] = (customers ?? []).filter(
    (c) =>
      c.id !== keepCustomerId &&
      (!filter.trim() || `${c.name} ${c.alias ?? ""}`.includes(filter.trim())),
  )

  const handleConfirm = () => {
    if (keepCustomerId === null || !preview || preview.blockers.length > 0) return
    mergeMutation.mutate(
      { keep_customer_id: keepCustomerId, merge_customer_ids: effectiveMergeIds },
      {
        onSuccess: () => {
          toast.success(`${effectiveMergeIds.length}件の顧客を統合しました`)
          reset()
          onOpenChange(false)
        },
        onError: (e) => {
          // 状況が変わった場合の 409 はプレビューからやり直してもらう。生の DB 文言は出さない
          toast.error(
            e instanceof ApiError && e.status === 409
              ? "統合できませんでした。内容を確認してやり直してください"
              : "顧客の統合に失敗しました",
          )
        },
      },
    )
  }

  const canConfirm =
    preview !== undefined && preview.blockers.length === 0 && !isFetching && !mergeMutation.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>顧客の統合</DialogTitle>
          <DialogDescription>
            重複して登録された顧客を1つにまとめます。注文などは残す顧客へ移り、メールアドレスは担当者として引き継ぎます。
            この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">残す顧客</p>
            <CustomerSelector
              value={keepId}
              onValueChange={(value) => setKeepId(value)}
              disabled={mergeMutation.isPending}
            />
          </div>

          {keepCustomerId !== null && (
            <div className="space-y-2">
              <Label htmlFor="customer-merge-filter">統合する顧客（複数選べます）</Label>
              <Input
                id="customer-merge-filter"
                placeholder="顧客名・通称で絞り込み"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`customer-merge-${c.id}`}
                      checked={effectiveMergeIds.includes(c.id)}
                      onCheckedChange={(checked) => toggle(c.id, checked === true)}
                    />
                    <Label htmlFor={`customer-merge-${c.id}`} className="font-normal">
                      {c.name}
                      {c.alias ? `（${c.alias}）` : ""}
                      {c.email ? ` ${c.email}` : ""}
                    </Label>
                  </li>
                ))}
                {candidates.length === 0 && (
                  <li className="text-sm text-muted-foreground">該当する顧客がありません</li>
                )}
              </ul>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">プレビューを取得できませんでした</p>
          )}

          {preview && (
            <div className="space-y-3 rounded-md border bg-muted/40 p-3 text-sm">
              <p>
                {preview.merge_customers.map((c) => `「${c.name}」`).join("")}
                を統合し、統合した顧客は削除されます。
              </p>
              {preview.blockers.length > 0 ? (
                <div className="space-y-1 text-destructive">
                  <p className="font-medium">統合できません（同じ製品・納期の注文が重複します）</p>
                  <ul className="list-disc pl-5">
                    {preview.blockers.map((b) => (
                      <li key={b.order_id}>
                        {b.customer_name} の注文 {b.order_number ?? `ID ${b.order_id}`} が
                        {` `}
                        {b.conflicting_order_number ?? `ID ${b.conflicting_order_id}`} と重複
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs">どちらかの注文の納期・製品を直すか削除してから統合してください。</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">残す顧客へ移るもの</p>
                  <ul className="list-disc pl-5">
                    {mergeCountLines(preview.counts).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                    {mergeCountLines(preview.counts).length === 0 && <li>なし</li>}
                  </ul>
                  {preview.counts.aliases_dropped > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      残す顧客と同じ表記の製品の別名 {preview.counts.aliases_dropped}件は、残す顧客の登録を優先します。
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    日報の進捗は次回の自動再計算で反映されます。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={mergeMutation.isPending}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canConfirm}>
            {mergeMutation.isPending ? "統合中..." : "統合する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

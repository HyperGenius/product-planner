"use client"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { ProductMergeCandidate, ProductMergePreview } from "@/types/product"

interface MergeConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keep: ProductMergeCandidate
  mergeProducts: ProductMergeCandidate[]
  preview: ProductMergePreview
  isPending: boolean
  onConfirm: () => void
}

/**
 * 統合の確認ダイアログ（Issue #515）。付け替え・削除される件数を示す。
 * 統合の完了を待って閉じる（失敗時は開いたまま残す）ため `AlertDialogAction` ではなく `Button` を使う。
 */
export function MergeConfirmDialog({
  open,
  onOpenChange,
  keep,
  mergeProducts,
  preview,
  isPending,
  onConfirm,
}: MergeConfirmDialogProps) {
  const { counts } = preview
  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>製品の統合</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                {mergeProducts.length}件の製品を「{keep.name}」に統合します。この操作は取り消せません。
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {mergeProducts.map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
              </ul>
              <div>
                <p className="font-medium text-foreground">残す製品へ付け替え</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>受注 {counts.orders_reassigned}件</li>
                  <li>
                    スケジュールのセグメント {counts.schedules_reassigned}件（時刻・設備は変わりません）
                  </li>
                  <li>
                    別名 {counts.aliases_reassigned}件（表記ゆれ履歴 {counts.alias_history_reassigned}件）
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground">削除</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>工程 {counts.routings_deleted}件</li>
                  <li>製品 {counts.products_deleted}件</li>
                  {counts.orders_deleted > 0 && (
                    <li>
                      付け替え先と重複する送品済みの受注 {counts.orders_deleted}件（
                      {preview.deleted_orders.map((o) => o.order_number ?? `ID ${o.id}`).join("、")}）
                    </li>
                  )}
                </ul>
              </div>
              <p className="text-xs">
                日報の進捗は次回の自動再計算（10〜15分ごと）で反映されます。
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "統合中..." : "統合する"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

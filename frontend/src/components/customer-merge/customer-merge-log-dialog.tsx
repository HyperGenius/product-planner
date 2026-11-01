"use client"

import { format } from "date-fns"
import { useCustomerMergeLog } from "@/hooks/use-customer-merge"
import { mergeCountLines } from "@/components/customer-merge/customer-merge-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface CustomerMergeLogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 顧客の統合の履歴（どの顧客をどこへ統合したか。Issue #610） */
export function CustomerMergeLogDialog({ open, onOpenChange }: CustomerMergeLogDialogProps) {
  const { data: log, isLoading, error } = useCustomerMergeLog(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>顧客の統合履歴</DialogTitle>
          <DialogDescription>新しい順に表示します</DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm">読み込み中...</p>}
        {error && <p className="text-sm text-destructive">履歴を取得できませんでした</p>}
        {log && log.length === 0 && (
          <p className="text-sm text-muted-foreground">統合の履歴はありません</p>
        )}
        <ul className="space-y-3">
          {log?.map((entry) => (
            <li key={entry.id} className="rounded-md border p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {format(new Date(entry.merged_at), "yyyy/MM/dd HH:mm")}
              </p>
              <p>
                {entry.merged_customers.map((c) => `「${c.name}」`).join("")}
                {" → "}「{entry.keep_customer_name}」
              </p>
              <p className="text-xs text-muted-foreground">
                {mergeCountLines(entry.counts).join("、") || "付け替えなし"}
              </p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

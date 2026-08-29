"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useProductNameAliasHistory } from "@/hooks/use-products"
import type { ProductNameAliasHistoryEntry, Product } from "@/types/product"

interface ProductNameAliasHistoryDialogProps {
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ACTION_LABELS: Record<string, string> = {
  created: "新規登録",
  updated: "上書き修正",
}

const ALL_CUSTOMERS = "__all__"

/**
 * 履歴エントリを顧客ごとにグルーピング/フィルタするためのキー。
 * 顧客が削除されると customer_id は null になるため、その場合は
 * スナップショット名でまとめる（Issue #349）。
 */
function customerKey(entry: ProductNameAliasHistoryEntry): string {
  return entry.customer_id != null
    ? `id:${entry.customer_id}`
    : `snap:${entry.customer_name_snapshot}`
}

/**
 * 製品名の表記ゆれ修正履歴ダイアログ（Issue #347 / 顧客スコープ化: Issue #349）
 *
 * メール起票の下書きで担当者が product_id を修正した際に記録される
 * 別名（(customer_id, raw_text) → product_id）の対応履歴を、いつ・誰が・
 * どの顧客の・どの注文をトリガに登録したかとあわせて一覧表示する。
 */
export function ProductNameAliasHistoryDialog({
  product,
  open,
  onOpenChange,
}: ProductNameAliasHistoryDialogProps) {
  const { data: history, isLoading } = useProductNameAliasHistory(product?.id ?? null)
  const [customerFilter, setCustomerFilter] = useState<string>(ALL_CUSTOMERS)

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of history ?? []) {
      map.set(customerKey(entry), entry.customer_name_snapshot)
    }
    return Array.from(map, ([key, label]) => ({ key, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "ja"),
    )
  }, [history])

  const visibleHistory = useMemo(() => {
    if (!history) return []
    if (customerFilter === ALL_CUSTOMERS) return history
    return history.filter((entry) => customerKey(entry) === customerFilter)
  }, [history, customerFilter])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>表記ゆれ履歴</DialogTitle>
          <DialogDescription>
            {product?.name}
            （{product?.code}）について、メール起票時の製品名の表記ゆれを
            担当者が修正した履歴です。別名は顧客ごとに管理されます。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            読み込み中...
          </div>
        ) : !history || history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            表記ゆれの修正履歴はありません
          </p>
        ) : (
          <div className="space-y-3">
            {customerOptions.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">顧客で絞り込み</span>
                <Select value={customerFilter} onValueChange={setCustomerFilter}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_CUSTOMERS}>すべての顧客</SelectItem>
                    {customerOptions.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>顧客</TableHead>
                    <TableHead>メール上の表記</TableHead>
                    <TableHead>区分</TableHead>
                    <TableHead>登録者</TableHead>
                    <TableHead>トリガー注文</TableHead>
                    <TableHead>登録日時</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.customer_name_snapshot}</TableCell>
                      <TableCell className="font-medium">{entry.raw_text}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.changed_by_full_name ?? "不明"}</TableCell>
                      <TableCell>
                        {entry.source_order_id ? (
                          <Link
                            href={`/orders/${entry.source_order_id}`}
                            className="text-primary underline underline-offset-2"
                          >
                            {entry.source_order_label_snapshot}
                          </Link>
                        ) : (
                          entry.source_order_label_snapshot
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(entry.changed_at).toLocaleString("ja-JP")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

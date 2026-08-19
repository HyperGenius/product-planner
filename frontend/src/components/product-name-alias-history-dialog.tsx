"use client"

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useProductNameAliasHistory } from "@/hooks/use-products"
import type { Product } from "@/types/product"

interface ProductNameAliasHistoryDialogProps {
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ACTION_LABELS: Record<string, string> = {
  created: "新規登録",
  updated: "上書き修正",
}

/**
 * 製品名の表記ゆれ修正履歴ダイアログ（Issue #347）
 *
 * メール起票の下書きで担当者が product_id を修正した際に記録される
 * 別名（raw_text → product_id）の対応履歴を、いつ・誰が・どの注文を
 * トリガに登録したかとあわせて一覧表示する。
 */
export function ProductNameAliasHistoryDialog({
  product,
  open,
  onOpenChange,
}: ProductNameAliasHistoryDialogProps) {
  const { data: history, isLoading } = useProductNameAliasHistory(product?.id ?? null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>表記ゆれ履歴</DialogTitle>
          <DialogDescription>
            {product?.name}
            （{product?.code}）について、メール起票時の製品名の表記ゆれを
            担当者が修正した履歴です。
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
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>メール上の表記</TableHead>
                  <TableHead>区分</TableHead>
                  <TableHead>登録者</TableHead>
                  <TableHead>トリガー注文</TableHead>
                  <TableHead>登録日時</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => (
                  <TableRow key={entry.id}>
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
        )}
      </DialogContent>
    </Dialog>
  )
}

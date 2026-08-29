"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  useDeleteProductAlias,
  useProductNameAliasHistory,
  useProducts,
  useUpdateProductAlias,
} from "@/hooks/use-products"
import type { ProductNameAliasHistoryEntry, Product } from "@/types/product"

interface ProductNameAliasHistoryDialogProps {
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ACTION_LABELS: Record<string, string> = {
  created: "新規登録",
  updated: "上書き修正",
  deleted: "削除",
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
 * 製品名の表記ゆれ修正履歴ダイアログ（Issue #347 / 顧客スコープ化: Issue #349 /
 * 由来表示・直接編集: Issue #350, #351）
 *
 * メール起票の下書きで担当者が product_id を修正した際、あるいは自動マッチのまま
 * 承認依頼された際に記録される別名（(customer_id, raw_text) → product_id）の
 * 対応履歴を一覧表示する。現在も有効なエントリ（alias_id あり）は、その場で
 * 別製品への付け替え・削除ができる（president の承認フロー不要）。
 */
export function ProductNameAliasHistoryDialog({
  product,
  open,
  onOpenChange,
}: ProductNameAliasHistoryDialogProps) {
  const { data: history, isLoading } = useProductNameAliasHistory(product?.id ?? null)
  const { data: products } = useProducts()
  const updateAlias = useUpdateProductAlias()
  const deleteAlias = useDeleteProductAlias()
  const [customerFilter, setCustomerFilter] = useState<string>(ALL_CUSTOMERS)

  // 付け替え対象 / 削除対象の履歴エントリ（ダイアログ制御用）
  const [repointTarget, setRepointTarget] =
    useState<ProductNameAliasHistoryEntry | null>(null)
  const [repointProductId, setRepointProductId] = useState<string>("")
  const [deleteTarget, setDeleteTarget] =
    useState<ProductNameAliasHistoryEntry | null>(null)

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of history ?? []) {
      map.set(customerKey(entry), entry.customer_name_snapshot)
    }
    return Array.from(map, ([key, label]) => ({ key, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "ja"),
    )
  }, [history])

  // 別製品のダイアログを開き直した等で前回のフィルタ値が現在の履歴に存在しない
  // 場合、そのまま使うと「該当0件・Select も非表示」で復帰不能になる。無効な値は
  // 「すべての顧客」と同等に扱う（state はそのままでも表示・絞り込みは破綻しない）。
  const effectiveFilter =
    customerFilter === ALL_CUSTOMERS ||
    customerOptions.some((opt) => opt.key === customerFilter)
      ? customerFilter
      : ALL_CUSTOMERS

  const visibleHistory = useMemo(() => {
    if (!history) return []
    if (effectiveFilter === ALL_CUSTOMERS) return history
    return history.filter((entry) => customerKey(entry) === effectiveFilter)
  }, [history, effectiveFilter])

  // 付け替え先候補: 現在の製品以外の有効な製品
  const repointCandidates = useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.id !== product?.id && p.is_active)
        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [products, product?.id],
  )

  const closeRepoint = () => {
    setRepointTarget(null)
    setRepointProductId("")
  }

  const handleRepoint = async () => {
    if (!product || !repointTarget?.alias_id || !repointProductId) return
    try {
      await updateAlias.mutateAsync({
        productId: product.id,
        aliasId: repointTarget.alias_id,
        data: { product_id: Number(repointProductId) },
      })
      toast.success("別名の向き先製品を付け替えました")
      closeRepoint()
    } catch {
      toast.error("別名の付け替えに失敗しました")
    }
  }

  const handleDelete = async () => {
    if (!product || !deleteTarget?.alias_id) return
    try {
      await deleteAlias.mutateAsync({
        productId: product.id,
        aliasId: deleteTarget.alias_id,
      })
      toast.success("別名を削除しました")
      setDeleteTarget(null)
    } catch {
      toast.error("別名の削除に失敗しました")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>表記ゆれ履歴</DialogTitle>
          <DialogDescription>
            {product?.name}
            （{product?.code}）について、メール起票時の製品名の表記ゆれを
            担当者が修正した履歴、および自動マッチのまま承認依頼された履歴です。
            別名は顧客ごとに管理されます。「未確認」は担当者が明示的に確認して
            いない自動マッチ結果です。
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
                <Select value={effectiveFilter} onValueChange={setCustomerFilter}>
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
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.customer_name_snapshot}</TableCell>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {entry.raw_text}
                          {entry.source === "auto_match_unreviewed" && (
                            <Badge
                              variant="outline"
                              className="border-amber-500 text-amber-600"
                            >
                              未確認
                            </Badge>
                          )}
                        </span>
                      </TableCell>
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
                      <TableCell className="text-right">
                        {entry.alias_id ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRepointTarget(entry)
                                setRepointProductId("")
                              }}
                            >
                              別製品へ付け替え
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setDeleteTarget(entry)}
                            >
                              削除
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>

      {/* 別製品へ付け替え */}
      <Dialog
        open={repointTarget !== null}
        onOpenChange={(o) => !o && closeRepoint()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>別製品へ付け替え</DialogTitle>
            <DialogDescription>
              「{repointTarget?.raw_text}」（顧客:{" "}
              {repointTarget?.customer_name_snapshot}）の向き先を別の製品へ
              付け替えます。以後この表記は付け替え先の製品にマッチします。
            </DialogDescription>
          </DialogHeader>
          <Select value={repointProductId} onValueChange={setRepointProductId}>
            <SelectTrigger>
              <SelectValue placeholder="付け替え先の製品を選択" />
            </SelectTrigger>
            <SelectContent>
              {repointCandidates.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                  {p.code ? `（${p.code}）` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={closeRepoint}>
              キャンセル
            </Button>
            <Button
              onClick={handleRepoint}
              disabled={!repointProductId || updateAlias.isPending}
            >
              {updateAlias.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              付け替える
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>別名を削除しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.raw_text}」（顧客:{" "}
              {deleteTarget?.customer_name_snapshot}）の別名を削除します。
              以後この表記は辞書ヒットせず、通常のマッチング（図番の完全一致 →
              曖昧検索）に戻ります。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

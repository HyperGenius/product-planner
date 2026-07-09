"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  Download,
  Mail,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductSelector } from "@/components/product-selector"
import { CustomerSelector } from "@/components/customer-selector"
import { useSplitOrder, useOrderAttachments } from "@/hooks/use-orders"
import { useCustomers } from "@/hooks/use-customers"
import { getCustomerName } from "@/lib/order-utils"
import type { Order } from "@/types/order"

/**
 * source_raw の先頭に含まれる「件名: ...」行を件名として切り出し、
 * 残りを本文として返す。件名行が見つからない場合は全体を本文として扱う。
 */
function splitSubjectAndBody(sourceRaw?: string | null): {
  subject?: string
  body?: string
} {
  if (!sourceRaw) return {}
  const match = sourceRaw.match(/^件名[:：]\s*(.*)$/m)
  if (!match || match.index == null) return { body: sourceRaw }
  const subject = match[1].trim()
  const body = sourceRaw.slice(match.index + match[0].length).replace(/^\s+/, "")
  return { subject: subject || undefined, body: body || undefined }
}

interface SplitOrderDialogProps {
  order: Order | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSplit?: () => void
}

interface SplitLineItemForm {
  productId: string
  customerId: string
  quantity: string
  desiredDeadline: string
}

function emptyLineItem(order: Order): SplitLineItemForm {
  return {
    productId: order.product_id?.toString() ?? "",
    customerId: order.customer_id?.toString() ?? "",
    quantity: "",
    desiredDeadline: order.desired_deadline ? order.desired_deadline.slice(0, 10) : "",
  }
}

export function SplitOrderDialog({
  order,
  open,
  onOpenChange,
  onSplit,
}: SplitOrderDialogProps) {
  const splitOrder = useSplitOrder()
  const [items, setItems] = useState<SplitLineItemForm[]>([])
  const [error, setError] = useState("")

  const { data: attachments } = useOrderAttachments(order?.id ?? 0)
  const { data: customers } = useCustomers()
  const { subject, body } = splitSubjectAndBody(order?.source_raw)

  // ダイアログを開いた時点の注文内容を初期値として2行を用意する
  useEffect(() => {
    if (open && order) {
      setItems([emptyLineItem(order), emptyLineItem(order)])
      setError("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id])

  if (!order) return null

  const updateItem = (index: number, patch: Partial<SplitLineItemForm>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const addItem = () => setItems((prev) => [...prev, emptyLineItem(order)])

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setItems([])
      setError("")
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = () => {
    setError("")

    if (items.length < 2) {
      setError("分割後の明細は2件以上入力してください")
      return
    }

    const lineItems = []
    for (const item of items) {
      const parsedProductId = parseInt(item.productId, 10)
      const parsedQuantity = parseInt(item.quantity, 10)
      if (!item.productId || isNaN(parsedProductId)) {
        setError("すべての明細で製品を選択してください")
        return
      }
      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        setError("すべての明細で数量を正しく入力してください")
        return
      }
      if (!item.desiredDeadline) {
        setError("すべての明細で希望納期を入力してください")
        return
      }
      lineItems.push({
        product_id: parsedProductId,
        quantity: parsedQuantity,
        desired_deadline: item.desiredDeadline,
        customer_id: item.customerId ? parseInt(item.customerId, 10) : undefined,
      })
    }

    splitOrder.mutate(
      { id: order.id, data: { line_items: lineItems } },
      {
        onSuccess: () => {
          toast.success(`注文を${lineItems.length}件に分割しました`)
          handleClose(false)
          onSplit?.()
        },
        onError: (err: Error) => {
          setError(err.message || "分割に失敗しました")
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[960px]">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>注文の分割</DialogTitle>
          <DialogDescription>
            誤って1件にマージされた下書き注文を、複数の下書き注文に分割します。
            分割後の各注文は、元の注文と同じメール／添付ファイルを参照します。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 border-t">
          {/* 左: 参照元メール（分割単位を判断するための情報） */}
          <div className="w-[300px] shrink-0 space-y-4 overflow-y-auto border-r bg-muted/30 p-5">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Mail className="h-4 w-4" />
              参照元メール
            </div>

            {subject && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">件名</p>
                <p className="text-sm font-medium break-words">{subject}</p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">顧客</p>
              <p className="text-sm font-medium">
                {order.customer_id ? (
                  getCustomerName(order.customer_id, customers)
                ) : (
                  <span className="text-muted-foreground">未設定</span>
                )}
              </p>
            </div>

            {body && (
              <div className="rounded-md border bg-background p-3">
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {body}
                </pre>
              </div>
            )}

            <div className="space-y-1.5 border-t pt-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                添付ファイル
              </p>
              {attachments && attachments.length > 0 ? (
                <ul className="space-y-1.5">
                  {attachments.map((att) => (
                    <li key={att.id} className="text-xs">
                      {att.parse_status === "failed_no_attachment" ? (
                        <span className="text-muted-foreground">添付ファイルなし</span>
                      ) : att.parse_status === "failed_encrypted" ||
                        att.parse_status === "failed_image" ? (
                        <span className="flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          自動読み取り不可
                          {att.signed_url && (
                            <a
                              href={att.signed_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1 underline text-primary"
                            >
                              {att.original_filename}
                            </a>
                          )}
                        </span>
                      ) : (
                        <a
                          href={att.signed_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-primary underline"
                        >
                          <Download className="h-3 w-3 shrink-0" />
                          {att.original_filename}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">添付ファイルなし</p>
              )}
            </div>
          </div>

          {/* 右: 分割フォーム */}
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {items.map((item, index) => (
              <div key={index} className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">明細 {index + 1}</span>
                  {items.length > 2 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      className="h-7 w-7 p-0 text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <ProductSelector
                  value={item.productId}
                  onValueChange={(value) => updateItem(index, { productId: value })}
                />

                <CustomerSelector
                  value={item.customerId}
                  onValueChange={(value) => updateItem(index, { customerId: value })}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`split-quantity-${index}`}>数量 *</Label>
                    <Input
                      id={`split-quantity-${index}`}
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`split-deadline-${index}`}>希望納期 *</Label>
                    <Input
                      id={`split-deadline-${index}`}
                      type="date"
                      value={item.desiredDeadline}
                      onChange={(e) =>
                        updateItem(index, { desiredDeadline: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addItem} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              明細を追加
            </Button>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => handleClose(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={splitOrder.isPending}>
            {splitOrder.isPending ? "分割中..." : `${items.length}件に分割する`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

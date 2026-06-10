"use client"

import { useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { AlertCircle, AlertTriangle, MoreHorizontal, Plus } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MasterPagination } from "@/components/master-pagination"
import { ProductSelector } from "@/components/product-selector"
import { CustomerSelector } from "@/components/customer-selector"
import { SimulationResult } from "@/components/simulation-result"
import {
  useConfirmOrder,
  useDeleteOrder,
  useOrders,
  useSimulateOrderById,
  useUpdateOrder,
} from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import {
  getProductName,
  getCustomerName,
  getStatusLabel,
  getStatusBadgeClass,
} from "@/lib/order-utils"
import type { Order, OrderSimulateResponse } from "@/types/order"

const PAGE_SIZE = 20

type StatusFilter = "" | "draft" | "confirmed" | "incomplete" | "completed" | "canceled"
type SortKey = "created_at_desc" | "created_at_asc" | "desired_deadline_asc"

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "すべて", value: "" },
  { label: "下書き", value: "draft" },
  { label: "確定済", value: "confirmed" },
  { label: "情報不足", value: "incomplete" },
  { label: "完了", value: "completed" },
  { label: "キャンセル", value: "canceled" },
]

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "登録日（新しい順）", value: "created_at_desc" },
  { label: "登録日（古い順）", value: "created_at_asc" },
  { label: "希望納期（近い順）", value: "desired_deadline_asc" },
]

function filterOrder(order: Order, statusFilter: StatusFilter): boolean {
  if (statusFilter === "incomplete") return !order.customer_id || !order.desired_deadline
  if (statusFilter) return order.status === statusFilter
  return true
}

function compareOrders(a: Order, b: Order, sortKey: SortKey): number {
  if (sortKey === "created_at_desc") return b.created_at.localeCompare(a.created_at)
  if (sortKey === "created_at_asc") return a.created_at.localeCompare(b.created_at)
  // desired_deadline_asc: null を末尾に
  if (!a.desired_deadline && !b.desired_deadline) return 0
  if (!a.desired_deadline) return 1
  if (!b.desired_deadline) return -1
  return a.desired_deadline.localeCompare(b.desired_deadline)
}

interface EditOrderDialogProps {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}

function EditOrderDialog({ order, open, onOpenChange }: EditOrderDialogProps) {
  const updateOrder = useUpdateOrder()

  const [orderNo, setOrderNo] = useState(order.order_no)
  const [productId, setProductId] = useState(order.product_id.toString())
  const [customerId, setCustomerId] = useState(order.customer_id?.toString() ?? "")
  const [quantity, setQuantity] = useState(order.quantity.toString())
  const [desiredDeadline, setDesiredDeadline] = useState(
    order.desired_deadline ? order.desired_deadline.slice(0, 16) : ""
  )
  const [duplicateError, setDuplicateError] = useState("")

  const productChanged = productId !== order.product_id.toString()
  const quantityChanged = quantity !== order.quantity.toString()
  const showScheduleWarning = order.is_scheduled && (productChanged || quantityChanged)

  const handleSubmit = () => {
    setDuplicateError("")
    const parsedQuantity = parseInt(quantity, 10)
    if (!orderNo.trim() || !productId || isNaN(parsedQuantity) || parsedQuantity <= 0) return

    updateOrder.mutate(
      {
        id: order.id,
        data: {
          order_no: orderNo.trim(),
          product_id: parseInt(productId, 10),
          customer_id: customerId ? parseInt(customerId, 10) : undefined,
          quantity: parsedQuantity,
          desired_deadline: desiredDeadline || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("注文情報を更新しました")
          onOpenChange(false)
        },
        onError: (error: Error) => {
          if (error.message.includes("400") || error.message.toLowerCase().includes("duplicate") || error.message.includes("already")) {
            setDuplicateError("この注文番号はすでに使用されています")
          } else {
            toast.error(`更新に失敗しました: ${error.message}`)
          }
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>注文の編集</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {showScheduleWarning && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                スケジュールが無効になります。保存後に再シミュレーションが必要です。
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="order-no">注文番号 *</Label>
            <Input
              id="order-no"
              value={orderNo}
              onChange={(e) => {
                setOrderNo(e.target.value)
                setDuplicateError("")
              }}
            />
            {duplicateError && (
              <p className="text-sm text-destructive">{duplicateError}</p>
            )}
          </div>

          <ProductSelector value={productId} onValueChange={setProductId} />

          <CustomerSelector value={customerId} onValueChange={setCustomerId} />

          <div className="space-y-2">
            <Label htmlFor="quantity">数量 *</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desired-deadline">希望納期</Label>
            <Input
              id="desired-deadline"
              type="datetime-local"
              value={desiredDeadline}
              onChange={(e) => setDesiredDeadline(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={updateOrder.isPending}>
            {updateOrder.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 注文一覧画面
 * URL: /orders
 */
export default function OrdersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const statusFilter = (searchParams.get("status") ?? "") as StatusFilter
  const sortKey = (searchParams.get("sort") ?? "created_at_desc") as SortKey
  const page = Number(searchParams.get("page") ?? "1")

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null)
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null)
  const [expandedSimResult, setExpandedSimResult] = useState<OrderSimulateResponse | null>(null)

  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const confirmOrder = useConfirmOrder()
  const deleteOrder = useDeleteOrder()
  const simulateOrderById = useSimulateOrderById()

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    // ステータスやソート変更時はページを1に戻す
    if (key !== "page") params.delete("page")
    router.push(`?${params.toString()}`)
  }

  const draftCount = useMemo(
    () => orders?.filter((o) => o.status === "draft").length ?? 0,
    [orders]
  )
  const incompleteCount = useMemo(
    () => orders?.filter((o) => !o.customer_id || !o.desired_deadline).length ?? 0,
    [orders]
  )

  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders
      .filter((order) => filterOrder(order, statusFilter))
      .sort((a, b) => compareOrders(a, b, sortKey))
  }, [orders, statusFilter, sortKey])

  const pagedOrders = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return filteredOrders.slice(offset, offset + PAGE_SIZE)
  }, [filteredOrders, page])

  const handleConfirmFromRow = (orderId: number, orderNo: string) => {
    confirmOrder.mutate(orderId, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」を確定し、スケジュールを作成しました`)
        setExpandedOrderId(null)
        setExpandedSimResult(null)
      },
      onError: (error: Error) => {
        toast.error(`確定に失敗しました: ${error.message}`)
      },
    })
  }

  const handleSimulate = async (order: Order) => {
    try {
      const result = await simulateOrderById.mutateAsync(order.id)
      setExpandedOrderId(order.id)
      setExpandedSimResult(result)
      toast.success("シミュレーションが完了しました")
    } catch (error) {
      console.error("Simulation error:", error)
      toast.error("シミュレーションに失敗しました")
    }
  }

  const handleOpenEditDialog = (order: Order) => {
    setSelectedOrder(order)
    setIsEditDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (!deleteTargetOrder) return
    const targetId = deleteTargetOrder.id
    const targetNo = deleteTargetOrder.order_no
    deleteOrder.mutate(targetId, {
      onSuccess: () => {
        toast.success(`注文「${targetNo}」を削除しました`)
        setDeleteTargetOrder(null)
        if (expandedOrderId === targetId) {
          setExpandedOrderId(null)
          setExpandedSimResult(null)
        }
      },
      onError: (error: Error) => {
        toast.error(`削除に失敗しました: ${error.message}`)
        setDeleteTargetOrder(null)
      },
    })
  }

  const isLoading = ordersLoading || productsLoading || customersLoading

  return (
    <TooltipProvider>
      <div className="container mx-auto py-6 px-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">注文一覧</h1>
            <p className="text-muted-foreground mt-2">
              登録された注文の一覧を表示します
            </p>
          </div>
          <Button onClick={() => router.push("/orders/new")}>
            <Plus className="mr-2 h-4 w-4" />
            新規注文
          </Button>
        </div>

        {!isLoading && (draftCount > 0 || incompleteCount > 0) && (
          <div className="mb-4 grid grid-cols-2 gap-4">
            {draftCount > 0 && (
              <Card
                className="cursor-pointer border-yellow-300 bg-yellow-50 hover:bg-yellow-100 transition-colors"
                onClick={() => setParam("status", "draft")}
              >
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold text-yellow-800">{draftCount}件 未確定</p>
                  <p className="text-sm text-yellow-700 mt-1">下書きを見る →</p>
                </CardContent>
              </Card>
            )}
            {incompleteCount > 0 && (
              <Card
                className="cursor-pointer border-orange-300 bg-orange-50 hover:bg-orange-100 transition-colors"
                onClick={() => setParam("status", "incomplete")}
              >
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold text-orange-800">{incompleteCount}件 情報不足</p>
                  <p className="text-sm text-orange-700 mt-1">確認する →</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
          <Tabs
            value={statusFilter}
            onValueChange={(v) => setParam("status", v)}
          >
            <TabsList>
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Select
            value={sortKey}
            onValueChange={(v) => setParam("sort", v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-card shadow-sm">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              読み込み中...
            </div>
          ) : pagedOrders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>注文番号</TableHead>
                  <TableHead>製品</TableHead>
                  <TableHead>顧客</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead>希望納期</TableHead>
                  <TableHead>確定納期</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedOrders.map((order) => (
                  <>
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.order_no}</TableCell>
                      <TableCell>{getProductName(order.product_id, products)}</TableCell>
                      <TableCell>
                        {order.customer_id == null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 text-yellow-500 text-sm cursor-default">
                                <AlertCircle className="h-4 w-4" />
                                未設定
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>顧客が設定されていません</TooltipContent>
                          </Tooltip>
                        ) : (
                          getCustomerName(order.customer_id, customers)
                        )}
                      </TableCell>
                      <TableCell className="text-right">{order.quantity}</TableCell>
                      <TableCell>
                        {order.desired_deadline ? (
                          format(new Date(order.desired_deadline), "yyyy/MM/dd HH:mm", {
                            locale: ja,
                          })
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 text-yellow-500 text-sm cursor-default">
                                <AlertCircle className="h-4 w-4" />
                                未設定
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>希望納期が設定されていません</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        {order.confirmed_deadline
                          ? format(new Date(order.confirmed_deadline), "yyyy/MM/dd", {
                              locale: ja,
                            })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusBadgeClass(order.status)}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {order.status === "draft" && !order.is_scheduled && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSimulate(order)}
                              disabled={simulateOrderById.isPending}
                            >
                              シミュレーション実行
                            </Button>
                          )}
                          {order.status === "draft" && order.is_scheduled && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleConfirmFromRow(order.id, order.order_no)}
                              disabled={confirmOrder.isPending}
                            >
                              確定
                            </Button>
                          )}
                          {order.status !== "completed" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">メニューを開く</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {order.status === "draft" && order.is_scheduled && (
                                  <DropdownMenuItem onClick={() => handleSimulate(order)}>
                                    再シミュレーション
                                  </DropdownMenuItem>
                                )}
                                {order.status === "draft" && (
                                  <DropdownMenuItem onClick={() => handleOpenEditDialog(order)}>
                                    編集
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleteTargetOrder(order)}
                                >
                                  削除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedOrderId === order.id && expandedSimResult && (
                      <TableRow key={`${order.id}-sim`}>
                        <TableCell colSpan={8} className="bg-muted/30 p-4">
                          <SimulationResult
                            result={expandedSimResult}
                            desiredDeadline={order.desired_deadline}
                          />
                          <div className="flex justify-end gap-2 mt-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setExpandedOrderId(null)
                                setExpandedSimResult(null)
                              }}
                            >
                              閉じる
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleConfirmFromRow(order.id, order.order_no)}
                              disabled={confirmOrder.isPending}
                            >
                              この内容で確定
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              {statusFilter ? (
                <p>条件に一致する注文がありません</p>
              ) : (
                <>
                  <p>まだ注文がありません</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => router.push("/orders/new")}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    新規注文を作成
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <MasterPagination totalCount={filteredOrders.length} pageSize={PAGE_SIZE} />

        {selectedOrder && (
          <EditOrderDialog
            order={selectedOrder}
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
          />
        )}

        <AlertDialog
          open={deleteTargetOrder !== null}
          onOpenChange={(open) => { if (!open) setDeleteTargetOrder(null) }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>注文の削除</AlertDialogTitle>
              <AlertDialogDescription>
                注文「{deleteTargetOrder?.order_no}」を削除しますか？この操作は取り消せません。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={handleConfirmDelete}
                disabled={deleteOrder.isPending}
              >
                {deleteOrder.isPending ? "削除中..." : "削除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}

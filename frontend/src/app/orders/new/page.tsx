"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { AlertTriangle, Calculator, Check, Save } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductSelector } from "@/components/product-selector"
import { CustomerSelector } from "@/components/customer-selector"
import { SimulationResult } from "@/components/simulation-result"
import { useSimulateOrder, useCreateOrder, useConfirmOrder } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { getProductName, getCustomerName } from "@/lib/order-utils"
import type { OrderSimulateResponse } from "@/types/order"

/**
 * 注文登録・納期回答シミュレーション画面
 * URL: /orders/new
 */
export default function NewOrderPage() {
  const router = useRouter()
  const [orderNo, setOrderNo] = useState("")
  const [productId, setProductId] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [desiredDeadline, setDesiredDeadline] = useState("")
  const [simulationResult, setSimulationResult] = useState<OrderSimulateResponse | null>(null)
  const [hasAttemptedSimulation, setHasAttemptedSimulation] = useState(false)

  const simulateMutation = useSimulateOrder()
  const createMutation = useCreateOrder()
  const confirmMutation = useConfirmOrder()
  const { data: products } = useProducts()
  const { data: customers } = useCustomers()

  const handleSimulate = async () => {
    setHasAttemptedSimulation(true)

    if (!productId) {
      toast.error("製品を選択してください")
      return
    }

    const productIdNum = parseInt(productId)
    if (isNaN(productIdNum)) {
      toast.error("製品IDが無効です")
      return
    }

    const quantityNum = parseInt(quantity)
    if (!quantity || isNaN(quantityNum) || quantityNum < 1) {
      toast.error("数量は1以上の整数を入力してください")
      return
    }

    setSimulationResult(null)

    try {
      const result = await simulateMutation.mutateAsync({
        product_id: productIdNum,
        quantity: quantityNum,
        desired_deadline: desiredDeadline || undefined,
      })
      setSimulationResult(result)
      toast.success("シミュレーションが完了しました")
    } catch (error) {
      console.error("Simulation error:", error)
      toast.error("シミュレーションに失敗しました")
    }
  }

  const handleConfirm = async () => {
    if (!simulationResult) {
      toast.error("先にシミュレーションを実行してください")
      return
    }

    const productIdNum = parseInt(productId)
    const quantityNum = parseInt(quantity)

    if (isNaN(productIdNum) || isNaN(quantityNum)) {
      toast.error("製品IDまたは数量が無効です")
      return
    }

    try {
      const createdOrder = await createMutation.mutateAsync({
        order_no: orderNo || undefined,
        product_id: productIdNum,
        customer_id: customerId ? parseInt(customerId) : undefined,
        quantity: quantityNum,
        desired_deadline: desiredDeadline || undefined,
      })

      await confirmMutation.mutateAsync(createdOrder.id)

      toast.success("注文を確定し、スケジュールを作成しました")
      router.push("/orders")
    } catch (error) {
      console.error("Create/Confirm order error:", error)
      toast.error("注文の登録または確定に失敗しました")
    }
  }

  const isConfirmDisabled = !simulationResult || createMutation.isPending || confirmMutation.isPending

  // ステップ状態
  const step1Done = !!simulationResult
  const step2Done = !!simulationResult
  const step3Active = !!simulationResult

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">注文登録・納期回答シミュレーション</h1>
        <p className="text-muted-foreground mt-2">
          注文情報を入力し、生産スケジュールをシミュレーションして納期を確認してください
        </p>
      </div>

      {/* 3ステップインジケーター */}
      <div className="mb-6 flex items-center">
        {/* Step 1 */}
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border-2",
            step1Done
              ? "bg-green-500 border-green-500 text-white"
              : "bg-primary border-primary text-primary-foreground"
          )}>
            {step1Done ? <Check className="h-4 w-4" /> : "1"}
          </div>
          <span className="text-sm font-medium">注文情報入力</span>
        </div>

        <div className={cn("h-0.5 w-12 mx-2 sm:w-16", step1Done ? "bg-green-500" : "bg-muted")} />

        {/* Step 2 */}
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border-2",
            step2Done
              ? "bg-green-500 border-green-500 text-white"
              : "bg-muted border-muted text-muted-foreground"
          )}>
            {step2Done ? <Check className="h-4 w-4" /> : "2"}
          </div>
          <span className={cn("text-sm font-medium", !step2Done && "text-muted-foreground")}>
            シミュレーション実行
          </span>
        </div>

        <div className={cn("h-0.5 w-12 mx-2 sm:w-16", step2Done ? "bg-green-500" : "bg-muted")} />

        {/* Step 3 */}
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border-2",
            step3Active
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-muted border-muted text-muted-foreground"
          )}>
            3
          </div>
          <span className={cn("text-sm font-medium", !step3Active && "text-muted-foreground")}>
            確認・確定
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左側: 入力フォームエリア */}
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">注文基本情報</h2>
            <div className="space-y-4">
              {/* 注文番号 */}
              <div className="space-y-2">
                <Label htmlFor="order-no">注文番号（任意）</Label>
                <Input
                  id="order-no"
                  type="text"
                  placeholder="例: ORD-20260125-001（空白可）"
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                />
              </div>

              {/* 製品選択 */}
              <ProductSelector
                value={productId}
                onValueChange={setProductId}
              />

              {/* 顧客選択 */}
              <div>
                <CustomerSelector
                  value={customerId}
                  onValueChange={setCustomerId}
                />
                {hasAttemptedSimulation && !customerId && (
                  <p className="text-sm text-muted-foreground mt-1">
                    ℹ 顧客を設定すると、受注管理が整理されます（任意）
                  </p>
                )}
              </div>

              {/* 数量 */}
              <div className="space-y-2">
                <Label htmlFor="quantity">数量 *</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  placeholder="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              {/* 希望納期 */}
              <div className="space-y-2">
                <Label htmlFor="desired-deadline">希望納期（任意）</Label>
                <Input
                  id="desired-deadline"
                  type="datetime-local"
                  value={desiredDeadline}
                  onChange={(e) => setDesiredDeadline(e.target.value)}
                />
                {hasAttemptedSimulation && !desiredDeadline && (
                  <p className="text-sm text-muted-foreground mt-1">
                    ℹ 希望納期を入力すると、納期に間に合うかどうかを判定できます
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex gap-3">
            <Button
              onClick={handleSimulate}
              disabled={simulateMutation.isPending}
              className="flex-1"
            >
              <Calculator className="mr-2 h-4 w-4" />
              {simulateMutation.isPending ? "計算中..." : "シミュレーション実行"}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isConfirmDisabled}
              variant="default"
              className="flex-1"
            >
              <Save className="mr-2 h-4 w-4" />
              {createMutation.isPending || confirmMutation.isPending ? "処理中..." : "注文確定"}
            </Button>
          </div>
        </div>

        {/* 右側: シミュレーション結果エリア */}
        <div className="rounded-lg border bg-card p-6 shadow-sm min-h-[600px]">
          <h2 className="text-xl font-semibold mb-4">シミュレーション結果</h2>
          <SimulationResult
            result={simulationResult}
            desiredDeadline={desiredDeadline}
            summaryContent={simulationResult && (
              <div className="rounded-lg border p-4 space-y-3 text-sm">
                <p className="font-semibold">注文内容の確認</p>
                <dl className="space-y-1.5">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">注文番号</dt>
                    <dd>{orderNo || <span className="text-muted-foreground">未設定</span>}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">製品</dt>
                    <dd>{productId ? getProductName(parseInt(productId), products) : "-"}</dd>
                  </div>
                  {customerId && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">顧客</dt>
                      <dd>{getCustomerName(parseInt(customerId), customers)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">数量</dt>
                    <dd>{quantity || "-"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">希望納期</dt>
                    <dd>
                      {desiredDeadline
                        ? format(new Date(desiredDeadline), "yyyy/MM/dd HH:mm", { locale: ja })
                        : <span className="text-muted-foreground">未設定</span>}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">確定納期</dt>
                    <dd className={!simulationResult.is_feasible ? "text-red-600 font-medium" : ""}>
                      {format(new Date(simulationResult.calculated_deadline), "yyyy/MM/dd HH:mm", { locale: ja })}
                    </dd>
                  </div>
                </dl>

                {(!desiredDeadline || !customerId) && (
                  <div className="flex items-start gap-1.5 text-yellow-700 pt-1 border-t">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>このまま確定してよいですか？</p>
                  </div>
                )}
              </div>
            )}
          />
        </div>
      </div>
    </div>
  )
}

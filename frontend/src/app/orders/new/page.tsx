"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Calculator, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductSelector } from "@/components/product-selector"
import { SimulationResult } from "@/components/simulation-result"
import { useSimulateOrder, useCreateOrder, useConfirmOrder } from "@/hooks/use-orders"
import type { OrderSimulateResponse } from "@/types/order"

/**
 * 注文登録・納期回答シミュレーション画面
 * URL: /orders/new
 */
export default function NewOrderPage() {
  const router = useRouter()
  const [orderNo, setOrderNo] = useState("")
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [desiredDeadline, setDesiredDeadline] = useState("")
  const [simulationResult, setSimulationResult] = useState<OrderSimulateResponse | null>(null)

  // API呼び出し用のフック
  const simulateMutation = useSimulateOrder()
  const createMutation = useCreateOrder()
  const confirmMutation = useConfirmOrder()

  // シミュレーション実行ハンドラ
  const handleSimulate = async () => {
    // バリデーション
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
      setSimulationResult(null)
    }
  }

  // 注文確定ハンドラ
  const handleConfirm = async () => {
    // バリデーション
    if (!orderNo) {
      toast.error("注文番号を入力してください")
      return
    }

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
      // 1. 注文を作成
      const createdOrder = await createMutation.mutateAsync({
        order_no: orderNo,
        product_id: productIdNum,
        quantity: quantityNum,
        desired_deadline: desiredDeadline || undefined,
      })
      
      // 2. 作成した注文を確定（スケジュール作成）
      await confirmMutation.mutateAsync(createdOrder.id)
      
      toast.success("注文を確定し、スケジュールを作成しました")
      router.push("/orders")
    } catch (error) {
      console.error("Create/Confirm order error:", error)
      toast.error("注文の登録または確定に失敗しました")
    }
  }

  // シミュレーション未実行の場合は確定ボタンを無効化
  const isConfirmDisabled = !simulationResult || createMutation.isPending || confirmMutation.isPending

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">注文登録・納期回答シミュレーション</h1>
        <p className="text-muted-foreground mt-2">
          注文情報を入力し、生産スケジュールをシミュレーションして納期を確認してください
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左側: 入力フォームエリア */}
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">注文基本情報</h2>
            <div className="space-y-4">
              {/* 注文番号 */}
              <div className="space-y-2">
                <Label htmlFor="order-no">注文番号 *</Label>
                <Input
                  id="order-no"
                  type="text"
                  placeholder="ORD-20260125-001"
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                />
              </div>

              {/* 製品選択 */}
              <ProductSelector
                value={productId}
                onValueChange={setProductId}
              />

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
          />
        </div>
      </div>
    </div>
  )
}

"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Check,
  Mail,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ProductSelector } from "@/components/product-selector"
import { CustomerSelector } from "@/components/customer-selector"
import { SimulationResult } from "@/components/simulation-result"
import { ProductRoutingsDialog } from "@/components/product-routings-dialog"
import {
  useSimulateOrder,
  useCreateOrder,
  useConfirmOrder,
  useCreateEmailOrderIntake,
} from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { getProductName, getCustomerName, formatDeadlineDate, jstTodayIso } from "@/lib/order-utils"
import type { OrderSimulateResponse } from "@/types/order"
import type { Product } from "@/types/product"

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
  // 作業開始日（工場が着手する日）。空なら実行日時から着手（Issue #372）
  const [schedulingStartDate, setSchedulingStartDate] = useState("")
  const [simulationResult, setSimulationResult] = useState<OrderSimulateResponse | null>(null)
  const [hasAttemptedSimulation, setHasAttemptedSimulation] = useState(false)
  const [noRoutingDialogOpen, setNoRoutingDialogOpen] = useState(false)
  const [routingDialogOpen, setRoutingDialogOpen] = useState(false)

  // 起票元モード（手動フォーム / メール起票）
  const [intakeMode, setIntakeMode] = useState<"manual" | "email">("manual")
  // メール起票モードの入力状態（顧客・本文・添付は全明細で共有する）
  const [sourceRaw, setSourceRaw] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [emailLineItems, setEmailLineItems] = useState<
    { productId: string; quantity: string; desiredDeadline: string }[]
  >([{ productId: "", quantity: "", desiredDeadline: "" }])

  const simulateMutation = useSimulateOrder()
  const createMutation = useCreateOrder()
  const confirmMutation = useConfirmOrder()
  const emailIntakeMutation = useCreateEmailOrderIntake()
  const { data: products } = useProducts()
  const { data: customers } = useCustomers()
  const { data: currentMember } = useCurrentMember()

  // 作業開始日を過去日に設定できるのは president / platform_admin のみ（Issue #372）
  const canBackdateSchedulingStart =
    currentMember?.role === "president" || currentMember?.role === "platform_admin"
  // 過去日判定はバックエンド（JST基準）と揃える（Issue #372）
  const todayStr = jstTodayIso()
  const isSchedulingStartBackdated =
    !!schedulingStartDate && schedulingStartDate < todayStr

  const selectedProduct: Product | null =
    products?.find((p) => p.id === parseInt(productId)) ?? null

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

    if (isSchedulingStartBackdated && !canBackdateSchedulingStart) {
      toast.error("作業開始日を過去日に設定できるのは president / platform_admin のみです")
      return
    }

    setSimulationResult(null)

    try {
      const result = await simulateMutation.mutateAsync({
        product_id: productIdNum,
        quantity: quantityNum,
        desired_deadline: desiredDeadline || undefined,
        scheduling_start_date: schedulingStartDate || undefined,
      })

      if (result.routing_status === "no_routing") {
        setNoRoutingDialogOpen(true)
        return
      }

      setSimulationResult(result)
      toast.success("シミュレーションが完了しました")
    } catch (error) {
      const message = error instanceof Error ? error.message : "シミュレーションに失敗しました"
      console.error("Simulation error:", error)
      toast.error(message)
    }
  }

  const handleSaveAsDraft = async () => {
    const productIdNum = parseInt(productId)
    const quantityNum = parseInt(quantity)

    if (isNaN(productIdNum) || isNaN(quantityNum)) {
      toast.error("製品IDまたは数量が無効です")
      return
    }

    if (isSchedulingStartBackdated && !canBackdateSchedulingStart) {
      toast.error("作業開始日を過去日に設定できるのは president / platform_admin のみです")
      return
    }

    try {
      await createMutation.mutateAsync({
        order_no: orderNo || undefined,
        product_id: productIdNum,
        customer_id: customerId ? parseInt(customerId) : undefined,
        quantity: quantityNum,
        desired_deadline: desiredDeadline || undefined,
        scheduling_start_date: schedulingStartDate || undefined,
      })
      setNoRoutingDialogOpen(false)
      toast.success("下書き保存しました。工程登録後に専門家キューから確定できます")
      router.push("/orders")
    } catch (error) {
      const message = error instanceof Error ? error.message : "下書き保存に失敗しました"
      console.error("Draft save error:", error)
      toast.error(message)
    }
  }

  const handleOpenRoutingRegistration = () => {
    setNoRoutingDialogOpen(false)
    setRoutingDialogOpen(true)
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

    if (isSchedulingStartBackdated && !canBackdateSchedulingStart) {
      toast.error("作業開始日を過去日に設定できるのは president / platform_admin のみです")
      return
    }

    try {
      const createdOrder = await createMutation.mutateAsync({
        order_no: orderNo || undefined,
        product_id: productIdNum,
        customer_id: customerId ? parseInt(customerId) : undefined,
        quantity: quantityNum,
        desired_deadline: desiredDeadline || undefined,
        scheduling_start_date: schedulingStartDate || undefined,
      })

      await confirmMutation.mutateAsync(createdOrder.id)

      toast.success("注文を確定し、スケジュールを作成しました")
      router.push("/orders")
    } catch (error) {
      const message = error instanceof Error ? error.message : "注文の登録または確定に失敗しました"
      console.error("Create/Confirm order error:", error)
      toast.error(message)
    }
  }

  const isConfirmDisabled = !simulationResult || createMutation.isPending || confirmMutation.isPending

  // ステップ状態
  const step1Done = !!simulationResult
  const step2Done = !!simulationResult
  const step3Active = !!simulationResult

  // --- メール起票モードのハンドラ ---
  const updateEmailLineItem = (
    index: number,
    key: "productId" | "quantity" | "desiredDeadline",
    value: string,
  ) => {
    setEmailLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    )
  }

  const addEmailLineItem = () => {
    setEmailLineItems((prev) => [
      ...prev,
      { productId: "", quantity: "", desiredDeadline: "" },
    ])
  }

  const removeEmailLineItem = (index: number) => {
    setEmailLineItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) {
      setAttachments((prev) => [...prev, ...selected])
    }
    // 同じファイルを選び直せるように input をリセットする
    e.target.value = ""
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleEmailIntakeSubmit = async () => {
    const parsedLineItems = emailLineItems.map((item) => {
      const quantityNum = parseInt(item.quantity)
      const productIdNum = parseInt(item.productId)
      return {
        product_id: Number.isNaN(productIdNum) ? undefined : productIdNum,
        quantity: quantityNum,
        desired_deadline: item.desiredDeadline || undefined,
      }
    })

    if (parsedLineItems.some((item) => Number.isNaN(item.quantity) || item.quantity < 1)) {
      toast.error("各明細の数量は1以上の整数を入力してください")
      return
    }

    try {
      const result = await emailIntakeMutation.mutateAsync({
        payload: {
          order_no: orderNo || undefined,
          customer_id: customerId ? parseInt(customerId) : undefined,
          source_raw: sourceRaw || undefined,
          line_items: parsedLineItems,
        },
        files: attachments,
      })
      toast.success(
        `メール起票で${result.created_orders.length}件の下書きを登録しました`,
      )
      router.push("/orders")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "メール起票の登録に失敗しました"
      console.error("Email intake error:", error)
      toast.error(message)
    }
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">注文登録・納期回答シミュレーション</h1>
        <p className="text-muted-foreground mt-2">
          注文情報を入力し、生産スケジュールをシミュレーションして納期を確認してください
        </p>
      </div>

      {/* 起票元モードの選択（手動フォーム / メール起票） */}
      <div className="mb-6 inline-flex rounded-lg border bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => setIntakeMode("manual")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            intakeMode === "manual"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Pencil className="h-4 w-4" />
          手動フォーム
        </button>
        <button
          type="button"
          onClick={() => setIntakeMode("email")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            intakeMode === "email"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Mail className="h-4 w-4" />
          メール起票
        </button>
      </div>

      {intakeMode === "email" && (
        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-xl font-semibold">メール起票（証跡付き手動登録）</h2>
            <p className="text-sm text-muted-foreground mt-1">
              自動抽出できない受注メールを、本文・添付ファイルとあわせて下書き登録します。
              分納など1通のメールから複数注文を起こす場合は、明細行を追加してまとめて登録できます。
              登録された注文は起票元がメール（<code>source_type=email</code>）として記録され、下書き状態になります。
            </p>
          </div>

          {/* 注文番号（任意） */}
          <div className="space-y-2">
            <Label htmlFor="email-order-no">注文番号（任意）</Label>
            <Input
              id="email-order-no"
              type="text"
              placeholder="例: ORD-20260125-001（空白可・先頭明細に付与）"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
            />
          </div>

          {/* 顧客（全明細で共有） */}
          <CustomerSelector value={customerId} onValueChange={setCustomerId} />

          {/* メール本文 */}
          <div className="space-y-2">
            <Label htmlFor="source-raw">メール本文</Label>
            <textarea
              id="source-raw"
              value={sourceRaw}
              onChange={(e) => setSourceRaw(e.target.value)}
              placeholder="受注メールの本文を貼り付けてください"
              rows={8}
              className={cn(
                "border-input placeholder:text-muted-foreground w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] resize-y",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              )}
            />
          </div>

          {/* 添付ファイル */}
          <div className="space-y-2">
            <Label htmlFor="email-attachments">添付ファイル（任意・複数可）</Label>
            <label
              htmlFor="email-attachments"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50"
            >
              <Paperclip className="h-4 w-4" />
              ファイルを選択して追加
              <input
                id="email-attachments"
                type="file"
                multiple
                className="hidden"
                onChange={handleAttachmentChange}
              />
            </label>
            {attachments.length > 0 && (
              <ul className="space-y-1">
                {attachments.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-sm"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label="添付を削除"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 明細行（分納対応） */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>明細（品番・数量・希望納期）</Label>
              <Button type="button" variant="outline" size="sm" onClick={addEmailLineItem}>
                <Plus className="mr-1 h-4 w-4" />
                明細を追加
              </Button>
            </div>

            {emailLineItems.map((item, index) => (
              <div
                key={index}
                className="rounded-lg border p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    明細 {index + 1}
                  </span>
                  {emailLineItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEmailLineItem(index)}
                      className="text-muted-foreground hover:text-red-600"
                      aria-label="明細を削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <ProductSelector
                  value={item.productId}
                  onValueChange={(value) =>
                    updateEmailLineItem(index, "productId", value)
                  }
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`email-qty-${index}`}>数量 *</Label>
                    <Input
                      id={`email-qty-${index}`}
                      type="number"
                      min="1"
                      placeholder="1"
                      value={item.quantity}
                      onChange={(e) =>
                        updateEmailLineItem(index, "quantity", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`email-deadline-${index}`}>希望納期（任意）</Label>
                    <Input
                      id={`email-deadline-${index}`}
                      type="date"
                      value={item.desiredDeadline}
                      onChange={(e) =>
                        updateEmailLineItem(index, "desiredDeadline", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>
              品番を選択しなかった明細は、製品未特定の下書きとして登録されます（後から受注一覧で紐付けできます）。
            </p>
          </div>

          <Button
            onClick={handleEmailIntakeSubmit}
            disabled={emailIntakeMutation.isPending}
            className="w-full"
          >
            <Save className="mr-2 h-4 w-4" />
            {emailIntakeMutation.isPending
              ? "登録中..."
              : `メール起票で登録（下書き${emailLineItems.length}件）`}
          </Button>
        </div>
      )}

      {intakeMode === "manual" && (
      <>
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
              {selectedProduct?.has_process === false && (
                <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    この製品は工程が登録されていないため、シミュレーションを実行できません。
                    <Link href="/master/products" className="ml-1 underline underline-offset-2 hover:text-orange-900">
                      マスタデータ &gt; 製品マスタ
                    </Link>
                    から工程を登録してください。
                  </p>
                </div>
              )}

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
                  type="date"
                  value={desiredDeadline}
                  onChange={(e) => setDesiredDeadline(e.target.value)}
                />
                {hasAttemptedSimulation && !desiredDeadline && (
                  <p className="text-sm text-muted-foreground mt-1">
                    ℹ 希望納期を入力すると、納期に間に合うかどうかを判定できます
                  </p>
                )}
              </div>

              {/* 作業開始日（Issue #372） */}
              <div className="space-y-2">
                <Label htmlFor="scheduling-start-date">作業開始日（任意）</Label>
                <Input
                  id="scheduling-start-date"
                  type="date"
                  value={schedulingStartDate}
                  min={canBackdateSchedulingStart ? undefined : todayStr}
                  onChange={(e) => setSchedulingStartDate(e.target.value)}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  {schedulingStartDate
                    ? "指定した日から着手する前提でスケジュールを計算します"
                    : "未指定の場合、実行日時から着手する前提で計算します"}
                </p>
                {isSchedulingStartBackdated && !canBackdateSchedulingStart && (
                  <p className="text-sm text-destructive mt-1">
                    過去日を設定できるのは president / platform_admin のみです
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex gap-3">
            <Button
              onClick={handleSimulate}
              disabled={simulateMutation.isPending || selectedProduct?.has_process === false}
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
            summaryContent={simulationResult && simulationResult.calculated_deadline && (
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
                      {formatDeadlineDate(desiredDeadline)
                        ?? <span className="text-muted-foreground">未設定</span>}
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
      </>
      )}

      {/* 工程未登録選択ダイアログ */}
      <Dialog open={noRoutingDialogOpen} onOpenChange={setNoRoutingDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>この製品には工程が登録されていません</DialogTitle>
            <DialogDescription>
              「{selectedProduct?.name ?? "選択中の製品"}」の生産工程が未登録のため、納期のシミュレーションができません。次の操作を選択してください。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <button
              onClick={handleOpenRoutingRegistration}
              className="flex flex-col items-start gap-2 rounded-lg border-2 border-primary bg-primary/5 p-4 text-left hover:bg-primary/10 transition-colors"
            >
              <BookOpen className="h-6 w-6 text-primary" />
              <p className="font-semibold text-sm">工程を登録してから注文する</p>
              <p className="text-xs text-muted-foreground">
                工程を登録し、その後シミュレーションを実行します
              </p>
            </button>
            <button
              onClick={handleSaveAsDraft}
              disabled={createMutation.isPending}
              className="flex flex-col items-start gap-2 rounded-lg border-2 border-muted bg-muted/30 p-4 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              <Save className="h-6 w-6 text-muted-foreground" />
              <p className="font-semibold text-sm">下書きで保存する</p>
              <p className="text-xs text-muted-foreground">
                今すぐ下書き保存し、あとで工程登録・確定できます
              </p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 工程登録ダイアログ（既存コンポーネント流用） */}
      <ProductRoutingsDialog
        product={selectedProduct}
        open={routingDialogOpen}
        onOpenChange={(open) => {
          setRoutingDialogOpen(open)
          if (!open) handleSimulate()
        }}
      />
    </div>
  )
}

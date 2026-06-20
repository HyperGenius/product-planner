"use client"

import { useState, useEffect } from "react"
import { Pencil, Trash2, Plus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useProcessRoutings,
  useCreateProcessRouting,
  useUpdateProcessRouting,
  useDeleteProcessRouting,
} from "@/hooks/use-process-routings"
import { useEquipmentGroups, formatGroupLabel } from "@/lib/hooks/use-equipment-groups"
import { useSimulateOrder } from "@/hooks/use-orders"
import type { Product } from "@/types/product"
import type { ProcessRouting } from "@/types/process-routing"

interface ProductRoutingsDialogProps {
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 製品の製造工程ルーティング管理ダイアログ
 */
export function ProductRoutingsDialog({
  product,
  open,
  onOpenChange,
}: ProductRoutingsDialogProps) {
  // 編集状態
  const [editingRouting, setEditingRouting] = useState<ProcessRouting | null>(null)
  const [processName, setProcessName] = useState("")
  const [equipmentGroupId, setEquipmentGroupId] = useState<number | null | "">("")
  const [sequenceOrder, setSequenceOrder] = useState<number | "">(1)
  const [setupTime, setSetupTime] = useState<number | "">(0)
  const [unitTime, setUnitTime] = useState<number | "">(0)
  
  // 削除確認ダイアログの状態
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [routingToDelete, setRoutingToDelete] = useState<ProcessRouting | null>(null)

  // 個数からの目安
  const [estimateQuantity, setEstimateQuantity] = useState<number | "">(1000)

  // データ取得
  const { data: routings, isLoading: isLoadingRoutings } = useProcessRoutings(product?.id ?? null)
  const { data: equipmentGroups, isLoading: isLoadingGroups } = useEquipmentGroups()

  // ミューテーション
  const createMutation = useCreateProcessRouting()
  const updateMutation = useUpdateProcessRouting()
  const deleteMutation = useDeleteProcessRouting()
  const simulateMutation = useSimulateOrder()

  // 個数・工程が変わったら500ms debounce でシミュレーション実行
  useEffect(() => {
    if (!product || !routings || routings.length === 0) return
    if (estimateQuantity === "" || estimateQuantity <= 0) return

    const timer = setTimeout(() => {
      simulateMutation.mutate({ product_id: product.id, quantity: estimateQuantity, standalone: true })
    }, 500)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateQuantity, routings, product?.id])

  // 工程 start〜end の経過日数を計算
  const estimateDays = (() => {
    const schedules = simulateMutation.data?.process_schedules
    if (!schedules || schedules.length === 0) return null
    const start = new Date(schedules[0].start_time)
    const end = new Date(schedules[schedules.length - 1].end_time)
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  })()

  // フォームをリセット
  const resetForm = () => {
    setEditingRouting(null)
    setProcessName("")
    setEquipmentGroupId("")
    setSequenceOrder(1)
    setSetupTime(0)
    setUnitTime(0)
  }

  // ダイアログが閉じられたときにフォームをリセット
  useEffect(() => {
    if (!open) {
      resetForm()
    }
  }, [open])

  // 編集ボタンのハンドラ
  const handleEdit = (routing: ProcessRouting) => {
    setEditingRouting(routing)
    setProcessName(routing.process_name)
    setEquipmentGroupId(routing.equipment_group_id)
    setSequenceOrder(routing.sequence_order)
    setSetupTime(routing.setup_time_seconds)
    setUnitTime(routing.unit_time_seconds)
  }

  // 保存ハンドラ
  const handleSave = async () => {
    if (!product) return

    // バリデーション
    if (!processName.trim()) {
      toast.error("工程名を入力してください")
      return
    }
    if (equipmentGroupId === "") {
      toast.error("設備グループまたは「設備なし」を選択してください")
      return
    }
    if (sequenceOrder === "" || sequenceOrder < 0) {
      toast.error("順序を入力してください")
      return
    }
    if (setupTime === "" || setupTime < 0) {
      toast.error("段取り時間を入力してください")
      return
    }
    if (unitTime === "" || unitTime < 0) {
      toast.error("単位時間を入力してください")
      return
    }

    // この時点で sequenceOrder, setupTime, unitTime は number 型であることが保証される
    // 重複する順序番号のチェック
    const duplicateRouting = routings?.find(
      (r) => r.sequence_order === (sequenceOrder as number) && r.id !== editingRouting?.id
    )
    if (duplicateRouting) {
      toast.error(`順序 ${sequenceOrder} は既に工程「${duplicateRouting.process_name}」で使用されています`)
      return
    }

    try {
      // この時点で equipmentGroupId は "" でないことが保証される（バリデーション済み）
      if (editingRouting) {
        // 更新
        await updateMutation.mutateAsync({
          id: editingRouting.id,
          data: {
            process_name: processName,
            equipment_group_id: equipmentGroupId,
            sequence_order: sequenceOrder,
            setup_time_seconds: setupTime,
            unit_time_seconds: unitTime,
          },
        })
        toast.success("工程を更新しました")
      } else {
        // 作成
        await createMutation.mutateAsync({
          product_id: product.id,
          process_name: processName,
          equipment_group_id: equipmentGroupId,
          sequence_order: sequenceOrder,
          setup_time_seconds: setupTime,
          unit_time_seconds: unitTime,
        })
        toast.success("工程を追加しました")
      }
      resetForm()
    } catch (error) {
      toast.error(editingRouting ? "工程の更新に失敗しました" : "工程の追加に失敗しました")
      console.error(error)
    }
  }

  // 削除ボタンのハンドラ（確認ダイアログを開く）
  const handleDeleteClick = (routing: ProcessRouting) => {
    setRoutingToDelete(routing)
    setDeleteConfirmOpen(true)
  }

  // 削除の実行
  const handleDeleteConfirm = async () => {
    if (!product || !routingToDelete) return

    try {
      await deleteMutation.mutateAsync({
        id: routingToDelete.id,
        productId: product.id,
      })
      toast.success("工程を削除しました")
      
      // 削除した工程を編集中だった場合はフォームをリセット
      if (editingRouting?.id === routingToDelete.id) {
        resetForm()
      }
    } catch (error) {
      toast.error("工程の削除に失敗しました")
      console.error(error)
    } finally {
      setDeleteConfirmOpen(false)
      setRoutingToDelete(null)
    }
  }

  // 設備グループ名を取得
  const getEquipmentGroupName = (equipmentGroupId: number | null) => {
    if (equipmentGroupId === null) return "設備なし"
    const group = equipmentGroups?.find((g) => g.id === equipmentGroupId)
    return group?.name || "不明"
  }

  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>工程管理 - {product?.name}</DialogTitle>
          <DialogDescription>
            製品の製造工程（ルーティング）を管理します
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[2fr_1fr] gap-6 flex-1 min-h-0">
          {/* 左側: 工程リスト */}
          <div className="flex flex-col min-h-0">
            <h3 className="text-sm font-semibold mb-3">登録済み工程</h3>
            <div className="border rounded-md flex-1 overflow-y-auto">
              {isLoadingRoutings ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">読み込み中...</p>
                </div>
              ) : routings && routings.length > 0 ? (
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-[80px]">順序</TableHead>
                      <TableHead>工程名</TableHead>
                      <TableHead>設備グループ</TableHead>
                      <TableHead className="w-[120px]">段取り時間(秒)</TableHead>
                      <TableHead className="w-[120px]">単位時間(秒)</TableHead>
                      <TableHead className="w-[100px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {routings
                      .sort((a, b) => a.sequence_order - b.sequence_order)
                      .map((routing) => (
                        <TableRow 
                          key={routing.id}
                          className={editingRouting?.id === routing.id ? "bg-muted/50" : ""}
                        >
                          <TableCell className="font-medium">{routing.sequence_order}</TableCell>
                          <TableCell>{routing.process_name}</TableCell>
                          <TableCell>{getEquipmentGroupName(routing.equipment_group_id)}</TableCell>
                          <TableCell>{routing.setup_time_seconds}</TableCell>
                          <TableCell>{routing.unit_time_seconds}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleEdit(routing)}
                                disabled={isPending}
                                aria-label={`${routing.process_name}を編集`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleDeleteClick(routing)}
                                disabled={isPending}
                                aria-label={`${routing.process_name}を削除`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">工程が登録されていません</p>
                </div>
              )}
            </div>
          </div>

          {/* 右側: 編集/追加フォーム */}
          <div className="flex flex-col border rounded-md p-4 gap-4 overflow-y-auto min-h-0">
            {/* 個数からの目安カード */}
            <Card className="shrink-0">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-semibold">個数からの目安</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={estimateQuantity}
                    onChange={(e) => {
                      if (e.target.value === "") {
                        setEstimateQuantity("")
                      } else {
                        const n = Number(e.target.value)
                        if (Number.isFinite(n)) setEstimateQuantity(n)
                      }
                    }}
                    disabled={!routings || routings.length === 0}
                    className="h-8 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="個数"
                    onWheel={(e) => e.currentTarget.blur()}
                    onKeyDown={(e) => {
                      if (
                        e.key === "e" || e.key === "E" ||
                        e.key === "+" || e.key === "-" ||
                        e.key === "ArrowUp" || e.key === "ArrowDown"
                      ) {
                        e.preventDefault()
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">個</span>
                </div>
                <div className="text-sm font-medium min-h-[1.25rem]">
                  {!routings || routings.length === 0 ? (
                    <span className="text-muted-foreground">工程を登録すると計算できます</span>
                  ) : simulateMutation.isPending ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      計算中...
                    </span>
                  ) : simulateMutation.isError ? (
                    <span className="text-destructive">計算に失敗しました</span>
                  ) : estimateDays !== null && estimateQuantity !== "" && estimateQuantity >= 1 ? (
                    <span>
                      {estimateQuantity}個で <strong>{estimateDays}日</strong>（単体換算）
                    </span>
                  ) : null}
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  他の受注がない場合の単体換算値です。実際の納期は設備の混雑状況により長くなる場合があります。
                </p>
              </CardContent>
            </Card>

            <h3 className="text-sm font-semibold">
              {editingRouting ? "工程編集" : "工程追加"}
            </h3>

            <div className="space-y-4 flex-1">
              <div className="space-y-2">
                <Label htmlFor="process-name">工程名</Label>
                <Input
                  id="process-name"
                  value={processName}
                  onChange={(e) => setProcessName(e.target.value)}
                  placeholder="例: 切削加工"
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="equipment-group">設備グループ</Label>
                {isLoadingGroups ? (
                  <div className="text-sm text-muted-foreground">読み込み中...</div>
                ) : (
                  <select
                    id="equipment-group"
                    value={equipmentGroupId === null ? "none" : equipmentGroupId}
                    onChange={(e) => {
                      if (e.target.value === "") {
                        setEquipmentGroupId("")
                      } else if (e.target.value === "none") {
                        setEquipmentGroupId(null)
                      } else {
                        setEquipmentGroupId(Number(e.target.value))
                      }
                    }}
                    disabled={isPending}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">選択してください</option>
                    <option value="none">設備なし</option>
                    {equipmentGroups?.map((group) => (
                      <option key={group.id} value={group.id}>
                        {formatGroupLabel(group)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="sequence-order">順序</Label>
                  <Input
                    id="sequence-order"
                    type="number"
                    min="0"
                    value={sequenceOrder}
                    onChange={(e) => setSequenceOrder(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-time">段取り時間 (秒)</Label>
                  <Input
                    id="setup-time"
                    type="number"
                    min="0"
                    value={setupTime}
                    onChange={(e) => setSetupTime(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={isPending}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unit-time">単位時間 (秒)</Label>
                <Input
                  id="unit-time"
                  type="number"
                  min="0"
                  value={unitTime}
                  onChange={(e) => setUnitTime(e.target.value === "" ? "" : Number(e.target.value))}
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button
                onClick={handleSave}
                disabled={isPending}
                className="flex-1"
              >
                {editingRouting ? (
                  <>
                    <Pencil className="mr-2 h-4 w-4" />
                    更新
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    追加
                  </>
                )}
              </Button>
              {editingRouting && (
                <Button
                  variant="outline"
                  onClick={resetForm}
                  disabled={isPending}
                >
                  キャンセル
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* 削除確認ダイアログ */}
    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>工程の削除</AlertDialogTitle>
          <AlertDialogDescription>
            本当に工程「{routingToDelete?.process_name}」を削除しますか？
            この操作は取り消せません。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={handleDeleteConfirm}>削除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

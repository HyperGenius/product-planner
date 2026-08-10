"use client"

import { useEffect, useRef, useState } from "react"
import { Pencil, Trash2, Plus, Loader2, Lock, CheckCircle2, ArrowUp, ArrowDown } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
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
  useUpdateProcessRouting,
  useBulkSaveProcessRoutings,
} from "@/hooks/use-process-routings"
import { useEquipmentGroups, formatGroupLabel } from "@/lib/hooks/use-equipment-groups"
import { useSimulateOrder } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import type { Product } from "@/types/product"
import type { ProcessRouting } from "@/types/process-routing"

interface ProductRoutingsDialogProps {
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** モーダル内でのみ扱うローカル下書き工程。id が負値の場合は未保存の新規工程を表す。 */
interface DraftRouting {
  id: number
  process_name: string
  equipment_group_id: number | null
  setup_time_seconds: number
  unit_time_seconds: number
  is_confirmed: boolean
  confirmed_by: string | null
  confirmed_at: string | null
}

const toDraft = (routing: ProcessRouting): DraftRouting => ({
  id: routing.id,
  process_name: routing.process_name,
  equipment_group_id: routing.equipment_group_id,
  setup_time_seconds: routing.setup_time_seconds,
  unit_time_seconds: routing.unit_time_seconds,
  is_confirmed: routing.is_confirmed,
  confirmed_by: routing.confirmed_by,
  confirmed_at: routing.confirmed_at,
})

// 下書きの差分検知用に比較可能な形へ正規化する（並び順・追加・削除・編集・確定状態の変化を検知する）
const serializeDrafts = (drafts: DraftRouting[]) => JSON.stringify(drafts)

/**
 * 製品の製造工程ルーティング管理ダイアログ
 *
 * 工程の追加・編集・削除・並べ替えはローカルの下書き状態のみを更新し、
 * 「変更を保存」ボタン押下時にまとめてサーバーへ反映する。
 * 確定フラグの切り替えのみ、監査ログ（confirmed_by/confirmed_at）の正確性を優先し即時反映する。
 */
export function ProductRoutingsDialog({
  product,
  open,
  onOpenChange,
}: ProductRoutingsDialogProps) {
  // ローカル下書き状態
  const [draftRoutings, setDraftRoutings] = useState<DraftRouting[]>([])
  const [baselineRoutings, setBaselineRoutings] = useState<DraftRouting[]>([])
  const initializedRef = useRef(false)
  const nextTempIdRef = useRef(-1)

  // 編集状態
  const [editingId, setEditingId] = useState<number | null>(null)
  const [processName, setProcessName] = useState("")
  const [equipmentGroupId, setEquipmentGroupId] = useState<number | null | "">("")
  const [setupTime, setSetupTime] = useState<number | "">(0)
  const [unitTime, setUnitTime] = useState<number | "">(0)

  // 削除確認ダイアログの状態
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [routingToDelete, setRoutingToDelete] = useState<DraftRouting | null>(null)

  // 確定取消確認ダイアログの状態
  const [unconfirmDialogOpen, setUnconfirmDialogOpen] = useState(false)
  const [routingToUnconfirm, setRoutingToUnconfirm] = useState<DraftRouting | null>(null)

  // 未保存変更で閉じようとした場合の確認ダイアログ
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  // 個数からの目安
  const [estimateQuantity, setEstimateQuantity] = useState<number | "">(1000)

  // データ取得
  const { data: routings, isLoading: isLoadingRoutings } = useProcessRoutings(product?.id ?? null)
  const { data: equipmentGroups, isLoading: isLoadingGroups } = useEquipmentGroups()
  const { data: currentMember } = useCurrentMember()

  const isAdmin = currentMember?.role === "president"

  // ミューテーション
  const updateMutation = useUpdateProcessRouting()
  const bulkSaveMutation = useBulkSaveProcessRoutings()
  const simulateMutation = useSimulateOrder()

  // ダイアログが開いたタイミングでサーバーの工程一覧を下書きへ1度だけ反映する
  // （確定トグル等によるクエリ再取得のたびに下書きが上書きされないようにするため）
  useEffect(() => {
    if (!open) {
      initializedRef.current = false
      resetForm()
      return
    }
    if (initializedRef.current || !routings) return

    const drafts = routings
      .slice()
      .sort((a, b) => a.sequence_order - b.sequence_order)
      .map(toDraft)
    setDraftRoutings(drafts)
    setBaselineRoutings(drafts)
    initializedRef.current = true
  }, [open, routings])

  const isDirty = serializeDrafts(draftRoutings) !== serializeDrafts(baselineRoutings)

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
    setEditingId(null)
    setProcessName("")
    setEquipmentGroupId("")
    setSetupTime(0)
    setUnitTime(0)
  }

  // 編集ボタンのハンドラ
  const handleEdit = (routing: DraftRouting) => {
    setEditingId(routing.id)
    setProcessName(routing.process_name)
    setEquipmentGroupId(routing.equipment_group_id)
    setSetupTime(routing.setup_time_seconds)
    setUnitTime(routing.unit_time_seconds)
  }

  // 下書きへの追加・更新ハンドラ（サーバー通信は行わない）
  const handleSave = () => {
    if (!processName.trim()) {
      toast.error("工程名を入力してください")
      return
    }
    if (equipmentGroupId === "") {
      toast.error("設備グループまたは「設備なし」を選択してください")
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

    if (editingId !== null) {
      setDraftRoutings((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                ...r,
                process_name: processName,
                equipment_group_id: equipmentGroupId,
                setup_time_seconds: setupTime,
                unit_time_seconds: unitTime,
              }
            : r
        )
      )
      toast.success("工程を更新しました（未保存）")
    } else {
      const newRouting: DraftRouting = {
        id: nextTempIdRef.current--,
        process_name: processName,
        equipment_group_id: equipmentGroupId,
        setup_time_seconds: setupTime,
        unit_time_seconds: unitTime,
        is_confirmed: false,
        confirmed_by: null,
        confirmed_at: null,
      }
      setDraftRoutings((prev) => [...prev, newRouting])
      toast.success("工程を追加しました（未保存）")
    }
    resetForm()
  }

  // 上下ボタンによる並べ替え
  const moveRouting = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    setDraftRoutings((prev) => {
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
  }

  // 削除ボタンのハンドラ（確認ダイアログを開く）
  const handleDeleteClick = (routing: DraftRouting) => {
    setRoutingToDelete(routing)
    setDeleteConfirmOpen(true)
  }

  // 削除の実行（下書きから除去するのみ）
  const handleDeleteConfirm = () => {
    if (!routingToDelete) return

    setDraftRoutings((prev) => prev.filter((r) => r.id !== routingToDelete.id))
    if (editingId === routingToDelete.id) {
      resetForm()
    }
    toast.success("工程を削除しました（未保存）")
    setDeleteConfirmOpen(false)
    setRoutingToDelete(null)
  }

  // 確定トグルのハンドラ（即時反映）
  const handleConfirmToggle = async (routing: DraftRouting) => {
    if (routing.id < 0) return // 未保存の新規工程は確定操作不可

    if (routing.is_confirmed) {
      // 確定取消 → 確認ダイアログを表示
      setRoutingToUnconfirm(routing)
      setUnconfirmDialogOpen(true)
    } else {
      // 確定ON → 即時実行
      try {
        const updated = await updateMutation.mutateAsync({
          id: routing.id,
          data: { is_confirmed: true },
        })
        applyConfirmedState(updated)
        toast.success(`工程「${routing.process_name}」を確定しました`)
      } catch (error) {
        toast.error("確定操作に失敗しました")
        console.error(error)
      }
    }
  }

  // 確定取消の実行
  const handleUnconfirmConfirm = async () => {
    if (!routingToUnconfirm) return
    try {
      const updated = await updateMutation.mutateAsync({
        id: routingToUnconfirm.id,
        data: { is_confirmed: false },
      })
      applyConfirmedState(updated)
      toast.success(`工程「${routingToUnconfirm.process_name}」の確定を取り消しました`)
    } catch (error) {
      toast.error("確定取消に失敗しました")
      console.error(error)
    } finally {
      setUnconfirmDialogOpen(false)
      setRoutingToUnconfirm(null)
    }
  }

  // 確定状態の変更を下書き・基準状態の両方に反映する（保存前の他の編集内容は保持する）
  const applyConfirmedState = (updated: ProcessRouting) => {
    const patch = (list: DraftRouting[]) =>
      list.map((r) =>
        r.id === updated.id
          ? {
              ...r,
              is_confirmed: updated.is_confirmed,
              confirmed_by: updated.confirmed_by,
              confirmed_at: updated.confirmed_at,
            }
          : r
      )
    setDraftRoutings(patch)
    setBaselineRoutings(patch)
  }

  // 一括保存の実行
  const handleBulkSave = async () => {
    if (!product) return
    try {
      const result = await bulkSaveMutation.mutateAsync({
        productId: product.id,
        items: draftRoutings.map((r, index) => ({
          id: r.id > 0 ? r.id : null,
          process_name: r.process_name,
          equipment_group_id: r.equipment_group_id,
          sequence_order: index + 1,
          setup_time_seconds: r.setup_time_seconds,
          unit_time_seconds: r.unit_time_seconds,
        })),
      })
      const drafts = result
        .slice()
        .sort((a, b) => a.sequence_order - b.sequence_order)
        .map(toDraft)
      setDraftRoutings(drafts)
      setBaselineRoutings(drafts)
      toast.success("変更を保存しました")
    } catch (error) {
      toast.error("変更の保存に失敗しました")
      console.error(error)
    }
  }

  // ダイアログを閉じようとした際のハンドラ（未保存の変更があれば確認を挟む）
  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty) {
      setCloseConfirmOpen(true)
      return
    }
    onOpenChange(next)
  }

  // 確認ダイアログで「破棄して閉じる」を選択した場合
  const handleDiscardAndClose = () => {
    setCloseConfirmOpen(false)
    onOpenChange(false)
  }

  // 設備グループ名を取得
  const getEquipmentGroupName = (equipmentGroupId: number | null) => {
    if (equipmentGroupId === null) return "設備なし"
    const group = equipmentGroups?.find((g) => g.id === equipmentGroupId)
    return group?.name || "不明"
  }

  const isPending = updateMutation.isPending || bulkSaveMutation.isPending

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>工程管理 - {product?.name}</DialogTitle>
          <DialogDescription>
            製品の製造工程を管理します。変更は「変更を保存」を押すまでサーバーに反映されません。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[2fr_1fr] gap-6 flex-1 min-h-0">
          {/* 左側: 工程リスト */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                登録済み工程
                {isDirty && (
                  <span className="ml-2 text-xs font-normal text-amber-600">未保存の変更があります</span>
                )}
              </h3>
              <Button
                size="sm"
                onClick={handleBulkSave}
                disabled={!isDirty || isPending}
              >
                {bulkSaveMutation.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : null}
                変更を保存
              </Button>
            </div>
            <div className="border rounded-md flex-1 overflow-y-auto">
              {isLoadingRoutings ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">読み込み中...</p>
                </div>
              ) : draftRoutings.length > 0 ? (
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-[70px]">順序</TableHead>
                      <TableHead>工程名</TableHead>
                      <TableHead>設備グループ</TableHead>
                      <TableHead className="w-[120px]">段取り時間(秒)</TableHead>
                      <TableHead className="w-[120px]">単位時間(秒)</TableHead>
                      <TableHead className="w-[80px] text-center">確定</TableHead>
                      <TableHead className="w-[130px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draftRoutings.map((routing, index) => (
                      <TableRow
                        key={routing.id}
                        className={editingId === routing.id ? "bg-muted/50" : ""}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-0.5">
                            <span className="w-4 text-right">{index + 1}</span>
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => moveRouting(index, -1)}
                                disabled={index === 0 || bulkSaveMutation.isPending}
                                aria-label={`${routing.process_name}を上へ移動`}
                                className="disabled:opacity-25 disabled:cursor-not-allowed hover:text-primary"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveRouting(index, 1)}
                                disabled={index === draftRoutings.length - 1 || bulkSaveMutation.isPending}
                                aria-label={`${routing.process_name}を下へ移動`}
                                className="disabled:opacity-25 disabled:cursor-not-allowed hover:text-primary"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {routing.process_name}
                            {routing.id < 0 && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500 text-amber-600 bg-amber-50">
                                未保存
                              </Badge>
                            )}
                            {routing.is_confirmed && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500 text-green-600 bg-green-50">
                                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                                確定済み
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getEquipmentGroupName(routing.equipment_group_id)}</TableCell>
                        <TableCell>{routing.setup_time_seconds}</TableCell>
                        <TableCell>{routing.unit_time_seconds}</TableCell>
                        <TableCell className="text-center">
                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleConfirmToggle(routing)}
                              disabled={isPending || routing.id < 0}
                              aria-label={routing.is_confirmed ? "確定を取り消す" : "確定する"}
                              title={routing.id < 0 ? "保存後に確定できます" : undefined}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                                routing.is_confirmed
                                  ? "bg-green-500 border-green-500"
                                  : "bg-background border-input hover:border-green-400"
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              {routing.is_confirmed && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </button>
                          ) : (
                            <div className="flex items-center justify-center" aria-label="管理者のみ操作可能">
                              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
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
                  未保存の工程変更は反映されません。
                </p>
              </CardContent>
            </Card>

            <h3 className="text-sm font-semibold">
              {editingId !== null ? "工程編集" : "工程追加"}
            </h3>

            <div className="space-y-4 flex-1">
              <div className="space-y-2">
                <Label htmlFor="process-name">工程名</Label>
                <Input
                  id="process-name"
                  value={processName}
                  onChange={(e) => setProcessName(e.target.value)}
                  placeholder="例: 切削加工"
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
                  <Label htmlFor="setup-time">段取り時間 (秒)</Label>
                  <Input
                    id="setup-time"
                    type="number"
                    min="0"
                    value={setupTime}
                    onChange={(e) => setSetupTime(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unit-time">単位時間 (秒)</Label>
                  <Input
                    id="unit-time"
                    type="number"
                    min="0"
                    value={unitTime}
                    onChange={(e) => setUnitTime(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                並べ替えは工程一覧の上下ボタンで行います。
              </p>
            </div>

            <div className="flex gap-2 mt-4">
              <Button
                onClick={handleSave}
                className="flex-1"
              >
                {editingId !== null ? (
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
              {editingId !== null && (
                <Button
                  variant="outline"
                  onClick={resetForm}
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
            「変更を保存」を押すまでサーバーには反映されません。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={handleDeleteConfirm}>削除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* 確定取消確認ダイアログ */}
    <AlertDialog open={unconfirmDialogOpen} onOpenChange={setUnconfirmDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確定を取り消しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            工程「{routingToUnconfirm?.process_name}」の確定を取り消します。
            再度確定するまで、この工程は未確定状態になります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={handleUnconfirmConfirm}>確定を取り消す</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* 未保存変更の警告ダイアログ */}
    <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>保存されていない変更があります</AlertDialogTitle>
          <AlertDialogDescription>
            工程の追加・編集・削除・並べ替えの変更が保存されていません。
            破棄してモーダルを閉じますか？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={handleDiscardAndClose}>破棄して閉じる</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

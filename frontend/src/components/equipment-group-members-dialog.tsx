"use client"

import { useState, useMemo } from "react"
import { ArrowRight, ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEquipments } from "@/hooks/use-equipments"
import {
  useEquipmentGroupMembers,
  useAddEquipmentToGroup,
  useRemoveEquipmentFromGroup,
} from "@/hooks/use-equipment-group-members"
import type { EquipmentGroup } from "@/lib/hooks/use-equipment-groups"

interface EquipmentGroupMembersDialogProps {
  group: EquipmentGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 設備グループのメンバー管理ダイアログ
 * 左側に未所属設備、右側に所属設備を表示し、追加・削除操作を行う
 */
export function EquipmentGroupMembersDialog({
  group,
  open,
  onOpenChange,
}: EquipmentGroupMembersDialogProps) {
  const [selectedUnassigned, setSelectedUnassigned] = useState<Set<number>>(new Set())
  const [selectedAssigned, setSelectedAssigned] = useState<Set<number>>(new Set())

  // データ取得
  const { data: allEquipments, isLoading: isLoadingEquipments } = useEquipments()
  const { data: assignedEquipments, isLoading: isLoadingMembers } = useEquipmentGroupMembers(
    group?.id ?? 0
  )

  // 操作
  const addMutation = useAddEquipmentToGroup()
  const removeMutation = useRemoveEquipmentFromGroup()

  // 未所属設備と所属設備のリストを計算
  const { unassignedEquipments, assigned } = useMemo(() => {
    if (!allEquipments || !assignedEquipments) {
      return { unassignedEquipments: [], assigned: [] }
    }

    const assignedIds = new Set(assignedEquipments.map((eq) => eq.id))
    const unassigned = allEquipments.filter((eq) => !assignedIds.has(eq.id))

    return {
      unassignedEquipments: unassigned,
      assigned: assignedEquipments,
    }
  }, [allEquipments, assignedEquipments])

  // 選択状態のトグル
  const toggleUnassignedSelection = (equipmentId: number) => {
    const newSelection = new Set(selectedUnassigned)
    if (newSelection.has(equipmentId)) {
      newSelection.delete(equipmentId)
    } else {
      newSelection.add(equipmentId)
    }
    setSelectedUnassigned(newSelection)
  }

  const toggleAssignedSelection = (equipmentId: number) => {
    const newSelection = new Set(selectedAssigned)
    if (newSelection.has(equipmentId)) {
      newSelection.delete(equipmentId)
    } else {
      newSelection.add(equipmentId)
    }
    setSelectedAssigned(newSelection)
  }

  // 設備を追加
  const handleAddEquipments = async () => {
    if (!group || selectedUnassigned.size === 0) return

    try {
      const promises = Array.from(selectedUnassigned).map((equipmentId) =>
        addMutation.mutateAsync({ groupId: group.id, equipmentId })
      )
      await Promise.all(promises)
      toast.success(`${selectedUnassigned.size}件の設備を追加しました`)
      setSelectedUnassigned(new Set())
    } catch (error) {
      toast.error("設備の追加に失敗しました")
      console.error(error)
    }
  }

  // 設備を削除
  const handleRemoveEquipments = async () => {
    if (!group || selectedAssigned.size === 0) return

    try {
      const promises = Array.from(selectedAssigned).map((equipmentId) =>
        removeMutation.mutateAsync({ groupId: group.id, equipmentId })
      )
      await Promise.all(promises)
      toast.success(`${selectedAssigned.size}件の設備を削除しました`)
      setSelectedAssigned(new Set())
    } catch (error) {
      toast.error("設備の削除に失敗しました")
      console.error(error)
    }
  }

  // ダイアログクローズ時の処理
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // 選択状態をクリア
      setSelectedUnassigned(new Set())
      setSelectedAssigned(new Set())
    }
    onOpenChange(newOpen)
  }

  const isLoading = isLoadingEquipments || isLoadingMembers
  const isPending = addMutation.isPending || removeMutation.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>メンバー管理 - {group?.name}</DialogTitle>
          <DialogDescription>
            設備グループに所属させる設備を選択してください
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 py-4">
          {/* 左側: 未所属設備リスト */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-sm">未所属設備</h3>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">読み込み中...</p>
              ) : unassignedEquipments.length > 0 ? (
                unassignedEquipments.map((equipment) => (
                  <div
                    key={equipment.id}
                    className={`p-2 rounded cursor-pointer hover:bg-accent transition-colors ${
                      selectedUnassigned.has(equipment.id) ? "bg-accent" : ""
                    }`}
                    onClick={() => toggleUnassignedSelection(equipment.id)}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedUnassigned.has(equipment.id)}
                        onChange={() => toggleUnassignedSelection(equipment.id)}
                        className="cursor-pointer"
                      />
                      <span className="text-sm">{equipment.name}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  未所属の設備はありません
                </p>
              )}
            </div>
          </div>

          {/* 中央: 操作ボタン */}
          <div className="flex flex-col items-center justify-center gap-2">
            <Button
              onClick={handleAddEquipments}
              disabled={selectedUnassigned.size === 0 || isPending}
              size="icon"
              variant="outline"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              onClick={handleRemoveEquipments}
              disabled={selectedAssigned.size === 0 || isPending}
              size="icon"
              variant="outline"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>

          {/* 右側: 所属設備リスト */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-sm">所属設備</h3>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">読み込み中...</p>
              ) : assigned.length > 0 ? (
                assigned.map((equipment) => (
                  <div
                    key={equipment.id}
                    className={`p-2 rounded cursor-pointer hover:bg-accent transition-colors ${
                      selectedAssigned.has(equipment.id) ? "bg-accent" : ""
                    }`}
                    onClick={() => toggleAssignedSelection(equipment.id)}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedAssigned.has(equipment.id)}
                        onChange={() => toggleAssignedSelection(equipment.id)}
                        className="cursor-pointer"
                      />
                      <span className="text-sm">{equipment.name}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  所属設備はありません
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
import { EquipmentList } from "@/components/equipment-list"
import { useEquipmentAssignment } from "@/hooks/use-equipment-assignment"
import type { EquipmentGroup } from "@/lib/hooks/use-equipment-groups"

interface EquipmentGroupMembersDialogProps {
  group: EquipmentGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 設備グループのメンバー管理ダイアログ
 * 左側に未所属設備、右側に所属設備を表示し、追加・削除操作を行う
 * @param group 設備グループ
 * @param open ダイアログの表示状態
 * @param onOpenChange ダイアログの表示状態を変更する関数
 * @returns 設備グループのメンバー管理ダイアログ
 */
export function EquipmentGroupMembersDialog({
  group,
  open,
  onOpenChange,
}: EquipmentGroupMembersDialogProps) {
  const {
    unassignedEquipments,
    assigned,
    selectedUnassigned,
    selectedAssigned,
    toggleUnassignedSelection,
    toggleAssignedSelection,
    handleAddEquipments,
    handleRemoveEquipments,
    resetSelections,
    isLoading,
    isPending,
  } = useEquipmentAssignment(group)

  // ダイアログクローズ時の処理
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetSelections()
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle>メンバー管理 - {group?.name}</DialogTitle>
          <DialogDescription>
            設備グループに所属させる設備を選択してください
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 py-4 flex-1 min-h-0">
          {/* 左側: 未所属設備リスト */}
          <EquipmentList
            title="未所属設備"
            equipments={unassignedEquipments}
            selectedIds={selectedUnassigned}
            onToggle={toggleUnassignedSelection}
            isLoading={isLoading}
            emptyMessage="未所属の設備はありません"
          />

          {/* 中央: 操作ボタン */}
          <div className="flex flex-col items-center justify-center gap-2">
            <Button
              onClick={handleAddEquipments}
              disabled={selectedUnassigned.size === 0 || isPending}
              size="icon"
              variant="outline"
              title="追加"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              onClick={handleRemoveEquipments}
              disabled={selectedAssigned.size === 0 || isPending}
              size="icon"
              variant="outline"
              title="削除"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>

          {/* 右側: 所属設備リスト */}
          <EquipmentList
            title="所属設備"
            equipments={assigned}
            selectedIds={selectedAssigned}
            onToggle={toggleAssignedSelection}
            isLoading={isLoading}
            emptyMessage="所属設備はありません"
          />
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

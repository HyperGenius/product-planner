'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

import { useEquipmentGroups } from '@/lib/hooks/use-equipment-groups'
import {
  useAllEquipmentGroupMembers,
  useAddEquipmentToGroup,
  useRemoveEquipmentFromGroup,
} from '@/hooks/use-equipment-group-members'
import type { Equipment } from '@/types/equipment'

interface Props {
  equipment: Equipment | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EquipmentGroupAssignmentDialog({ equipment, open, onOpenChange }: Props) {
  const { data: groups = [] } = useEquipmentGroups()
  const { data: allMembers = [] } = useAllEquipmentGroupMembers()
  const addMutation = useAddEquipmentToGroup()
  const removeMutation = useRemoveEquipmentFromGroup()

  // この設備が現在所属しているグループIDセット
  const currentGroupIds = new Set(
    allMembers
      .filter((m) => m.equipment_id === equipment?.id)
      .map((m) => m.equipment_group_id)
  )

  // チェックボックスの選択状態（ダイアログ内の操作用）
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())

  // ダイアログが開いたとき、現在の所属状態で初期化
  useEffect(() => {
    if (open && equipment) {
      setSelectedGroupIds(new Set(currentGroupIds))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, equipment?.id, allMembers])

  const handleToggle = (groupId: number, checked: boolean) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(groupId)
      } else {
        next.delete(groupId)
      }
      return next
    })
  }

  const handleSave = async () => {
    if (!equipment) return

    const toAdd = [...selectedGroupIds].filter((id) => !currentGroupIds.has(id))
    const toRemove = [...currentGroupIds].filter((id) => !selectedGroupIds.has(id))

    try {
      await Promise.all([
        ...toAdd.map((groupId) =>
          addMutation.mutateAsync({ groupId, equipmentId: equipment.id })
        ),
        ...toRemove.map((groupId) =>
          removeMutation.mutateAsync({ groupId, equipmentId: equipment.id })
        ),
      ])
      toast.success('グループ設定を保存しました')
      onOpenChange(false)
    } catch {
      toast.error('保存に失敗しました')
    }
  }

  const isPending = addMutation.isPending || removeMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{equipment?.name} のグループ設定</DialogTitle>
          <DialogDescription>この設備が属するグループを選択してください</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">グループが登録されていません</p>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`group-${group.id}`}
                    checked={selectedGroupIds.has(group.id)}
                    onCheckedChange={(checked: boolean) => handleToggle(group.id, checked)}
                  />
                  <Label htmlFor={`group-${group.id}`} className="cursor-pointer font-normal">
                    {group.name}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

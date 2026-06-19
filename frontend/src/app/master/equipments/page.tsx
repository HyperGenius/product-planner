"use client"

import { useMemo, useState } from "react"
import { Pencil, Plus, Trash2, Users, Layers } from "lucide-react"
import { toast } from "sonner"

import {
  useEquipments,
  useCreateEquipment,
  useUpdateEquipment,
  useDeleteEquipment,
} from "@/hooks/use-equipments"
import {
  useEquipmentGroups,
  useCreateEquipmentGroup,
  useUpdateEquipmentGroup,
  useDeleteEquipmentGroup,
  type EquipmentGroup,
} from "@/lib/hooks/use-equipment-groups"
import { useAllEquipmentGroupMembers } from "@/hooks/use-equipment-group-members"
import type { Equipment } from "@/types/equipment"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EquipmentGroupMembersDialog } from "@/components/equipment-group-members-dialog"
import { EquipmentGroupAssignmentDialog } from "@/components/equipment-group-assignment-dialog"

type GroupDialogMode = "create" | "edit" | null

interface SchedulingParamFieldsProps {
  guardTime: string
  minSlot: string
  maxFragments: string
  onGuardTimeChange: (v: string) => void
  onMinSlotChange: (v: string) => void
  onMaxFragmentsChange: (v: string) => void
  idPrefix: string
}

function SchedulingParamFields({
  guardTime, minSlot, maxFragments,
  onGuardTimeChange, onMinSlotChange, onMaxFragmentsChange,
  idPrefix,
}: SchedulingParamFieldsProps) {
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">
        スケジューリング設定（空欄 = グローバル設定を使用）
      </p>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-guard`}>ガードタイム（分）</Label>
        <Input
          id={`${idPrefix}-guard`}
          type="number"
          min={0}
          value={guardTime}
          onChange={(e) => onGuardTimeChange(e.target.value)}
          placeholder="デフォルト使用中"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-min-slot`}>最低時間スロット（分）</Label>
        <Input
          id={`${idPrefix}-min-slot`}
          type="number"
          min={0}
          value={minSlot}
          onChange={(e) => onMinSlotChange(e.target.value)}
          placeholder="デフォルト使用中"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-max-frag`}>最大断片数</Label>
        <Input
          id={`${idPrefix}-max-frag`}
          type="number"
          min={1}
          value={maxFragments}
          onChange={(e) => onMaxFragmentsChange(e.target.value)}
          placeholder="デフォルト使用中"
        />
      </div>
    </div>
  )
}

export default function EquipmentsPage() {
  // ── 設備一覧タブの状態 ──────────────────────────────────────────
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null)
  const [equipmentName, setEquipmentName] = useState("")
  const [equipGuardTime, setEquipGuardTime] = useState("")
  const [equipMinSlot, setEquipMinSlot] = useState("")
  const [equipMaxFragments, setEquipMaxFragments] = useState("")
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [equipmentForAssignment, setEquipmentForAssignment] = useState<Equipment | null>(null)

  // ── グループ管理タブの状態 ──────────────────────────────────────
  const [groupDialogMode, setGroupDialogMode] = useState<GroupDialogMode>(null)
  const [selectedGroup, setSelectedGroup] = useState<EquipmentGroup | null>(null)
  const [groupName, setGroupName] = useState("")
  const [groupGuardTime, setGroupGuardTime] = useState("")
  const [groupMinSlot, setGroupMinSlot] = useState("")
  const [groupMaxFragments, setGroupMaxFragments] = useState("")
  const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false)
  const [groupToDelete, setGroupToDelete] = useState<EquipmentGroup | null>(null)
  const [membersDialogOpen, setMembersDialogOpen] = useState(false)
  const [groupForMembers, setGroupForMembers] = useState<EquipmentGroup | null>(null)

  // ── データフェッチ ───────────────────────────────────────────────
  const { data: equipments, isLoading: isLoadingEquipments, error: equipmentError } = useEquipments()
  const { data: groups, isLoading: isLoadingGroups, error: groupError } = useEquipmentGroups()
  const { data: allMembers = [] } = useAllEquipmentGroupMembers()

  const createEquipmentMutation = useCreateEquipment()
  const updateEquipmentMutation = useUpdateEquipment()
  const deleteEquipmentMutation = useDeleteEquipment()

  const createGroupMutation = useCreateEquipmentGroup()
  const updateGroupMutation = useUpdateEquipmentGroup()
  const deleteGroupMutation = useDeleteEquipmentGroup()

  // 共有グループ(2設備以上)のIDセット
  const sharedGroupIds = useMemo(
    () => new Set(groups?.filter((g) => g.member_count >= 2).map((g) => g.id) ?? []),
    [groups]
  )

  // 設備ID → 所属共有グループ名リスト のマップ(システムグループは除外)
  const equipmentGroupMap = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const member of allMembers) {
      if (!sharedGroupIds.has(member.equipment_group_id)) continue
      const group = groups?.find((g) => g.id === member.equipment_group_id)
      if (!group) continue
      const names = map.get(member.equipment_id) ?? []
      names.push(group.name)
      map.set(member.equipment_id, names)
    }
    return map
  }, [allMembers, groups, sharedGroupIds])

  // ── 設備タブのハンドラ ────────────────────────────────────────
  const handleOpenCreateDialog = () => {
    setEquipmentName("")
    setEquipGuardTime("")
    setEquipMinSlot("")
    setEquipMaxFragments("")
    setIsCreateDialogOpen(true)
  }

  const handleOpenEditDialog = (equipment: Equipment) => {
    setSelectedEquipment(equipment)
    setEquipmentName(equipment.name)
    setEquipGuardTime(equipment.guard_time_minutes != null ? String(equipment.guard_time_minutes) : "")
    setEquipMinSlot(equipment.min_slot_minutes != null ? String(equipment.min_slot_minutes) : "")
    setEquipMaxFragments(equipment.max_fragments != null ? String(equipment.max_fragments) : "")
    setIsEditDialogOpen(true)
  }

  const handleOpenDeleteDialog = (equipment: Equipment) => {
    setSelectedEquipment(equipment)
    setIsDeleteDialogOpen(true)
  }

  const handleOpenAssignmentDialog = (equipment: Equipment) => {
    setEquipmentForAssignment(equipment)
    setAssignmentDialogOpen(true)
  }

  const parseOptionalInt = (val: string) => (val.trim() === "" ? null : parseInt(val, 10))

  const handleCreate = async () => {
    if (!equipmentName.trim()) {
      toast.error("設備名を入力してください")
      return
    }
    try {
      await createEquipmentMutation.mutateAsync({
        name: equipmentName,
        guard_time_minutes: parseOptionalInt(equipGuardTime),
        min_slot_minutes: parseOptionalInt(equipMinSlot),
        max_fragments: parseOptionalInt(equipMaxFragments),
      })
      toast.success("設備を作成しました")
      setIsCreateDialogOpen(false)
      setEquipmentName("")
    } catch (error) {
      toast.error("設備の作成に失敗しました")
      console.error(error)
    }
  }

  const handleUpdate = async () => {
    if (!selectedEquipment) return
    if (!equipmentName.trim()) {
      toast.error("設備名を入力してください")
      return
    }
    try {
      await updateEquipmentMutation.mutateAsync({
        id: selectedEquipment.id,
        data: {
          name: equipmentName,
          guard_time_minutes: parseOptionalInt(equipGuardTime),
          min_slot_minutes: parseOptionalInt(equipMinSlot),
          max_fragments: parseOptionalInt(equipMaxFragments),
        },
      })
      toast.success("設備を更新しました")
      setIsEditDialogOpen(false)
      setEquipmentName("")
      setSelectedEquipment(null)
    } catch (error) {
      toast.error("設備の更新に失敗しました")
      console.error(error)
    }
  }

  const handleDelete = async () => {
    if (!selectedEquipment) return
    try {
      await deleteEquipmentMutation.mutateAsync(selectedEquipment.id)
      toast.success("設備を削除しました")
      setIsDeleteDialogOpen(false)
      setSelectedEquipment(null)
    } catch (error) {
      toast.error("設備の削除に失敗しました")
      console.error(error)
    }
  }

  // ── グループタブのハンドラ ────────────────────────────────────
  const handleOpenGroupCreateDialog = () => {
    setGroupName("")
    setGroupGuardTime("")
    setGroupMinSlot("")
    setGroupMaxFragments("")
    setSelectedGroup(null)
    setGroupDialogMode("create")
  }

  const handleOpenGroupEditDialog = (group: EquipmentGroup) => {
    setGroupName(group.name)
    setGroupGuardTime(group.guard_time_minutes != null ? String(group.guard_time_minutes) : "")
    setGroupMinSlot(group.min_slot_minutes != null ? String(group.min_slot_minutes) : "")
    setGroupMaxFragments(group.max_fragments != null ? String(group.max_fragments) : "")
    setSelectedGroup(group)
    setGroupDialogMode("edit")
  }

  const handleCloseGroupDialog = () => {
    setGroupDialogMode(null)
    setSelectedGroup(null)
    setGroupName("")
    setGroupGuardTime("")
    setGroupMinSlot("")
    setGroupMaxFragments("")
  }

  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!groupName.trim()) {
      toast.error("グループ名を入力してください")
      return
    }
    const groupData = {
      name: groupName,
      guard_time_minutes: parseOptionalInt(groupGuardTime),
      min_slot_minutes: parseOptionalInt(groupMinSlot),
      max_fragments: parseOptionalInt(groupMaxFragments),
    }
    try {
      if (groupDialogMode === "create") {
        await createGroupMutation.mutateAsync(groupData)
        toast.success("設備グループを作成しました")
      } else if (groupDialogMode === "edit" && selectedGroup) {
        await updateGroupMutation.mutateAsync({ id: selectedGroup.id, data: groupData })
        toast.success("設備グループを更新しました")
      }
      handleCloseGroupDialog()
    } catch (error) {
      toast.error("操作に失敗しました")
      console.error(error)
    }
  }

  const handleOpenGroupDeleteDialog = (group: EquipmentGroup) => {
    setGroupToDelete(group)
    setDeleteGroupDialogOpen(true)
  }

  const handleGroupDelete = async () => {
    if (!groupToDelete) return
    try {
      await deleteGroupMutation.mutateAsync(groupToDelete.id)
      toast.success("設備グループを削除しました")
      setDeleteGroupDialogOpen(false)
      setGroupToDelete(null)
    } catch (error) {
      toast.error("削除に失敗しました")
      console.error(error)
    }
  }

  const handleOpenMembersDialog = (group: EquipmentGroup) => {
    setGroupForMembers(group)
    setMembersDialogOpen(true)
  }

  // ── エラー表示 ───────────────────────────────────────────────
  if (equipmentError || groupError) {
    return (
      <div className="py-10">
        <div className="text-red-500">
          エラーが発生しました: {(equipmentError ?? groupError)?.message || "不明なエラー"}
        </div>
      </div>
    )
  }

  return (
    <div className="py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">設備マスタ</h1>
        <p className="text-muted-foreground">設備の登録・管理、グループ設定を行います</p>
      </div>

      <Tabs defaultValue="equipments">
        <TabsList className="mb-6">
          <TabsTrigger value="equipments">設備一覧</TabsTrigger>
          <TabsTrigger value="groups">グループ管理</TabsTrigger>
        </TabsList>

        {/* ── タブ1: 設備一覧 ─────────────────────────────────── */}
        <TabsContent value="equipments">
          <div className="mb-4 flex justify-end">
            <Button onClick={handleOpenCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              新規作成
            </Button>
          </div>

          {isLoadingEquipments ? (
            <div className="text-center py-10 text-muted-foreground">読み込み中...</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">ID</TableHead>
                    <TableHead>設備名</TableHead>
                    <TableHead>所属グループ</TableHead>
                    <TableHead className="w-[150px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipments && equipments.length > 0 ? (
                    equipments.map((equipment) => {
                      const groupNames = equipmentGroupMap.get(equipment.id) ?? []
                      return (
                        <TableRow key={equipment.id}>
                          <TableCell className="font-medium">{equipment.id}</TableCell>
                          <TableCell>{equipment.name}</TableCell>
                          <TableCell>
                            {groupNames.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {groupNames.map((name) => (
                                  <Badge key={name} variant="secondary">
                                    {name}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleOpenAssignmentDialog(equipment)}
                                title="グループ管理"
                                aria-label={`${equipment.name}のグループ管理`}
                              >
                                <Layers className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleOpenEditDialog(equipment)}
                                aria-label={`${equipment.name}を編集`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleOpenDeleteDialog(equipment)}
                                aria-label={`${equipment.name}を削除`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-10">
                        設備がありません
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── タブ2: グループ管理 ──────────────────────────────── */}
        <TabsContent value="groups">
          <div className="mb-4 flex justify-end">
            <Button onClick={handleOpenGroupCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              新規作成
            </Button>
          </div>

          {isLoadingGroups ? (
            <div className="text-center py-10 text-muted-foreground">読み込み中...</div>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">ID</TableHead>
                    <TableHead>グループ名</TableHead>
                    <TableHead className="w-[200px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups && groups.filter((g) => g.member_count >= 2).length > 0 ? (
                    groups.filter((g) => g.member_count >= 2).map((group) => (
                      <TableRow key={group.id}>
                        <TableCell className="font-medium">{group.id}</TableCell>
                        <TableCell>{group.name}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleOpenMembersDialog(group)}
                              title="メンバー管理"
                            >
                              <Users className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleOpenGroupEditDialog(group)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleOpenGroupDeleteDialog(group)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                        データがありません
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── 設備: 作成ダイアログ ─────────────────────────────────── */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設備の新規作成</DialogTitle>
            <DialogDescription>新しい設備を作成します。設備名を入力してください。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="create-name">設備名</Label>
              <Input
                id="create-name"
                value={equipmentName}
                onChange={(e) => setEquipmentName(e.target.value)}
                placeholder="例: 切断機A"
              />
            </div>
            <SchedulingParamFields
              guardTime={equipGuardTime}
              minSlot={equipMinSlot}
              maxFragments={equipMaxFragments}
              onGuardTimeChange={setEquipGuardTime}
              onMinSlotChange={setEquipMinSlot}
              onMaxFragmentsChange={setEquipMaxFragments}
              idPrefix="create-equip"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleCreate} disabled={createEquipmentMutation.isPending}>
              {createEquipmentMutation.isPending ? "作成中..." : "作成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 設備: 編集ダイアログ ─────────────────────────────────── */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設備の編集</DialogTitle>
            <DialogDescription>設備名を変更してください。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">設備名</Label>
              <Input
                id="edit-name"
                value={equipmentName}
                onChange={(e) => setEquipmentName(e.target.value)}
                placeholder="例: 切断機A"
              />
            </div>
            <SchedulingParamFields
              guardTime={equipGuardTime}
              minSlot={equipMinSlot}
              maxFragments={equipMaxFragments}
              onGuardTimeChange={setEquipGuardTime}
              onMinSlotChange={setEquipMinSlot}
              onMaxFragmentsChange={setEquipMaxFragments}
              idPrefix="edit-equip"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleUpdate} disabled={updateEquipmentMutation.isPending}>
              {updateEquipmentMutation.isPending ? "更新中..." : "更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 設備: 削除確認ダイアログ ─────────────────────────────── */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設備の削除</DialogTitle>
            <DialogDescription>
              本当に「{selectedEquipment?.name}」を削除しますか？この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteEquipmentMutation.isPending}
            >
              {deleteEquipmentMutation.isPending ? "削除中..." : "削除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 設備: グループ管理ダイアログ（設備視点） ─────────────── */}
      <EquipmentGroupAssignmentDialog
        equipment={equipmentForAssignment}
        open={assignmentDialogOpen}
        onOpenChange={setAssignmentDialogOpen}
      />

      {/* ── グループ: 作成/編集ダイアログ ────────────────────────── */}
      <Dialog open={groupDialogMode !== null} onOpenChange={handleCloseGroupDialog}>
        <DialogContent>
          <form onSubmit={handleGroupSubmit}>
            <DialogHeader>
              <DialogTitle>{groupDialogMode === "create" ? "新規作成" : "編集"}</DialogTitle>
              <DialogDescription>設備グループの情報を入力してください</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="group-name">グループ名</Label>
                <Input
                  id="group-name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例: 切断グループ"
                  autoComplete="off"
                />
              </div>
              <SchedulingParamFields
                guardTime={groupGuardTime}
                minSlot={groupMinSlot}
                maxFragments={groupMaxFragments}
                onGuardTimeChange={setGroupGuardTime}
                onMinSlotChange={setGroupMinSlot}
                onMaxFragmentsChange={setGroupMaxFragments}
                idPrefix="group"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCloseGroupDialog}>
                キャンセル
              </Button>
              <Button
                type="submit"
                disabled={createGroupMutation.isPending || updateGroupMutation.isPending}
              >
                {createGroupMutation.isPending || updateGroupMutation.isPending
                  ? "保存中..."
                  : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── グループ: 削除確認ダイアログ ─────────────────────────── */}
      <AlertDialog open={deleteGroupDialogOpen} onOpenChange={setDeleteGroupDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>削除の確認</AlertDialogTitle>
            <AlertDialogDescription>
              {groupToDelete?.name} を削除してもよろしいですか？
              <br />
              この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setGroupToDelete(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleGroupDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteGroupMutation.isPending}
            >
              {deleteGroupMutation.isPending ? "削除中..." : "削除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── グループ: メンバー管理ダイアログ（グループ視点） ─────── */}
      <EquipmentGroupMembersDialog
        group={groupForMembers}
        open={membersDialogOpen}
        onOpenChange={setMembersDialogOpen}
      />
    </div>
  )
}

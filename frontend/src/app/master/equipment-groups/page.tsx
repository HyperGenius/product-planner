'use client'

import { useState } from 'react'
import { Pencil, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  useEquipmentGroups,
  useCreateEquipmentGroup,
  useUpdateEquipmentGroup,
  useDeleteEquipmentGroup,
  type EquipmentGroup,
} from '@/lib/hooks/use-equipment-groups'
import { EquipmentGroupMembersDialog } from '@/components/equipment-group-members-dialog'

type DialogMode = 'create' | 'edit' | null

export default function EquipmentGroupsPage() {
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [selectedGroup, setSelectedGroup] = useState<EquipmentGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [groupToDelete, setGroupToDelete] = useState<EquipmentGroup | null>(null)
  const [membersDialogOpen, setMembersDialogOpen] = useState(false)
  const [groupForMembers, setGroupForMembers] = useState<EquipmentGroup | null>(null)

  const { data: groups, isLoading, error } = useEquipmentGroups()
  const createMutation = useCreateEquipmentGroup()
  const updateMutation = useUpdateEquipmentGroup()
  const deleteMutation = useDeleteEquipmentGroup()

  const handleOpenCreateDialog = () => {
    setGroupName('')
    setSelectedGroup(null)
    setDialogMode('create')
  }

  const handleOpenEditDialog = (group: EquipmentGroup) => {
    setGroupName(group.name)
    setSelectedGroup(group)
    setDialogMode('edit')
  }

  const handleCloseDialog = () => {
    setDialogMode(null)
    setSelectedGroup(null)
    setGroupName('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!groupName.trim()) {
      toast.error('グループ名を入力してください')
      return
    }

    try {
      if (dialogMode === 'create') {
        await createMutation.mutateAsync({ name: groupName })
        toast.success('設備グループを作成しました')
      } else if (dialogMode === 'edit' && selectedGroup) {
        await updateMutation.mutateAsync({
          id: selectedGroup.id,
          data: { name: groupName },
        })
        toast.success('設備グループを更新しました')
      }
      handleCloseDialog()
    } catch (error) {
      toast.error('操作に失敗しました')
      console.error(error)
    }
  }

  const handleOpenDeleteDialog = (group: EquipmentGroup) => {
    setGroupToDelete(group)
    setDeleteDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!groupToDelete) return

    try {
      await deleteMutation.mutateAsync(groupToDelete.id)
      toast.success('設備グループを削除しました')
      setDeleteDialogOpen(false)
      setGroupToDelete(null)
    } catch (error) {
      toast.error('削除に失敗しました')
      console.error(error)
    }
  }

  const handleOpenMembersDialog = (group: EquipmentGroup) => {
    setGroupForMembers(group)
    setMembersDialogOpen(true)
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-10">
        <div className="flex items-center justify-center">
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto py-10">
        <div className="flex items-center justify-center">
          <p className="text-destructive">エラーが発生しました: {error?.message || "不明なエラー"}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">設備グループマスタ</h1>
        <Button onClick={handleOpenCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          新規作成
        </Button>
      </div>

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
            {groups && groups.length > 0 ? (
              groups.map((group) => (
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
                        onClick={() => handleOpenEditDialog(group)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleOpenDeleteDialog(group)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  データがありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 作成/編集ダイアログ */}
      <Dialog open={dialogMode !== null} onOpenChange={handleCloseDialog}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {dialogMode === 'create' ? '新規作成' : '編集'}
              </DialogTitle>
              <DialogDescription>
                設備グループの情報を入力してください
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">グループ名</Label>
                <Input
                  id="name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例: 切断グループ"
                  autoComplete="off"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseDialog}
              >
                キャンセル
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? '保存中...'
                  : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 削除確認ダイアログ */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
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
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? '削除中...' : '削除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* メンバー管理ダイアログ */}
      <EquipmentGroupMembersDialog
        group={groupForMembers}
        open={membersDialogOpen}
        onOpenChange={setMembersDialogOpen}
      />
    </div>
  )
}

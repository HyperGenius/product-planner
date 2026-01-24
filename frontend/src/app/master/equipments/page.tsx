"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  useEquipments,
  useCreateEquipment,
  useUpdateEquipment,
  useDeleteEquipment,
} from "@/hooks/use-equipments"
import type { Equipment } from "@/types/equipment"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

/**
 * 設備マスタ画面
 * URL: /master/equipments
 */
export default function EquipmentsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(
    null
  )
  const [equipmentName, setEquipmentName] = useState("")

  // データ取得・操作のフック
  const { data: equipments, isLoading, error } = useEquipments()
  const createMutation = useCreateEquipment()
  const updateMutation = useUpdateEquipment()
  const deleteMutation = useDeleteEquipment()

  // 作成ダイアログを開く
  const handleOpenCreateDialog = () => {
    setEquipmentName("")
    setIsCreateDialogOpen(true)
  }

  // 編集ダイアログを開く
  const handleOpenEditDialog = (equipment: Equipment) => {
    setSelectedEquipment(equipment)
    setEquipmentName(equipment.name)
    setIsEditDialogOpen(true)
  }

  // 削除ダイアログを開く
  const handleOpenDeleteDialog = (equipment: Equipment) => {
    setSelectedEquipment(equipment)
    setIsDeleteDialogOpen(true)
  }

  // 設備を作成
  const handleCreate = async () => {
    if (!equipmentName.trim()) {
      toast.error("設備名を入力してください")
      return
    }

    try {
      await createMutation.mutateAsync({ name: equipmentName })
      toast.success("設備を作成しました")
      setIsCreateDialogOpen(false)
      setEquipmentName("")
    } catch (error) {
      toast.error("設備の作成に失敗しました")
      console.error(error)
    }
  }

  // 設備を更新
  const handleUpdate = async () => {
    if (!selectedEquipment) return

    if (!equipmentName.trim()) {
      toast.error("設備名を入力してください")
      return
    }

    try {
      await updateMutation.mutateAsync({
        id: selectedEquipment.id,
        data: { name: equipmentName },
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

  // 設備を削除
  const handleDelete = async () => {
    if (!selectedEquipment) return

    try {
      await deleteMutation.mutateAsync(selectedEquipment.id)
      toast.success("設備を削除しました")
      setIsDeleteDialogOpen(false)
      setSelectedEquipment(null)
    } catch (error) {
      toast.error("設備の削除に失敗しました")
      console.error(error)
    }
  }

  if (error) {
    return (
      <div className="container mx-auto py-10">
        <div className="text-red-500">
          エラーが発生しました: {error?.message || "不明なエラー"}
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">設備マスタ</h1>
          <p className="text-muted-foreground">
            設備の一覧表示、作成、編集、削除を行います
          </p>
        </div>
        <Button onClick={handleOpenCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          新規作成
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-10">読み込み中...</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead>設備名</TableHead>
                <TableHead className="w-[150px] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipments && equipments.length > 0 ? (
                equipments.map((equipment) => (
                  <TableRow key={equipment.id}>
                    <TableCell className="font-medium">{equipment.id}</TableCell>
                    <TableCell>{equipment.name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
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
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-10">
                    設備がありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 作成ダイアログ */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設備の新規作成</DialogTitle>
            <DialogDescription>
              新しい設備を作成します。設備名を入力してください。
            </DialogDescription>
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
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "作成中..." : "作成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 編集ダイアログ */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設備の編集</DialogTitle>
            <DialogDescription>
              設備情報を編集します。設備名を変更してください。
            </DialogDescription>
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
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "更新中..." : "更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認ダイアログ */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設備の削除</DialogTitle>
            <DialogDescription>
              本当に「{selectedEquipment?.name}」を削除しますか？
              この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "削除中..." : "削除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

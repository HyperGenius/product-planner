"use client"

import { useMemo, useState } from "react"
import { ArrowUpDown, Pencil, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import { useEquipments } from "@/hooks/use-equipments"
import {
  useEquipmentGroups,
  useCreateEquipmentGroup,
  useUpdateEquipmentGroup,
  useDeleteEquipmentGroup,
  type EquipmentGroup,
} from "@/lib/hooks/use-equipment-groups"
import { useAllEquipmentGroupMembers } from "@/hooks/use-equipment-group-members"
import { sortEquipments, type EquipmentSortKey } from "@/lib/equipment-utils"

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
import { EquipmentDetailSheet } from "@/components/equipments/equipment-detail-sheet"
import { SchedulingParamFields } from "@/components/equipments/equipment-form-fields"

type GroupDialogMode = "create" | "edit" | null

function SortableHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground ${active ? "text-foreground" : ""}`}
      aria-label={`${label}順に並べ替え`}
      aria-pressed={active}
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
    </button>
  )
}

export default function EquipmentsPage() {
  // ── 設備一覧タブの状態 ──────────────────────────────────────────
  const [sortKey, setSortKey] = useState<EquipmentSortKey>("ledger_no")
  // 詳細シート。開くたびに sheetSession を変えてシートの状態（モード・入力値）を初期化する
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [sheetSession, setSheetSession] = useState(0)
  /** シートに表示する設備の ID。null なら新規作成 */
  const [sheetEquipmentId, setSheetEquipmentId] = useState<number | null>(null)

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

  const createGroupMutation = useCreateEquipmentGroup()
  const updateGroupMutation = useUpdateEquipmentGroup()
  const deleteGroupMutation = useDeleteEquipmentGroup()

  const sortedEquipments = useMemo(
    () => (equipments ? sortEquipments(equipments, sortKey) : []),
    [equipments, sortKey]
  )

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

  // 一覧の再取得後も最新の値を表示するよう、シートの設備は一覧のデータから ID で引く
  const sheetEquipment = equipments?.find((e) => e.id === sheetEquipmentId) ?? null

  // ── 設備タブのハンドラ ────────────────────────────────────────
  const handleOpenSheet = (equipmentId: number | null) => {
    setSheetEquipmentId(equipmentId)
    setSheetSession((n) => n + 1)
    setIsSheetOpen(true)
  }

  const parseOptionalInt = (val: string) => (val.trim() === "" ? null : parseInt(val, 10))

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
            <Button onClick={() => handleOpenSheet(null)}>
              <Plus className="mr-2 h-4 w-4" />
              新規作成
            </Button>
          </div>

          {isLoadingEquipments ? (
            <div className="text-center py-10 text-muted-foreground">読み込み中...</div>
          ) : (
            <div className="rounded-md border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">
                      <SortableHeader
                        label="台帳番号"
                        active={sortKey === "ledger_no"}
                        onClick={() => setSortKey("ledger_no")}
                      />
                    </TableHead>
                    <TableHead className="w-[160px]">
                      <SortableHeader
                        label="呼称"
                        active={sortKey === "short_name"}
                        onClick={() => setSortKey("short_name")}
                      />
                    </TableHead>
                    <TableHead>
                      <SortableHeader
                        label="正式名称"
                        active={sortKey === "name"}
                        onClick={() => setSortKey("name")}
                      />
                    </TableHead>
                    <TableHead className="w-[200px]">所属グループ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedEquipments.length > 0 ? (
                    sortedEquipments.map((equipment) => {
                      const groupNames = equipmentGroupMap.get(equipment.id) ?? []
                      return (
                        <TableRow
                          key={equipment.id}
                          className="cursor-pointer"
                          data-state={isSheetOpen && sheetEquipmentId === equipment.id ? "selected" : undefined}
                          onClick={() => handleOpenSheet(equipment.id)}
                        >
                          <TableCell className="py-2.5 tabular-nums">
                            {equipment.ledger_no ?? <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="py-2.5">
                            {equipment.short_name ? (
                              <div className="truncate font-medium" title={equipment.short_name}>
                                {equipment.short_name}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          {/* 正式名称は長いので折り返さず省略する。行のクリックはこのボタン経由でキーボードでも開ける */}
                          <TableCell className="py-2.5">
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              className="block w-full truncate text-left outline-none focus-visible:underline"
                              title={equipment.name}
                            >
                              {equipment.name}
                            </button>
                          </TableCell>
                          <TableCell className="py-2.5">
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
                    <TableHead>グループ名</TableHead>
                    <TableHead className="w-[80px] text-right">台数</TableHead>
                    <TableHead className="w-[200px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups && groups.filter((g) => g.member_count >= 2).length > 0 ? (
                    groups.filter((g) => g.member_count >= 2).map((group) => (
                      <TableRow key={group.id}>
                        <TableCell>{group.name}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{group.member_count}台</TableCell>
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

      {/* ── 設備: 詳細シート（閲覧・編集・新規作成・削除・グループ設定） ── */}
      <EquipmentDetailSheet
        key={sheetSession}
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        equipment={sheetEquipment}
        groupNames={sheetEquipment ? (equipmentGroupMap.get(sheetEquipment.id) ?? []) : []}
        onCreated={setSheetEquipmentId}
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

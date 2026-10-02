"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import { Layers, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useCreateEquipment, useDeleteEquipment, useUpdateEquipment } from "@/hooks/use-equipments"
import {
  EMPTY_EQUIPMENT_FORM,
  equipmentDisplayName,
  equipmentFormFromEquipment,
  equipmentSaveErrorMessage,
  parseEquipmentForm,
  type EquipmentFormValues,
} from "@/lib/equipment-utils"
import type { Equipment } from "@/types/equipment"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { EquipmentGroupAssignmentDialog } from "@/components/equipment-group-assignment-dialog"
import { EquipmentFormFields } from "@/components/equipments/equipment-form-fields"

type SheetMode = "view" | "edit" | "create"

interface EquipmentDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 表示する設備。null なら新規作成モードで開く */
  equipment: Equipment | null
  /** 所属グループ名（一覧と同じく共有グループのみ） */
  groupNames: string[]
  /** 新規作成に成功したら、作成した設備の ID を受け取って表示対象を切り替える */
  onCreated: (equipmentId: number) => void
}

const LEDGER_DETAIL_FIELDS: { key: "maker" | "model" | "manufactured_on" | "serial_no" | "note"; label: string }[] = [
  { key: "maker", label: "メーカー" },
  { key: "model", label: "型式" },
  { key: "manufactured_on", label: "製造年月" },
  { key: "serial_no", label: "製造番号" },
  { key: "note", label: "備考" },
]

const SCHEDULING_DETAIL_FIELDS: {
  key: "guard_time_minutes" | "min_slot_minutes" | "max_fragments"
  label: string
  unit: string
}[] = [
  { key: "guard_time_minutes", label: "ガードタイム", unit: "分" },
  { key: "min_slot_minutes", label: "最低時間スロット", unit: "分" },
  { key: "max_fragments", label: "最大断片数", unit: "" },
]

function DetailSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

/**
 * 設備の詳細シート（Issue #503）。一覧の行クリックで開き、台帳の全項目・所属グループ・
 * スケジューリング設定を表示する。編集・新規作成はダイアログを重ねずシートの中でフォームに切り替える。
 * 開くたびに親が `key` を変えて状態（モード・入力値）を初期化する前提
 */
export function EquipmentDetailSheet({
  open,
  onOpenChange,
  equipment,
  groupNames,
  onCreated,
}: EquipmentDetailSheetProps) {
  const [mode, setMode] = useState<SheetMode>(equipment ? "view" : "create")
  const [form, setForm] = useState<EquipmentFormValues>(EMPTY_EQUIPMENT_FORM)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false)

  const createMutation = useCreateEquipment()
  const updateMutation = useUpdateEquipment()
  const deleteMutation = useDeleteEquipment()

  const handleStartEdit = () => {
    if (!equipment) return
    setForm(equipmentFormFromEquipment(equipment))
    setMode("edit")
  }

  const handleCancel = () => {
    if (mode === "create") onOpenChange(false)
    else setMode("view")
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseEquipmentForm(form)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    try {
      if (mode === "create") {
        const created = await createMutation.mutateAsync(parsed.value)
        toast.success("設備を作成しました")
        onCreated(created.id)
      } else if (equipment) {
        await updateMutation.mutateAsync({ id: equipment.id, data: parsed.value })
        toast.success("設備を更新しました")
      }
      setMode("view")
    } catch (error) {
      const fallback = mode === "create" ? "設備の作成に失敗しました" : "設備の更新に失敗しました"
      toast.error(equipmentSaveErrorMessage(error, fallback))
      console.error(error)
    }
  }

  const handleDelete = async () => {
    if (!equipment) return
    try {
      await deleteMutation.mutateAsync(equipment.id)
      toast.success("設備を削除しました")
      setIsDeleteDialogOpen(false)
      onOpenChange(false)
    } catch (error) {
      toast.error("設備の削除に失敗しました")
      console.error(error)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending
  const displayName = equipment ? equipmentDisplayName(equipment) : ""

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[480px]">
          {mode === "view" ? (
            <>
              <SheetHeader className="shrink-0 border-b px-6 py-4 pr-12">
                <SheetTitle>{displayName}</SheetTitle>
                <SheetDescription>
                  {equipment?.short_name ? equipment.name : "設備の詳細"}
                </SheetDescription>
              </SheetHeader>
              {/* 新規作成の直後は一覧の再取得が終わるまで equipment が無い */}
              {equipment && (
                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
                  <DetailSection title="設備台帳">
                    <dl className="space-y-2">
                      <DetailRow label="台帳番号" value={equipment.ledger_no} />
                      <DetailRow label="正式名称" value={equipment.name} />
                      <DetailRow label="呼称" value={equipment.short_name || null} />
                      {LEDGER_DETAIL_FIELDS.map(({ key, label }) => (
                        <DetailRow key={key} label={label} value={equipment[key] || null} />
                      ))}
                    </dl>
                  </DetailSection>
                  <DetailSection
                    title="所属グループ"
                    action={
                      <Button variant="outline" size="sm" onClick={() => setIsAssignmentDialogOpen(true)}>
                        <Layers />
                        グループ設定
                      </Button>
                    }
                  >
                    {groupNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {groupNames.map((name) => (
                          <Badge key={name} variant="secondary">
                            {name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">なし</p>
                    )}
                  </DetailSection>
                  <DetailSection title="スケジューリング設定">
                    <dl className="space-y-2">
                      {SCHEDULING_DETAIL_FIELDS.map(({ key, label, unit }) => (
                        <DetailRow
                          key={key}
                          label={label}
                          value={
                            equipment[key] != null ? (
                              `${equipment[key]}${unit}`
                            ) : (
                              <span className="text-muted-foreground">グローバル設定を使用</span>
                            )
                          }
                        />
                      ))}
                    </dl>
                  </DetailSection>
                </div>
              )}
              <SheetFooter className="shrink-0 flex-row justify-between border-t px-6 py-4">
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  disabled={!equipment}
                >
                  <Trash2 />
                  削除
                </Button>
                <Button onClick={handleStartEdit} disabled={!equipment}>
                  <Pencil />
                  編集
                </Button>
              </SheetFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <SheetHeader className="shrink-0 border-b px-6 py-4 pr-12">
                <SheetTitle>{mode === "create" ? "設備の新規作成" : "設備の編集"}</SheetTitle>
                <SheetDescription>
                  {mode === "create"
                    ? "設備名（台帳の正式名称）・呼称と設備台帳の情報を入力してください。"
                    : `「${displayName}」の設備名・呼称・設備台帳の情報を変更します。`}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <EquipmentFormFields
                  values={form}
                  onChange={setForm}
                  idPrefix={mode === "create" ? "create-equip" : "edit-equip"}
                />
              </div>
              <SheetFooter className="shrink-0 flex-row justify-end border-t px-6 py-4">
                <Button type="button" variant="outline" onClick={handleCancel}>
                  キャンセル
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {mode === "create"
                    ? createMutation.isPending ? "作成中..." : "作成"
                    : updateMutation.isPending ? "保存中..." : "保存"}
                </Button>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>設備の削除</AlertDialogTitle>
            <AlertDialogDescription>
              本当に「{displayName}」を削除しますか？この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            {/* AlertDialogAction はクリックで即座に閉じるので、削除の完了を待てる Button を使う */}
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "削除中..." : "削除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EquipmentGroupAssignmentDialog
        equipment={equipment}
        open={isAssignmentDialogOpen}
        onOpenChange={setIsAssignmentDialogOpen}
      />
    </>
  )
}

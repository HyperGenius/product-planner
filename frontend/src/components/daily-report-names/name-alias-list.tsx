"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCustomers } from "@/hooks/use-customers"
import {
  useDeleteNameAlias,
  useNameAliases,
  useUpdateNameAlias,
} from "@/hooks/use-daily-report-names"
import { useEquipments } from "@/hooks/use-equipments"
import { useProducts } from "@/hooks/use-products"
import { nameMutationErrorMessage } from "@/lib/daily-report-name-utils"
import { equipmentDisplayName } from "@/lib/equipment-utils"
import {
  NAME_KIND_LABELS,
  NAME_KINDS,
  type NameKind,
  type ProductNameAlias,
} from "@/types/daily-report-names"
import { CustomerPicker, EquipmentPicker, ProcessPicker, ProductPicker } from "./target-pickers"

const PRODUCT_ALIAS_SOURCE_LABELS: Record<ProductNameAlias["source"], string> = {
  daily_report: "日報",
  manual_correction: "メール起票",
  auto_match_unreviewed: "メール起票（未確認）",
}

/**
 * 登録済みの対応付け（別名辞書）の一覧・変更・削除 (Issue #489)。
 * 照合は都度解決なので、変更・削除はそのまま過去の明細の照合結果にも反映される。
 */
export function NameAliasList({ canEdit }: { canEdit: boolean }) {
  const [kind, setKind] = React.useState<NameKind>("equipment")
  const [query, setQuery] = React.useState("")

  return (
    <div className="space-y-3">
      <Tabs value={kind} onValueChange={(v) => setKind(v as NameKind)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            {NAME_KINDS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {NAME_KIND_LABELS[k]}
              </TabsTrigger>
            ))}
          </TabsList>
          <Input
            className="h-8 w-56"
            placeholder="表記で絞り込み"
            aria-label="表記で絞り込み"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <TabsContent value="equipment">
          <EquipmentAliases canEdit={canEdit} query={query} />
        </TabsContent>
        <TabsContent value="process">
          <ProcessAliases canEdit={canEdit} query={query} />
        </TabsContent>
        <TabsContent value="customer">
          <CustomerAliases canEdit={canEdit} query={query} />
        </TabsContent>
        <TabsContent value="product">
          <p className="mb-2 text-xs text-muted-foreground">
            製品の別名はメール起票と共通です（顧客ごと）。変更・削除はメール起票の照合にも反映されます。
          </p>
          <ProductAliases canEdit={canEdit} query={query} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface ListProps {
  canEdit: boolean
  query: string
}

const matchesQuery = (rawText: string, query: string) =>
  rawText.toLowerCase().includes(query.trim().toLowerCase())

function AliasTable({
  isLoading,
  isError,
  count,
  children,
}: {
  isLoading: boolean
  isError: boolean
  count: number
  children: React.ReactNode
}) {
  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">読み込み中...</p>
  if (isError) {
    return <p className="py-6 text-sm text-destructive">対応付けを取得できませんでした</p>
  }
  if (count === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        登録済みの対応付けはありません
      </p>
    )
  }
  return <ul className="divide-y rounded-lg border bg-card">{children}</ul>
}

function AliasRow({
  rawText,
  target,
  meta,
  canEdit,
  editControl,
  onDelete,
  busy,
}: {
  rawText: string
  target: React.ReactNode
  meta?: React.ReactNode
  canEdit: boolean
  editControl: React.ReactNode
  onDelete: () => void
  busy: boolean
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <span className="break-all font-medium">{rawText}</span>
      <span className="text-muted-foreground">→</span>
      <span className="break-all text-sm">{target}</span>
      {meta}
      {canEdit && (
        <div className="ml-auto flex items-center gap-2">
          {editControl}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`「${rawText}」の対応付けを削除`}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 />
          </Button>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>対応付けを削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  「{rawText}」の対応付けを削除します。照合できなくなった表記は未照合キューに戻ります。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>削除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </li>
  )
}

/** 変更・削除のミューテーションとトーストをまとめる */
function useAliasMutations() {
  const update = useUpdateNameAlias()
  const remove = useDeleteNameAlias()
  const busy = update.isPending || remove.isPending
  const handlers = (rawText: string) => ({
    onUpdateSuccess: () => toast.success(`「${rawText}」の対応付けを変更しました`),
    onDeleteSuccess: () => toast.success(`「${rawText}」の対応付けを削除しました`),
    onUpdateError: (error: unknown) =>
      toast.error(nameMutationErrorMessage(error, "対応付けを変更できませんでした")),
    onDeleteError: (error: unknown) =>
      toast.error(nameMutationErrorMessage(error, "対応付けを削除できませんでした")),
  })
  return { update, remove, busy, handlers }
}

function EquipmentAliases({ canEdit, query }: ListProps) {
  const { data: aliases, isLoading, isError } = useNameAliases("equipment")
  const { data: equipments } = useEquipments()
  const { update, remove, busy, handlers } = useAliasMutations()
  const rows = (aliases ?? []).filter((a) => matchesQuery(a.raw_text, query))
  const nameOf = (id: number) => {
    const equipment = equipments?.find((e) => e.id === id)
    return equipment ? equipmentDisplayName(equipment) : `設備 #${id}`
  }

  return (
    <AliasTable isLoading={isLoading} isError={isError} count={rows.length}>
      {rows.map((alias) => {
        const h = handlers(alias.raw_text)
        return (
          <AliasRow
            key={alias.id}
            rawText={alias.raw_text}
            target={nameOf(alias.equipment_id)}
            canEdit={canEdit}
            busy={busy}
            editControl={
              <EquipmentPicker
                triggerLabel="変更"
                ariaLabel={`「${alias.raw_text}」の設備を変更`}
                selectedId={alias.equipment_id}
                disabled={busy}
                onSelect={(id) =>
                  update.mutate(
                    { kind: "equipment", id: alias.id, data: { equipment_id: id } },
                    { onSuccess: h.onUpdateSuccess, onError: h.onUpdateError },
                  )
                }
              />
            }
            onDelete={() =>
              remove.mutate(
                { kind: "equipment", id: alias.id },
                { onSuccess: h.onDeleteSuccess, onError: h.onDeleteError },
              )
            }
          />
        )
      })}
    </AliasTable>
  )
}

function ProcessAliases({ canEdit, query }: ListProps) {
  const { data: aliases, isLoading, isError } = useNameAliases("process")
  const { update, remove, busy, handlers } = useAliasMutations()
  const rows = (aliases ?? []).filter((a) => matchesQuery(a.raw_text, query))

  return (
    <AliasTable isLoading={isLoading} isError={isError} count={rows.length}>
      {rows.map((alias) => {
        const h = handlers(alias.raw_text)
        return (
          <AliasRow
            key={alias.id}
            rawText={alias.raw_text}
            target={alias.process_names.join("・")}
            canEdit={canEdit}
            busy={busy}
            editControl={
              <ProcessPicker
                triggerLabel="変更"
                ariaLabel={`「${alias.raw_text}」の工程を変更`}
                initialNames={alias.process_names}
                disabled={busy}
                onSubmit={(names) =>
                  update.mutate(
                    { kind: "process", id: alias.id, data: { process_names: names } },
                    { onSuccess: h.onUpdateSuccess, onError: h.onUpdateError },
                  )
                }
              />
            }
            onDelete={() =>
              remove.mutate(
                { kind: "process", id: alias.id },
                { onSuccess: h.onDeleteSuccess, onError: h.onDeleteError },
              )
            }
          />
        )
      })}
    </AliasTable>
  )
}

function CustomerAliases({ canEdit, query }: ListProps) {
  const { data: aliases, isLoading, isError } = useNameAliases("customer")
  const { data: customers } = useCustomers()
  const { update, remove, busy, handlers } = useAliasMutations()
  const rows = (aliases ?? []).filter((a) => matchesQuery(a.raw_text, query))
  const nameOf = (id: number) => customers?.find((c) => c.id === id)?.name ?? `顧客 #${id}`

  return (
    <AliasTable isLoading={isLoading} isError={isError} count={rows.length}>
      {rows.map((alias) => {
        const h = handlers(alias.raw_text)
        return (
          <AliasRow
            key={alias.id}
            rawText={alias.raw_text}
            target={nameOf(alias.customer_id)}
            canEdit={canEdit}
            busy={busy}
            editControl={
              <CustomerPicker
                triggerLabel="変更"
                ariaLabel={`「${alias.raw_text}」の顧客を変更`}
                selectedId={alias.customer_id}
                disabled={busy}
                onSelect={(id) =>
                  update.mutate(
                    { kind: "customer", id: alias.id, data: { customer_id: id } },
                    { onSuccess: h.onUpdateSuccess, onError: h.onUpdateError },
                  )
                }
              />
            }
            onDelete={() =>
              remove.mutate(
                { kind: "customer", id: alias.id },
                { onSuccess: h.onDeleteSuccess, onError: h.onDeleteError },
              )
            }
          />
        )
      })}
    </AliasTable>
  )
}

function ProductAliases({ canEdit, query }: ListProps) {
  const { data: aliases, isLoading, isError } = useNameAliases("product")
  const { data: products } = useProducts()
  const { data: customers } = useCustomers()
  const { update, remove, busy, handlers } = useAliasMutations()
  const rows = (aliases ?? []).filter((a) => matchesQuery(a.raw_text, query))
  const productName = (id: number) =>
    products?.find((p) => p.id === id)?.name ?? `製品 #${id}`
  const customerName = (id: number) =>
    customers?.find((c) => c.id === id)?.name ?? `顧客 #${id}`

  return (
    <AliasTable isLoading={isLoading} isError={isError} count={rows.length}>
      {rows.map((alias) => {
        const h = handlers(alias.raw_text)
        return (
          <AliasRow
            key={alias.id}
            rawText={alias.raw_text}
            target={productName(alias.product_id)}
            meta={
              <>
                <span className="text-xs text-muted-foreground">
                  顧客: {customerName(alias.customer_id)}
                </span>
                <Badge variant="outline">{PRODUCT_ALIAS_SOURCE_LABELS[alias.source]}</Badge>
              </>
            }
            canEdit={canEdit}
            busy={busy}
            editControl={
              <ProductPicker
                triggerLabel="変更"
                ariaLabel={`「${alias.raw_text}」の製品を変更`}
                selectedId={alias.product_id}
                disabled={busy}
                onSelect={(id) =>
                  update.mutate(
                    {
                      kind: "product",
                      id: alias.id,
                      productId: alias.product_id,
                      data: { product_id: id },
                    },
                    { onSuccess: h.onUpdateSuccess, onError: h.onUpdateError },
                  )
                }
              />
            }
            onDelete={() =>
              remove.mutate(
                { kind: "product", id: alias.id, productId: alias.product_id },
                { onSuccess: h.onDeleteSuccess, onError: h.onDeleteError },
              )
            }
          />
        )
      })}
    </AliasTable>
  )
}

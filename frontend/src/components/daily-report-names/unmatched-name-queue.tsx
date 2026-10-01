"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useCreateNameAlias,
  useIgnoreName,
  useProductCandidates,
  useUnmatchedNames,
} from "@/hooks/use-daily-report-names"
import {
  formatWorkDate,
  nameMutationErrorMessage,
  productAliasBlockedReason,
  unmatchedNameKey,
} from "@/lib/daily-report-name-utils"
import {
  NAME_KIND_LABELS,
  NAME_KINDS,
  type NameKind,
  type UnmatchedName,
} from "@/types/daily-report-names"
import { NameEntriesTable } from "./name-entries-table"
import { CustomerPicker, EquipmentPicker, ProcessPicker, ProductPicker } from "./target-pickers"

/** 行内に並べる類似候補の数。残りは「他の製品から選択」に出す */
const INLINE_CANDIDATE_COUNT = 3

/**
 * 未照合キュー (Issue #489)。照合できなかった表記を種別ごとに出現件数の多い順で並べ、
 * その場で別名辞書に登録（対応付け）するか「対象外」にする。
 */
export function UnmatchedNameQueue({ canEdit }: { canEdit: boolean }) {
  const { data: items, isLoading, isError } = useUnmatchedNames()
  const [kind, setKind] = React.useState<NameKind>("equipment")

  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">読み込み中...</p>
  if (isError || !items) {
    return <p className="py-6 text-sm text-destructive">未照合の表記を取得できませんでした</p>
  }

  return (
    <Tabs value={kind} onValueChange={(v) => setKind(v as NameKind)}>
      <TabsList>
        {NAME_KINDS.map((k) => (
          <TabsTrigger key={k} value={k}>
            {NAME_KIND_LABELS[k]}
            <Badge variant="secondary" className="ml-1">
              {items.filter((i) => i.kind === k).length}
            </Badge>
          </TabsTrigger>
        ))}
      </TabsList>
      {NAME_KINDS.map((k) => {
        const kindItems = items.filter((i) => i.kind === k)
        return (
          <TabsContent key={k} value={k} className="space-y-2">
            {k === "product" && (
              <p className="text-xs text-muted-foreground">
                製品の別名は顧客ごとに登録します。顧客先が未照合の行は、先に「顧客」で対応付けてください。
              </p>
            )}
            {kindItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                未照合の{NAME_KIND_LABELS[k]}はありません
              </p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {kindItems.map((item) => (
                  <UnmatchedNameRow key={unmatchedNameKey(item)} item={item} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

function UnmatchedNameRow({ item, canEdit }: { item: UnmatchedName; canEdit: boolean }) {
  const [expanded, setExpanded] = React.useState(false)
  const createAlias = useCreateNameAlias()
  const ignore = useIgnoreName()
  const busy = createAlias.isPending || ignore.isPending

  const onError = (fallback: string) => (error: unknown) =>
    toast.error(nameMutationErrorMessage(error, fallback))
  const onMapped = () => toast.success(`「${item.raw_text}」を対応付けました`)
  const register = (variables: Parameters<typeof createAlias.mutate>[0]) =>
    createAlias.mutate(variables, {
      onSuccess: onMapped,
      onError: onError("対応付けに失敗しました"),
    })

  return (
    <li className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 text-left font-medium hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          <span className="break-all">{item.raw_text}</span>
        </button>
        {item.kind === "product" && (
          <span className="text-xs text-muted-foreground">
            顧客先: {item.customer_raw ?? "（空欄）"}
          </span>
        )}
        <span className="text-sm tabular-nums">{item.entry_count.toLocaleString()} 件</span>
        <span className="text-xs text-muted-foreground">
          最終 {formatWorkDate(item.last_work_date)}
        </span>

        {canEdit && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {item.kind === "equipment" && (
              <EquipmentPicker
                ariaLabel={`「${item.raw_text}」の設備を選択`}
                disabled={busy}
                onSelect={(id) =>
                  register({
                    kind: "equipment",
                    data: { raw_text: item.raw_text, equipment_id: id },
                  })
                }
              />
            )}
            {item.kind === "customer" && (
              <CustomerPicker
                ariaLabel={`「${item.raw_text}」の顧客を選択`}
                disabled={busy}
                onSelect={(id) =>
                  register({
                    kind: "customer",
                    data: { raw_text: item.raw_text, customer_id: id },
                  })
                }
              />
            )}
            {item.kind === "process" && (
              <ProcessPicker
                ariaLabel={`「${item.raw_text}」の工程を選択`}
                disabled={busy}
                onSubmit={(names) =>
                  register({
                    kind: "process",
                    data: { raw_text: item.raw_text, process_names: names },
                  })
                }
              />
            )}
            {item.kind === "product" && (
              <ProductMapping item={item} disabled={busy} onSelect={(productId, customerId) =>
                register({
                  kind: "product",
                  data: {
                    raw_text: item.raw_text,
                    customer_id: customerId,
                    product_id: productId,
                  },
                })
              } />
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`「${item.raw_text}」を対象外にする`}
              onClick={() =>
                ignore.mutate(item, {
                  onSuccess: () => toast.success(`「${item.raw_text}」を対象外にしました`),
                  onError: onError("対象外にできませんでした"),
                })
              }
            >
              <EyeOff />
              対象外
            </Button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="rounded-md border bg-muted/30">
          <NameEntriesTable item={item} />
        </div>
      )}
    </li>
  )
}

/** 製品: 類似候補（pg_trgm）を行内に並べ、選ぶだけで対応付けられるようにする */
function ProductMapping({
  item,
  disabled,
  onSelect,
}: {
  item: UnmatchedName
  disabled: boolean
  onSelect: (productId: number, customerId: number) => void
}) {
  const blockedReason = productAliasBlockedReason(item)
  if (blockedReason !== null || item.customer_id === null) {
    return <span className="text-xs text-amber-700">{blockedReason}</span>
  }
  return (
    <ProductCandidates
      item={item}
      customerId={item.customer_id}
      disabled={disabled}
      onSelect={onSelect}
    />
  )
}

function ProductCandidates({
  item,
  customerId,
  disabled,
  onSelect,
}: {
  item: UnmatchedName
  customerId: number
  disabled: boolean
  onSelect: (productId: number, customerId: number) => void
}) {
  const { data: candidates } = useProductCandidates(item.raw_text)
  return (
    <>
      {(candidates ?? []).slice(0, INLINE_CANDIDATE_COUNT).map((candidate) => (
        <Button
          key={candidate.product_id}
          variant="secondary"
          size="sm"
          disabled={disabled}
          title={`類似度 ${Math.round(candidate.score * 100)}%`}
          aria-label={`「${item.raw_text}」を「${candidate.name}」に対応付ける`}
          onClick={() => onSelect(candidate.product_id, customerId)}
        >
          <span className="max-w-[10rem] truncate">{candidate.name}</span>
        </Button>
      ))}
      <ProductPicker
        ariaLabel={`「${item.raw_text}」の製品を選択`}
        disabled={disabled}
        candidates={candidates}
        onSelect={(id) => onSelect(id, customerId)}
      />
    </>
  )
}

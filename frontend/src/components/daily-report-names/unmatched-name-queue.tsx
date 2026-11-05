"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent } from "@/components/ui/tabs"
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
import { ConfirmMappingDialog, type PendingNameAction } from "./confirm-mapping-dialog"
import { KIND_PANEL_CLASS, KindTabsList, kindColorStyle } from "./kind-tabs"
import { NameEntriesTable } from "./name-entries-table"
import { CustomerPicker, EquipmentPicker, ProcessPicker, ProductPicker } from "./target-pickers"

/** 行内に並べる類似候補の数。残りは「他の製品から選択」に出す */
const INLINE_CANDIDATE_COUNT = 3

/**
 * 未照合キュー (Issue #489)。照合できなかった表記を種別ごとに出現件数の多い順で並べ、
 * 確認ダイアログを経て別名辞書に登録（対応付け）するか「対象外」にする (Issue #645)。
 */
export function UnmatchedNameQueue({ canEdit }: { canEdit: boolean }) {
  const { data: items, isLoading, isError } = useUnmatchedNames()
  const [kind, setKind] = React.useState<NameKind>("equipment")

  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">読み込み中...</p>
  if (isError || !items) {
    return <p className="py-6 text-sm text-destructive">未照合の表記を取得できませんでした</p>
  }

  const counts = Object.fromEntries(
    NAME_KINDS.map((k) => [k, items.filter((i) => i.kind === k).length]),
  ) as Record<NameKind, number>

  return (
    <Tabs value={kind} onValueChange={(v) => setKind(v as NameKind)} className="min-h-0 flex-1">
      <KindTabsList counts={counts} />
      {NAME_KINDS.map((k) => {
        const kindItems = items.filter((i) => i.kind === k)
        return (
          <TabsContent
            key={k}
            value={k}
            className="flex min-h-0 flex-1 flex-col gap-2"
            style={kindColorStyle(k)}
          >
            <p className="text-xs text-muted-foreground">
              {k === "product"
                ? "製品の別名は顧客ごとに登録します。顧客先が未照合の行は、先に「顧客」で対応付けてください。"
                : "出現件数の多い順に並んでいます。"}
            </p>
            {kindItems.length === 0 ? (
              <p className="rounded-lg border border-t-4 border-t-[var(--kind-color)] bg-card py-8 text-center text-sm text-muted-foreground">
                未照合の{NAME_KIND_LABELS[k]}はありません
              </p>
            ) : (
              <ul className={`divide-y ${KIND_PANEL_CLASS}`}>
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

type AliasVariables = Parameters<ReturnType<typeof useCreateNameAlias>["mutate"]>[0]

/** 確認待ちの操作。登録する中身（variables）は対応付けのときだけ */
interface PendingOperation {
  view: PendingNameAction
  variables: AliasVariables | null
}

function UnmatchedNameRow({ item, canEdit }: { item: UnmatchedName; canEdit: boolean }) {
  const [expanded, setExpanded] = React.useState(false)
  const [pending, setPending] = React.useState<PendingOperation | null>(null)
  const createAlias = useCreateNameAlias()
  const ignore = useIgnoreName()
  const busy = createAlias.isPending || ignore.isPending

  const onError = (fallback: string) => (error: unknown) =>
    toast.error(nameMutationErrorMessage(error, fallback))
  // 選んだ時点では登録せず、確認ダイアログを開く (Issue #645)
  const requestMap = (variables: AliasVariables, targetLabel: string, score?: number) =>
    setPending({
      view: {
        type: "map",
        kind: item.kind,
        rawText: item.raw_text,
        customerRaw: item.customer_raw,
        targetLabel,
        score,
      },
      variables,
    })
  const requestIgnore = () =>
    setPending({
      view: {
        type: "ignore",
        kind: item.kind,
        rawText: item.raw_text,
        customerRaw: item.customer_raw,
      },
      variables: null,
    })
  // 成功したら閉じる。失敗時は開いたままトーストを出す
  const confirm = () => {
    if (!pending) return
    if (pending.variables) {
      createAlias.mutate(pending.variables, {
        onSuccess: () => {
          setPending(null)
          toast.success(`「${item.raw_text}」を対応付けました`)
        },
        onError: onError("対応付けに失敗しました"),
      })
    } else {
      ignore.mutate(item, {
        onSuccess: () => {
          setPending(null)
          toast.success(`「${item.raw_text}」を対象外にしました`)
        },
        onError: onError("対象外にできませんでした"),
      })
    }
  }

  return (
    <li className="space-y-2 px-3 py-2">
      <ConfirmMappingDialog
        pending={pending?.view ?? null}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
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
                onSelect={(id, label) =>
                  requestMap(
                    { kind: "equipment", data: { raw_text: item.raw_text, equipment_id: id } },
                    label,
                  )
                }
              />
            )}
            {item.kind === "customer" && (
              <CustomerPicker
                ariaLabel={`「${item.raw_text}」の顧客を選択`}
                disabled={busy}
                onSelect={(id, label) =>
                  requestMap(
                    { kind: "customer", data: { raw_text: item.raw_text, customer_id: id } },
                    label,
                  )
                }
              />
            )}
            {item.kind === "process" && (
              <ProcessPicker
                ariaLabel={`「${item.raw_text}」の工程を選択`}
                disabled={busy}
                onSubmit={(names) =>
                  requestMap(
                    { kind: "process", data: { raw_text: item.raw_text, process_names: names } },
                    names.join("・"),
                  )
                }
              />
            )}
            {item.kind === "product" && (
              <ProductMapping
                item={item}
                disabled={busy}
                onSelect={(productId, customerId, label, score) =>
                  requestMap(
                    {
                      kind: "product",
                      data: {
                        raw_text: item.raw_text,
                        customer_id: customerId,
                        product_id: productId,
                      },
                    },
                    label,
                    score,
                  )
                }
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`「${item.raw_text}」を対象外にする`}
              onClick={requestIgnore}
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
  onSelect: (productId: number, customerId: number, label: string, score?: number) => void
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
  onSelect: (productId: number, customerId: number, label: string, score?: number) => void
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
          onClick={() =>
            onSelect(candidate.product_id, customerId, candidate.name, candidate.score)
          }
        >
          <span className="max-w-[10rem] truncate">{candidate.name}</span>
        </Button>
      ))}
      <ProductPicker
        ariaLabel={`「${item.raw_text}」の製品を選択`}
        disabled={disabled}
        candidates={candidates}
        onSelect={(id, label) => onSelect(id, customerId, label)}
      />
    </>
  )
}

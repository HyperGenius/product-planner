"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useCreateNameAlias,
  useIgnoreName,
  useProductCandidates,
  useUnignoreName,
} from "@/hooks/use-daily-report-names"
import {
  formatWorkDate,
  nameMutationErrorMessage,
  unmatchedNameKey,
} from "@/lib/daily-report-name-utils"
import { DAILY_REPORT_ALIASES_LABEL } from "@/lib/daily-report-worklist-utils"
import {
  type NameKind,
  type ProductCandidate,
  type UnmatchedName,
} from "@/types/daily-report-names"
import { CustomerOpenOrdersPanel } from "./customer-open-orders"
import { ConfirmMappingDialog, type PendingNameAction } from "./confirm-mapping-dialog"
import { KIND_LIST_CLASS, KIND_PANEL_CLASS, kindColorStyle } from "./kind-tabs"
import { NameEntriesTable } from "./name-entries-table"
import { CustomerPicker, EquipmentPicker, ProcessPicker, ProductPicker } from "./target-pickers"

/** 行内に並べる類似候補の数。残りは「他の製品から選択」に出す */
const INLINE_CANDIDATE_COUNT = 3

/**
 * 日報の表記の一覧 (Issue #489 / #707)。マスタに結び付いていない表記を明細の多い順に並べ、
 * 確認ダイアログを経て別名辞書に登録（対応付け）するか「対象外」にする (Issue #645)。
 * どの表記をどのページに出すかは呼び出し側が `classifyDailyReportWorklist()` の結果で決める。
 * 一覧の領域は残りの高さを使ってスクロールする（`scroll={false}` ならページ側に任せる）
 */
export function UnmatchedNameList({
  items,
  kind,
  canEdit,
  emptyMessage,
  scroll = true,
}: {
  items: readonly UnmatchedName[]
  /** 一覧の上辺の色に使う種別 */
  kind: NameKind
  canEdit: boolean
  emptyMessage: string
  scroll?: boolean
}) {
  if (items.length === 0) {
    return (
      <p
        className="rounded-lg border border-t-4 border-t-[var(--kind-color)] bg-card py-8 text-center text-sm text-muted-foreground"
        style={kindColorStyle(kind)}
      >
        {emptyMessage}
      </p>
    )
  }
  return (
    <ul
      className={scroll ? `divide-y ${KIND_PANEL_CLASS}` : `divide-y ${KIND_LIST_CLASS}`}
      style={kindColorStyle(kind)}
    >
      {items.map((item) => (
        <UnmatchedNameRow key={unmatchedNameKey(item)} item={item} canEdit={canEdit} />
      ))}
    </ul>
  )
}

type AliasVariables = Parameters<ReturnType<typeof useCreateNameAlias>["mutate"]>[0]

/** 確認待ちの操作。登録する中身（variables）は対応付けのときだけ */
interface PendingOperation {
  view: PendingNameAction
  variables: AliasVariables | null
}

export function UnmatchedNameRow({
  item,
  canEdit,
  showCustomerRaw = true,
  summary,
  onMapped,
}: {
  item: UnmatchedName
  canEdit: boolean
  /** 製品の顧客先を行に出すか（顧客先のまとまりの中では見出しに出すので false。Issue #703） */
  showCustomerRaw?: boolean
  /** 明細の数の横に添える件数（顧客先のまとまりの見出しの「3品名」等） */
  summary?: string
  /** 対応付けの登録に成功したとき。渡すと既定のトーストの代わりに呼ぶ */
  onMapped?: (targetLabel: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [pending, setPending] = React.useState<PendingOperation | null>(null)
  const createAlias = useCreateNameAlias()
  const ignore = useIgnoreName()
  const unignore = useUnignoreName()
  const busy = createAlias.isPending || ignore.isPending

  const onError = (fallback: string) => (error: unknown) =>
    toast.error(nameMutationErrorMessage(error, fallback))
  // 選んだ時点では登録せず、確認ダイアログを開く (Issue #645)
  const requestMap = (
    variables: AliasVariables,
    targetLabel: string,
    productRef?: { customerId: number; productId: number },
  ) =>
    setPending({
      view: {
        type: "map",
        kind: item.kind,
        rawText: item.raw_text,
        customerRaw: item.customer_raw,
        targetLabel,
        productRef,
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
      const targetLabel = pending.view.type === "map" ? pending.view.targetLabel : ""
      createAlias.mutate(pending.variables, {
        onSuccess: () => {
          setPending(null)
          if (onMapped) onMapped(targetLabel)
          else toast.success(`「${item.raw_text}」を対応付けました`)
        },
        onError: onError("対応付けに失敗しました"),
      })
    } else {
      ignore.mutate(item, {
        onSuccess: (ignored) => {
          setPending(null)
          toast.success(`「${item.raw_text}」を対象外にしました`, {
            description: `「${DAILY_REPORT_ALIASES_LABEL}」の対象外からも戻せます`,
            action: { label: "元に戻す", onClick: () => undoIgnore(ignored.id) },
          })
        },
        onError: onError("対象外にできませんでした"),
      })
    }
  }

  // 対象外にした行は一覧から消えて unmount するので、mutate のコールバックではなく mutateAsync の結果で知らせる
  const undoIgnore = (id: string) =>
    unignore.mutateAsync(id).then(
      () => toast.success(`「${item.raw_text}」を対象外から戻しました`),
      (error: unknown) => toast.error(nameMutationErrorMessage(error, "対象外から戻せませんでした")),
    )

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
        {item.kind === "product" && showCustomerRaw && (
          <span className="text-xs text-muted-foreground">
            顧客先: {item.customer_raw ?? "（空欄）"}
          </span>
        )}
        {summary && <span className="text-sm font-medium tabular-nums">{summary}</span>}
        <span className="text-sm tabular-nums">{item.entry_count.toLocaleString()}明細</span>
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
                onSelect={(productId, customerId, label) =>
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
                    { customerId, productId },
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
          {item.kind === "product" && item.customer_id !== null && (
            <CustomerOpenOrdersPanel customerId={item.customer_id} />
          )}
        </div>
      )}
    </li>
  )
}

/**
 * 製品: 似ている製品（pg_trgm）を似ている順に行内に並べ、選ぶだけで対応付けられるようにする。
 * 類似度の数値は出さない（品名を見比べて選ぶ。Issue #702）
 */
function ProductMapping({
  item,
  disabled,
  onSelect,
}: {
  item: UnmatchedName
  disabled: boolean
  onSelect: (productId: number, customerId: number, label: string) => void
}) {
  // 顧客先が決まっていない製品は前提のページにまとめて置き、見出しに1回だけ理由を出す（#707）
  if (item.customer_id === null) return null
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
  onSelect: (productId: number, customerId: number, label: string) => void
}) {
  const { data: candidates } = useProductCandidates(item.raw_text, customerId)
  return (
    <>
      {(candidates ?? []).slice(0, INLINE_CANDIDATE_COUNT).map((candidate) => (
        <Button
          key={candidate.product_id}
          variant="secondary"
          size="sm"
          disabled={disabled}
          title={candidateTitle(candidate)}
          aria-label={`「${item.raw_text}」を「${candidate.name}」に対応付ける`}
          onClick={() => onSelect(candidate.product_id, customerId, candidate.name)}
        >
          <span className="max-w-[10rem] truncate">{candidate.name}</span>
          <OrderBadge candidate={candidate} />
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

function candidateTitle(candidate: ProductCandidate): string | undefined {
  return candidate.nearest_deadline
    ? `直近の希望納期 ${formatWorkDate(candidate.nearest_deadline)}`
    : undefined
}

/**
 * 似ている製品に、その顧客の確定済み・生産中の受注の有無を出す (Issue #646)。受注なしでも選べる
 * （確認ダイアログで受注が無いことを伝える）。
 */
function OrderBadge({ candidate }: { candidate: ProductCandidate }) {
  if (candidate.open_order_count === undefined) return null
  return candidate.open_order_count > 0 ? (
    <Badge variant="secondary" className="bg-emerald-100 text-xs font-normal text-emerald-800">
      受注あり {candidate.open_order_count.toLocaleString()}注文
    </Badge>
  ) : (
    <Badge variant="outline" className="text-xs font-normal text-amber-700">
      受注なし
    </Badge>
  )
}

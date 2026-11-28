"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, EyeOff, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CreateProductDialog } from "@/components/products/create-product-dialog"
import {
  useCreateNameAlias,
  useCustomerOrderedProducts,
  useIgnoreName,
  useLinkNameToNewProduct,
  useUnignoreName,
} from "@/hooks/use-daily-report-names"
import {
  formatWorkDate,
  nameMutationErrorMessage,
  unmatchedNameKey,
} from "@/lib/daily-report-name-utils"
import { DAILY_REPORT_ALIASES_LABEL } from "@/lib/daily-report-worklist-utils"
import { orderedProductSummary, rankOrderedProducts } from "@/lib/ordered-product-utils"
import { guessProductCode } from "@/lib/product-code-utils"
import type { Product, SimilarProduct } from "@/types/product"
import { type NameKind, type UnmatchedName } from "@/types/daily-report-names"
import { ConfirmMappingDialog, type PendingNameAction } from "./confirm-mapping-dialog"
import { KIND_LIST_CLASS, KIND_PANEL_CLASS, kindColorStyle } from "./kind-tabs"
import { NameEntriesTable } from "./name-entries-table"
import { CustomerPicker, EquipmentPicker, ProcessPicker, ProductPicker } from "./target-pickers"

/** 行内に並べる受注の製品の数。残りは「他の製品から選択」の「受注の製品」に出す (Issue #704) */
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

/**
 * 確認待ちの操作。行ごとに1つだけ持ち、確認ダイアログか製品の作成ダイアログを1つ開く (Issue #645 / #705)。
 * 登録する中身（variables）は対応付けのときだけ
 */
type PendingOperation =
  | { type: "confirm"; view: PendingNameAction; variables: AliasVariables | null }
  | { type: "create-product"; customerId: number }

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
  const linkNewProduct = useLinkNameToNewProduct()
  const ignore = useIgnoreName()
  const unignore = useUnignoreName()
  const busy = createAlias.isPending || ignore.isPending || linkNewProduct.isPending
  const confirming = pending?.type === "confirm" ? pending : null

  const onError = (fallback: string) => (error: unknown) =>
    toast.error(nameMutationErrorMessage(error, fallback))
  // 選んだ時点では登録せず、確認ダイアログを開く (Issue #645)
  const requestMap = (
    variables: AliasVariables,
    targetLabel: string,
    productRef?: { customerId: number; productId: number },
  ) =>
    setPending({
      type: "confirm",
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
      type: "confirm",
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
    if (!confirming) return
    if (confirming.variables) {
      const targetLabel = confirming.view.type === "map" ? confirming.view.targetLabel : ""
      createAlias.mutate(confirming.variables, {
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

  // 製品を作ったら、そのまま日報の品名をその製品の別名にする (Issue #705)。製品の作成と別名の登録は別の API なので、
  // 別名だけ失敗したら製品は残し、行も一覧に残る（「他の製品から選択」で結び付け直せる）。
  // 結び付くと行は一覧から消えて unmount するので、mutateAsync の結果で知らせる
  const linkCreatedProduct = (customerId: number) => async (product: Product) => {
    try {
      await linkNewProduct.mutateAsync({
        raw_text: item.raw_text,
        customer_id: customerId,
        product_id: product.id,
      })
      if (onMapped) onMapped(product.name)
      else toast.success(`製品「${product.name}」を登録し、日報の品名を結び付けました`)
    } catch (error) {
      console.error(error)
      toast.error(`製品「${product.name}」を登録しました。日報の品名は結び付けられませんでした`, {
        description: "「他の製品から選択」で結び付けられます",
      })
    }
  }
  // 似た製品を選んだら作らずに、他の製品を選んだときと同じ確認ダイアログを経て結び付ける
  const selectSimilar = (customerId: number) => (product: SimilarProduct) =>
    requestMap(
      {
        kind: "product",
        data: { raw_text: item.raw_text, customer_id: customerId, product_id: product.id },
      },
      product.name,
      { customerId, productId: product.id },
    )

  // 対象外にした行は一覧から消えて unmount するので、mutate のコールバックではなく mutateAsync の結果で知らせる
  const undoIgnore = (id: string) =>
    unignore.mutateAsync(id).then(
      () => toast.success(`「${item.raw_text}」を対象外から戻しました`),
      (error: unknown) => toast.error(nameMutationErrorMessage(error, "対象外から戻せませんでした")),
    )

  return (
    <li className="space-y-2 px-3 py-2">
      <ConfirmMappingDialog
        pending={confirming?.view ?? null}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
      {/* 開いている行の分だけ描画する（中の類似製品の警告が行ごとに問い合わせないように） */}
      {pending?.type === "create-product" && (
        <CreateProductDialog
          open
          onOpenChange={(open) => {
            if (!open) setPending(null)
          }}
          title="製品を登録する"
          submitLabel="登録して結び付ける"
          submittingLabel="登録中..."
          initialValues={{ name: item.raw_text, code: guessProductCode(item.raw_text) }}
          context={
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-foreground">
              <p className="text-xs text-muted-foreground">
                日報の品名（顧客先: {item.customer_raw ?? "空欄"}）
              </p>
              <p className="break-all font-medium">{item.raw_text}</p>
            </div>
          }
          onCreated={linkCreatedProduct(pending.customerId)}
          onSelectSimilar={selectSimilar(pending.customerId)}
        />
      )}
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
                onCreate={(customerId) => setPending({ type: "create-product", customerId })}
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
        </div>
      )}
    </li>
  )
}

/**
 * 製品: その顧客の受注のうち、日報の実績がまだ結び付いていない受注の製品を、日報の品名に近い順に
 * 行内に並べ、選ぶだけで対応付けられるようにする (Issue #704)。近さの数値は出さず、自動確定もしない。
 * 全製品の似ている製品は「他の製品から選択」の中だけに出す（行内は受注の製品だけ）
 */
function ProductMapping({
  item,
  disabled,
  onCreate,
  onSelect,
}: {
  item: UnmatchedName
  disabled: boolean
  /** 製品マスタに無い製品を登録する (Issue #705) */
  onCreate: (customerId: number) => void
  onSelect: (productId: number, customerId: number, label: string) => void
}) {
  // 顧客先が決まっていない製品は前提のページにまとめて置き、見出しに1回だけ理由を出す（#707）
  if (item.customer_id === null) return null
  return (
    <ProductCandidates
      item={item}
      customerId={item.customer_id}
      disabled={disabled}
      onCreate={() => onCreate(item.customer_id!)}
      onSelect={onSelect}
    />
  )
}

function ProductCandidates({
  item,
  customerId,
  disabled,
  onCreate,
  onSelect,
}: {
  item: UnmatchedName
  customerId: number
  disabled: boolean
  onCreate: () => void
  onSelect: (productId: number, customerId: number, label: string) => void
}) {
  const { data: orderedProducts } = useCustomerOrderedProducts(customerId)
  const ranked = React.useMemo(
    () => rankOrderedProducts(item.raw_text, orderedProducts ?? []),
    [item.raw_text, orderedProducts],
  )
  return (
    <>
      {ranked.slice(0, INLINE_CANDIDATE_COUNT).map((product) => {
        const summary = orderedProductSummary(product)
        return (
          <Button
            key={product.product_id}
            variant="secondary"
            size="sm"
            disabled={disabled}
            className="h-auto flex-col items-start gap-0 py-1 text-left"
            aria-label={`「${item.raw_text}」を「${product.name}」に対応付ける`}
            onClick={() => onSelect(product.product_id, customerId, product.name)}
          >
            <span className="max-w-[14rem] truncate">{product.name}</span>
            {summary && (
              <span className="max-w-[14rem] truncate text-xs font-normal text-muted-foreground">
                {summary}
              </span>
            )}
          </Button>
        )
      })}
      {/* 並びは流れの順: 受注の製品 → 製品を登録する → 他の製品から選択 → 対象外 (Epic #701) */}
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label={`「${item.raw_text}」を製品マスタに登録する`}
        onClick={onCreate}
      >
        <Plus />
        製品を登録する
      </Button>
      <ProductPicker
        ariaLabel={`「${item.raw_text}」の製品を選択`}
        disabled={disabled}
        orderedProducts={ranked.slice(INLINE_CANDIDATE_COUNT)}
        similarTo={{ rawText: item.raw_text, customerId }}
        onSelect={(id, label) => onSelect(id, customerId, label)}
      />
    </>
  )
}

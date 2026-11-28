"use client"

import * as React from "react"
import type { ReactNode } from "react"
import { ListPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  ConfirmMappingDialog,
  type PendingNameAction,
} from "@/components/daily-report-names/confirm-mapping-dialog"
import { ProcessPicker } from "@/components/daily-report-names/target-pickers"
import { ListStatus } from "@/components/daily-reports/daily-report-page-layout"
import { ProductRoutingsDialog } from "@/components/product-routings-dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useCreateNameAlias,
  useIgnoreName,
  useInvalidateProductProcesses,
  useUnignoreName,
} from "@/hooks/use-daily-report-names"
import { useProducts } from "@/hooks/use-products"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import {
  useAddUntrackedProcessName,
  useRemoveUntrackedProcessName,
  useUntrackedProcessNames,
} from "@/hooks/use-untracked-process-names"
import { ApiError } from "@/lib/api-client"
import { formatWorkDate, nameMutationErrorMessage } from "@/lib/daily-report-name-utils"
import { DAILY_REPORT_ALIASES_LABEL } from "@/lib/daily-report-worklist-utils"
import {
  allInRouting,
  formatEntryCount,
  routingNamesOf,
} from "@/lib/product-process-utils"
import { findUntrackedProcessName, UNTRACKED_PROCESS_LABEL } from "@/lib/untracked-process-utils"
import { cn } from "@/lib/utils"
import type {
  ProcessRaw,
  ProductProcessComparison,
  UnmatchedProcessRaw,
} from "@/types/daily-report-names"
import { UNTRACKED_PROCESS_EDITOR_ROLES } from "@/types/member"

/** 左右がそろったときのトーストの説明（行の状態の変化を知らせる） */
const ALIGNED_MESSAGE = "工程マスタと日報の行が揃いました"

/** 確認待ちの操作（行ごとではなく画面で1つだけ持つ。Issue #645 と同じ考え方） */
type PendingOperation =
  | { type: "alias"; raw: UnmatchedProcessRaw; processNames: string[] }
  | { type: "ignore"; raw: UnmatchedProcessRaw }
  | { type: "untracked-add"; processName: string }
  | { type: "untracked-remove"; processName: string; id: number }

/**
 * ② 製品の工程を日報に合わせる: 製品の工程ルート（左）と日報に出てくるその製品の工程（右）の比較（Issue #708）。
 * 工程ルートの工程に結び付く日報の表記は同じ行に並べ、結び付かない表記・工程ルートに無い工程は下にまとめる。
 * 合わない行にだけ操作を置き、できないロールにはボタンを出さない。
 *
 * - 工程名に結び付かない表記 → 工程名を選ぶ（工程の別名、テナント共通）・対象外（`DAILY_REPORT_NAME_EDITOR_ROLES`）
 * - 工程ルートに無い工程 → この製品の工程に足す（工程ルートの編集。テナントのメンバー全員）
 * - 日報に出てこない工程 → 日報で追わない工程にする（`UNTRACKED_PROCESS_EDITOR_ROLES`）
 * - 日報で追わないのに日報に実績がある工程 → 日報で追う工程に戻す（同上）
 * - 工程ルートが無い → 工程を登録する
 *
 * 左右に並べるかは本文の幅で決める（`@container`。サイドバーを開いたタブレットでは縦に並ぶ）
 */
export function ProductProcessComparisonPanel({
  comparison,
  isLoading,
  isError,
  canEditNames,
}: {
  comparison: ProductProcessComparison | undefined
  isLoading: boolean
  isError: boolean
  canEditNames: boolean
}) {
  const { data: member } = useCurrentMember()
  const canEditUntracked = member != null && UNTRACKED_PROCESS_EDITOR_ROLES.includes(member.role)
  const { data: products } = useProducts()
  const { data: untrackedNames } = useUntrackedProcessNames()
  const invalidate = useInvalidateProductProcesses()
  const createAlias = useCreateNameAlias()
  const ignore = useIgnoreName()
  const unignore = useUnignoreName()
  const addUntracked = useAddUntrackedProcessName()
  const removeUntracked = useRemoveUntrackedProcessName()
  const [pending, setPending] = React.useState<PendingOperation | null>(null)
  /** 開いている工程ルートの編集（`processName` は追加のフォームに入れておく工程名） */
  const [routingEdit, setRoutingEdit] = React.useState<{ processName?: string } | null>(null)

  if (isLoading || isError || !comparison) {
    return <ListStatus isLoading={isLoading || !comparison} isError={isError} />
  }

  const product = products?.find((p) => p.id === comparison.product_id) ?? null
  const routingNames = routingNamesOf(comparison)
  const busy =
    createAlias.isPending ||
    ignore.isPending ||
    addUntracked.isPending ||
    removeUntracked.isPending

  const confirmView: PendingNameAction | null =
    pending?.type === "alias"
      ? {
          type: "map",
          kind: "process",
          rawText: pending.raw.raw_text,
          targetLabel: pending.processNames.join("・"),
          otherProductCount: pending.raw.other_product_count,
        }
      : pending?.type === "ignore"
        ? {
            type: "ignore",
            kind: "process",
            rawText: pending.raw.raw_text,
            otherProductCount: pending.raw.other_product_count,
          }
        : null

  const onError = (fallback: string) => (error: unknown) =>
    toast.error(nameMutationErrorMessage(error, fallback))

  const confirmName = () => {
    if (pending?.type === "alias") {
      const { raw, processNames } = pending
      createAlias.mutate(
        { kind: "process", data: { raw_text: raw.raw_text, process_names: processNames } },
        {
          onSuccess: () => {
            setPending(null)
            toast.success(`日報の「${raw.raw_text}」を工程「${processNames.join("・")}」に結び付けました`, {
              description: allInRouting(processNames, routingNames) ? ALIGNED_MESSAGE : undefined,
            })
          },
          onError: onError("結び付けに失敗しました"),
        },
      )
    } else if (pending?.type === "ignore") {
      const { raw } = pending
      ignore.mutate(
        { kind: "process", raw_text: raw.raw_text, customer_raw: null },
        {
          onSuccess: (ignored) => {
            setPending(null)
            toast.success(`日報の「${raw.raw_text}」を対象外にしました`, {
              description: `「${DAILY_REPORT_ALIASES_LABEL}」の対象外からも戻せます`,
              action: {
                label: "元に戻す",
                onClick: () =>
                  unignore.mutateAsync(ignored.id).then(
                    () => toast.success(`日報の「${raw.raw_text}」を対象外から戻しました`),
                    (error: unknown) =>
                      toast.error(nameMutationErrorMessage(error, "対象外から戻せませんでした")),
                  ),
              },
            })
          },
          onError: onError("対象外にできませんでした"),
        },
      )
    }
  }

  // 日報で追わない工程の設定・解除。完了を待って閉じ、失敗したら開いたまま知らせる
  const confirmUntracked = async () => {
    if (pending?.type !== "untracked-add" && pending?.type !== "untracked-remove") return
    const { processName } = pending
    try {
      if (pending.type === "untracked-add") {
        await addUntracked.mutateAsync(processName)
        toast.success(`工程「${processName}」を日報で追わない工程にしました`, {
          description: ALIGNED_MESSAGE,
        })
      } else {
        await removeUntracked.mutateAsync(pending.id)
        toast.success(`工程「${processName}」を日報で追う工程に戻しました`, {
          description: ALIGNED_MESSAGE,
        })
      }
      setPending(null)
      await invalidate()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.info(`工程「${processName}」は既に日報で追わない工程です`)
        setPending(null)
        await invalidate()
        return
      }
      console.error(error)
      toast.error("日報で追わない工程の設定に失敗しました")
    }
  }

  const requestUntracked = (processName: string, action: "add" | "remove") => {
    if (action === "add") {
      setPending({ type: "untracked-add", processName })
      return
    }
    const current = findUntrackedProcessName(untrackedNames, processName)
    // 設定の一覧がまだ届いていない・別の画面で外された
    if (!current) {
      void invalidate()
      return
    }
    setPending({ type: "untracked-remove", processName, id: current.id })
  }

  const onRoutingSaved = (processName: string | undefined) => (saved: { process_name: string }[]) => {
    const names = saved.map((r) => r.process_name)
    if (processName && allInRouting([processName], names)) {
      toast.success(`工程「${processName}」をこの製品の工程に足しました`, {
        description: ALIGNED_MESSAGE,
      })
    } else {
      toast.success("変更を保存しました")
    }
    void invalidate()
  }

  const routingButton = (label: string, processName?: string) => (
    <Button
      variant="outline"
      size="sm"
      disabled={product === null}
      onClick={() => setRoutingEdit({ processName })}
    >
      <ListPlus />
      {label}
    </Button>
  )

  const rightOnlyCount = comparison.off_routing.length + comparison.unmatched.length

  return (
    <div className="@container flex flex-col gap-5">
      <section aria-labelledby="product-process-routings" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="product-process-routings" className="text-base font-semibold">
            工程
          </h2>
          {comparison.has_routings && routingButton("工程を編集")}
        </div>
        <div className="rounded-lg border bg-card">
          <ColumnHeader />
          {comparison.has_routings ? (
            <ul className="divide-y" aria-label="工程マスタの工程">
              {comparison.routings.map((row) => {
                const leftOnly = row.raws.length === 0
                const untrackedWithActuals = row.untracked && !leftOnly
                const action =
                  canEditUntracked && leftOnly && !row.untracked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => requestUntracked(row.process_name, "add")}
                    >
                      日報で追わない工程にする
                    </Button>
                  ) : canEditUntracked && untrackedWithActuals ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => requestUntracked(row.process_name, "remove")}
                    >
                      日報で追う工程に戻す
                    </Button>
                  ) : null
                return (
                  <CompareRow
                    key={row.routing_id}
                    label={`${row.sequence_order} ${row.process_name}`}
                    // 左だけの工程は合わない工程に数えない（検査など日報に書かない工程がある）ので、操作だけ置く
                    mismatch={untrackedWithActuals}
                    left={
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {row.sequence_order}
                        </span>
                        <span className="break-all font-medium">{row.process_name}</span>
                        {row.untracked && (
                          <Badge variant="secondary">{UNTRACKED_PROCESS_LABEL}</Badge>
                        )}
                      </span>
                    }
                    right={<RawList raws={row.raws} />}
                    action={action}
                  />
                )
              })}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
              <p className="text-sm text-muted-foreground">工程が登録されていません</p>
              {routingButton("工程を登録する")}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="product-process-right-only" className="space-y-2">
        <h2 id="product-process-right-only" className="text-base font-semibold">
          工程マスタに無い日報の工程
          <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
            {rightOnlyCount}工程
          </span>
        </h2>
        {rightOnlyCount === 0 ? (
          <p className="rounded-lg border bg-card py-6 text-center text-sm text-muted-foreground">
            ありません
          </p>
        ) : (
          <div className="rounded-lg border bg-card">
            <ColumnHeader />
            <ul className="divide-y" aria-label="工程マスタに無い日報の工程">
              {comparison.off_routing.map((row) => (
                <CompareRow
                  key={`off:${row.process_name}`}
                  label={row.process_name}
                  mismatch
                  left={<MissingLeft />}
                  right={
                    <div className="space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        工程「{row.process_name}」
                        {row.untracked && (
                          <Badge variant="secondary">{UNTRACKED_PROCESS_LABEL}</Badge>
                        )}
                      </p>
                      <RawList raws={row.raws} />
                    </div>
                  }
                  action={routingButton("この製品の工程に足す", row.process_name)}
                />
              ))}
              {comparison.unmatched.map((raw) => (
                <CompareRow
                  key={`raw:${raw.raw_text}`}
                  label={raw.raw_text}
                  mismatch
                  left={<MissingLeft />}
                  right={<RawList raws={[raw]} />}
                  action={
                    canEditNames ? (
                      <>
                        <ProcessPicker
                          triggerLabel="工程名を選ぶ"
                          ariaLabel={`「${raw.raw_text}」の工程名を選ぶ`}
                          disabled={busy}
                          onSubmit={(processNames) =>
                            setPending({ type: "alias", raw, processNames })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setPending({ type: "ignore", raw })}
                        >
                          対象外
                        </Button>
                      </>
                    ) : null
                  }
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <ConfirmMappingDialog
        pending={confirmView}
        busy={busy}
        onConfirm={confirmName}
        onCancel={() => setPending(null)}
      />
      <UntrackedConfirmDialog
        pending={
          pending?.type === "untracked-add" || pending?.type === "untracked-remove" ? pending : null
        }
        busy={busy}
        onConfirm={confirmUntracked}
        onCancel={() => setPending(null)}
      />
      {/* 閉じている間に設備グループ等を取得しないよう、開くときだけ描画する */}
      {routingEdit !== null && product !== null && (
        <ProductRoutingsDialog
          product={product}
          open
          initialProcessName={routingEdit.processName}
          onSaved={onRoutingSaved(routingEdit.processName)}
          onOpenChange={(open) => {
            if (open) return
            setRoutingEdit(null)
            // ダイアログの中で日報で追わない工程を切り替えても、比較に反映する
            void invalidate()
          }}
        />
      )}
    </div>
  )
}

/** 左右の見出し（左右に並ぶ幅のときだけ出す。縦に並ぶときは各行の小見出し） */
function ColumnHeader() {
  return (
    <div
      aria-hidden
      className="hidden border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground @[44rem]:grid @[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] @[44rem]:gap-x-4"
    >
      <span>工程マスタ</span>
      <span>日報</span>
    </div>
  )
}

function CompareRow({
  label,
  left,
  right,
  action,
  mismatch,
}: {
  /** 行の読み上げ名 */
  label: string
  left: ReactNode
  right: ReactNode
  action: ReactNode
  /** 左右が合わない行（操作を置く行） */
  mismatch: boolean
}) {
  return (
    <li
      aria-label={label}
      data-mismatch={mismatch || undefined}
      className={cn(
        "grid gap-x-4 gap-y-1.5 px-3 py-2 @[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]",
        mismatch && "border-l-4 border-l-amber-400 bg-amber-50/50 pl-2",
      )}
    >
      <div className="min-w-0">
        <span className="mb-0.5 block text-[11px] text-muted-foreground @[44rem]:hidden">
          工程マスタ
        </span>
        {left}
      </div>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mb-0.5 block text-[11px] text-muted-foreground @[44rem]:hidden">
            日報
          </span>
          {right}
        </div>
        {action && <div className="ml-auto flex flex-wrap items-center gap-1.5">{action}</div>}
      </div>
    </li>
  )
}

function MissingLeft() {
  return <span className="text-sm text-muted-foreground">－</span>
}

/** 日報の表記（明細の数・最終の加工日）。表記が無ければ「－」 */
function RawList({ raws }: { raws: readonly ProcessRaw[] }) {
  if (raws.length === 0) return <span className="text-sm text-muted-foreground">－</span>
  return (
    <ul className="space-y-0.5">
      {raws.map((raw) => (
        <li key={raw.raw_text} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="break-all font-medium">{raw.raw_text}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatEntryCount(raw.entry_count)}・最終 {formatWorkDate(raw.last_work_date)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function UntrackedConfirmDialog({
  pending,
  busy,
  onConfirm,
  onCancel,
}: {
  pending:
    | { type: "untracked-add"; processName: string }
    | { type: "untracked-remove"; processName: string; id: number }
    | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const isAdd = pending?.type === "untracked-add"
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isAdd ? "日報で追わない工程にしますか？" : "日報で追う工程に戻しますか？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            工程「{pending?.processName ?? ""}」。同じ工程名の工程を持つすべての製品に効きます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>キャンセル</AlertDialogCancel>
          <Button onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {isAdd ? "日報で追わない" : "日報で追う"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

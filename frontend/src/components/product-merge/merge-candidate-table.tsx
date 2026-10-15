"use client"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  MERGE_RANK_LABELS,
  formatOrderCounts,
  mergeIneligibleReason,
} from "@/lib/product-merge-utils"
import type { ProductMergeCandidate } from "@/types/product"

interface MergeCandidateTableProps {
  candidates: ProductMergeCandidate[]
  keepId: number | null
  excludedIds: ReadonlySet<number>
  onKeepChange: (id: number) => void
  onExcludedChange: (id: number, excluded: boolean) => void
  disabled?: boolean
}

/**
 * 統合の候補一覧（Issue #515）。「残す」で残す製品を1件選び、「統合」のチェックで統合される側を個別に外す。
 * 接頭辞が残す製品と違う候補は参考として出し、チェックできないようにして理由を表示する。
 */
export function MergeCandidateTable({
  candidates,
  keepId,
  excludedIds,
  onKeepChange,
  onExcludedChange,
  disabled = false,
}: MergeCandidateTableProps) {
  const keep = candidates.find((c) => c.id === keepId) ?? null

  return (
    <div className="rounded-md border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[52px] text-center">残す</TableHead>
            <TableHead className="w-[52px] text-center">統合</TableHead>
            <TableHead>品名 / 図番</TableHead>
            <TableHead className="w-[170px]">工程</TableHead>
            <TableHead className="w-[150px]">受注</TableHead>
            <TableHead className="w-[56px] text-right">別名</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => {
            const isKeep = candidate.id === keepId
            const ineligibleReason = mergeIneligibleReason(candidate, keep)
            const canCheck = keep !== null && !isKeep && ineligibleReason === null
            const isMerged = canCheck && !excludedIds.has(candidate.id)
            const orderCounts = formatOrderCounts(candidate.order_counts)
            return (
              <TableRow
                key={candidate.id}
                data-testid={`merge-candidate-${candidate.id}`}
                className={cn(isKeep && "bg-primary/5", ineligibleReason && "text-muted-foreground")}
              >
                <TableCell className="text-center">
                  <input
                    type="radio"
                    name="merge-keep-product"
                    aria-label={`「${candidate.name}」を残す`}
                    className="size-4 accent-primary"
                    checked={isKeep}
                    disabled={disabled}
                    onChange={() => onKeepChange(candidate.id)}
                  />
                </TableCell>
                <TableCell className="text-center">
                  {!isKeep && (
                    <Checkbox
                      aria-label={`「${candidate.name}」を統合する`}
                      checked={isMerged}
                      disabled={disabled || !canCheck}
                      onCheckedChange={(checked) =>
                        onExcludedChange(candidate.id, checked !== true)
                      }
                    />
                  )}
                </TableCell>
                <TableCell>
                  <div className="text-xs text-muted-foreground">
                    {candidate.code ?? "図番未設定"}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {candidate.prefix && (
                      <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
                        {candidate.prefix}
                      </Badge>
                    )}
                    <span className="break-all text-sm font-medium">
                      {candidate.name}
                    </span>
                    {!candidate.is_active && <Badge variant="outline">無効</Badge>}
                    {isKeep && <Badge>残す</Badge>}
                  </div>
                  {ineligibleReason && (
                    <p className="mt-1 text-xs text-amber-700">{ineligibleReason}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {candidate.routing_count === 0 ? (
                    <span className="text-muted-foreground">工程なし</span>
                  ) : (
                    <>
                      <div>
                        {candidate.routing_count}工程（時間あり {candidate.timed_routing_count}）
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {MERGE_RANK_LABELS[candidate.rank]}
                      </div>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {orderCounts ?? <span className="text-muted-foreground">なし</span>}
                </TableCell>
                <TableCell className="text-right text-sm">{candidate.alias_count}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UNALLOCATED_ACTUALS_LIMIT, useUnallocatedActuals } from "@/hooks/use-daily-report-coverage"
import { formatWorkDate } from "@/lib/daily-report-name-utils"
import type { UnallocatedGroup } from "@/types/daily-report-progress"

/** 未割当のまとめ1行の元の日報の行（新しい順）。行を開いたときだけ取得する */
export function UnallocatedActualsTable({
  group,
  months,
}: {
  group: UnallocatedGroup
  months: number | null
}) {
  const { data: actuals, isLoading, isError } = useUnallocatedActuals(group, months)

  if (isLoading) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">読み込み中...</p>
  }
  if (isError || !actuals) {
    return <p className="px-3 py-2 text-sm text-destructive">日報の行を取得できませんでした</p>
  }

  return (
    <div className="space-y-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">加工日</TableHead>
            <TableHead>シート・行</TableHead>
            <TableHead>顧客先</TableHead>
            <TableHead>商品</TableHead>
            <TableHead>日報の工程</TableHead>
            <TableHead className="text-right">数量</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actuals.map((actual) => (
            <TableRow key={actual.id}>
              <TableCell>{formatWorkDate(actual.work_date)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {actual.sheet_name ?? "－"}
                {actual.row_no !== null && ` ${actual.row_no}行目`}
              </TableCell>
              <TableCell>{actual.customer_raw ?? "－"}</TableCell>
              <TableCell>{actual.product_raw ?? "－"}</TableCell>
              <TableCell>{actual.process_raw ?? "－"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {actual.qty.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {actuals.length >= UNALLOCATED_ACTUALS_LIMIT && actuals.length < group.row_count && (
        <p className="px-2 text-xs text-muted-foreground">
          新しい順に {actuals.length} 行を表示しています（全 {group.row_count} 行）
        </p>
      )}
    </div>
  )
}

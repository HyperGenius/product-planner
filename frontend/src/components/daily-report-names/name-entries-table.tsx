"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useNameEntries } from "@/hooks/use-daily-report-names"
import { formatWorkDate } from "@/lib/daily-report-name-utils"
import type { UnmatchedName } from "@/types/daily-report-names"

const formatQty = (value: number | null) => (value === null ? "－" : value.toLocaleString())

/** 表記が使われている日報の行（加工日・商品・工程・数量）。未照合キューで表記を開いたときに出す */
export function NameEntriesTable({ item }: { item: UnmatchedName }) {
  const { data: entries, isLoading, isError } = useNameEntries(item)

  if (isLoading) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">読み込み中...</p>
  }
  if (isError || !entries) {
    return <p className="px-3 py-2 text-sm text-destructive">日報の行を取得できませんでした</p>
  }

  return (
    <div className="space-y-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">加工日</TableHead>
            <TableHead>顧客先</TableHead>
            <TableHead>商品</TableHead>
            <TableHead>工程</TableHead>
            <TableHead>設備</TableHead>
            <TableHead className="text-right">加工数</TableHead>
            <TableHead className="text-right">良品数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{formatWorkDate(entry.work_date)}</TableCell>
              <TableCell>{entry.customer_raw ?? "－"}</TableCell>
              <TableCell>{entry.product_raw ?? "－"}</TableCell>
              <TableCell>{entry.process_raw ?? "－"}</TableCell>
              <TableCell>{entry.equipment_raw ?? "－"}</TableCell>
              <TableCell className="text-right">{formatQty(entry.processed_qty)}</TableCell>
              <TableCell className="text-right">{formatQty(entry.good_qty)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {entries.length < item.entry_count && (
        <p className="px-2 text-xs text-muted-foreground">
          新しい順に {entries.length} 件を表示しています（全 {item.entry_count} 件）
        </p>
      )}
    </div>
  )
}

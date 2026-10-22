"use client"

import type { ReactNode } from "react"
import { MasterPagination } from "@/components/master-pagination"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getDeadlineColumnLabel, type StatusFilter } from "@/lib/order-utils"

interface OrdersTableProps {
  isLoading: boolean
  /** 列見出しの行（`<TableRow>`）。行（children）の列と揃える */
  header: ReactNode
  /** 表示する行の数。0 なら表の代わりに emptyState を出す */
  rowCount: number
  /** 該当する注文が無いときの表示 */
  emptyState: ReactNode
  /** ページングの対象件数（絞り込み後の全件数）。pageSize と合わせて省略するとページングを出さない */
  totalCount?: number
  /** 1ページの件数。ページは URL の `?page=` で持つので、1画面に表を複数並べるときは省略する */
  pageSize?: number
  /** 行（`OrderTableRow` 等） */
  children: ReactNode
}

/** 注文の表の外枠（読み込み中・空状態・スクロール領域・ページング。Issue #554） */
export function OrdersTable({
  isLoading,
  header,
  rowCount,
  emptyState,
  totalCount,
  pageSize,
  children,
}: OrdersTableProps) {
  return (
    <>
      <div className="rounded-lg border bg-card shadow-sm max-h-[calc(100vh-20rem)] overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">読み込み中...</div>
        ) : rowCount > 0 ? (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">{header}</TableHeader>
            <TableBody>{children}</TableBody>
          </Table>
        ) : (
          <div className="p-8 text-center text-muted-foreground">{emptyState}</div>
        )}
      </div>

      {totalCount !== undefined && pageSize !== undefined && (
        <MasterPagination totalCount={totalCount} pageSize={pageSize} />
      )}
    </>
  )
}

interface OrderTableHeaderRowProps {
  /** 納期カラムの見出し（「シミュ納期」/「確定納期」）の出し分けに使う */
  statusFilter: StatusFilter
  /** 選択列の見出し（全選択のチェックボックス等） */
  selectAll?: ReactNode
  /** 選択・操作の列を出すか。行の `OrderTableRow` と同じ値を渡す（Issue #558） */
  showActionColumns?: boolean
}

/** `OrderTableRow` の列に対応する見出しの行 */
export function OrderTableHeaderRow({
  statusFilter,
  selectAll,
  showActionColumns = true,
}: OrderTableHeaderRowProps) {
  return (
    <TableRow>
      {showActionColumns && (
        <TableHead className="w-10">
          <div className="flex items-center justify-center">{selectAll}</div>
        </TableHead>
      )}
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>注文番号</span>
          <span className="text-xs font-normal text-muted-foreground">顧客注番</span>
        </div>
      </TableHead>
      <TableHead>製品</TableHead>
      <TableHead>通称</TableHead>
      <TableHead className="text-right">数量</TableHead>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>希望納期</span>
          <span className="text-xs font-normal text-muted-foreground">
            {getDeadlineColumnLabel(statusFilter)}
          </span>
        </div>
      </TableHead>
      <TableHead className="text-foreground">ステータス</TableHead>
      {showActionColumns && <TableHead className="text-right text-foreground">操作</TableHead>}
    </TableRow>
  )
}

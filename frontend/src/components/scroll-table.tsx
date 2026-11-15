import type { ReactNode } from "react"
import { TableBody, TableHeader } from "@/components/ui/table"
import { cn } from "@/lib/utils"

interface ScrollTableProps {
  isLoading: boolean
  isError?: boolean
  /** 表示する行の数。0 なら表の代わりに emptyState を出す */
  rowCount: number
  /** 該当する行が無いときの表示 */
  emptyState: ReactNode
  /** 取得に失敗したときの表示 */
  errorState?: ReactNode
  /** 列見出しの行（`<TableRow>`）。スクロールしても上に残る */
  header: ReactNode
  /** 行（`<TableRow>`） */
  children: ReactNode
  /**
   * 枠の高さ。既定は親の縦 flex（`ListPageLayout` の本文）の残りの高さを使う。
   * 縦 flex の外で使うときは `max-h-*` 等で上限を渡す
   */
  className?: string
}

/** 既定の高さ。残りの高さを使い、縦が低い画面でも 16rem は確保する（下回る分はページ側がスクロールする） */
const FILL_CLASS = "min-h-64 flex-1"

/**
 * スクロールする表の枠（Issue #671）。枠の中だけをスクロールさせ、見出しの行を固定する。
 *
 * shadcn の `Table` は内側に `overflow-auto` の div を挟み、見出しの `sticky` がこの枠に対して効かないので、
 * 素の `<table>` で組む（`TableHeader` / `TableRow` / `TableCell` はそのまま使える）
 */
export function ScrollTable({
  isLoading,
  isError = false,
  rowCount,
  emptyState,
  errorState = "取得できませんでした",
  header,
  children,
  className,
}: ScrollTableProps) {
  return (
    <div className={cn("overflow-auto rounded-lg border bg-card shadow-sm", className ?? FILL_CLASS)}>
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">読み込み中...</div>
      ) : isError ? (
        <div className="p-8 text-center text-red-600">{errorState}</div>
      ) : rowCount > 0 ? (
        <table className="w-full caption-bottom text-sm">
          {/* 見出しの下線は border-collapse で行と一緒にスクロールしてしまうので、影で引く */}
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--color-border)]">
            {header}
          </TableHeader>
          <TableBody>{children}</TableBody>
        </table>
      ) : (
        <div className="p-8 text-center text-muted-foreground">{emptyState}</div>
      )}
    </div>
  )
}

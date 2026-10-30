"use client"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  compareReadings,
  PREVIEW_SOURCE_LABELS,
  UNREADABLE_REASON_LABELS,
  type ComparisonRow,
} from "@/lib/extraction-preview-utils"
import { cn } from "@/lib/utils"
import type { ExtractionPreview } from "@/types/customer-extraction-prompt"

interface ExtractionPreviewComparisonProps {
  preview: ExtractionPreview
}

/** 試し読みの結果を、今の指示と編集中の指示で項目ごとに並べる。違う項目を強調する */
export function ExtractionPreviewComparison({ preview }: ExtractionPreviewComparisonProps) {
  if (preview.unreadable_reason) {
    return (
      <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
        {UNREADABLE_REASON_LABELS[preview.unreadable_reason]}
      </p>
    )
  }
  if (!preview.current || !preview.edited) return null

  const comparison = compareReadings(preview.current, preview.edited)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {preview.source && (
          <span className="text-muted-foreground">{PREVIEW_SOURCE_LABELS[preview.source]}</span>
        )}
        {preview.same_prompt ? (
          <Badge variant="secondary">指示が同じため1回だけ読み取りました</Badge>
        ) : comparison.differenceCount > 0 ? (
          <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
            違いのある項目: {comparison.differenceCount}
          </Badge>
        ) : (
          <Badge variant="secondary">違いはありません</Badge>
        )}
      </div>

      <ComparisonTable title="文書" rows={comparison.document} />
      {comparison.lines.map((line) => (
        <ComparisonTable key={line.index} title={`明細 ${line.index}`} rows={line.rows} />
      ))}
    </div>
  )
}

function ComparisonTable({ title, rows }: { title: string; rows: ComparisonRow[] }) {
  return (
    <section aria-label={title} className="rounded-md border">
      <h3 className="border-b bg-muted/40 px-3 py-2 text-sm font-semibold">{title}</h3>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[160px]">項目</TableHead>
            <TableHead>今の指示</TableHead>
            <TableHead>編集中の指示</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.label}
              data-differs={row.differs || undefined}
              className={cn(row.differs && "bg-amber-50 hover:bg-amber-50")}
            >
              <TableCell className="font-medium">
                {row.label}
                {row.differs && <span className="sr-only">（違いあり）</span>}
              </TableCell>
              <TableCell className="whitespace-normal break-words">{row.current}</TableCell>
              <TableCell
                className={cn("whitespace-normal break-words", row.differs && "font-semibold")}
              >
                {row.edited}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

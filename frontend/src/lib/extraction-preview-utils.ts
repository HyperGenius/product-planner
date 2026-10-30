/**
 * 抽出指示の試し読み（Issue #602）の結果を、今の指示と編集中の指示で項目ごとに並べて比べる。
 * 明細は上から順に（同じ位置どうしを）比べる。片方にしか無い明細はすべての項目を違いとする。
 */
import { format, parseISO } from "date-fns"
import { getCertaintyLabel } from "@/lib/order-utils"
import type {
  ExtractionPreview,
  PreviewLineItem,
  PreviewReading,
} from "@/types/customer-extraction-prompt"

const EMPTY = "－"

export interface ComparisonRow {
  label: string
  current: string
  edited: string
  differs: boolean
}

export interface LineComparison {
  /** 1始まりの明細の番号 */
  index: number
  rows: ComparisonRow[]
  differs: boolean
}

export interface PreviewComparison {
  document: ComparisonRow[]
  lines: LineComparison[]
  /** 違いのある項目の数（文書・明細の合計） */
  differenceCount: number
}

const LINE_FIELDS: { label: string; format: (line: PreviewLineItem) => string }[] = [
  { label: "品名", format: (line) => line.product_name_raw ?? EMPTY },
  { label: "品番", format: (line) => line.product_number_raw ?? EMPTY },
  {
    label: "数量",
    format: (line) =>
      line.invalid_quantity
        ? "読めない値（起票しない）"
        : line.quantity != null
          ? line.quantity.toLocaleString("ja-JP")
          : EMPTY,
  },
  {
    label: "納期",
    format: (line) => formatDate(line.delivery_date),
  },
  {
    label: "確度",
    format: (line) => (line.certainty ? getCertaintyLabel(line.certainty) : "不明"),
  },
  { label: "明細の注文番号", format: (line) => line.line_order_no ?? EMPTY },
  { label: "起票される注文番号", format: (line) => line.customer_order_no ?? EMPTY },
  {
    label: "製品の照合",
    format: (line) =>
      line.product
        ? [line.product.code, line.product.name].filter(Boolean).join(" ")
        : "未照合",
  },
]

function formatDate(value: string | null): string {
  if (!value) return EMPTY
  // 日付のみの値は parseISO でローカル深夜として読む（new Date だと UTC 扱いでずれる）
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "yyyy/MM/dd")
}

const FALLBACK_LABELS: Record<NonNullable<PreviewReading["fallback"]>, string> = {
  email_body: "明細なし（取り込みではメール本文から読み直す）",
  unreadable_draft: "明細なし（取り込みでは空の下書きを起票する）",
}

function readingSummary(reading: PreviewReading): string {
  if (reading.error === "document_rejected") {
    return "読み取れない（Claude が文書を受け付けなかった）"
  }
  if (reading.fallback) return FALLBACK_LABELS[reading.fallback]
  return `${reading.line_items.length}件`
}

function row(label: string, current: string, edited: string): ComparisonRow {
  return { label, current, edited, differs: current !== edited }
}

export function compareReadings(
  current: PreviewReading,
  edited: PreviewReading,
): PreviewComparison {
  const document = [
    row("明細", readingSummary(current), readingSummary(edited)),
    row(
      "文書の注文番号",
      current.document_order_no ?? EMPTY,
      edited.document_order_no ?? EMPTY,
    ),
    row(
      "種別",
      current.is_repair ? "修理等" : "生産",
      edited.is_repair ? "修理等" : "生産",
    ),
    row("件名", current.subject ?? EMPTY, edited.subject ?? EMPTY),
  ]

  const lineCount = Math.max(current.line_items.length, edited.line_items.length)
  const lines: LineComparison[] = Array.from({ length: lineCount }, (_, i) => {
    const currentLine = current.line_items[i]
    const editedLine = edited.line_items[i]
    const rows = LINE_FIELDS.map((field) =>
      row(
        field.label,
        currentLine ? field.format(currentLine) : "（明細なし）",
        editedLine ? field.format(editedLine) : "（明細なし）",
      ),
    )
    return { index: i + 1, rows, differs: rows.some((r) => r.differs) }
  })

  const differenceCount =
    document.filter((r) => r.differs).length +
    lines.reduce((sum, line) => sum + line.rows.filter((r) => r.differs).length, 0)
  return { document, lines, differenceCount }
}

export const UNREADABLE_REASON_LABELS: Record<
  NonNullable<ExtractionPreview["unreadable_reason"]>,
  string
> = {
  failed_encrypted:
    "パスワード付きのPDFのため読み取れません（取り込みでは読み取り不能の下書きになります）",
  failed_too_large: "PDFが大きすぎるため読み取れません（取り込みでも読み取りません）",
}

export const PREVIEW_SOURCE_LABELS: Record<NonNullable<ExtractionPreview["source"]>, string> = {
  text: "テキストPDF（文字を読み取って抽出）",
  image: "画像PDF（FAX・スキャンを画像として抽出）",
}

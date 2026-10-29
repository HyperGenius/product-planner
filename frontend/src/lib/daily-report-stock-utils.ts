import { formatWorkDate } from "@/lib/daily-report-name-utils"
import type {
  StockEstimate,
  StockEstimates,
  StockFeedback,
  StockFeedbackInput,
  StockFeedbackKind,
} from "@/types/daily-report-stock"

/**
 * 日報からの作り置き（先行着手）の推定の表示ロジック (Issue #591)。
 * 用語はヒアリングで現場の呼び名を聞いて合わせる前提で、画面の呼び名は `STOCK_LABEL` 1か所にまとめる。
 */
export const STOCK_LABEL = "作り置き"

/** 作り置きしている場所（どの工程の後か） */
export function stockPlaceLabel(estimate: Pick<StockEstimate, "process_name">): string {
  return `「${estimate.process_name}」の後`
}

/** 推定数が何で減るか */
export function stockConsumedByLabel(
  estimate: Pick<StockEstimate, "next_process_name">,
): string {
  return estimate.next_process_name
    ? `「${estimate.next_process_name}」で使うと減ります`
    : "日報の最後の工程なので、送品で減ります"
}

/** 指摘の内容の要約 */
export function feedbackSummary(
  feedback: Pick<StockFeedback, "kind" | "process_name" | "baseline_qty" | "baseline_date">,
): string {
  if (feedback.kind === "not_stocked") return `${STOCK_LABEL}していない`
  const place = `「${feedback.process_name}」の後に${STOCK_LABEL}`
  if (feedback.baseline_qty === null || feedback.baseline_date === null) return place
  return `${place}（${formatWorkDate(feedback.baseline_date)} 時点で ${feedback.baseline_qty.toLocaleString()} 個）`
}

/** 推定が出ていない製品の指摘（「作り置きしていない」や、指定した工程の推定が0の製品） */
export function feedbackWithoutEstimates(data: StockEstimates): StockFeedback[] {
  const estimated = new Set(data.items.map((i) => i.product_id))
  return data.feedback.filter((f) => !estimated.has(f.product_id))
}

export interface StockFeedbackForm {
  kind: StockFeedbackKind
  processName: string
  /** 空欄なら基準値なし */
  baselineQty: string
  baselineDate: string
  note: string
}

export function initialStockFeedbackForm(
  feedback: StockFeedback | undefined,
  defaults: { processName: string; today: string },
): StockFeedbackForm {
  return {
    kind: feedback?.kind ?? "stock_process",
    processName: feedback?.process_name ?? defaults.processName,
    baselineQty: feedback?.baseline_qty?.toString() ?? "",
    baselineDate: feedback?.baseline_date ?? defaults.today,
    note: feedback?.note ?? "",
  }
}

/** フォームの値を API の入力にする。入力に誤りがあればその理由を返す */
export function toStockFeedbackInput(
  form: StockFeedbackForm,
): { input: StockFeedbackInput; error?: undefined } | { input?: undefined; error: string } {
  const note = form.note.trim() || null
  if (form.kind === "not_stocked") return { input: { kind: "not_stocked", note } }

  const processName = form.processName.trim()
  if (!processName) return { error: "工程を選んでください" }
  const qtyText = form.baselineQty.trim()
  if (!qtyText) {
    return {
      input: {
        kind: "stock_process",
        process_name: processName,
        baseline_qty: null,
        baseline_date: null,
        note,
      },
    }
  }
  if (!/^\d+$/.test(qtyText)) return { error: "数は0以上の整数で入力してください" }
  if (!form.baselineDate) return { error: "いつの時点の数かを入力してください" }
  return {
    input: {
      kind: "stock_process",
      process_name: processName,
      baseline_qty: Number(qtyText),
      baseline_date: form.baselineDate,
      note,
    },
  }
}

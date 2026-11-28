import { formatWorkDate } from "@/lib/daily-report-name-utils"
import type { OrderProgress, ProcessProgress } from "@/types/daily-report-progress"
import type {
  OrderStockAssignments,
  StockAssignment,
  StockAssignmentInput,
  StockEstimate,
  StockEstimates,
  StockFeedback,
  StockFeedbackInput,
  StockFeedbackKind,
  StockSourceEntry,
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

export interface StockConsumerGroup {
  /** 推定数が何の工程で減るか。null は日報の最後の工程（送品で減る） */
  nextProcessName: string | null
  items: StockEstimate[]
}

/**
 * 推定を、何で減るか（消費先の工程）ごとにまとめる (Issue #639)。同じ「…で使うと減ります」を
 * 行ごとに繰り返さず、グループの見出しに1回だけ出すため。グループは最も推定数の多い行の順、
 * グループ内は入力（推定数の多い順）のまま。
 */
export function groupStockByConsumer(items: readonly StockEstimate[]): StockConsumerGroup[] {
  const groups = new Map<string | null, StockConsumerGroup>()
  for (const item of items) {
    const group = groups.get(item.next_process_name) ?? {
      nextProcessName: item.next_process_name,
      items: [],
    }
    group.items.push(item)
    groups.set(item.next_process_name, group)
  }
  return [...groups.values()]
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
  if (!form.baselineDate) return { error: "数えた日を入力してください" }
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

/** 作り置きの引き当て（Issue #624）の入力 */
export interface StockAssignmentForm {
  processName: string
  qty: string
  note: string
}

/** 引き当てのダイアログが使う受注の作り置き・未割当の情報（Issue #673） */
export type StockAssignmentBasis = Pick<OrderStockAssignments, "stock_estimates"> &
  Partial<Pick<OrderStockAssignments, "process_names" | "candidate_totals" | "assignments">>

/**
 * 工程を選んだときの数の初期値 (Issue #673)。登録済みの引き当てがあればその数、無ければ
 * min(作り置きの推定 か 未割当の日報の合計, 受注数量)。どちらも無ければ空欄
 */
export function suggestedStockQty(
  data: StockAssignmentBasis,
  processName: string,
  orderQuantity: number,
): string {
  if (!processName) return ""
  const existing = data.assignments?.find((a) => a.process_name === processName)
  if (existing) return String(existing.qty)
  const estimate = data.stock_estimates.find((e) => e.process_name === processName)?.qty ?? 0
  const basis = estimate > 0 ? estimate : (data.candidate_totals?.[processName]?.qty ?? 0)
  return basis > 0 ? String(Math.min(basis, orderQuantity)) : ""
}

/**
 * 引き当ての初期値。推定の出ている工程のうち工程ルートで最も後の工程（最も先まで済んだ作り置き）を選ぶ。
 * 推定が無ければ、未割当の日報のある工程のうち工程ルートで最も後の工程（日報の顧客先の誤記の分）。
 * どちらも無ければ空欄にして選ばせる。数は `suggestedStockQty()`
 */
export function initialStockAssignmentForm(
  data: StockAssignmentBasis,
  orderQuantity: number,
): StockAssignmentForm {
  const estimate = data.stock_estimates.filter((e) => e.qty > 0).at(-1)
  const withCandidates = (data.process_names ?? []).filter(
    (name) => (data.candidate_totals?.[name]?.qty ?? 0) > 0,
  )
  const processName = estimate?.process_name ?? withCandidates.at(-1) ?? ""
  return { processName, qty: suggestedStockQty(data, processName, orderQuantity), note: "" }
}

/** 工程を選ぶ表の1行 (Issue #673) */
export interface StockProcessRow {
  processName: string
  /** 工程ルートで次の工程。null は最後の工程 */
  nextProcessName: string | null
  /** 作り置きの推定。推定が無ければ null */
  estimateQty: number | null
  /** 未割当の日報の件数・合計（全件） */
  candidateCount: number
  candidateQty: number
  /** この受注の実績（良品数）。進捗が無ければ null */
  actualQty: number | null
  /** この工程の登録済みの引き当て。無ければ null */
  assignedQty: number | null
  /** 引き当てられるもの（推定か未割当の日報）があるか */
  hasStock: boolean
}

/** 工程ルートの順に全工程の行を作る。実績は同じ工程名の進捗の良品数の最大 */
export function stockProcessRows(
  data: Pick<
    OrderStockAssignments,
    "process_names" | "stock_estimates" | "candidate_totals" | "assignments"
  >,
  progress: readonly Pick<ProcessProgress, "process_name" | "good_qty">[] | undefined,
): StockProcessRow[] {
  return data.process_names.map((processName, i) => {
    const estimateQty =
      data.stock_estimates.find((e) => e.process_name === processName)?.qty ?? null
    const total = data.candidate_totals?.[processName]
    const actuals = (progress ?? [])
      .filter((p) => p.process_name === processName)
      .map((p) => p.good_qty)
    const candidateQty = total?.qty ?? 0
    return {
      processName,
      nextProcessName: data.process_names[i + 1] ?? null,
      estimateQty,
      candidateCount: total?.count ?? 0,
      candidateQty,
      actualQty: actuals.length > 0 ? Math.max(...actuals) : null,
      assignedQty: data.assignments.find((a) => a.process_name === processName)?.qty ?? null,
      hasStock: (estimateQty ?? 0) > 0 || candidateQty > 0,
    }
  })
}

/** 引き当てる数を、明細（加工日の新しい順）に新しい順で割り振った見込み。数が不正なら全て0 */
export function plannedSourceUsage(
  entries: readonly Pick<StockSourceEntry, "qty">[],
  qtyText: string,
): number[] {
  let rest = /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : 0
  return entries.map((e) => {
    const used = Math.min(e.qty, rest)
    rest -= used
    return used
  })
}

/** 明細の表記（日報の商品名・顧客先）を、重複と空欄を除いて出てきた順に並べる */
export function distinctRawValues(
  entries: readonly StockSourceEntry[],
  key: "product_raw" | "customer_raw",
): string[] {
  const values = entries.map((e) => e[key]?.trim()).filter((v): v is string => !!v)
  return [...new Set(values)]
}

/**
 * 登録を妨げない注意 (Issue #673)。数が未割当の合計を超える・日報の顧客先が受注の顧客と違う・
 * 登録済みを上書きする、の3つ。顧客は日報の顧客先を照合した顧客で比べる（照合できない明細は比べない）
 */
export function stockAssignmentWarnings({
  qtyText,
  candidateQty,
  usedEntries,
  orderCustomerId,
  existingQty,
}: {
  qtyText: string
  candidateQty: number
  usedEntries: readonly Pick<StockSourceEntry, "customer_id">[]
  orderCustomerId: number | null
  existingQty: number | null
}): string[] {
  const warnings: string[] = []
  const qty = /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : 0
  if (qty > 0 && qty > candidateQty) {
    warnings.push(
      candidateQty === 0
        ? `この工程に未割当の日報はありません。日報が取り込まれるまで、集計では${STOCK_LABEL}を充てられません`
        : `未割当の日報は合計 ${candidateQty.toLocaleString()} 個です。集計で充てられるのは ${candidateQty.toLocaleString()} 個までです`,
    )
  }
  if (
    orderCustomerId !== null &&
    usedEntries.some((e) => e.customer_id != null && e.customer_id !== orderCustomerId)
  ) {
    warnings.push(
      "日報の顧客先が受注の顧客と違う明細があります。顧客先の誤記なら、このまま引き当ててかまいません",
    )
  }
  if (existingQty !== null) {
    warnings.push(`登録済みの引き当て（${existingQty.toLocaleString()} 個）を上書きします`)
  }
  return warnings
}

/** フォームの値を API の入力にする。入力に誤りがあればその理由を返す */
export function toStockAssignmentInput(
  form: StockAssignmentForm,
  orderQuantity: number,
): { input: StockAssignmentInput; error?: undefined } | { input?: undefined; error: string } {
  const processName = form.processName.trim()
  if (!processName) return { error: "工程を選んでください" }
  const qtyText = form.qty.trim()
  if (!/^\d+$/.test(qtyText) || Number(qtyText) <= 0) {
    return { error: "数は1以上の整数で入力してください" }
  }
  const qty = Number(qtyText)
  if (qty > orderQuantity) {
    return { error: `数は受注数量（${orderQuantity.toLocaleString()}）以下にしてください` }
  }
  return { input: { process_name: processName, qty, note: form.note.trim() || null } }
}

/**
 * 引き当てが集計にまだ反映されていないか (Issue #673)。登録・上書きの後、割り付けの最終計算日時より後に
 * 書いた引き当ては次の集計（cron）まで進捗に効かない。一度も計算していなければ反映待ち
 */
export function isAssignmentPending(
  assignment: Pick<StockAssignment, "updated_at">,
  computedAt: string | null,
): boolean {
  if (!computedAt) return true
  return new Date(assignment.updated_at).getTime() > new Date(computedAt).getTime()
}

/**
 * 工程の進捗カードに「作り置きから引き当てられるかも」の案内を出すか (Issue #673)。
 * 日報の実績が付いていない工程があり、引き当てられる受注で、その製品に引き当てられるもの（推定か未割当の日報）が
 * あるときだけ。反映待ちの引き当てがあるときは、登録済みなので出さない
 */
export function shouldShowStockHint(
  progress: Pick<OrderProgress, "computed_at" | "processes"> | undefined,
  stock:
    | Pick<
        OrderStockAssignments,
        | "computed_at"
        | "assignable"
        | "process_names"
        | "stock_estimates"
        | "candidate_totals"
        | "assignments"
      >
    | undefined,
): boolean {
  if (!progress?.computed_at || !stock?.assignable) return false
  if (!progress.processes.some((p) => p.status === "not_started")) return false
  if (stock.assignments.some((a) => isAssignmentPending(a, stock.computed_at))) return false
  return stockProcessRows(stock, progress.processes).some((row) => row.hasStock)
}

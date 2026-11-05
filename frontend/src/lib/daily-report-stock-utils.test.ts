import { describe, expect, it } from "vitest"
import type { StockEstimate, StockEstimates, StockFeedback } from "@/types/daily-report-stock"
import {
  feedbackSummary,
  feedbackWithoutEstimates,
  initialStockAssignmentForm,
  groupStockByConsumer,
  initialStockFeedbackForm,
  stockConsumedByLabel,
  toStockAssignmentInput,
  toStockFeedbackInput,
  type StockAssignmentForm,
  type StockFeedbackForm,
} from "./daily-report-stock-utils"

/** 日報からの作り置きの推定の表示ロジック (Issue #591)。製品はダミー値 */

function feedback(overrides: Partial<StockFeedback>): StockFeedback {
  return {
    product_id: 1,
    product_name: "テスト製品A",
    product_code: null,
    kind: "stock_process",
    process_name: "プレス",
    baseline_qty: null,
    baseline_date: null,
    note: null,
    updated_by: "u1",
    updated_at: "2026-10-29T01:00:00Z",
    ...overrides,
  }
}

const FORM: StockFeedbackForm = {
  kind: "stock_process",
  processName: "プレス",
  baselineQty: "",
  baselineDate: "2026-10-29",
  note: "",
}

describe("daily-report-stock-utils", () => {
  it("推定数が何で減るかを出す", () => {
    expect(stockConsumedByLabel({ next_process_name: "カシメ" })).toBe("「カシメ」で使うと減ります")
    expect(stockConsumedByLabel({ next_process_name: null })).toBe(
      "日報の最後の工程なので、送品で減ります",
    )
  })

  it("推定を消費先の工程ごとにまとめる（グループは推定数の多い行の順、行は入力の順）", () => {
    const item = (product_id: number, next: string | null, qty: number): StockEstimate => ({
      product_id,
      product_name: null,
      product_code: null,
      process_name: "プレス",
      next_process_name: next,
      qty,
      last_movement_date: null,
    })
    const groups = groupStockByConsumer([
      item(1, null, 500),
      item(2, "検査", 300),
      item(3, null, 200),
      item(4, "検査", 100),
    ])
    expect(groups.map((g) => [g.nextProcessName, g.items.map((i) => i.product_id)])).toEqual([
      [null, [1, 3]],
      ["検査", [2, 4]],
    ])
    expect(groupStockByConsumer([])).toEqual([])
  })

  it("指摘の内容を要約する", () => {
    expect(feedbackSummary(feedback({ kind: "not_stocked", process_name: null }))).toBe(
      "作り置きしていない",
    )
    expect(feedbackSummary(feedback({}))).toBe("「プレス」の後に作り置き")
    expect(
      feedbackSummary(feedback({ baseline_qty: 1200, baseline_date: "2026-09-30" })),
    ).toBe("「プレス」の後に作り置き（2026/09/30 時点で 1,200 個）")
  })

  it("推定が出ていない製品の指摘だけを返す", () => {
    const data: StockEstimates = {
      computed_at: null,
      items: [
        {
          product_id: 1,
          product_name: "テスト製品A",
          product_code: null,
          process_name: "プレス",
          next_process_name: null,
          qty: 10,
          last_movement_date: "2026-10-01",
        },
      ],
      feedback: [feedback({ product_id: 1 }), feedback({ product_id: 2, kind: "not_stocked" })],
    }

    expect(feedbackWithoutEstimates(data).map((f) => f.product_id)).toEqual([2])
  })

  it("既存の指摘があればフォームの初期値にする", () => {
    const defaults = { processName: "カシメ", today: "2026-10-29" }
    expect(initialStockFeedbackForm(undefined, defaults)).toEqual({
      ...FORM,
      processName: "カシメ",
    })
    expect(
      initialStockFeedbackForm(
        feedback({ baseline_qty: 5, baseline_date: "2026-10-01", note: "棚" }),
        defaults,
      ),
    ).toEqual({
      kind: "stock_process",
      processName: "プレス",
      baselineQty: "5",
      baselineDate: "2026-10-01",
      note: "棚",
    })
  })

  describe("toStockFeedbackInput", () => {
    it("作り置きしていない: 工程・数は送らない", () => {
      expect(toStockFeedbackInput({ ...FORM, kind: "not_stocked", baselineQty: "3", note: " 試作 " })).toEqual({
        input: { kind: "not_stocked", note: "試作" },
      })
    })

    it("数が空欄なら基準値なし", () => {
      expect(toStockFeedbackInput(FORM)).toEqual({
        input: {
          kind: "stock_process",
          process_name: "プレス",
          baseline_qty: null,
          baseline_date: null,
          note: null,
        },
      })
    })

    it("数を入れたら基準日と一緒に送る", () => {
      expect(toStockFeedbackInput({ ...FORM, baselineQty: " 12 " }).input).toMatchObject({
        baseline_qty: 12,
        baseline_date: "2026-10-29",
      })
    })

    it.each([
      [{ processName: " " }, "工程を選んでください"],
      [{ baselineQty: "-1" }, "数は0以上の整数で入力してください"],
      [{ baselineQty: "1.5" }, "数は0以上の整数で入力してください"],
      [{ baselineQty: "3", baselineDate: "" }, "いつの時点の数かを入力してください"],
    ])("入力の誤り %o", (patch, error) => {
      expect(toStockFeedbackInput({ ...FORM, ...patch })).toEqual({ error })
    })
  })
})

describe("作り置きの引き当て (Issue #624)", () => {
  describe("initialStockAssignmentForm", () => {
    it("工程ルートで最も後の工程の推定を選び、数は推定数と受注数量の小さい方", () => {
      const data = {
        stock_estimates: [
          { process_name: "カシメ", next_process_name: "クグシ", qty: 28, last_movement_date: null },
          { process_name: "クグシ", next_process_name: null, qty: 8222, last_movement_date: null },
        ],
      }
      expect(initialStockAssignmentForm(data, 5000)).toEqual({
        processName: "クグシ",
        qty: "5000",
        note: "",
      })
      expect(initialStockAssignmentForm(data, 10000).qty).toBe("8222")
    })

    it("推定が無ければ空欄", () => {
      expect(initialStockAssignmentForm({ stock_estimates: [] }, 100)).toEqual({
        processName: "",
        qty: "",
        note: "",
      })
    })
  })

  describe("toStockAssignmentInput", () => {
    const FORM: StockAssignmentForm = { processName: "クグシ", qty: "5000", note: " 棚の分 " }

    it("工程・数・メモを API の入力にする", () => {
      expect(toStockAssignmentInput(FORM, 5000)).toEqual({
        input: { process_name: "クグシ", qty: 5000, note: "棚の分" },
      })
      expect(toStockAssignmentInput({ ...FORM, note: " " }, 5000).input?.note).toBeNull()
    })

    it.each<[Partial<StockAssignmentForm>, string]>([
      [{ processName: " " }, "工程を選んでください"],
      [{ qty: "" }, "数は1以上の整数で入力してください"],
      [{ qty: "0" }, "数は1以上の整数で入力してください"],
      [{ qty: "1.5" }, "数は1以上の整数で入力してください"],
      [{ qty: "5001" }, "数は受注数量（5,000）以下にしてください"],
    ])("入力の誤り %o", (patch, error) => {
      expect(toStockAssignmentInput({ ...FORM, ...patch }, 5000)).toEqual({ error })
    })
  })
})

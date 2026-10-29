import { describe, expect, it } from "vitest"
import type { StockEstimates, StockFeedback } from "@/types/daily-report-stock"
import {
  feedbackSummary,
  feedbackWithoutEstimates,
  initialStockFeedbackForm,
  stockConsumedByLabel,
  toStockFeedbackInput,
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

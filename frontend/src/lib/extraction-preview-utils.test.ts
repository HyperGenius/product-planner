import { describe, expect, it } from "vitest"
import { compareReadings } from "./extraction-preview-utils"
import type { PreviewLineItem, PreviewReading } from "@/types/customer-extraction-prompt"

const LINE: PreviewLineItem = {
  product_name_raw: "部品A",
  product_number_raw: "A-1",
  quantity: 1200,
  invalid_quantity: false,
  delivery_date: "2026-11-01",
  certainty: "confirmed",
  line_order_no: null,
  customer_order_no: "C100",
  product: { id: 42, code: "A-1", name: "部品A" },
}

function reading(overrides: Partial<PreviewReading> = {}): PreviewReading {
  return {
    error: null,
    document_order_no: "C100",
    is_repair: false,
    subject: null,
    line_items: [LINE],
    fallback: null,
    ...overrides,
  }
}

describe("compareReadings", () => {
  it("同じ結果なら違いは0", () => {
    const result = compareReadings(reading(), reading())

    expect(result.differenceCount).toBe(0)
    expect(result.lines[0].differs).toBe(false)
  })

  it("違う項目だけを違いとして数える", () => {
    const result = compareReadings(
      reading(),
      reading({
        document_order_no: "C200",
        line_items: [{ ...LINE, quantity: 120, customer_order_no: "C200", product: null }],
      }),
    )

    expect(result.document.find((r) => r.label === "文書の注文番号")).toMatchObject({
      current: "C100",
      edited: "C200",
      differs: true,
    })
    const differing = result.lines[0].rows.filter((r) => r.differs)
    expect(differing.map((r) => [r.label, r.current, r.edited])).toEqual([
      ["数量", "1,200", "120"],
      ["起票される注文番号", "C100", "C200"],
      ["製品の照合", "A-1 部品A", "未照合"],
    ])
    expect(result.differenceCount).toBe(4)
  })

  it("片方にしか無い明細はすべての項目を違いにする", () => {
    const result = compareReadings(
      reading(),
      reading({ line_items: [LINE, { ...LINE, product_name_raw: "部品B" }] }),
    )

    expect(result.lines).toHaveLength(2)
    expect(result.lines[1].rows.every((r) => r.differs)).toBe(true)
    expect(result.lines[1].rows[0]).toMatchObject({ current: "（明細なし）", edited: "部品B" })
    expect(result.document[0]).toMatchObject({ current: "1件", edited: "2件", differs: true })
  })

  it("日付のみの納期を端末のタイムゾーンでずらさずに表示する", () => {
    const result = compareReadings(reading(), reading())

    expect(result.lines[0].rows.find((r) => r.label === "納期")?.current).toBe("2026/11/01")
  })

  it("明細が取れなかったときは取り込みの代わりの処理を表示する", () => {
    const result = compareReadings(
      reading({ line_items: [], fallback: "email_body" }),
      reading({ line_items: [], error: "document_rejected", fallback: "unreadable_draft" }),
    )

    expect(result.document[0]).toMatchObject({
      current: "明細なし（取り込みではメール本文から読み直す）",
      edited: "読み取れない（Claude が文書を受け付けなかった）",
    })
  })

  it("確度と読めない数量を日本語で表示する", () => {
    const result = compareReadings(
      reading(),
      reading({ line_items: [{ ...LINE, certainty: null, invalid_quantity: true, quantity: null }] }),
    )
    const rows = Object.fromEntries(result.lines[0].rows.map((r) => [r.label, r]))

    expect(rows["確度"]).toMatchObject({ current: "顧客確定", edited: "不明" })
    expect(rows["数量"].edited).toBe("読めない値（起票しない）")
  })
})

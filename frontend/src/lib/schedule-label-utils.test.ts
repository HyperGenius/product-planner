import { describe, expect, it } from "vitest"
import {
  isDeadlineExceeded,
  scheduleCustomerFullLabel,
  scheduleCustomerLabel,
  scheduleDeadlineLabel,
  scheduleOrderMeta,
  scheduleOrderNumberLabel,
  scheduleOrderTitle,
} from "./schedule-label-utils"

const BASE = {
  order_id: 7,
  order_number: "ORD-7",
  customer_order_no: "PO-7",
  customer_name: "顧客A社",
  product_name: "ピン",
  quantity: 500,
  desired_deadline: "2026-10-31",
  confirmed_deadline: "2026-11-02",
}

describe("scheduleDeadlineLabel", () => {
  it("希望納期を優先し、無ければ完成見込みを「見込」で出す", () => {
    expect(scheduleDeadlineLabel(BASE)).toBe("納期 10/31")
    expect(scheduleDeadlineLabel({ ...BASE, desired_deadline: null })).toBe("見込 11/2")
    expect(scheduleDeadlineLabel({ desired_deadline: null, confirmed_deadline: null })).toBeNull()
  })

  it("日付のみの値を端末の TZ でずらさない", () => {
    expect(scheduleDeadlineLabel({ desired_deadline: "2026-01-01", confirmed_deadline: null })).toBe("納期 1/1")
  })
})

describe("scheduleOrderNumberLabel", () => {
  it("注文番号 → 顧客の注文番号 → 内部 ID の順に出す", () => {
    expect(scheduleOrderNumberLabel(BASE)).toBe("ORD-7")
    expect(scheduleOrderNumberLabel({ ...BASE, order_number: null })).toBe("PO-7")
    expect(scheduleOrderNumberLabel({ ...BASE, order_number: null, customer_order_no: null })).toBe("#7")
  })
})

describe("scheduleOrderMeta / scheduleOrderTitle", () => {
  it("数量・納期・注文番号を並べ、値の無い項目は出さない", () => {
    expect(scheduleOrderMeta(BASE)).toEqual(["500個", "納期 10/31", "ORD-7"])
    expect(
      scheduleOrderMeta({ ...BASE, quantity: null, desired_deadline: null, confirmed_deadline: null }),
    ).toEqual(["ORD-7"])
  })

  it("顧客不明は「顧客不明」と出す", () => {
    expect(scheduleOrderTitle(BASE)).toBe("顧客A社 ピン")
    expect(scheduleOrderTitle({ customer_name: null, product_name: "ピン" })).toBe("顧客不明 ピン")
  })
})

describe("scheduleCustomerLabel / scheduleCustomerFullLabel（Issue #589）", () => {
  it("ガントは通称（前後の空白を除く）→ 正式名称 → 顧客不明の順", () => {
    expect(scheduleCustomerLabel({ customer_name: "顧客A社", customer_alias: " A社 " })).toBe("A社")
    expect(scheduleCustomerLabel({ customer_name: "顧客A社", customer_alias: "  " })).toBe("顧客A社")
    expect(scheduleCustomerLabel({ customer_name: null, customer_alias: null })).toBe("顧客不明")
    expect(scheduleOrderTitle({ customer_name: "顧客A社", customer_alias: "A社", product_name: "ピン" })).toBe("A社 ピン")
  })

  it("詳細シートは正式名称に、違う通称があれば併記する", () => {
    expect(scheduleCustomerFullLabel({ customer_name: "顧客A社", customer_alias: "A社" })).toBe("顧客A社（A社）")
    expect(scheduleCustomerFullLabel({ customer_name: "顧客A社", customer_alias: "顧客A社" })).toBe("顧客A社")
    expect(scheduleCustomerFullLabel({ customer_name: "顧客A社", customer_alias: null })).toBe("顧客A社")
    expect(scheduleCustomerFullLabel({ customer_name: null, customer_alias: null })).toBe("顧客不明")
  })
})

describe("isDeadlineExceeded", () => {
  it("最後の工程の計画終了が希望納期の日の終わり以降なら超過", () => {
    const deadline = { desired_deadline: "2026-09-30" }
    expect(isDeadlineExceeded(deadline, new Date(2026, 8, 30, 17))).toBe(false)
    expect(isDeadlineExceeded(deadline, new Date(2026, 9, 1, 0))).toBe(true)
  })

  it("希望納期が無ければ判定しない（完成見込みは計画から算出するので常に間に合う）", () => {
    expect(isDeadlineExceeded({ desired_deadline: null }, new Date(2027, 0, 1))).toBe(false)
  })
})

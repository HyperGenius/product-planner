import { describe, expect, it } from "vitest"
import {
  RISK_DEADLINE_BUFFER_DAYS,
  describeDeadlineRisk,
  getDeadlineRiskOrders,
} from "./deadline-risk"
import type { Order } from "@/types/order"

/**
 * 納期リスク注文カードのリスク判定・ソート（Issue #403）。
 * DB もレンダリングも不要な純粋関数なのでここで検証する。
 */

const TODAY = "2026-09-09"

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-001",
    product_id: 10,
    quantity: 1,
    status: "confirmed",
    customer_certainty: null,
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe("getDeadlineRiskOrders", () => {
  it("計画納期が顧客希望納期を超過している注文を拾う", () => {
    const orders = [
      makeOrder({
        id: 1,
        confirmed_deadline: "2026-09-20",
        desired_deadline: "2026-09-15",
      }),
    ]
    const rows = getDeadlineRiskOrders(orders, TODAY)

    expect(rows).toHaveLength(1)
    expect(rows[0].order.id).toBe(1)
    expect(rows[0].overrunDays).toBe(5)
    expect(rows[0].daysUntilDeadline).toBe(6)
  })

  it("計画は間に合うが顧客希望納期が今日・過去の注文を拾う（buffer 0）", () => {
    const orders = [
      makeOrder({
        id: 2,
        confirmed_deadline: "2026-09-08",
        desired_deadline: "2026-09-09", // 今日
      }),
      makeOrder({
        id: 3,
        confirmed_deadline: "2026-09-05",
        desired_deadline: "2026-09-07", // 過去
      }),
    ]
    const rows = getDeadlineRiskOrders(orders, TODAY)

    expect(rows.map((r) => r.order.id).sort()).toEqual([2, 3])
    for (const r of rows) expect(r.overrunDays).toBeLessThanOrEqual(0)
  })

  it("計画が間に合い顧客希望納期も先の注文は除外する", () => {
    const orders = [
      makeOrder({
        id: 4,
        confirmed_deadline: "2026-09-15",
        desired_deadline: "2026-09-30",
      }),
    ]
    expect(getDeadlineRiskOrders(orders, TODAY)).toEqual([])
  })

  it("対象ステータス（confirmed / in_progress）以外は除外する", () => {
    const base = {
      confirmed_deadline: "2026-09-20",
      desired_deadline: "2026-09-10",
    }
    const orders = [
      makeOrder({ id: 5, status: "confirmed", ...base }),
      makeOrder({ id: 6, status: "in_progress", ...base }),
      makeOrder({ id: 7, status: "pending_approval", ...base }),
      makeOrder({ id: 8, status: "shipped", ...base }),
      makeOrder({ id: 9, status: "draft", ...base }),
    ]
    const ids = getDeadlineRiskOrders(orders, TODAY).map((r) => r.order.id)

    expect(ids).toEqual(expect.arrayContaining([5, 6]))
    expect(ids).not.toContain(7)
    expect(ids).not.toContain(8)
    expect(ids).not.toContain(9)
  })

  it("confirmed_deadline / desired_deadline のいずれかが NULL・不正日付なら除外する", () => {
    const orders = [
      makeOrder({ id: 10, confirmed_deadline: undefined, desired_deadline: "2026-09-10" }),
      makeOrder({ id: 11, confirmed_deadline: "2026-09-20", desired_deadline: undefined }),
      makeOrder({ id: 12, confirmed_deadline: "2026-13-40", desired_deadline: "2026-09-10" }),
    ]
    expect(getDeadlineRiskOrders(orders, TODAY)).toEqual([])
  })

  it("超過日数の降順 → 顧客希望納期の昇順でソートする", () => {
    const orders = [
      makeOrder({ id: 20, confirmed_deadline: "2026-09-12", desired_deadline: "2026-09-10" }), // +2
      makeOrder({ id: 21, confirmed_deadline: "2026-09-20", desired_deadline: "2026-09-10" }), // +10
      makeOrder({ id: 22, confirmed_deadline: "2026-09-13", desired_deadline: "2026-09-05" }), // +8, 希望早い
      makeOrder({ id: 23, confirmed_deadline: "2026-09-16", desired_deadline: "2026-09-08" }), // +8, 希望遅い
    ]
    const ids = getDeadlineRiskOrders(orders, TODAY).map((r) => r.order.id)

    expect(ids).toEqual([21, 22, 23, 20])
  })

  it("buffer 日数を広げると残日数条件の対象が増える", () => {
    const orders = [
      makeOrder({
        id: 30,
        confirmed_deadline: "2026-09-10",
        desired_deadline: "2026-09-14", // 今日から5日先、計画は間に合う
      }),
    ]
    expect(getDeadlineRiskOrders(orders, TODAY, 0)).toEqual([])
    expect(getDeadlineRiskOrders(orders, TODAY, 7)).toHaveLength(1)
  })

  it("orders が undefined なら空配列", () => {
    expect(getDeadlineRiskOrders(undefined, TODAY)).toEqual([])
  })

  it("RISK_DEADLINE_BUFFER_DAYS の既定値は 0", () => {
    expect(RISK_DEADLINE_BUFFER_DAYS).toBe(0)
  })
})

describe("describeDeadlineRisk", () => {
  const row = (overrunDays: number, daysUntilDeadline: number) => ({
    order: makeOrder({}),
    overrunDays,
    daysUntilDeadline,
  })

  it("計画超過は「N日超過」で overrun", () => {
    expect(describeDeadlineRisk(row(5, 8))).toEqual({
      text: "5日超過",
      severity: "overrun",
    })
  })

  it("残日数が正なら「あとN日」で imminent", () => {
    expect(describeDeadlineRisk(row(0, 3))).toEqual({
      text: "あと3日",
      severity: "imminent",
    })
  })

  it("今日が希望納期なら専用文言で imminent", () => {
    expect(describeDeadlineRisk(row(0, 0))).toEqual({
      text: "本日が希望納期",
      severity: "imminent",
    })
  })

  it("希望納期が過去なら負値を出さず「N日前」で overrun", () => {
    expect(describeDeadlineRisk(row(-2, -4))).toEqual({
      text: "希望納期が4日前",
      severity: "overrun",
    })
  })
})

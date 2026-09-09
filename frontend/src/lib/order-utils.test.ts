import { describe, expect, it } from "vitest"
import type { Order } from "@/types/order"
import { filterOrder, isNoRoutingOrder } from "./order-utils"

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2026-09-30",
    status: "draft",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe("isNoRoutingOrder", () => {
  it("製品マッチ済み・工程なし・未シミュレーションの draft は true", () => {
    expect(isNoRoutingOrder(makeOrder({ has_no_routings: true }))).toBe(true)
  })

  it("has_no_routings が false/未設定なら false", () => {
    expect(isNoRoutingOrder(makeOrder({ has_no_routings: false }))).toBe(false)
    expect(isNoRoutingOrder(makeOrder({}))).toBe(false)
  })

  it("製品未マッチ（product_id === null）は対象外（製品未確定バッジ側で扱う）", () => {
    expect(
      isNoRoutingOrder(makeOrder({ has_no_routings: true, product_id: null })),
    ).toBe(false)
  })

  it("シミュレーション済み（is_scheduled）は対象外", () => {
    expect(
      isNoRoutingOrder(makeOrder({ has_no_routings: true, is_scheduled: true })),
    ).toBe(false)
  })

  it("draft 以外のステータスは対象外", () => {
    expect(
      isNoRoutingOrder(makeOrder({ has_no_routings: true, status: "confirmed" })),
    ).toBe(false)
  })
})

describe("filterOrder", () => {
  it("工程未入力は専用タブを設けず「下書き」タブに含める（設計方針 #215）", () => {
    const noRouting = makeOrder({ has_no_routings: true })
    expect(filterOrder(noRouting, "draft")).toBe(true)
  })
})

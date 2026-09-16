import { describe, expect, it } from "vitest"
import type { Order } from "@/types/order"
import { filterOrder, getOrderUrgency, isNoRoutingOrder } from "./order-utils"

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

describe("getOrderUrgency（Issue #461）", () => {
  // 2026-09-16 は水曜日。週の定義（日曜始まり）で今週は 09-13(日)〜09-19(土)。
  const TODAY = "2026-09-16"

  it("納期が当日〜過去（超過）なら today", () => {
    expect(
      getOrderUrgency(makeOrder({ desired_deadline: "2026-09-16" }), "", TODAY),
    ).toBe("today")
    expect(
      getOrderUrgency(makeOrder({ desired_deadline: "2026-09-10" }), "", TODAY),
    ).toBe("today")
  })

  it("納期が今日より後・今週中（土曜まで）なら this_week", () => {
    expect(
      getOrderUrgency(makeOrder({ desired_deadline: "2026-09-19" }), "", TODAY),
    ).toBe("this_week")
  })

  it("納期が来週以降なら next_week_or_later", () => {
    expect(
      getOrderUrgency(makeOrder({ desired_deadline: "2026-09-20" }), "", TODAY),
    ).toBe("next_week_or_later")
  })

  it("納期未設定なら unset", () => {
    expect(
      getOrderUrgency(makeOrder({ desired_deadline: undefined }), "", TODAY),
    ).toBe("unset")
  })

  it("shipped / completed / canceled は強調対象外（null）", () => {
    for (const status of ["shipped", "completed", "canceled"] as const) {
      expect(
        getOrderUrgency(
          makeOrder({ status, desired_deadline: "2026-09-16" }),
          "",
          TODAY,
        ),
      ).toBeNull()
    }
  })

  it("タブに応じた納期（シミュ納期／確定納期）を基準にする", () => {
    const order = makeOrder({
      status: "confirmed",
      desired_deadline: "2026-09-30",
      confirmed_deadline: "2026-09-16",
    })
    // "confirmed" タブは確定納期（当日）を基準に today
    expect(getOrderUrgency(order, "confirmed", TODAY)).toBe("today")
  })
})

describe("filterOrder", () => {
  it("工程未入力は専用タブを設けず「下書き」タブに含める（設計方針 #215）", () => {
    const noRouting = makeOrder({ has_no_routings: true })
    expect(filterOrder(noRouting, "draft")).toBe(true)
  })

  it("incomplete は顧客または希望納期が未設定の注文を通す（通知カード導線）", () => {
    expect(filterOrder(makeOrder({ customer_id: undefined }), "incomplete")).toBe(true)
    expect(filterOrder(makeOrder({ desired_deadline: undefined }), "incomplete")).toBe(true)
    expect(
      filterOrder(
        makeOrder({ customer_id: 1, desired_deadline: "2026-09-30" }),
        "incomplete",
      ),
    ).toBe(false)
  })

  describe("action_required（Issue #460）", () => {
    it("order_handler / iso_officer は下書き全般（未シミュレーション・シミュ済み）が対象", () => {
      const draft = makeOrder({ status: "draft", is_scheduled: false })
      const simulated = makeOrder({ status: "draft", is_scheduled: true })
      const pendingApproval = makeOrder({ status: "pending_approval" })
      for (const role of ["order_handler", "iso_officer"] as const) {
        expect(filterOrder(draft, "action_required", role)).toBe(true)
        expect(filterOrder(simulated, "action_required", role)).toBe(true)
        expect(filterOrder(pendingApproval, "action_required", role)).toBe(false)
      }
    })

    it("president は承認待ちのみ対象", () => {
      expect(
        filterOrder(makeOrder({ status: "pending_approval" }), "action_required", "president"),
      ).toBe(true)
      expect(
        filterOrder(makeOrder({ status: "draft" }), "action_required", "president"),
      ).toBe(false)
    })

    it("platform_admin は確定済みのみ対象", () => {
      expect(
        filterOrder(makeOrder({ status: "confirmed" }), "action_required", "platform_admin"),
      ).toBe(true)
      expect(
        filterOrder(
          makeOrder({ status: "pending_approval" }),
          "action_required",
          "platform_admin",
        ),
      ).toBe(false)
    })

    it("ロール未取得（null）は対象外", () => {
      expect(filterOrder(makeOrder({ status: "draft" }), "action_required", null)).toBe(false)
    })
  })
})

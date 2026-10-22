import { afterEach, describe, expect, it, vi } from "vitest"
import type { EmailIntakeResult, Order } from "@/types/order"
import {
  canApproveOrder,
  canRejectOrder,
  canShipWithoutRouting,
  canWithdrawApproval,
  compareApprovalRequests,
  countRecentFailedEmailIntakes,
  formatDateTimeShort,
  filterOrder,
  getIntakeCategory,
  getOrderUrgency,
  isNoRoutingOrder,
  jstTomorrowIso,
  matchesCustomerProductFilter,
  toValidMasterId,
} from "./order-utils"

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

describe("jstTomorrowIso（Issue #477）", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("JST の暦日の翌日を返す（UTC では前日の深夜でも JST 基準）", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    // UTC 2026-09-29 16:30 == JST 2026-09-30 01:30
    vi.setSystemTime(new Date("2026-09-29T16:30:00Z"))
    expect(jstTomorrowIso()).toBe("2026-10-01")
  })

  it("月末・年末をまたいでも正しく繰り上がる", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    // JST 2026-12-31 12:00
    vi.setSystemTime(new Date("2026-12-31T03:00:00Z"))
    expect(jstTomorrowIso()).toBe("2027-01-01")
  })
})

describe("matchesCustomerProductFilter / toValidMasterId（Issue #546）", () => {
  const order = (customer_id?: number, product_id?: number) =>
    ({ id: 1, customer_id, product_id }) as Order

  it("未指定（null）なら顧客・製品が無い注文も通す", () => {
    expect(matchesCustomerProductFilter(order(), null, null)).toBe(true)
  })

  it("顧客・製品は ID 一致で AND 判定する", () => {
    expect(matchesCustomerProductFilter(order(1, 10), 1, 10)).toBe(true)
    expect(matchesCustomerProductFilter(order(1, 10), 1, 11)).toBe(false)
    expect(matchesCustomerProductFilter(order(2, 10), 1, null)).toBe(false)
  })

  it("顧客不明・製品未照合の注文は指定中は通さない", () => {
    expect(matchesCustomerProductFilter(order(undefined, 10), 1, null)).toBe(false)
    expect(matchesCustomerProductFilter(order(1, undefined), null, 10)).toBe(false)
  })

  it("toValidMasterId は不正値・存在しない ID を null にする", () => {
    const ids = new Set([1, 2])
    expect(toValidMasterId("2", ids)).toBe(2)
    expect(toValidMasterId("3", ids)).toBeNull()
    expect(toValidMasterId("abc", ids)).toBeNull()
    expect(toValidMasterId("1.5")).toBeNull()
    expect(toValidMasterId("0")).toBeNull()
    expect(toValidMasterId("-1")).toBeNull()
    expect(toValidMasterId(null)).toBeNull()
    expect(toValidMasterId("7")).toBe(7)
  })
})

describe("getIntakeCategory（Issue #555）", () => {
  it("下書き以外は区分を持たない", () => {
    expect(getIntakeCategory(makeOrder({ status: "pending_approval", is_scheduled: true }))).toBeNull()
    expect(getIntakeCategory(makeOrder({ status: "confirmed" }))).toBeNull()
  })

  it("製品未確定を最優先にする（has_no_routings・情報不足より先）", () => {
    const order = makeOrder({
      product_id: null,
      has_no_routings: true,
      customer_id: undefined,
      desired_deadline: undefined,
    })
    expect(getIntakeCategory(order)).toBe("no_product")
  })

  it("工程未登録は情報不足より先。シミュ済でも has_no_routings なら工程未登録", () => {
    expect(getIntakeCategory(makeOrder({ has_no_routings: true, customer_id: undefined }))).toBe(
      "no_routing",
    )
    expect(getIntakeCategory(makeOrder({ has_no_routings: true, is_scheduled: true }))).toBe(
      "no_routing",
    )
  })

  it("顧客か希望納期が未設定なら情報不足（シミュ済でも）", () => {
    expect(getIntakeCategory(makeOrder({ customer_id: undefined }))).toBe("incomplete")
    expect(getIntakeCategory(makeOrder({ desired_deadline: undefined, is_scheduled: true }))).toBe(
      "incomplete",
    )
  })

  it("情報がそろっていれば is_scheduled でシミュ未実行／シミュ納期の確認に分ける", () => {
    expect(getIntakeCategory(makeOrder({ has_no_routings: false }))).toBe("unsimulated")
    expect(getIntakeCategory(makeOrder({ has_no_routings: false, is_scheduled: true }))).toBe(
      "simulated",
    )
  })

  it("修理注文は製品未確定・工程未登録に入れない", () => {
    const repair = makeOrder({
      order_type: "repair",
      product_id: null,
      quantity: null,
      has_no_routings: true,
    })
    expect(getIntakeCategory(repair)).toBe("unsimulated")
    expect(getIntakeCategory({ ...repair, is_scheduled: true })).toBe("simulated")
    expect(getIntakeCategory({ ...repair, customer_id: undefined })).toBe("incomplete")
  })

  it("差し戻された下書きは区分を変えない", () => {
    expect(
      getIntakeCategory(makeOrder({ is_scheduled: true, rejection_reason: "納期を確認してください" })),
    ).toBe("simulated")
    expect(getIntakeCategory(makeOrder({ product_id: null, rejection_reason: "製品違い" }))).toBe(
      "no_product",
    )
  })
})

describe("countRecentFailedEmailIntakes（Issue #555）", () => {
  function makeResult(overrides: Partial<EmailIntakeResult>): EmailIntakeResult {
    return {
      id: "att-1",
      received_at: "2026-10-20T00:00:00+00:00",
      customer_id: null,
      customer_name: null,
      original_filename: null,
      has_attachment: true,
      content_type: "application/pdf",
      parse_status: "failed_image",
      gmail_message_id: null,
      gmail_url: null,
      signed_url: null,
      created_order_count: 0,
      created_order_ids: [],
      parse_log_reasons: [],
      outcome: "failed",
      needs_attention: false,
      empty_draft: false,
      ...overrides,
    }
  }
  const now = new Date("2026-10-22T03:00:00+00:00")

  it("直近7日に受信した失敗だけを数える（起票・スキップ・7日より前は数えない）", () => {
    const results = [
      makeResult({ id: "a", received_at: "2026-10-22T01:00:00+00:00" }),
      makeResult({ id: "b", received_at: "2026-10-15T03:00:00+00:00" }), // ちょうど7日前
      makeResult({ id: "c", received_at: "2026-10-15T02:59:59+00:00" }),
      makeResult({ id: "d", outcome: "created" }),
      makeResult({ id: "e", outcome: "skipped" }),
    ]
    expect(countRecentFailedEmailIntakes(results, now)).toBe(2)
  })

  it("受信日時が解釈できない行は数えない", () => {
    expect(countRecentFailedEmailIntakes([makeResult({ received_at: "invalid" })], now)).toBe(0)
  })
})

describe("承認待ちの操作の権限（Issue #556）", () => {
  const pending = makeOrder({ status: "pending_approval" })

  it("承認・差し戻しは社長だけ（platform_admin を含めない）", () => {
    expect(canApproveOrder(pending, "president")).toBe(true)
    expect(canRejectOrder(pending, "president")).toBe(true)
    for (const role of ["platform_admin", "order_handler", "iso_officer", null] as const) {
      expect(canApproveOrder(pending, role)).toBe(false)
      expect(canRejectOrder(pending, role)).toBe(false)
    }
  })

  it("取り下げは受注担当だけ", () => {
    expect(canWithdrawApproval(pending, "order_handler")).toBe(true)
    for (const role of ["president", "platform_admin", "iso_officer", null] as const) {
      expect(canWithdrawApproval(pending, role)).toBe(false)
    }
  })

  it("承認待ち以外はどのロールも操作できない", () => {
    const draft = makeOrder({ status: "draft" })
    expect(canApproveOrder(draft, "president")).toBe(false)
    expect(canRejectOrder(draft, "president")).toBe(false)
    expect(canWithdrawApproval(draft, "order_handler")).toBe(false)
  })
})

describe("compareApprovalRequests（Issue #556）", () => {
  it("承認依頼の古い順。依頼日時が未設定・解釈できない注文は末尾で、同順位は ID 順", () => {
    const orders = [
      makeOrder({ id: 1, approval_requested_at: null }),
      makeOrder({ id: 2, approval_requested_at: "2026-09-02T00:00:00Z" }),
      makeOrder({ id: 3, approval_requested_at: "invalid" }),
      makeOrder({ id: 4, approval_requested_at: "2026-09-01T00:00:00Z" }),
      makeOrder({ id: 5, approval_requested_at: "2026-09-02T09:00:00+09:00" }),
    ]
    expect([...orders].sort(compareApprovalRequests).map((o) => o.id)).toEqual([4, 2, 5, 1, 3])
  })
})

describe("formatDateTimeShort（Issue #556）", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("JST の日時で、当年は年を省き、それ以外は2桁の年を付ける", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-22T03:00:00Z"))
    // UTC では前日でも JST の暦日で表示する
    expect(formatDateTimeShort("2026-10-21T15:30:00Z")).toBe("10/22 00:30")
    expect(formatDateTimeShort("2025-12-31T14:59:00Z")).toBe("25/12/31 23:59")
  })

  it("未設定・解釈できない値は null", () => {
    expect(formatDateTimeShort(null)).toBeNull()
    expect(formatDateTimeShort("invalid")).toBeNull()
  })
})

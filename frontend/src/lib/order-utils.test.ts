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
  getDeadlineColumnLabel,
  getDeadlineForTab,
  getIntakeCategory,
  getIntakeMissingFields,
  getOrderProductDisplayParts,
  getOrderProductName,
  getOrderUrgency,
  getRepairApprovalBlockReason,
  getRepairSubject,
  groupOrdersByProduct,
  isNoRoutingOrder,
  matchesOrderType,
  partitionOverdueBySimulatedDeadline,
  summarizeIntakeCategory,
  toValidIntakeCategory,
  jstTomorrowIso,
  matchesCustomerProductFilter,
  toValidMasterId,
  toValidOrderTypeFilter,
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

  it("「下書き」タブはシミュ済みの下書きも含める（Issue #558）", () => {
    expect(filterOrder(makeOrder({ is_scheduled: false }), "draft")).toBe(true)
    expect(filterOrder(makeOrder({ is_scheduled: true }), "draft")).toBe(true)
    expect(filterOrder(makeOrder({ status: "pending_approval" }), "draft")).toBe(false)
  })

  it("「すべて」は全ステータスを通す", () => {
    for (const status of ["draft", "pending_approval", "confirmed", "canceled"] as const) {
      expect(filterOrder(makeOrder({ status }), "")).toBe(true)
    }
  })
})

describe("納期カラム（Issue #558）", () => {
  it("「すべて」タブは見出しを「納期」にし、行ごとにシミュ納期／確定納期を出す", () => {
    expect(getDeadlineColumnLabel("")).toBe("納期")
    const draft = makeOrder({ status: "draft", simulated_deadline: "2026-09-20" })
    const confirmed = makeOrder({
      status: "confirmed",
      simulated_deadline: "2026-09-20",
      confirmed_deadline: "2026-09-25",
    })
    expect(getDeadlineForTab(draft, "")).toBe("2026-09-20")
    expect(getDeadlineForTab(confirmed, "")).toBe("2026-09-25")
  })

  it("ステータスのタブはタブに合わせて出し分ける", () => {
    expect(getDeadlineColumnLabel("draft")).toBe("シミュ納期")
    expect(getDeadlineColumnLabel("confirmed")).toBe("確定納期")
    const confirmed = makeOrder({ status: "confirmed", confirmed_deadline: "2026-09-25" })
    expect(getDeadlineForTab(confirmed, "confirmed")).toBe("2026-09-25")
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

describe("getIntakeCategory（Issue #654）", () => {
  it("下書き以外は区分を持たない", () => {
    expect(getIntakeCategory(makeOrder({ status: "pending_approval", is_scheduled: true }))).toBeNull()
    expect(getIntakeCategory(makeOrder({ status: "confirmed" }))).toBeNull()
  })

  it("差し戻しは他の問題があっても差し戻しに入れる", () => {
    expect(
      getIntakeCategory(makeOrder({ is_scheduled: true, rejection_reason: "納期を確認してください" })),
    ).toBe("rejected")
    expect(
      getIntakeCategory(
        makeOrder({ product_id: null, has_no_routings: true, rejection_reason: "製品違い" }),
      ),
    ).toBe("rejected")
    expect(
      getIntakeCategory(makeOrder({ has_no_routings: true, rejection_reason: "工程を確認" })),
    ).toBe("rejected")
  })

  it("空白だけの差し戻し理由は差し戻しとみなさない", () => {
    expect(getIntakeCategory(makeOrder({ rejection_reason: "  " }))).toBe("ready_to_request")
    expect(getIntakeCategory(makeOrder({ rejection_reason: null }))).toBe("ready_to_request")
  })

  it("製品・数量・顧客・希望納期のどれかが無ければ入力を直す（工程の登録待ちより先）", () => {
    expect(getIntakeCategory(makeOrder({ product_id: null, has_no_routings: true }))).toBe(
      "needs_input",
    )
    expect(getIntakeCategory(makeOrder({ quantity: null }))).toBe("needs_input")
    expect(getIntakeCategory(makeOrder({ has_no_routings: true, customer_id: undefined }))).toBe(
      "needs_input",
    )
    expect(getIntakeCategory(makeOrder({ desired_deadline: undefined, is_scheduled: true }))).toBe(
      "needs_input",
    )
  })

  it("入力がそろっていて工程が無ければ工程の登録待ち（シミュ済でも）", () => {
    expect(getIntakeCategory(makeOrder({ has_no_routings: true }))).toBe("waiting_routing")
    expect(getIntakeCategory(makeOrder({ has_no_routings: true, is_scheduled: true }))).toBe(
      "waiting_routing",
    )
  })

  it("入力と工程がそろっていれば、完成見込みの有無にかかわらず承認依頼を送る", () => {
    expect(getIntakeCategory(makeOrder({ has_no_routings: false }))).toBe("ready_to_request")
    expect(getIntakeCategory(makeOrder({ has_no_routings: false, is_scheduled: true }))).toBe(
      "ready_to_request",
    )
  })

  it("修理等は製品・数量・工程を見ない", () => {
    const repair = makeOrder({
      order_type: "repair",
      product_id: null,
      quantity: null,
      has_no_routings: true,
    })
    expect(getIntakeCategory(repair)).toBe("ready_to_request")
    expect(getIntakeCategory({ ...repair, customer_id: undefined })).toBe("needs_input")
    expect(getIntakeMissingFields({ ...repair, customer_id: undefined })).toEqual(["customer"])
  })
})

describe("summarizeIntakeCategory（Issue #654）", () => {
  it("入力を直すは足りない項目ごとの件数（1件が複数の項目に数えられる）", () => {
    const orders = [
      makeOrder({ product_id: null, customer_id: undefined }),
      makeOrder({ customer_id: undefined }),
    ]
    expect(summarizeIntakeCategory("needs_input", orders)).toEqual({
      text: "製品 1件・顧客 2件",
      isAlert: false,
    })
  })

  it("承認依頼を送るは希望納期に間に合わない件数・完成見込みが無い件数。間に合わない注文があれば強調する", () => {
    const orders = [
      makeOrder({ is_scheduled: true, simulated_deadline: "2026-10-05" }),
      makeOrder({ is_scheduled: true, simulated_deadline: "2026-09-20" }),
      makeOrder({ is_scheduled: false }),
    ]
    expect(summarizeIntakeCategory("ready_to_request", orders)).toEqual({
      text: "希望納期に間に合わない 1件・完成見込みなし 1件",
      isAlert: true,
    })
    expect(summarizeIntakeCategory("ready_to_request", [orders[1]])).toBeNull()
  })

  it("工程の登録待ちは製品の数", () => {
    const orders = [
      makeOrder({ id: 1, product_id: 10 }),
      makeOrder({ id: 2, product_id: 20 }),
      makeOrder({ id: 3, product_id: 10 }),
    ]
    expect(summarizeIntakeCategory("waiting_routing", orders)).toEqual({
      text: "2製品",
      isAlert: false,
    })
  })

  it("0件・差し戻しは内訳を持たない", () => {
    expect(summarizeIntakeCategory("needs_input", [])).toBeNull()
    expect(summarizeIntakeCategory("rejected", [makeOrder({ rejection_reason: "x" })])).toBeNull()
  })
})

describe("groupOrdersByProduct（Issue #654）", () => {
  it("製品ごとにまとめ、最初に出てきた順に並べる", () => {
    const groups = groupOrdersByProduct([
      makeOrder({ id: 1, product_id: 20 }),
      makeOrder({ id: 2, product_id: 10 }),
      makeOrder({ id: 3, product_id: 20 }),
    ])
    expect(groups.map((g) => [g.productId, g.orders.map((o) => o.id)])).toEqual([
      [20, [1, 3]],
      [10, [2]],
    ])
  })
})

describe("toValidIntakeCategory（Issue #654）", () => {
  const counts = { rejected: 0, needs_input: 0, ready_to_request: 3, waiting_routing: 1 }

  it("既知の区分のハッシュはそのまま使う（0件でも）", () => {
    expect(toValidIntakeCategory("#waiting_routing", counts)).toBe("waiting_routing")
    expect(toValidIntakeCategory("#needs_input", counts)).toBe("needs_input")
  })

  it("未指定・不正な値なら件数のある最初の区分にする", () => {
    expect(toValidIntakeCategory("", counts)).toBe("ready_to_request")
    expect(toValidIntakeCategory("#unknown", counts)).toBe("ready_to_request")
    expect(toValidIntakeCategory("#unknown", { ...counts, rejected: 1 })).toBe("rejected")
  })

  it("0件で隠れた差し戻しは指せない", () => {
    expect(toValidIntakeCategory("#rejected", counts)).toBe("ready_to_request")
    expect(toValidIntakeCategory("#rejected", { ...counts, rejected: 2 })).toBe("rejected")
  })

  it("どの区分も0件なら入力を直す", () => {
    expect(
      toValidIntakeCategory("", {
        rejected: 0,
        needs_input: 0,
        ready_to_request: 0,
        waiting_routing: 0,
      }),
    ).toBe("needs_input")
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

describe("修理等の注文（Issue #494）", () => {
  const repair = makeOrder({
    order_type: "repair",
    product_id: null,
    quantity: null,
    work_description: "\n  部品の補修  \n・補修部1〜3ヶ所 ×11枚",
  })

  describe("toValidOrderTypeFilter", () => {
    it("既知の値はそのまま返す", () => {
      expect(toValidOrderTypeFilter("production")).toBe("production")
      expect(toValidOrderTypeFilter("repair")).toBe("repair")
    })

    it("未指定・未知の値は生産にクランプする", () => {
      expect(toValidOrderTypeFilter(null)).toBe("production")
      expect(toValidOrderTypeFilter("")).toBe("production")
      expect(toValidOrderTypeFilter("maintenance")).toBe("production")
      expect(toValidOrderTypeFilter("REPAIR")).toBe("production")
    })
  })

  describe("matchesOrderType", () => {
    it("order_type 未指定は生産として扱う", () => {
      expect(matchesOrderType(makeOrder(), "production")).toBe(true)
      expect(matchesOrderType(makeOrder(), "repair")).toBe(false)
    })

    it("修理等は修理の一覧にだけ当たる", () => {
      expect(matchesOrderType(repair, "repair")).toBe(true)
      expect(matchesOrderType(repair, "production")).toBe(false)
    })
  })

  describe("getRepairSubject / 品名の表示", () => {
    it("work_description の先頭の空でない行を件名にする", () => {
      expect(getRepairSubject(repair)).toBe("部品の補修")
      expect(getOrderProductName(repair)).toBe("部品の補修")
      expect(getOrderProductDisplayParts(repair)).toEqual({
        primary: "部品の補修",
        secondary: null,
        unresolved: false,
      })
    })

    it("件名が空なら代替の表示にする", () => {
      expect(getRepairSubject(makeOrder({ order_type: "repair", work_description: null }))).toBe(
        "（件名なし）",
      )
    })

    it("生産は従来どおり製品名を返す", () => {
      expect(getOrderProductName(makeOrder({ product_id: null }))).toBe("不明")
    })
  })

  describe("getRepairApprovalBlockReason", () => {
    it("実施開始日と完了予定日の両方が揃うまで理由を返す", () => {
      expect(getRepairApprovalBlockReason(repair)).toBe(
        "実施開始日と完了予定日を入力すると承認依頼できます",
      )
      expect(
        getRepairApprovalBlockReason({ ...repair, scheduling_start_date: "2026-10-01" }),
      ).toBe("完了予定日を入力すると承認依頼できます")
      expect(
        getRepairApprovalBlockReason({ ...repair, simulated_deadline: "2026-10-05" }),
      ).toBe("実施開始日を入力すると承認依頼できます")
    })

    it("両方入っていれば null（承認依頼できる）", () => {
      expect(
        getRepairApprovalBlockReason({
          ...repair,
          scheduling_start_date: "2026-10-01",
          simulated_deadline: "2026-10-05",
        }),
      ).toBeNull()
    })
  })

  it("修理等は工程未入力・工程未入力の例外送品の対象にならない", () => {
    const noRouting = { ...repair, has_no_routings: true }
    expect(isNoRoutingOrder(noRouting)).toBe(false)
    expect(canShipWithoutRouting(noRouting, "president")).toBe(false)
  })
})

describe("partitionOverdueBySimulatedDeadline (Issue #617)", () => {
  it("シミュ納期が希望納期を超える注文を先頭に寄せ、それぞれの順序は保つ", () => {
    const orders = [
      makeOrder({ id: 1, desired_deadline: "2026-12-03", simulated_deadline: "2026-10-13" }),
      makeOrder({ id: 2, desired_deadline: "2026-10-01", simulated_deadline: "2026-10-05" }),
      makeOrder({ id: 3, desired_deadline: undefined, simulated_deadline: "2026-10-05" }),
      makeOrder({ id: 4, desired_deadline: "2026-10-01", simulated_deadline: "2026-10-09" }),
    ]
    const { sorted, overdueCount } = partitionOverdueBySimulatedDeadline(orders)
    expect(sorted.map((o) => o.id)).toEqual([2, 4, 1, 3])
    expect(overdueCount).toBe(2)
    expect(orders.map((o) => o.id)).toEqual([1, 2, 3, 4])
  })

  it("超過が無ければ件数0で順序もそのまま", () => {
    const orders = [makeOrder({ id: 1 }), makeOrder({ id: 2 })]
    const { sorted, overdueCount } = partitionOverdueBySimulatedDeadline(orders)
    expect(sorted.map((o) => o.id)).toEqual([1, 2])
    expect(overdueCount).toBe(0)
  })
})

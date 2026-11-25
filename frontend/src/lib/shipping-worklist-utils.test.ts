import { describe, expect, it } from "vitest"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { Order } from "@/types/order"
import type {
  ShipmentEntryRef,
  ShipmentOrderMatch,
  ShipmentOrderReview,
  ShipmentOrderReviewList,
  ShipmentUnmatchedGroup,
  ShipmentUnmatchedList,
  ShipmentUnmatchedStatus,
} from "@/types/shipment"
import {
  classifyShippingWorklist,
  formatWorkCount,
  isAwaitingYayoiImport,
  orderConfirmRows,
  placeShippingOrder,
  type ShippingWorklist,
} from "./shipping-worklist-utils"
import { buildShippingRow } from "./shipping-candidate-utils"

const TODAY = "2026-11-25"
// 納期まで7日以上（②に当たらない）
const FAR = "2026-12-31"

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: FAR,
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

function makeProcess(overrides: Partial<ProcessProgress>): ProcessProgress {
  return {
    order_id: 1,
    process_routing_id: 1,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: 0,
    order_quantity: 10,
    first_actual_date: null,
    last_actual_date: null,
    status: "not_started",
    completed_by: null,
    planned_end_datetime: null,
    ...overrides,
  }
}

function makeEntry(id: number): ShipmentEntryRef {
  return {
    id,
    sales_date: "2026-11-10",
    slip_no: null,
    quantity: 5,
    note: null,
    product_name: null,
    method: null,
    candidate_order_ids: [],
  }
}

function makeMatch(orderId: number, shippedQty: number, overrides: Partial<ShipmentOrderMatch> = {}) {
  const orderQuantity = overrides.order_quantity ?? 10
  return {
    order_id: orderId,
    shipped_qty: shippedQty,
    order_quantity: orderQuantity,
    is_fully_shipped: shippedQty >= orderQuantity,
    last_sales_date: "2026-11-10",
    entries: shippedQty > 0 ? [makeEntry(orderId * 100)] : [],
    ambiguous_entries: [],
    ...overrides,
  } satisfies ShipmentOrderMatch
}

function makeReview(orderId: number, overrides: Partial<ShipmentOrderReview> = {}): ShipmentOrderReview {
  return {
    order_id: orderId,
    product_id: 1,
    cause: "missing_report",
    shipped_qty: 10,
    last_sales_date: "2026-11-10",
    final_process_name: "検査",
    final_good_qty: 0,
    unallocated_qty: 0,
    process_names: [],
    ...overrides,
  }
}

function reviewList(items: ShipmentOrderReview[]): ShipmentOrderReviewList {
  return {
    computed_at: null,
    counts: { no_routing: 0, process_mismatch: 0, customer_or_stock: 0, missing_report: items.length },
    items,
  }
}

function makeGroup(
  status: ShipmentUnmatchedStatus,
  customerCode: string,
  productCode: string,
  overrides: Partial<ShipmentUnmatchedGroup> = {},
): ShipmentUnmatchedGroup {
  return {
    status,
    customer_code: customerCode,
    customer_code_key: customerCode,
    customer_name: null,
    product_code: productCode,
    product_code_key: productCode,
    product_name: null,
    latest_note: null,
    entry_count: 1,
    total_qty: 5,
    last_sales_date: "2026-11-10",
    customer_ids: [],
    product_ids: [],
    note_deadlines: [],
    candidate_order_ids: [],
    ...overrides,
  }
}

function unmatchedList(items: ShipmentUnmatchedGroup[], truncated = false): ShipmentUnmatchedList {
  const counts = { unmatched_customer: 0, unmatched_product: 0, no_order: 0, ambiguous: 0 }
  items.forEach((g) => (counts[g.status] += 1))
  return { latest_sales_date: "2026-11-10", since: "2026-09-12", counts, truncated, items }
}

/** どの注文・明細も1か所にだけ置かれているか（日報の参考は重ねてよいので数えない） */
function expectEachPlacedOnce(worklist: ShippingWorklist, orders: Order[], groups: ShipmentUnmatchedGroup[]) {
  const orderIds = [...worklist.ship, ...worklist.confirm, ...worklist.excludedOrders].map(
    (o) => o.order.id,
  )
  expect(new Set(orderIds).size).toBe(orderIds.length)
  expect(new Set(orderIds)).toEqual(
    new Set(orders.filter((o) => ["confirmed", "in_progress"].includes(o.status)).map((o) => o.id)),
  )
  const placedGroups = [
    ...worklist.register,
    ...worklist.prerequisite.customer,
    ...worklist.prerequisite.product,
    ...worklist.prerequisite.ambiguous,
  ]
  expect(placedGroups).toHaveLength(groups.length)
  expect(new Set(placedGroups)).toEqual(new Set(groups))
}

describe("placeShippingOrder", () => {
  const place = (order: Order, processes?: ProcessProgress[], shipment?: ShipmentOrderMatch) =>
    placeShippingOrder(buildShippingRow(order, processes, TODAY, shipment))

  it("弥生の送品数量が受注数量に達したら①", () => {
    expect(place(makeOrder({}), undefined, makeMatch(1, 10))).toBe("ship")
  })

  it("最終工程完了・納期超過・納期まで7日未満のどれかなら②", () => {
    const done = [makeProcess({ status: "completed", completed_by: "quantity" })]
    expect(place(makeOrder({}), done)).toBe("confirm")
    expect(place(makeOrder({ desired_deadline: "2026-11-24" }))).toBe("confirm")
    expect(place(makeOrder({ desired_deadline: "2026-12-01" }))).toBe("confirm")
  })

  it("どれにも当たらなければ対象外（分納の途中だけでは②にしない）", () => {
    expect(place(makeOrder({}))).toBe("excluded")
    expect(place(makeOrder({}), undefined, makeMatch(1, 4))).toBe("excluded")
    // 納期まで7日ちょうどは「7日未満」に入らない
    expect(place(makeOrder({ desired_deadline: "2026-12-02" }))).toBe("excluded")
  })

  it("①と②の両方に当たるときは①を優先する", () => {
    const done = [makeProcess({ status: "completed", completed_by: "quantity" })]
    expect(place(makeOrder({ desired_deadline: "2026-11-01" }), done, makeMatch(1, 10))).toBe("ship")
  })
})

describe("classifyShippingWorklist", () => {
  it("確定済・生産中の注文だけを①②・対象外に振り分け、下書き・承認待ち・送品済みは出さない", () => {
    const orders = [
      makeOrder({ id: 1 }),
      makeOrder({ id: 2, status: "in_progress", desired_deadline: "2026-11-20" }),
      makeOrder({ id: 3 }),
      makeOrder({ id: 4, status: "draft", desired_deadline: "2026-11-20" }),
      makeOrder({ id: 5, status: "pending_approval" }),
      makeOrder({ id: 6, status: "shipped" }),
    ]
    const worklist = classifyShippingWorklist({
      orders,
      shipmentMatches: [makeMatch(1, 10), makeMatch(4, 10)],
      todayIso: TODAY,
    })
    expect(worklist.ship.map((o) => o.order.id)).toEqual([1])
    expect(worklist.confirm.map((o) => o.order.id)).toEqual([2])
    expect(worklist.excludedOrders.map((o) => o.order.id)).toEqual([3])
    expect(worklist.counts).toMatchObject({ ship: 1, confirm: 1, excluded: 1 })
    expectEachPlacedOnce(worklist, orders, [])
  })

  it("①かつ日報が追いついていない注文は①に置き、日報の印を付けて参考にも重ねる", () => {
    const orders = [makeOrder({ id: 1, desired_deadline: "2026-11-01" })]
    const review = makeReview(1)
    const worklist = classifyShippingWorklist({
      orders,
      shipmentMatches: [makeMatch(1, 10)],
      orderReviews: reviewList([review]),
      todayIso: TODAY,
    })
    expect(worklist.ship).toHaveLength(1)
    expect(worklist.ship[0].marks.dailyReport).toEqual(review)
    expect(worklist.ship[0].marks.partialShippedQty).toBeNull()
    expect(worklist.dailyReportOrders.map((o) => o.order.id)).toEqual([1])
    expect(worklist.counts.dailyReport).toBe(1)
    expectEachPlacedOnce(worklist, orders, [])
  })

  it("②かつ分納の途中の注文は②に置き、弥生の数量の印を付ける", () => {
    const orders = [makeOrder({ id: 1, desired_deadline: "2026-11-20" })]
    const worklist = classifyShippingWorklist({
      orders,
      shipmentMatches: [makeMatch(1, 4)],
      orderReviews: reviewList([makeReview(1, { shipped_qty: 4, cause: "customer_or_stock" })]),
      todayIso: TODAY,
    })
    expect(worklist.confirm).toHaveLength(1)
    expect(worklist.confirm[0].marks.partialShippedQty).toBe(4)
    expect(worklist.confirm[0].marks.dailyReport?.cause).toBe("customer_or_stock")
    expect(worklist.ship).toHaveLength(0)
  })

  it("弥生に計上が無い②の注文には分納の印を付けない", () => {
    const worklist = classifyShippingWorklist({
      orders: [makeOrder({ id: 1, desired_deadline: "2026-11-20" })],
      shipmentMatches: [],
      todayIso: TODAY,
    })
    expect(worklist.confirm[0].marks).toEqual({
      dailyReport: null,
      partialShippedQty: null,
      ambiguousEntryCount: 0,
    })
  })

  it("対象外の注文が日報の参考に当たっても、置き場所は対象外のまま（参考には重ねる）", () => {
    const orders = [makeOrder({ id: 1 })]
    const worklist = classifyShippingWorklist({
      orders,
      shipmentMatches: [makeMatch(1, 4)],
      orderReviews: reviewList([makeReview(1, { shipped_qty: 4 })]),
      todayIso: TODAY,
    })
    expect(worklist.excludedOrders.map((o) => o.order.id)).toEqual([1])
    expect(worklist.dailyReportOrders.map((o) => o.order.id)).toEqual([1])
    expectEachPlacedOnce(worklist, orders, [])
  })

  it("弥生の明細を突合の状態で前提・③に振り分ける", () => {
    const groups = [
      makeGroup("unmatched_customer", "C1", "P1"),
      makeGroup("unmatched_customer", "C1", "P2"),
      makeGroup("unmatched_customer", "C2", "P1"),
      makeGroup("unmatched_product", "C3", "P1"),
      makeGroup("no_order", "C4", "P1", { note_deadlines: ["2026-11-10", "2026-11-20"] }),
      makeGroup("ambiguous", "C5", "P1", { candidate_order_ids: [1, 2] }),
    ]
    const worklist = classifyShippingWorklist({
      orders: [],
      unmatchedEntries: unmatchedList(groups),
      todayIso: TODAY,
    })
    expect(worklist.register).toEqual([groups[4]])
    expect(worklist.prerequisite.customer).toEqual(groups.slice(0, 3))
    expect(worklist.prerequisite.product).toEqual([groups[3]])
    expect(worklist.prerequisite.ambiguous).toEqual([groups[5]])
    // ③は (得意先, 商品コード) のまとまりで数える（納期分ごとに分けない）
    expect(worklist.counts.register).toBe(1)
    // 得意先は得意先の数、商品・受注の見分けはまとまりの数
    expect(worklist.counts.prerequisite).toEqual({ customer: 2, product: 1, ambiguous: 1 })
    expectEachPlacedOnce(worklist, [], groups)
  })

  it("受注が区別できない明細は前提にだけ置き、候補の注文の行には件数の印だけを付ける", () => {
    const orders = [
      makeOrder({ id: 1, desired_deadline: "2026-11-20" }),
      makeOrder({ id: 2 }),
    ]
    const ambiguous = makeGroup("ambiguous", "C1", "P1", { candidate_order_ids: [1, 2] })
    const entry = { ...makeEntry(9), candidate_order_ids: [1, 2] }
    const worklist = classifyShippingWorklist({
      orders,
      shipmentMatches: [
        makeMatch(1, 0, { ambiguous_entries: [entry] }),
        makeMatch(2, 0, { ambiguous_entries: [entry] }),
      ],
      unmatchedEntries: unmatchedList([ambiguous]),
      todayIso: TODAY,
    })
    expect(worklist.prerequisite.ambiguous).toEqual([ambiguous])
    expect(worklist.register).toEqual([])
    // 候補の注文は自分の条件で②・対象外に置かれ、印だけが付く
    expect(worklist.confirm.map((o) => [o.order.id, o.marks.ambiguousEntryCount])).toEqual([[1, 1]])
    expect(worklist.excludedOrders.map((o) => [o.order.id, o.marks.ambiguousEntryCount])).toEqual([
      [2, 1],
    ])
    expectEachPlacedOnce(worklist, orders, [ambiguous])
  })

  it("弥生の明細・日報の参考が届いていない間は、その件数を null にする", () => {
    const worklist = classifyShippingWorklist({ orders: [makeOrder({})], todayIso: TODAY })
    expect(worklist.counts.register).toBeNull()
    expect(worklist.counts.prerequisite).toBeNull()
    expect(worklist.counts.dailyReport).toBeNull()
    expect(worklist.counts.excluded).toBe(1)
  })

  it("弥生の明細が上限で切られていたら truncated を返す", () => {
    const worklist = classifyShippingWorklist({
      orders: [],
      unmatchedEntries: unmatchedList([makeGroup("no_order", "C1", "P1")], true),
      todayIso: TODAY,
    })
    expect(worklist.truncated).toBe(true)
  })

  it("①②の並びは送品の候補と同じ（①の中・②の中で納期の古い順）", () => {
    const orders = [
      makeOrder({ id: 1, desired_deadline: "2026-11-22" }),
      makeOrder({ id: 2, desired_deadline: "2026-11-10" }),
      makeOrder({ id: 3, desired_deadline: "2026-11-30" }),
      makeOrder({ id: 4, desired_deadline: "2026-11-05" }),
    ]
    const worklist = classifyShippingWorklist({
      orders,
      shipmentMatches: [makeMatch(3, 10), makeMatch(1, 10)],
      todayIso: TODAY,
    })
    expect(worklist.ship.map((o) => o.order.id)).toEqual([1, 3])
    expect(worklist.confirm.map((o) => o.order.id)).toEqual([4, 2])
  })
})

describe("formatWorkCount（Issue #692）", () => {
  it("単位を付け、取得中は「－」、失敗は「取得できませんでした」、上限で切られたら「以上」", () => {
    expect(formatWorkCount({ value: 3, isError: false }, "注文")).toBe("3注文")
    expect(formatWorkCount({ value: 3, isError: false, atLeast: true }, "商品")).toBe("3商品以上")
    expect(formatWorkCount({ value: null, isError: false }, "注文")).toBe("－")
    expect(formatWorkCount({ value: 3, isError: true }, "注文")).toBe("取得できませんでした")
  })
})

describe("②の取り込み待ち（Issue #693）", () => {
  const LATEST = "2026-11-10"

  it("弥生に計上が無く、納期が最新の売上日より後なら取り込み待ち", () => {
    expect(isAwaitingYayoiImport({ deadline: "2026-11-11", shipment: null }, LATEST)).toBe(true)
    expect(
      isAwaitingYayoiImport({ deadline: "2026-11-11", shipment: makeMatch(1, 0) }, LATEST),
    ).toBe(true)
  })

  it("納期が最新の売上日以前・分納の途中・納期が無い・未取り込みなら取り込み待ちにしない", () => {
    expect(isAwaitingYayoiImport({ deadline: LATEST, shipment: null }, LATEST)).toBe(false)
    expect(
      isAwaitingYayoiImport({ deadline: "2026-11-30", shipment: makeMatch(1, 3) }, LATEST),
    ).toBe(false)
    expect(isAwaitingYayoiImport({ deadline: null, shipment: null }, LATEST)).toBe(false)
    expect(isAwaitingYayoiImport({ deadline: "2026-11-30", shipment: null }, null)).toBe(false)
  })

  it("取り込み待ちを後ろへ回し、それぞれの中の並びと行数を保つ", () => {
    const rows = [
      { id: 1, deadline: "2026-11-01", shipment: null },
      { id: 2, deadline: "2026-11-20", shipment: null },
      { id: 3, deadline: "2026-11-05", shipment: null },
      { id: 4, deadline: "2026-11-28", shipment: null },
    ]
    expect(orderConfirmRows(rows, LATEST).map((r) => r.id)).toEqual([1, 3, 2, 4])
    expect(orderConfirmRows(rows, null).map((r) => r.id)).toEqual([1, 2, 3, 4])
  })
})

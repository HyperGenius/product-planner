import { describe, expect, it } from "vitest"
import { render, screen } from "@/test-utils/render"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"
import type { Schedule } from "@/types/schedule"
import { ShipmentScheduleList, groupSchedulesByShipmentDate } from "./ShipmentScheduleList"

const customers: Customer[] = [
  { id: 1, name: "顧客A", status: "active", tenant_id: "t1", created_at: "", updated_at: "" },
  { id: 2, name: "顧客B", status: "active", tenant_id: "t1", created_at: "", updated_at: "" },
]

/**
 * 現場ダッシュボードの出荷予定表エリア（Issue #443）のユニットテスト。
 */

const products: Product[] = [
  {
    id: 1,
    name: "製品A",
    code: "P-001",
    is_active: true,
    has_process: true,
    has_unconfirmed_process: false,
    tenant_id: "t1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
]

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    quantity: 10,
    status: "confirmed",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  }
}

function makeSchedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: 1,
    order_id: 1,
    process_routing_id: 1,
    equipment_id: 1,
    start_datetime: "2026-09-10T00:00:00Z",
    end_datetime: "2026-09-10T05:00:00Z",
    ...overrides,
  }
}

describe("groupSchedulesByShipmentDate", () => {
  it("同一注文内で end_datetime が最も遅い工程（最終工程）の完了日でグループ化する", () => {
    const orders = [makeOrder({ id: 1, quantity: 7 })]
    const schedules = [
      makeSchedule({
        id: 1,
        order_id: 1,
        end_datetime: "2026-09-10T05:00:00Z",
        equipment_name: "設備1",
      }),
      makeSchedule({
        id: 2,
        order_id: 1,
        end_datetime: "2026-09-12T05:00:00Z", // こちらが最終工程
        equipment_name: "設備2",
      }),
    ]

    const groups = groupSchedulesByShipmentDate(schedules, orders, products)

    expect(groups).toHaveLength(1)
    expect(groups[0].dateIso).toBe("2026-09-12")
    expect(groups[0].rows[0].equipmentName).toBe("設備2")
    expect(groups[0].rows[0].quantity).toBe(7)
  })

  it("confirmed / in_progress 以外の注文（一致する場合）は除外する", () => {
    const orders = [
      makeOrder({ id: 1, status: "confirmed" }),
      makeOrder({ id: 2, status: "shipped" }),
    ]
    const schedules = [
      makeSchedule({ id: 1, order_id: 1 }),
      makeSchedule({ id: 2, order_id: 2 }),
    ]

    const groups = groupSchedulesByShipmentDate(schedules, orders, products)

    const orderIds = groups.flatMap((g) => g.rows.map((r) => r.orderId))
    expect(orderIds).toEqual([1])
  })

  it("一致する注文が無い場合はスケジュール側の非正規化データで表示する", () => {
    const schedules = [
      makeSchedule({
        id: 1,
        order_id: 999,
        product_name: "非正規化製品",
        equipment_name: "設備9",
      }),
    ]

    const groups = groupSchedulesByShipmentDate(schedules, undefined, products)

    expect(groups[0].rows[0].productPrimary).toBe("非正規化製品")
    expect(groups[0].rows[0].quantity).toBeNull()
  })

  it("UTC日付境界を跨ぐ end_datetime は JST の暦日でグループ化する", () => {
    const orders = [makeOrder({ id: 1 })]
    const schedules = [
      // UTC では 9/10 だが JST(+9) では 9/11 0:30
      makeSchedule({ id: 1, order_id: 1, end_datetime: "2026-09-10T15:30:00Z" }),
    ]

    const groups = groupSchedulesByShipmentDate(schedules, orders, products)

    expect(groups).toHaveLength(1)
    expect(groups[0].dateIso).toBe("2026-09-11")
  })

  it("日付が異なる複数注文は別セクションになり、日付昇順に並ぶ", () => {
    const orders = [makeOrder({ id: 1 }), makeOrder({ id: 2 })]
    const schedules = [
      makeSchedule({ id: 1, order_id: 1, end_datetime: "2026-09-12T05:00:00Z" }),
      makeSchedule({ id: 2, order_id: 2, end_datetime: "2026-09-10T05:00:00Z" }),
    ]

    const groups = groupSchedulesByShipmentDate(schedules, orders, products)

    expect(groups.map((g) => g.dateIso)).toEqual(["2026-09-10", "2026-09-12"])
  })

  it("検索語（顧客名・製品名・注文番号）で絞り込む", () => {
    const orders = [
      makeOrder({ id: 1, customer_id: 1, order_no: "O-100" }),
      makeOrder({ id: 2, customer_id: 2, order_no: "O-200" }),
    ]
    const schedules = [
      makeSchedule({ id: 1, order_id: 1, end_datetime: "2026-09-10T05:00:00Z" }),
      makeSchedule({ id: 2, order_id: 2, end_datetime: "2026-09-10T05:00:00Z" }),
    ]

    const groups = groupSchedulesByShipmentDate(schedules, orders, products, customers, {
      searchText: "O-200",
      overdueOnly: false,
    })

    const orderIds = groups.flatMap((g) => g.rows.map((r) => r.orderId))
    expect(orderIds).toEqual([2])
  })

  it("「納期遅れのみ」フィルタで納期超過の注文だけに絞り込む", () => {
    const orders = [
      makeOrder({ id: 1, confirmed_deadline: "2026-09-08" }), // 超過
      makeOrder({ id: 2, confirmed_deadline: "2026-09-20" }), // 予定通り
    ]
    const schedules = [
      makeSchedule({ id: 1, order_id: 1, end_datetime: "2026-09-10T05:00:00Z" }),
      makeSchedule({ id: 2, order_id: 2, end_datetime: "2026-09-10T05:00:00Z" }),
    ]

    const groups = groupSchedulesByShipmentDate(
      schedules,
      orders,
      products,
      customers,
      { searchText: "", overdueOnly: true },
      "2026-09-10",
    )

    const orderIds = groups.flatMap((g) => g.rows.map((r) => r.orderId))
    expect(orderIds).toEqual([1])
  })
})

describe("ShipmentScheduleList", () => {
  it("読み込み中はローディング表示", () => {
    render(
      <ShipmentScheduleList schedules={undefined} orders={undefined} products={products} isLoading />,
    )
    expect(screen.getByText("読み込み中…")).toBeInTheDocument()
  })

  it("スケジュールが無ければ空表示", () => {
    render(
      <ShipmentScheduleList schedules={[]} orders={[]} products={products} isLoading={false} />,
    )
    expect(screen.getByText("出荷予定はありません")).toBeInTheDocument()
  })

  it("製品名・設備名・計画数量を表示する", () => {
    const orders = [makeOrder({ id: 1, product_id: 1, quantity: 5 })]
    const schedules = [
      makeSchedule({
        id: 1,
        order_id: 1,
        end_datetime: "2026-09-10T05:00:00Z",
        equipment_name: "設備1",
      }),
    ]

    render(
      <ShipmentScheduleList schedules={schedules} orders={orders} products={products} isLoading={false} />,
    )

    expect(screen.getByText("製品A")).toBeInTheDocument()
    expect(screen.getByText("設備1")).toBeInTheDocument()
    expect(screen.getByText(/数量\s*5/)).toBeInTheDocument()
  })

  it("実績「未報告」バッジは Phase 1 では表示しない（Issue #450）", () => {
    const orders = [makeOrder({ id: 1, product_id: 1, quantity: 5 })]
    const schedules = [
      makeSchedule({
        id: 1,
        order_id: 1,
        end_datetime: "2026-09-10T05:00:00Z",
        equipment_name: "設備1",
      }),
    ]

    render(
      <ShipmentScheduleList schedules={schedules} orders={orders} products={products} isLoading={false} />,
    )

    expect(screen.queryByText("実績未報告")).not.toBeInTheDocument()
  })
})

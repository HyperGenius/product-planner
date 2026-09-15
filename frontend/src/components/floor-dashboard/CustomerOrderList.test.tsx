import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test-utils/render"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"
import type { OrderSearchFilters } from "@/lib/floor-dashboard-utils"
import { CustomerOrderList, groupOrdersByCustomer } from "./CustomerOrderList"

const NO_FILTERS: OrderSearchFilters = { searchText: "", overdueOnly: false }
const TODAY_ISO = "2026-09-10"

/**
 * 現場ダッシュボードの顧客別受注情報エリア（Issue #442）のユニットテスト。
 * 「今日」判定は JST 基準のため、UTC 深夜をまたぐ時刻でシステム時刻を固定する
 * （`use-floor-dashboard-metrics.test.ts` と同じ方針）。
 */

const NOW_UTC = new Date("2026-09-09T15:30:00Z") // JST 2026-09-10 00:30

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

const customers: Customer[] = [
  { id: 1, name: "顧客A", status: "active", tenant_id: "t1", created_at: "", updated_at: "" },
  { id: 2, name: "顧客B", status: "active", tenant_id: "t1", created_at: "", updated_at: "" },
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_UTC)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("groupOrdersByCustomer", () => {
  it("confirmed / in_progress のみを対象に顧客ごとにグループ化する", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, status: "confirmed" }),
      makeOrder({ id: 2, customer_id: 1, status: "in_progress" }),
      makeOrder({ id: 3, customer_id: 2, status: "confirmed" }),
      makeOrder({ id: 4, customer_id: 1, status: "draft" }),
      makeOrder({ id: 5, customer_id: 1, status: "shipped" }),
    ]

    const groups = groupOrdersByCustomer(orders, products, customers, NO_FILTERS, TODAY_ISO)

    expect(groups).toHaveLength(2)
    expect(groups[0].customerName).toBe("顧客A")
    expect(groups[0].orders.map((o) => o.id)).toEqual([1, 2])
    expect(groups[1].customerName).toBe("顧客B")
    expect(groups[1].orders.map((o) => o.id)).toEqual([3])
  })

  it("顧客未設定の注文は「顧客未設定」グループにまとめる", () => {
    const orders: Order[] = [makeOrder({ id: 1, customer_id: undefined, status: "confirmed" })]

    const groups = groupOrdersByCustomer(orders, products, customers, NO_FILTERS, TODAY_ISO)

    expect(groups).toHaveLength(1)
    expect(groups[0].customerName).toBe("顧客未設定")
  })

  it("グループ内は納期の早い順（納期未設定は末尾）に並ぶ", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, confirmed_deadline: "2026-09-20" }),
      makeOrder({ id: 2, customer_id: 1, confirmed_deadline: "2026-09-10" }),
      makeOrder({ id: 3, customer_id: 1 }), // 納期未設定
      makeOrder({ id: 4, customer_id: 1, confirmed_deadline: "2026-09-15" }),
    ]

    const groups = groupOrdersByCustomer(orders, products, customers, NO_FILTERS, TODAY_ISO)

    expect(groups[0].orders.map((o) => o.id)).toEqual([2, 4, 1, 3])
  })
})

describe("CustomerOrderList", () => {
  it("読み込み中はローディング表示", () => {
    render(
      <CustomerOrderList orders={undefined} products={products} customers={customers} isLoading filters={NO_FILTERS} />,
    )
    expect(screen.getByText("読み込み中…")).toBeInTheDocument()
  })

  it("受注中の注文が無ければ空表示", () => {
    render(
      <CustomerOrderList orders={[]} products={products} customers={customers} isLoading={false} filters={NO_FILTERS} />,
    )
    expect(screen.getByText("受注中の注文はありません")).toBeInTheDocument()
  })

  it("製品名・数量・納期・納期状態バッジを表示する", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, product_id: 1, quantity: 5, confirmed_deadline: "2026-09-08" }), // 超過
    ]

    render(
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={false}
        filters={NO_FILTERS}
      />,
    )

    expect(screen.getByText("顧客A")).toBeInTheDocument()
    expect(screen.getByText("P-001")).toBeInTheDocument()
    expect(screen.getByText("製品A")).toBeInTheDocument()
    expect(screen.getByText(/5\s*個/)).toBeInTheDocument()
    expect(screen.getByText(/09\/08/)).toBeInTheDocument()
  })

  it("納期超過の注文は納期バッジが赤背景になり、残り日数ラベルは表示しない", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, product_id: 1, quantity: 5, confirmed_deadline: "2026-09-08" }), // 超過
    ]

    render(
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={false}
        filters={NO_FILTERS}
      />,
    )

    expect(screen.getByText(/09\/08/).closest("span")).toHaveClass("bg-red-600")
    expect(screen.queryByText("予定通り")).not.toBeInTheDocument()
    expect(screen.queryByText(/^残り/)).not.toBeInTheDocument()
  })

  it("予定通りの注文は残り日数ラベル「予定通り」を表示する", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, product_id: 1, quantity: 5, confirmed_deadline: "2026-09-20" }),
    ]

    render(
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={false}
        filters={NO_FILTERS}
      />,
    )

    expect(screen.getByText("予定通り")).toBeInTheDocument()
  })

  it("数量はカンマ区切り、納期は翌年のみ年を追加表示する", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, product_id: 1, quantity: 1234, confirmed_deadline: "2027-01-05" }),
    ]

    render(
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={false}
        filters={NO_FILTERS}
      />,
    )

    expect(screen.getByText(/1,234\s*個/)).toBeInTheDocument()
    expect(screen.getByText(/2027\/01\/05/)).toBeInTheDocument()
  })

  it("製品未確定の注文は extracted_product_name にフォールバックする", () => {
    const orders: Order[] = [
      makeOrder({
        id: 1,
        customer_id: 1,
        product_id: null,
        extracted_product_name: "抽出製品X",
      }),
    ]

    render(
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={false}
        filters={NO_FILTERS}
      />,
    )

    expect(screen.getByText("抽出製品X（製品未確定）")).toBeInTheDocument()
  })

  it("検索語（顧客名・製品名・注文番号）で絞り込む", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, order_no: "O-100", product_id: 1 }),
      makeOrder({ id: 2, customer_id: 2, order_no: "O-200", product_id: 1 }),
    ]

    render(
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={false}
        filters={{ searchText: "O-200", overdueOnly: false }}
      />,
    )

    expect(screen.getByText("顧客B")).toBeInTheDocument()
    expect(screen.queryByText("顧客A")).not.toBeInTheDocument()
  })

  it("「納期遅れのみ」フィルタで納期超過の注文だけに絞り込む", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, customer_id: 1, confirmed_deadline: "2026-09-08" }), // 超過
      makeOrder({ id: 2, customer_id: 2, confirmed_deadline: "2026-09-20" }), // 予定通り
    ]

    render(
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={false}
        filters={{ searchText: "", overdueOnly: true }}
      />,
    )

    expect(screen.getByText("顧客A")).toBeInTheDocument()
    expect(screen.queryByText("顧客B")).not.toBeInTheDocument()
  })
})

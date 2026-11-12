import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { ShipmentCustomerItem, ShipmentProductItem } from "@/types/shipment"
import { ShipmentNameMatching } from "./shipment-name-matching"

/**
 * 弥生の名寄せ（Issue #667）。得意先・商品はダミー値（実データを含めない）。
 * 顧客は MSW 既定の sampleCustomers（1: テスト顧客A / 2: テスト顧客B）、製品は sampleProducts（1: テスト製品A）
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/shipment-names",
}))

function customerItem(overrides: Partial<ShipmentCustomerItem>): ShipmentCustomerItem {
  return {
    customer_code: "001",
    code_key: "001",
    customer_name: "架空商事",
    entry_count: 3,
    last_sales_date: "2026-10-20",
    links: [],
    auto_customer_id: null,
    ignored_id: null,
    name_candidate_ids: [],
    flow_candidates: [],
    unmatched_entry_count: 0,
    ...overrides,
  }
}

function productItem(overrides: Partial<ShipmentProductItem>): ShipmentProductItem {
  return {
    customer_code: "001",
    customer_code_key: "001",
    customer_name: "架空商事",
    product_code: "ab1",
    product_code_key: "AB1",
    product_name: "品名サンプル",
    entry_count: 2,
    last_sales_date: "2026-10-20",
    customer_ids: [1],
    link: null,
    auto_product_id: null,
    auto_method: null,
    ignored_id: null,
    customer_ignored: false,
    candidate_product_ids: [],
    cross_customer_candidates: [],
    ...overrides,
  }
}

function mockRole(role: string) {
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () => HttpResponse.json({ user_id: "u1", role })),
  )
}

function recordWrites() {
  const writes: { method: string; path: string; body: unknown }[] = []
  server.use(
    http.all(`${API_BASE}/shipments/:kind`, async ({ request, params }) => {
      if (request.method === "GET") return undefined
      writes.push({ method: request.method, path: String(params.kind), body: await request.json() })
      return HttpResponse.json({ id: "x" }, { status: request.method === "POST" ? 201 : 200 })
    }),
  )
  return writes
}

describe("ShipmentNameMatching", () => {
  it("未照合の得意先だけを既定で出し、すべてに切り替えると照合済みも出す", async () => {
    mockRole("order_handler")
    server.use(
      http.get(`${API_BASE}/shipments/customers`, () =>
        HttpResponse.json([
          customerItem({ code_key: "001", customer_name: "未照合商事" }),
          customerItem({ code_key: "002", customer_code: "002", customer_name: "自動工業", auto_customer_id: 1 }),
        ]),
      ),
    )
    const user = userEvent.setup()
    render(<ShipmentNameMatching />)

    expect(await screen.findByText("未照合商事")).toBeInTheDocument()
    expect(screen.queryByText("自動工業")).toBeNull()
    expect(screen.getByRole("tab", { name: "得意先（未照合 1）" })).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "すべて" }))
    expect(await screen.findByText("自動工業")).toBeInTheDocument()
    expect(screen.getByText("（得意先名で自動）")).toBeInTheDocument()
  })

  it("商流の推定の候補を押すと、得意先にその顧客をひも付ける（1つの得意先に複数の顧客）", async () => {
    mockRole("president")
    server.use(
      http.get(`${API_BASE}/shipments/customers`, () =>
        HttpResponse.json([
          customerItem({
            links: [{ id: "l1", customer_id: 1 }],
            flow_candidates: [{ customer_id: 2, entry_count: 5 }],
          }),
        ]),
      ),
    )
    const writes = recordWrites()
    const user = userEvent.setup()
    render(<ShipmentNameMatching />)

    await user.click(await screen.findByRole("tab", { name: "すべて" }))
    const row = (await screen.findByText("架空商事")).closest("tr")!
    expect(within(row).getByText("テスト顧客A")).toBeInTheDocument()
    await user.click(within(row).getByRole("button", { name: /テスト顧客B.*商流の推定・5行/ }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({
      method: "POST",
      path: "customer-links",
      body: { customer_code: "001", customer_id: 2 },
    })
  })

  it("商品は対象外にでき、別の顧客の受注にある製品の候補を選ぶと得意先の顧客と製品を両方登録する", async () => {
    mockRole("order_handler")
    server.use(
      http.get(`${API_BASE}/shipments/products`, () =>
        HttpResponse.json([
          productItem({
            cross_customer_candidates: [{ product_id: 1, customer_ids: [2] }],
          }),
          productItem({ product_code: "fee", product_code_key: "FEE", product_name: "送料" }),
        ]),
      ),
    )
    const writes = recordWrites()
    const user = userEvent.setup()
    render(<ShipmentNameMatching />)

    await user.click(await screen.findByRole("tab", { name: "商品（未照合 2）" }))
    const fee = (await screen.findByText("送料")).closest("tr")!
    await user.click(within(fee).getByRole("button", { name: "対象外にする" }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({
      method: "POST",
      path: "ignored",
      body: { kind: "product", customer_code: "001", product_code: "fee" },
    })

    const row = screen.getByText("品名サンプル").closest("tr")!
    await user.click(within(row).getByRole("button", { name: /テスト製品A/ }))
    await waitFor(() => expect(writes).toHaveLength(3))
    expect(writes[1]).toEqual({
      method: "POST",
      path: "customer-links",
      body: { customer_code: "001", customer_id: 2 },
    })
    expect(writes[2]).toEqual({
      method: "PUT",
      path: "product-links",
      body: { customer_code: "001", product_code: "ab1", product_id: 1 },
    })
  })

  it("編集できないロールには操作を出さない", async () => {
    mockRole("iso_officer")
    server.use(
      http.get(`${API_BASE}/shipments/customers`, () => HttpResponse.json([customerItem({})])),
    )
    render(<ShipmentNameMatching />)

    expect(await screen.findByText("架空商事")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "対象外にする" })).toBeNull()
  })
})

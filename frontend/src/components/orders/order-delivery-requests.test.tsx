import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import userEvent from "@testing-library/user-event"
import { render, screen, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { OrderDeliveryRequest } from "@/types/order-delivery-request"
import { OrderDeliveryRequests } from "./order-delivery-requests"

const ORDER_ID = 1000001

function request(overrides: Partial<OrderDeliveryRequest> = {}): OrderDeliveryRequest {
  return {
    id: "r1",
    order_id: ORDER_ID,
    kind: "delivery_chase",
    extracted_product_name: "テスト製品A",
    quantity: 500,
    requested_date: "2026-11-03",
    body_snippet: "納期遅れ分の解消をお願いします",
    resolved_at: null,
    created_at: "2026-11-01T01:00:00Z",
    ...overrides,
  }
}

function respond(body: OrderDeliveryRequest[]) {
  server.use(http.get(`${API_BASE}/orders/${ORDER_ID}/delivery-requests`, () => HttpResponse.json(body)))
}

describe("OrderDeliveryRequests", () => {
  it("依頼が無い受注では何も描画しない", async () => {
    respond([])
    const { container } = render(<OrderDeliveryRequests orderId={ORDER_ID} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it("種別・希望日・数量・本文の抜粋を表示する", async () => {
    respond([request()])
    render(<OrderDeliveryRequests orderId={ORDER_ID} />)

    expect(await screen.findByText("督促")).toBeInTheDocument()
    expect(screen.getByText("希望日: 11月3日")).toBeInTheDocument()
    expect(screen.getByText("500個")).toBeInTheDocument()
    expect(screen.getByText("納期遅れ分の解消をお願いします")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "対応済みにする" })).toBeInTheDocument()
  })

  it("分納の依頼は種別ラベルが変わる", async () => {
    respond([request({ kind: "split_delivery" })])
    render(<OrderDeliveryRequests orderId={ORDER_ID} />)
    expect(await screen.findByText("分納の依頼")).toBeInTheDocument()
  })

  it("「対応済みにする」で resolved=true を送る", async () => {
    respond([request()])
    let sent: unknown = null
    server.use(
      http.patch(`${API_BASE}/orders/delivery-requests/r1`, async ({ request: req }) => {
        sent = await req.json()
        return HttpResponse.json(request({ resolved_at: "2026-11-02T00:00:00Z" }))
      }),
    )
    render(<OrderDeliveryRequests orderId={ORDER_ID} />)

    await userEvent.click(await screen.findByRole("button", { name: "対応済みにする" }))

    await waitFor(() => expect(sent).toEqual({ resolved: true }))
  })

  it("対応済みの依頼は「未対応に戻す」を出す", async () => {
    respond([request({ resolved_at: "2026-11-02T00:00:00Z" })])
    render(<OrderDeliveryRequests orderId={ORDER_ID} />)
    expect(await screen.findByRole("button", { name: "未対応に戻す" })).toBeInTheDocument()
  })
})

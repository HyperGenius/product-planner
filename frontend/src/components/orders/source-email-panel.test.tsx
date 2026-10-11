import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order, OrderAttachment } from "@/types/order"
import { SourceEmailPanel } from "./source-email-panel"

const ORDER_ID = 1000001

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    order_no: null,
    product_id: 1,
    customer_id: undefined,
    quantity: 10,
    desired_deadline: "2026-09-30",
    status: "draft",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "email",
    source_raw: "",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function attachment(parseStatus: OrderAttachment["parse_status"]): OrderAttachment {
  return {
    id: "att-1",
    order_id: ORDER_ID,
    storage_path: "t1/orders/1000001/fax.pdf",
    original_filename: "fax.pdf",
    content_type: "application/pdf",
    size_bytes: 1234,
    parse_status: parseStatus,
    signed_url: "https://example.com/fax.pdf",
    created_at: "2026-10-10T00:00:00Z",
  }
}

function respond(attachments: OrderAttachment[]) {
  server.use(
    http.get(`${API_BASE}/orders/${ORDER_ID}/attachments`, () => HttpResponse.json(attachments))
  )
}

describe("SourceEmailPanel", () => {
  it("画像PDFから読み取った添付は、ファイルへのリンクと確認を促す注意書きを出す（Issue #520）", async () => {
    respond([attachment("success_image")])
    render(<SourceEmailPanel order={makeOrder()} />)

    const link = await screen.findByRole("link", { name: "fax.pdf" })
    expect(link).toHaveAttribute("href", "https://example.com/fax.pdf")
    expect(screen.getByText(/画像から自動読み取り/)).toBeInTheDocument()
  })

  it("テキストPDFから読み取った添付には注意書きを出さない", async () => {
    respond([attachment("success")])
    render(<SourceEmailPanel order={makeOrder()} />)

    await screen.findByRole("link", { name: "fax.pdf" })
    expect(screen.queryByText(/画像から自動読み取り/)).not.toBeInTheDocument()
  })
})

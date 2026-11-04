import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, userEvent, waitFor } from "@/test-utils/render";
import { server } from "@/test-utils/msw/server";
import { API_BASE } from "@/test-utils/msw/handlers";
import type { OpenDeliveryRequestListItem } from "@/types/order-delivery-request";
import DeliveryRequestsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/delivery-requests",
}));

function makeRequest(
  overrides: Partial<OpenDeliveryRequestListItem>,
): OpenDeliveryRequestListItem {
  return {
    id: "r1",
    order_id: 5,
    kind: "delivery_chase",
    extracted_product_name: null,
    quantity: null,
    requested_date: null,
    body_snippet: "至急お願いします",
    resolved_at: null,
    created_at: "2026-11-01T00:00:00+00:00",
    order_number: "O-5",
    customer_name: "顧客A",
    ...overrides,
  };
}

describe("DeliveryRequestsPage", () => {
  it("紐づけ済みは受注へのリンク、未紐づけはその旨を表示する", async () => {
    server.use(
      http.get(`${API_BASE}/orders/delivery-requests`, () =>
        HttpResponse.json([
          makeRequest({}),
          makeRequest({
            id: "r2",
            order_id: null,
            order_number: null,
            kind: "split_delivery",
          }),
        ]),
      ),
    );
    render(<DeliveryRequestsPage />);
    const link = await screen.findByRole("link", { name: "O-5" });
    expect(link).toHaveAttribute("href", "/orders/5");
    expect(screen.getByText("未紐づけ")).toBeInTheDocument();
  });

  it("対応済みにするとPATCHを送る", async () => {
    let body: unknown = null;
    server.use(
      http.get(`${API_BASE}/orders/delivery-requests`, () =>
        HttpResponse.json([makeRequest({})]),
      ),
      http.patch(
        `${API_BASE}/orders/delivery-requests/r1`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(
            makeRequest({ resolved_at: "2026-11-02T00:00:00+00:00" }),
          );
        },
      ),
    );
    render(<DeliveryRequestsPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "対応済みにする" }),
    );
    await waitFor(() => expect(body).toEqual({ resolved: true }));
  });

  it("依頼が無いときは空表示", async () => {
    render(<DeliveryRequestsPage />);
    expect(
      await screen.findByText("未対応の依頼はありません"),
    ).toBeInTheDocument();
  });
});

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
    order_quantity: null,
    desired_deadline: null,
    confirmed_deadline: null,
    simulated_deadline: null,
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

  it("紐づけ済みは依頼の中身と受注の現状・進捗を表示し、未紐づけは受注側を空にする", async () => {
    server.use(
      http.get(`${API_BASE}/orders/delivery-requests`, () =>
        HttpResponse.json([
          makeRequest({
            extracted_product_name: "製品A",
            quantity: 500,
            requested_date: "2026-11-10",
            order_quantity: 200,
            desired_deadline: "2020-01-01",
            confirmed_deadline: "2026-11-20",
          }),
          makeRequest({
            id: "r2",
            order_id: null,
            order_number: null,
            extracted_product_name: "製品B",
          }),
        ]),
      ),
      http.get(`${API_BASE}/daily-reports/order-progress`, () =>
        HttpResponse.json({
          computed_at: null,
          items: [
            {
              order_id: 5,
              process_routing_id: 1,
              sequence_order: 2,
              process_name: "検査",
              good_qty: 80,
              order_quantity: 200,
              first_actual_date: null,
              last_actual_date: null,
              status: "in_progress",
              completed_by: null,
              planned_end_datetime: null,
            },
          ],
        }),
      ),
    );
    render(<DeliveryRequestsPage />);
    expect(await screen.findByText("製品A")).toBeInTheDocument();
    expect(screen.getByText(/数量: 500/)).toBeInTheDocument();
    expect(screen.getByText(/要望日: 11月10日/)).toBeInTheDocument();
    expect(screen.getByText(/日超過/)).toBeInTheDocument();
    expect(screen.getByText(/完成見込み: 11月20日/)).toBeInTheDocument();
    expect(await screen.findByText(/検査 80 \/ 200/)).toBeInTheDocument();
    // 未紐づけの行は受注側が空表示（「－」）
    expect(screen.getByText("未紐づけ")).toBeInTheDocument();
    expect(screen.getAllByText(/希望納期:/)).toHaveLength(1);
  });

  it("超過日数の多い順に並べ替えられる", async () => {
    server.use(
      http.get(`${API_BASE}/orders/delivery-requests`, () =>
        HttpResponse.json([
          makeRequest({ id: "r1", extracted_product_name: "新しい依頼", desired_deadline: "2999-01-01" }),
          makeRequest({ id: "r2", extracted_product_name: "古い納期", desired_deadline: "2020-01-01" }),
        ]),
      ),
    );
    render(<DeliveryRequestsPage />);
    await screen.findByText("新しい依頼");
    await userEvent.click(screen.getByRole("button", { name: "超過日数の多い順" }));
    const names = screen.getAllByText(/新しい依頼|古い納期/).map((e) => e.textContent);
    expect(names).toEqual(["古い納期", "新しい依頼"]);
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

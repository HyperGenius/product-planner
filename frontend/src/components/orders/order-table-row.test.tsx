import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test-utils/render"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Table, TableBody } from "@/components/ui/table"
import type { Order } from "@/types/order"
import { OrderTableRow } from "./order-table-row"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))

/**
 * `quantity` が null のドラフト受注を含む一覧でクラッシュしないことのリグレッションテスト（Issue #414）。
 * メール起票で数量を抽出できなかった場合、`orders.quantity` は 0 ではなく null で保存される。
 */

function makeOrder(overrides: Partial<Order>): Order {
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
    source_type: "email",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

const rowProps = {
  statusFilter: "draft" as const,
  products: [],
  customers: [],
  isSimulating: false,
  hasSimulationError: false,
  requestApprovalIsPending: false,
  approveIsPending: false,
  withdrawIsPending: false,
  shipIsPending: false,
  currentUserRole: "order_handler",
  isSelected: false,
  isBulkOperationInProgress: false,
  onSimulate: vi.fn(),
  onRequestApproval: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onWithdraw: vi.fn(),
  onShip: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleSelect: vi.fn(),
}

function renderRow(order: Order) {
  return render(
    <TooltipProvider>
      <Table>
        <TableBody>
          <OrderTableRow order={order} {...rowProps} />
        </TableBody>
      </Table>
    </TooltipProvider>,
  )
}

describe("OrderTableRow", () => {
  it("quantity が数値なら 3 桁区切りで表示する", () => {
    renderRow(makeOrder({ quantity: 1234 }))

    expect(screen.getByText("1,234")).toBeInTheDocument()
  })

  it("quantity が null でもクラッシュせず「未設定」を表示する", () => {
    renderRow(makeOrder({ quantity: null }))

    // 数量セルの「未設定」プレースホルダ（顧客・希望納期セルと同じ表現）
    expect(screen.getByText("未設定")).toBeInTheDocument()
  })

  describe("工程未入力（has_no_routings）— Issue #406", () => {
    it("製品マッチ済み・工程なしの draft に「工程未入力・起票不可」バッジを出す", () => {
      renderRow(makeOrder({ has_no_routings: true, source_type: "manual" }))

      expect(screen.getByText("工程未入力・起票不可")).toBeInTheDocument()
    })

    it("製品未マッチ（product_id === null）ではバッジを出さない（二重表示を防ぐ）", () => {
      renderRow(
        makeOrder({ has_no_routings: true, product_id: null, source_type: "manual" }),
      )

      expect(screen.queryByText("工程未入力・起票不可")).not.toBeInTheDocument()
    })

    it("工程なしの手動 draft はシミュレーション実行ボタンを disabled にする", () => {
      renderRow(makeOrder({ has_no_routings: true, source_type: "manual" }))

      expect(
        screen.getByRole("button", { name: "シミュレーション実行" }),
      ).toBeDisabled()
    })

    it("工程がある手動 draft のシミュレーション実行ボタンは押下可能", () => {
      renderRow(makeOrder({ has_no_routings: false, source_type: "manual" }))

      expect(
        screen.getByRole("button", { name: "シミュレーション実行" }),
      ).toBeEnabled()
    })
  })

  describe("緊急度による行の背景色（Issue #461）", () => {
    function renderRowWithProps(
      order: Order,
      props: Partial<React.ComponentProps<typeof OrderTableRow>> = {},
    ) {
      return render(
        <TooltipProvider>
          <Table>
            <TableBody>
              <OrderTableRow order={order} {...rowProps} {...props} />
            </TableBody>
          </Table>
        </TooltipProvider>,
      )
    }

    it("納期超過（today）の行は赤系の背景色になる", () => {
      const { container } = renderRowWithProps(
        makeOrder({ desired_deadline: "2020-01-01", source_type: "manual" }),
      )
      expect(container.querySelector("tr")).toHaveClass("bg-red-50")
    })

    it("shipped / completed / canceled は納期超過でも強調しない", () => {
      const { container } = renderRowWithProps(
        makeOrder({
          status: "shipped",
          desired_deadline: "2020-01-01",
          source_type: "manual",
        }),
      )
      expect(container.querySelector("tr")).not.toHaveClass("bg-red-50")
    })

    it("バルクシミュレーション失敗行の強調は緊急度より優先される", () => {
      const { container } = renderRowWithProps(
        makeOrder({ desired_deadline: "2020-01-01", source_type: "manual" }),
        { hasBulkSimFailed: true },
      )
      const row = container.querySelector("tr")
      expect(row).toHaveClass("bg-destructive/5")
      expect(row).not.toHaveClass("bg-red-50")
    })
  })
})

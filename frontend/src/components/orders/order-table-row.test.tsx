import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, userEvent } from "@/test-utils/render"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Table, TableBody } from "@/components/ui/table"
import type { Order } from "@/types/order"
import { OrderTableRow, type OrderTableRowProps } from "./order-table-row"

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
  onShipWithoutRouting: vi.fn(),
  onConvertToRepair: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleSelect: vi.fn(),
  onView: vi.fn(),
}

function renderRow(
  order: Order,
  props: Partial<typeof rowProps> &
    Pick<OrderTableRowProps, "visibleActions" | "showActionColumns"> = {},
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

describe("OrderTableRow", () => {
  describe("工程未入力の下書きの送品済み化（Issue #547）", () => {
    const LABEL = "送品済みにする（工程未入力の例外処理）"

    async function openMenu() {
      await userEvent.click(screen.getByRole("button", { name: "メニューを開く" }))
    }

    it("president × 工程未入力の下書きならメニューに表示し、クリックで onShipWithoutRouting を呼ぶ", async () => {
      const onShipWithoutRouting = vi.fn()
      const order = makeOrder({ has_no_routings: true })
      renderRow(order, { currentUserRole: "president", onShipWithoutRouting })

      await openMenu()
      await userEvent.click(await screen.findByText(LABEL))

      expect(onShipWithoutRouting).toHaveBeenCalledWith(order)
    })

    it.each(["order_handler", "iso_officer", "platform_admin"])(
      "%s には表示しない",
      async (role) => {
        renderRow(makeOrder({ has_no_routings: true }), { currentUserRole: role })

        await openMenu()

        expect(screen.queryByText(LABEL)).not.toBeInTheDocument()
      },
    )

    it("工程が入力済みの下書きには表示しない", async () => {
      renderRow(makeOrder({ has_no_routings: false }), { currentUserRole: "president" })

      await openMenu()

      expect(screen.queryByText(LABEL)).not.toBeInTheDocument()
    })

    it("下書き以外には表示しない", async () => {
      renderRow(makeOrder({ has_no_routings: true, status: "pending_approval" }), {
        currentUserRole: "president",
      })

      await openMenu()

      expect(screen.queryByText(LABEL)).not.toBeInTheDocument()
    })
  })

  describe("修理等への変更（Issue #568）", () => {
    const LABEL = "修理等に変更"

    async function openMenu() {
      await userEvent.click(screen.getByRole("button", { name: "メニューを開く" }))
    }

    it("生産の下書きならメニューに表示し、クリックで onConvertToRepair を呼ぶ", async () => {
      const onConvertToRepair = vi.fn()
      const order = makeOrder({ product_id: null })
      renderRow(order, { onConvertToRepair })

      await openMenu()
      await userEvent.click(await screen.findByText(LABEL))

      expect(onConvertToRepair).toHaveBeenCalledWith(order)
    })

    it("修理等の注文には表示しない", async () => {
      renderRow(makeOrder({ order_type: "repair", product_id: null, quantity: null }))

      await openMenu()

      expect(screen.queryByText(LABEL)).not.toBeInTheDocument()
    })

    it("下書き以外には表示しない", async () => {
      renderRow(makeOrder({ status: "pending_approval" }), { currentUserRole: "president" })

      await openMenu()

      expect(screen.queryByText(LABEL)).not.toBeInTheDocument()
    })

    it("visibleActions に含めない画面では表示しない", async () => {
      renderRow(makeOrder({}), { visibleActions: ["edit", "delete"] })

      await openMenu()

      expect(screen.queryByText(LABEL)).not.toBeInTheDocument()
    })
  })

  it("quantity が数値なら 3 桁区切りで表示する", () => {
    renderRow(makeOrder({ quantity: 1234 }))

    expect(screen.getByText("1,234")).toBeInTheDocument()
  })

  it("quantity が null でもクラッシュせず「未設定」を表示する", () => {
    renderRow(makeOrder({ quantity: null }))

    // 数量セルの「未設定」プレースホルダ（顧客・希望納期セルと同じ表現）
    expect(screen.getByText("未設定")).toBeInTheDocument()
  })

  it("メール取り込みで顧客を特定できなかった受注は「顧客不明」と表示する（Issue #521）", () => {
    renderRow(makeOrder({ customer_id: undefined, source_type: "email" }))

    expect(screen.getByText("顧客不明")).toBeInTheDocument()
  })

  it("手入力で顧客が未設定の受注は従来どおり「未設定」と表示する", () => {
    renderRow(makeOrder({ customer_id: undefined, source_type: "manual" }))

    expect(screen.getByText("未設定")).toBeInTheDocument()
    expect(screen.queryByText("顧客不明")).not.toBeInTheDocument()
  })

  describe("顧客側の確度バッジ（Issue #474）", () => {
    it("確度が NULL（判定できなかった受注）なら確度バッジを出さない", () => {
      renderRow(makeOrder({ customer_certainty: null }))

      expect(screen.queryByText("内々示")).not.toBeInTheDocument()
      expect(screen.queryByText("内示")).not.toBeInTheDocument()
      expect(screen.queryByText("－")).not.toBeInTheDocument()
    })

    it("内々示の受注には確度バッジを出す", () => {
      renderRow(makeOrder({ customer_certainty: "forecast_tentative" }))

      expect(screen.getByText("内々示")).toBeInTheDocument()
    })
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

  describe("行のクリックで確認モーダルを開く（Issue #527 / #558）", () => {
    function renderViewableRow(order: Order) {
      const onView = vi.fn()
      const onDelete = vi.fn()
      const utils = render(
        <TooltipProvider>
          <Table>
            <TableBody>
              <OrderTableRow
                order={order}
                {...rowProps}
                statusFilter="confirmed"
                onView={onView}
                onDelete={onDelete}
              />
            </TableBody>
          </Table>
        </TooltipProvider>,
      )
      return { ...utils, onView, onDelete }
    }

    it.each(["draft", "pending_approval", "confirmed", "in_progress", "shipped", "canceled"] as const)(
      "%s の行をクリックすると onView が呼ばれる",
      async (status) => {
        const order = makeOrder({ status, source_type: "manual" })
        const { onView } = renderViewableRow(order)

        await userEvent.setup().click(screen.getByText("O-1"))

        expect(onView).toHaveBeenCalledWith(order)
      },
    )

    it("行にフォーカスして Enter を押すと onView が呼ばれる", async () => {
      const order = makeOrder({ status: "confirmed", source_type: "manual" })
      const { onView } = renderViewableRow(order)

      screen.getByRole("row", { name: "注文 O-1 の内容を確認" }).focus()
      await userEvent.setup().keyboard("{Enter}")

      expect(onView).toHaveBeenCalledTimes(1)
    })

    it("ケバブメニューを開いて項目を選んでも onView は呼ばれない", async () => {
      const { onView, onDelete } = renderViewableRow(
        makeOrder({ status: "confirmed", source_type: "manual" }),
      )
      const user = userEvent.setup()

      await user.click(screen.getByRole("button", { name: "メニューを開く" }))
      await user.click(await screen.findByRole("menuitem", { name: "削除" }))

      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(onView).not.toHaveBeenCalled()
    })
  })

  describe("出す操作を呼び出し側から絞る（Issue #554）", () => {
    it("visibleActions を省略するとステータス・ロールに応じた操作をすべて出す", async () => {
      renderRow(makeOrder({ status: "pending_approval" }), { currentUserRole: "president" })

      expect(screen.getByRole("button", { name: "承認" })).toBeInTheDocument()
      await userEvent.click(screen.getByRole("button", { name: "メニューを開く" }))
      expect(await screen.findByText("差し戻し")).toBeInTheDocument()
      expect(screen.getByText("削除")).toBeInTheDocument()
    })

    it("含めない操作は出さない", async () => {
      renderRow(makeOrder({ status: "pending_approval" }), {
        currentUserRole: "president",
        visibleActions: ["reject"],
      })

      expect(screen.queryByRole("button", { name: "承認" })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole("button", { name: "メニューを開く" }))
      expect(await screen.findByText("差し戻し")).toBeInTheDocument()
      expect(screen.queryByText("削除")).not.toBeInTheDocument()
    })

    it("メニューに出す操作が1つも無ければメニュー自体を出さない", () => {
      renderRow(makeOrder({ status: "draft", source_type: "manual" }), {
        visibleActions: ["simulate"],
      })

      expect(screen.getByRole("button", { name: "シミュレーション実行" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "メニューを開く" })).not.toBeInTheDocument()
    })

    it("view を含めない行はクリックできない", () => {
      const { container } = renderRow(makeOrder({ status: "confirmed" }), {
        visibleActions: ["ship"],
      })

      expect(container.querySelector("tr")).not.toHaveAttribute("tabindex")
    })
  })

  describe("選択・操作の列を出さない（「すべての注文」、Issue #558）", () => {
    it("showActionColumns=false なら選択・操作のセルを出さず、作業ボタンも出さない", () => {
      const { container } = renderRow(makeOrder({ status: "pending_approval" }), {
        currentUserRole: "president",
        visibleActions: ["view"],
        showActionColumns: false,
      })

      expect(container.querySelectorAll("td")).toHaveLength(6)
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "承認" })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "メニューを開く" })).not.toBeInTheDocument()
      expect(container.querySelector("tr")).toHaveAttribute("tabindex", "0")
    })

    it("一括選択の props を渡さなければ選択のチェックボックスを出さない", () => {
      renderRow(makeOrder({ status: "draft", source_type: "manual" }), {
        isSelected: undefined,
        isBulkOperationInProgress: undefined,
        onToggleSelect: undefined,
      })

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    })
  })
})

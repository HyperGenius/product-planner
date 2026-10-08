import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Customer } from "@/types/customer"
import { CustomerSelector } from "./customer-selector"

/**
 * 顧客選択のコンボボックス (Issue #509)。顧客名はダミー値（実データを含めない）。
 */

function customer(overrides: Partial<Customer>): Customer {
  return {
    id: 1,
    name: "顧客A",
    status: "active",
    tenant_id: "tenant-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function mockCustomers(customers: Customer[]) {
  server.use(http.get(`${API_BASE}/customers`, () => HttpResponse.json(customers)))
}

const CUSTOMERS = [
  customer({ id: 1, name: "株式会社サンプル精工", alias: "サンプル" }),
  customer({ id: 2, name: "テスト工業株式会社", alias: "TEST" }),
  customer({ id: 3, name: "仮登録商事", status: "draft" }),
]

/** トリガーを開く（顧客の読み込み中は無効なので有効になるのを待つ） */
async function openSelector(index = 0) {
  const trigger = (await screen.findAllByRole("combobox", { name: "顧客" }))[index]
  await waitFor(() => expect(trigger).toBeEnabled())
  await userEvent.click(trigger)
}

function optionNames() {
  return screen.getAllByRole("option").map((o) => o.textContent)
}

describe("CustomerSelector", () => {
  it("未選択のときはプレースホルダーを出し、選んだ顧客の ID を渡す", async () => {
    mockCustomers(CUSTOMERS)
    const onValueChange = vi.fn()

    render(<CustomerSelector value="" onValueChange={onValueChange} />)

    const trigger = await screen.findByRole("combobox", { name: "顧客" })
    await waitFor(() => expect(trigger).toHaveTextContent("顧客を選択（任意）"))
    await openSelector()
    // 未選択なら「選択を解除」は出さない
    expect(screen.queryByRole("option", { name: /選択を解除/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("option", { name: /テスト工業株式会社/ }))

    expect(onValueChange).toHaveBeenCalledWith("2")
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
  })

  it("顧客名・略称の一部（大文字小文字無視）で絞り込める", async () => {
    mockCustomers(CUSTOMERS)

    render(<CustomerSelector value="" onValueChange={vi.fn()} />)
    await openSelector()

    const input = screen.getByPlaceholderText("顧客名または略称で検索...")
    await userEvent.type(input, "精工")
    expect(optionNames()).toEqual([expect.stringContaining("株式会社サンプル精工")])

    await userEvent.clear(input)
    await userEvent.type(input, "test")
    expect(optionNames()).toEqual([expect.stringContaining("テスト工業株式会社")])

    await userEvent.clear(input)
    await userEvent.type(input, "該当しない")
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
    expect(screen.getByText("顧客が見つかりません")).toBeInTheDocument()
  })

  it("キーボードで選べる", async () => {
    mockCustomers(CUSTOMERS)
    const onValueChange = vi.fn()

    render(<CustomerSelector value="" onValueChange={onValueChange} />)
    await openSelector()

    await userEvent.keyboard("{ArrowDown}{Enter}")

    expect(onValueChange).toHaveBeenCalledWith("2")
  })

  it("「選択を解除」で空文字を渡す。検索中は出さない", async () => {
    mockCustomers(CUSTOMERS)
    const onValueChange = vi.fn()

    render(<CustomerSelector value="1" onValueChange={onValueChange} />)

    const trigger = await screen.findByRole("combobox", { name: "顧客" })
    await waitFor(() => expect(trigger).toHaveTextContent("株式会社サンプル精工"))
    await openSelector()

    await userEvent.type(screen.getByPlaceholderText("顧客名または略称で検索..."), "テスト")
    expect(screen.queryByRole("option", { name: /選択を解除/ })).not.toBeInTheDocument()

    await userEvent.clear(screen.getByPlaceholderText("顧客名または略称で検索..."))
    await userEvent.click(screen.getByRole("option", { name: /選択を解除/ }))

    expect(onValueChange).toHaveBeenCalledWith("")
  })

  it("下書きの顧客には「下書き」バッジを出す", async () => {
    mockCustomers(CUSTOMERS)

    render(<CustomerSelector value="3" onValueChange={vi.fn()} />)

    const trigger = await screen.findByRole("combobox", { name: "顧客" })
    await waitFor(() => expect(trigger).toHaveTextContent("仮登録商事下書き"))
    await openSelector()

    expect(screen.getByRole("option", { name: /仮登録商事/ })).toHaveTextContent("下書き")
    expect(screen.getByRole("option", { name: /テスト工業株式会社/ })).not.toHaveTextContent(
      "下書き",
    )
  })

  it("顧客が0件なら「顧客が登録されていません」を出す", async () => {
    mockCustomers([])

    render(<CustomerSelector value="" onValueChange={vi.fn()} />)
    await openSelector()

    expect(screen.getByText("顧客が登録されていません")).toBeInTheDocument()
  })

  it("複数並べてもラベルがそれぞれのトリガーを指し、独立して選べる", async () => {
    mockCustomers(CUSTOMERS)
    const first = vi.fn()
    const second = vi.fn()

    render(
      <>
        <CustomerSelector value="" onValueChange={first} />
        <CustomerSelector value="" onValueChange={second} />
      </>,
    )

    const triggers = await screen.findAllByRole("combobox", { name: "顧客" })
    expect(triggers).toHaveLength(2)
    expect(triggers[0].id).not.toEqual(triggers[1].id)

    await openSelector(1)
    await userEvent.click(screen.getByRole("option", { name: /株式会社サンプル精工/ }))

    expect(second).toHaveBeenCalledWith("1")
    expect(first).not.toHaveBeenCalled()
  })
})

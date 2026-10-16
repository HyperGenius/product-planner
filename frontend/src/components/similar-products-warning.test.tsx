import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { SimilarProduct } from "@/types/product"
import { SimilarProductsWarning } from "./similar-products-warning"

/** 類似製品の警告 (Issue #516)。品名・図番はダミー値 */

function similar(overrides: Partial<SimilarProduct>): SimilarProduct {
  return {
    id: 1,
    name: "φ10.0×20L SUS100",
    code: "A-001",
    is_active: true,
    prefix: "",
    prefix_differs: false,
    has_process: true,
    has_unconfirmed_process: false,
    ...overrides,
  }
}

function mockSimilar(products: SimilarProduct[]) {
  const requests: URL[] = []
  server.use(
    http.get(`${API_BASE}/products/similar`, ({ request }) => {
      requests.push(new URL(request.url))
      return HttpResponse.json({ products })
    }),
  )
  return requests
}

describe("SimilarProductsWarning", () => {
  it("似た製品を品名・図番・工程の登録状況つきで表示し、製品マスタへのリンクを持つ", async () => {
    mockSimilar([similar({ id: 7, has_unconfirmed_process: true })])

    render(<SimilarProductsWarning name="10φ×20L SUS100" />)

    expect(await screen.findByRole("alert")).toHaveTextContent("似た製品があります")
    expect(screen.getByText("φ10.0×20L SUS100")).toBeInTheDocument()
    expect(screen.getByText("図番: A-001")).toBeInTheDocument()
    expect(screen.getByText("工程あり（未確定）")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /製品マスタで開く/ })).toHaveAttribute(
      "href",
      "/master/products?highlight=7",
    )
  })

  it("接頭辞が違う製品は接頭辞を目立たせ、無効な製品はその旨を示す", async () => {
    mockSimilar([
      similar({ id: 2, prefix: "ABC", prefix_differs: true, is_active: false, has_process: false, code: null }),
    ])

    render(<SimilarProductsWarning name="φ10×20L SUS100" />)

    expect(await screen.findByText("接頭辞: ABC")).toBeInTheDocument()
    expect(screen.getByText("無効")).toBeInTheDocument()
    expect(screen.getByText("工程未登録")).toBeInTheDocument()
    expect(screen.getByText("図番: 未設定")).toBeInTheDocument()
  })

  it("類似製品が無ければ何も表示しない", async () => {
    const requests = mockSimilar([])

    render(<SimilarProductsWarning name="φ10×20L SUS100" />)

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("品名が空なら問い合わせない", async () => {
    const requests = mockSimilar([similar({})])

    render(<SimilarProductsWarning name="  " />)

    await new Promise((r) => setTimeout(r, 600))
    expect(requests).toHaveLength(0)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("編集中の製品の ID を exclude_id で渡し、品名を変更していない間は問い合わせない", async () => {
    const requests = mockSimilar([similar({})])

    const { rerender } = render(
      <SimilarProductsWarning name="φ10×20L SUS100" excludeId={5} originalName="φ10×20L SUS100" />,
    )
    await new Promise((r) => setTimeout(r, 600))
    expect(requests).toHaveLength(0)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    rerender(
      <SimilarProductsWarning name="10φ×20L SUS100" excludeId={5} originalName="φ10×20L SUS100" />,
    )
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0].searchParams.get("exclude_id")).toBe("5")
    expect(requests[0].searchParams.get("name")).toBe("10φ×20L SUS100")
  })

  it("入力中は連続して問い合わせず、止まってから1回だけ問い合わせる", async () => {
    const requests = mockSimilar([])

    const { rerender } = render(<SimilarProductsWarning name="" />)
    rerender(<SimilarProductsWarning name="φ1" />)
    rerender(<SimilarProductsWarning name="φ10" />)
    rerender(<SimilarProductsWarning name="φ10×20L" />)

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].searchParams.get("name")).toBe("φ10×20L")
  })
})

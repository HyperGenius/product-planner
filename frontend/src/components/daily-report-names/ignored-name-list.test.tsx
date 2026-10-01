import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { IgnoredName } from "@/types/daily-report-names"
import { IgnoredNameList } from "./ignored-name-list"

const ignoredRow = (overrides: Partial<IgnoredName>): IgnoredName => ({
  id: "i-1",
  kind: "product",
  raw_text: "試作品",
  customer_raw: null,
  created_by: "u-1",
  created_at: "2026-09-01T00:00:00Z",
  ...overrides,
})

describe("IgnoredNameList", () => {
  it("対象外の表記を一覧し、戻すと一覧から消える", async () => {
    let rows = [
      ignoredRow({ id: "i-1", kind: "product", raw_text: "試作品", customer_raw: "顧客A" }),
      ignoredRow({ id: "i-2", kind: "process", raw_text: "段取り" }),
    ]
    const deleted: string[] = []
    server.use(
      http.get(`${API_BASE}/daily-reports/ignored-names`, () => HttpResponse.json(rows)),
      http.delete(`${API_BASE}/daily-reports/ignored-names/:id`, ({ params }) => {
        deleted.push(String(params.id))
        rows = rows.filter((r) => r.id !== params.id)
        return HttpResponse.json({ status: "deleted" })
      }),
    )

    render(<IgnoredNameList canEdit />)

    expect(await screen.findByText("顧客先: 顧客A")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "「段取り」を未照合キューに戻す" }))

    await waitFor(() => expect(deleted).toEqual(["i-2"]))
    await waitFor(() => expect(screen.queryByText("段取り")).not.toBeInTheDocument())
    expect(screen.getByText("試作品")).toBeInTheDocument()
  })

  it("空なら案内を出す", async () => {
    server.use(http.get(`${API_BASE}/daily-reports/ignored-names`, () => HttpResponse.json([])))

    render(<IgnoredNameList canEdit />)

    expect(await screen.findByText("対象外にした表記はありません")).toBeInTheDocument()
  })
})

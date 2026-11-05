import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { Tabs } from "@/components/ui/tabs"
import { render } from "@/test-utils/render"
import type { NameKind } from "@/types/daily-report-names"
import { KIND_COLORS, KindTabsList } from "./kind-tabs"

function Harness({ counts }: { counts?: Record<NameKind, number> }) {
  const [kind, setKind] = useState<NameKind>("equipment")
  return (
    <Tabs value={kind} onValueChange={(v) => setKind(v as NameKind)}>
      <KindTabsList counts={counts} />
    </Tabs>
  )
}

describe("KindTabsList", () => {
  it("種別ごとに別の色を持つ", () => {
    expect(new Set(Object.values(KIND_COLORS)).size).toBe(4)
  })

  it("件数を表示し、種別の色を CSS 変数で渡す", () => {
    render(<Harness counts={{ equipment: 2, process: 0, customer: 1, product: 12 }} />)
    expect(screen.getByRole("tab", { name: /設備\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /製品\s*12/ })).toHaveStyle({
      "--kind-color": KIND_COLORS.product,
    })
  })

  it("件数を省略すると件数なしで表示し、選択を切り替えられる", async () => {
    render(<Harness />)
    expect(screen.getByRole("tab", { name: "設備" })).toHaveAttribute("aria-selected", "true")
    await userEvent.click(screen.getByRole("tab", { name: "顧客" }))
    expect(screen.getByRole("tab", { name: "顧客" })).toHaveAttribute("aria-selected", "true")
  })
})

import { describe, expect, it } from "vitest"
import { render, screen } from "@/test-utils/render"
import { CustomerCertaintyValue } from "./customer-certainty-value"

describe("CustomerCertaintyValue", () => {
  it("確度が NULL（判定できなかった受注）なら「－」を表示し、内々示とは表示しない（Issue #474）", () => {
    render(<CustomerCertaintyValue certainty={null} />)

    expect(screen.getByText("－")).toBeInTheDocument()
    expect(screen.queryByText("内々示")).not.toBeInTheDocument()
  })

  it.each([
    ["confirmed", "顧客確定"],
    ["forecast", "内示"],
    ["forecast_tentative", "内々示"],
  ] as const)("確度 %s はラベル「%s」で表示する", (certainty, label) => {
    render(<CustomerCertaintyValue certainty={certainty} />)

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText("－")).not.toBeInTheDocument()
  })
})

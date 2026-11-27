import { describe, expect, it } from "vitest"
import {
  isFromShipping,
  isWithinShipmentPeriod,
  shipmentNamesHref,
  toValidNameKind,
} from "./shipment-utils"

describe("送品の消し込み ⇄ 弥生の名寄せ（Issue #694）", () => {
  it("送品の消し込みから開く URL には from=shipping を付ける", () => {
    expect(shipmentNamesHref("customers", { fromShipping: true })).toBe(
      "/orders/shipment-names?from=shipping#customers",
    )
    expect(shipmentNamesHref("products")).toBe("/orders/shipment-names#products")
  })

  it("from は既知の値とだけ比べる", () => {
    expect(isFromShipping(new URLSearchParams("from=shipping"))).toBe(true)
    expect(isFromShipping(new URLSearchParams("from=Shipping"))).toBe(false)
    expect(isFromShipping(new URLSearchParams("from=https://example.com"))).toBe(false)
    expect(isFromShipping(new URLSearchParams())).toBe(false)
    expect(isFromShipping(null)).toBe(false)
  })

  it("ハッシュの種別は知らない値を得意先に寄せる", () => {
    expect(toValidNameKind("#products")).toBe("products")
    expect(toValidNameKind("#customers")).toBe("customers")
    expect(toValidNameKind("#unknown")).toBe("customers")
    expect(toValidNameKind("")).toBe("customers")
  })

  it("最後の売上日が期間の始まり以降なら期間内。始まりが分からなければ絞らない", () => {
    expect(isWithinShipmentPeriod("2026-08-22", "2026-08-22")).toBe(true)
    expect(isWithinShipmentPeriod("2026-08-21", "2026-08-22")).toBe(false)
    expect(isWithinShipmentPeriod("2020-01-01", null)).toBe(true)
  })
})

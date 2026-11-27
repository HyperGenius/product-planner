import { describe, expect, it } from "vitest"
import {
  buildShippingCountSnapshot,
  diffShippingCounts,
  parseShippingCountSnapshot,
  type ShippingCountSnapshot,
} from "./shipping-count-history"
import type { ShippingWorkCount } from "./shipping-worklist-utils"

function count(value: number | null, extra?: Partial<ShippingWorkCount>): ShippingWorkCount {
  return { value, isError: false, ...extra }
}

function snapshot(overrides: Partial<Record<keyof ShippingCountSnapshot, number>> = {}) {
  const base = { customer: 0, product: 0, ambiguous: 0, ship: 0, confirm: 0, register: 0, ...overrides }
  return Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, { value: v, atLeast: false }]),
  ) as ShippingCountSnapshot
}

describe("送品の消し込みの前回からの件数の変化（Issue #694）", () => {
  const loaded = {
    customer: count(1),
    product: count(2),
    ambiguous: count(0),
    ship: count(3),
    confirm: count(4),
    register: count(5, { atLeast: true }),
  }

  it("どれも取得し終えたら保存する値を作る", () => {
    expect(buildShippingCountSnapshot(loaded)).toEqual({
      customer: { value: 1, atLeast: false },
      product: { value: 2, atLeast: false },
      ambiguous: { value: 0, atLeast: false },
      ship: { value: 3, atLeast: false },
      confirm: { value: 4, atLeast: false },
      register: { value: 5, atLeast: true },
    })
  })

  it("取得中・取得に失敗した件数があれば保存しない（途中の件数を残さない）", () => {
    expect(buildShippingCountSnapshot({ ...loaded, ship: count(null) })).toBeNull()
    expect(buildShippingCountSnapshot({ ...loaded, register: count(5, { isError: true }) })).toBeNull()
  })

  it("保存した値を読み直せる。形が合わなければ null", () => {
    const value = buildShippingCountSnapshot(loaded)!
    expect(parseShippingCountSnapshot(JSON.stringify(value))).toEqual(value)

    expect(parseShippingCountSnapshot(null)).toBeNull()
    expect(parseShippingCountSnapshot("not json")).toBeNull()
    expect(parseShippingCountSnapshot("[]")).toBeNull()
    expect(parseShippingCountSnapshot("null")).toBeNull()
    const missing: Record<string, unknown> = { ...value }
    delete missing.ship
    expect(parseShippingCountSnapshot(JSON.stringify(missing))).toBeNull()
    expect(
      parseShippingCountSnapshot(JSON.stringify({ ...value, ship: { value: -1, atLeast: false } })),
    ).toBeNull()
    expect(
      parseShippingCountSnapshot(JSON.stringify({ ...value, ship: { value: 1.5, atLeast: false } })),
    ).toBeNull()
    expect(
      parseShippingCountSnapshot(JSON.stringify({ ...value, ship: { value: 1, atLeast: "no" } })),
    ).toBeNull()
  })

  it("変わった件数だけを、前提 → ①②③の順に単位付きで返す", () => {
    expect(
      diffShippingCounts(
        snapshot({ register: 5, customer: 2, ship: 1 }),
        snapshot({ register: 2, customer: 0, ship: 3 }),
      ),
    ).toEqual([
      { kind: "customer", label: "未登録の得意先", from: "2得意先", to: "0得意先" },
      { kind: "ship", label: "① 送品済みにする", from: "1注文", to: "3注文" },
      { kind: "register", label: "③ 受注を起票する", from: "5商品", to: "2商品" },
    ])
    expect(diffShippingCounts(snapshot({ confirm: 2 }), snapshot({ confirm: 2 }))).toEqual([])
  })

  it("「以上」が付く・外れるのも変化として出す", () => {
    const previous = snapshot({ register: 50 })
    const current = { ...snapshot({ register: 50 }), register: { value: 50, atLeast: true } }
    expect(diffShippingCounts(previous, current)).toEqual([
      { kind: "register", label: "③ 受注を起票する", from: "50商品", to: "50商品以上" },
    ])
  })
})

import { describe, expect, it } from "vitest"
import {
  buildNewOrderHref,
  parseNewOrderPrefill,
  toPositiveInt,
  toValidIsoDate,
  toValidReturnPath,
} from "./order-prefill-utils"

describe("受注作成のクエリの検証（Issue #694）", () => {
  it.each([
    ["1", 1],
    ["120", 120],
    ["2147483647", 2147483647],
    ["0", null],
    ["-3", null],
    ["01", null],
    ["1.5", null],
    ["1e3", null],
    [" 1", null],
    ["abc", null],
    ["2147483648", null],
    ["", null],
    [null, null],
  ])("整数の ID・数量: %s → %s", (value, expected) => {
    expect(toPositiveInt(value)).toBe(expected)
  })

  it.each([
    ["2026-11-30", "2026-11-30"],
    ["2028-02-29", "2028-02-29"],
    ["2026-02-30", null],
    ["2026-13-01", null],
    ["2026-1-5", null],
    ["2026-11-30T00:00:00Z", null],
    ["11/30", null],
    [null, null],
  ])("日付: %s → %s", (value, expected) => {
    expect(toValidIsoDate(value)).toBe(expected)
  })

  it("戻り先は既知のパスだけを受け取る", () => {
    expect(toValidReturnPath("/orders/shipping/register")).toBe("/orders/shipping/register")
    expect(toValidReturnPath("https://example.com/")).toBeNull()
    expect(toValidReturnPath("//example.com/orders/shipping/register")).toBeNull()
    expect(toValidReturnPath("/orders/shipping/register?x=1")).toBeNull()
    expect(toValidReturnPath("constructor")).toBeNull()
    expect(toValidReturnPath("toString")).toBeNull()
    expect(toValidReturnPath(null)).toBeNull()
  })

  it("クエリから初期値と戻り先を取り出し、形の合わない値は null にする", () => {
    expect(
      parseNewOrderPrefill(
        new URLSearchParams({
          customer_id: "3",
          product_id: "x",
          quantity: "120",
          desired_deadline: "2026-02-30",
          return_to: "/orders/shipping/register",
        }),
      ),
    ).toEqual({
      customerId: 3,
      productId: null,
      quantity: 120,
      desiredDeadline: null,
      returnTo: "/orders/shipping/register",
    })
    expect(parseNewOrderPrefill(null)).toEqual({
      customerId: null,
      productId: null,
      quantity: null,
      desiredDeadline: null,
      returnTo: null,
    })
  })

  it("URL を組み、読み直すと同じ値になる。null・不正な値はクエリに載せない", () => {
    const href = buildNewOrderHref({
      customerId: 1,
      productId: 101,
      quantity: 120,
      desiredDeadline: "2026-11-30",
      returnTo: "/orders/shipping/register",
    })
    const url = new URL(href, "http://localhost")
    expect(url.pathname).toBe("/orders/new")
    expect(parseNewOrderPrefill(url.searchParams)).toEqual({
      customerId: 1,
      productId: 101,
      quantity: 120,
      desiredDeadline: "2026-11-30",
      returnTo: "/orders/shipping/register",
    })

    expect(buildNewOrderHref({ customerId: null, quantity: -1, desiredDeadline: "11/30" })).toBe(
      "/orders/new",
    )
  })
})

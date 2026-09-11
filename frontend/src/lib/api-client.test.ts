import { describe, expect, it } from "vitest"
import { ApiError } from "./api-client"

/**
 * ApiError の conflictingOrder / lineItemIndex getter は、想定外の形のレスポンスを
 * そのまま `as` キャストで返すと呼び出し側（DuplicateOrderDialog 等）が壊れるため、
 * 最低限の型検証をしてから返す（Copilot レビュー指摘、Issue #415 PR3）。
 */
describe("ApiError", () => {
  describe("errorCode", () => {
    it("detail.error を返す", () => {
      const error = new ApiError(409, { detail: { error: "duplicate_order" } })
      expect(error.errorCode).toBe("duplicate_order")
    })

    it("detail が文字列なら undefined を返す", () => {
      const error = new ApiError(400, { detail: "some message" })
      expect(error.errorCode).toBeUndefined()
    })
  })

  describe("conflictingOrder", () => {
    const validConflict = {
      id: 99,
      order_no: "PO-9999",
      customer_name: "顧客B社",
      product_name: "製品Y",
      quantity: 50,
      deadline_date: "2026-10-01",
      status: "confirmed",
    }

    it("id が number / status が string の妥当な形なら返す", () => {
      const error = new ApiError(409, {
        detail: { error: "duplicate_order", conflicting_order: validConflict },
      })
      expect(error.conflictingOrder).toEqual(validConflict)
    })

    it("conflicting_order が無ければ undefined", () => {
      const error = new ApiError(409, { detail: { error: "duplicate_order" } })
      expect(error.conflictingOrder).toBeUndefined()
    })

    it("id が number でない不正な形は undefined を返す（表示崩れの防止）", () => {
      const error = new ApiError(409, {
        detail: {
          error: "duplicate_order",
          conflicting_order: { ...validConflict, id: "99" },
        },
      })
      expect(error.conflictingOrder).toBeUndefined()
    })

    it("status が欠けている不正な形は undefined を返す", () => {
      const withoutStatus: Record<string, unknown> = { ...validConflict }
      delete withoutStatus.status
      const error = new ApiError(409, {
        detail: { error: "duplicate_order", conflicting_order: withoutStatus },
      })
      expect(error.conflictingOrder).toBeUndefined()
    })

    it("conflicting_order が配列の場合は undefined を返す", () => {
      const error = new ApiError(409, {
        detail: { error: "duplicate_order", conflicting_order: [validConflict] },
      })
      expect(error.conflictingOrder).toBeUndefined()
    })
  })

  describe("lineItemIndex", () => {
    it("整数の number ならそのまま返す", () => {
      const error = new ApiError(409, {
        detail: { error: "duplicate_order", line_item_index: 1 },
      })
      expect(error.lineItemIndex).toBe(1)
    })

    it("文字列で返ってきた場合は undefined を返す（誤って文字列連結されるのを防ぐ）", () => {
      const error = new ApiError(409, {
        detail: { error: "duplicate_order", line_item_index: "1" },
      })
      expect(error.lineItemIndex).toBeUndefined()
    })

    it("整数でない number（小数）は undefined を返す", () => {
      const error = new ApiError(409, {
        detail: { error: "duplicate_order", line_item_index: 1.5 },
      })
      expect(error.lineItemIndex).toBeUndefined()
    })

    it("未指定なら undefined を返す", () => {
      const error = new ApiError(409, { detail: { error: "duplicate_order" } })
      expect(error.lineItemIndex).toBeUndefined()
    })
  })
})

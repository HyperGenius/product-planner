import { describe, expect, it } from "vitest"
import { guessProductCode } from "./product-code-utils"

/** 品名から図番の初期値を読み取る (Issue #705)。品名はダミー値 */
describe("guessProductCode", () => {
  it("数字5桁以上の番号が1つだけあれば、それを図番にする", () => {
    expect(guessProductCode("フィルター 123456 φ10×20L")).toBe("123456")
    expect(guessProductCode("12345")).toBe("12345")
  })

  it("全角の数字も半角にして読み取る", () => {
    expect(guessProductCode("ピン　１２３４５")).toBe("12345")
  })

  it("仕様の書き方だけの品名からは読み取らない", () => {
    expect(guessProductCode("φ10.0×20L SUS100")).toBe("")
    expect(guessProductCode("ピン 1234")).toBe("")
    expect(guessProductCode("")).toBe("")
  })

  it("番号が2つ以上あるときは決めない（同じ番号の繰り返しは1つと数える）", () => {
    expect(guessProductCode("12345 / 67890")).toBe("")
    expect(guessProductCode("12345（12345）")).toBe("12345")
  })
})

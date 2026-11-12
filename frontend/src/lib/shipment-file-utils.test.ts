import { describe, expect, it } from "vitest"
import { formatFileSize, validateShipmentFile } from "./shipment-file-utils"

const file = (name: string, size: number) =>
  Object.defineProperty(new File(["x"], name), "size", { value: size })

describe("validateShipmentFile", () => {
  it("Excel・CSV・テキストは通す（拡張子の大文字小文字は問わない）", () => {
    expect(validateShipmentFile(file("売上.csv", 10))).toBeNull()
    expect(validateShipmentFile(file("売上.TXT", 10))).toBeNull()
    expect(validateShipmentFile(file("売上.xlsx", 10))).toBeNull()
  })

  it("Excel など想定外の拡張子は理由を返す", () => {
    expect(validateShipmentFile(file("売上.pdf", 10))).toContain(".csv")
  })

  it("空ファイルと上限超過は理由を返す", () => {
    expect(validateShipmentFile(file("a.csv", 0))).toBe("空のファイルです")
    expect(validateShipmentFile(file("a.csv", 20 * 1024 * 1024 + 1))).toContain("大きすぎます")
  })
})

describe("formatFileSize", () => {
  it("1KB 未満でも 1KB と表示し、MB 以上は小数1桁にする", () => {
    expect(formatFileSize(10)).toBe("1 KB")
    expect(formatFileSize(2048)).toBe("2 KB")
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB")
  })
})

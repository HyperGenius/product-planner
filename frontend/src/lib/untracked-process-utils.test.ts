import { describe, expect, it } from "vitest"
import {
  findUntrackedProcessName,
  isUntrackedProcessName,
  toUntrackedNameSet,
} from "./untracked-process-utils"

const ITEMS = [
  { id: 1, process_name: "検査", created_at: "2026-11-15T00:00:00Z" },
  { id: 2, process_name: " 外観検査　", created_at: "2026-11-15T00:00:00Z" },
]

describe("untracked-process-utils（Issue #681）", () => {
  it("工程名は前後の空白（全角を含む）を除いて比べる", () => {
    const names = toUntrackedNameSet(ITEMS)

    expect(isUntrackedProcessName(names, "検査")).toBe(true)
    expect(isUntrackedProcessName(names, "　検査 ")).toBe(true)
    expect(isUntrackedProcessName(names, "外観検査")).toBe(true)
    expect(isUntrackedProcessName(names, "プレス")).toBe(false)
  })

  it("空の工程名・設定の未取得は日報で追う工程とみなす", () => {
    expect(isUntrackedProcessName(toUntrackedNameSet(ITEMS), " ")).toBe(false)
    expect(isUntrackedProcessName(undefined, "検査")).toBe(false)
    expect(toUntrackedNameSet(undefined).size).toBe(0)
  })

  it("工程名に当たる設定を探す（解除に id を使う）", () => {
    expect(findUntrackedProcessName(ITEMS, "外観検査 ")?.id).toBe(2)
    expect(findUntrackedProcessName(ITEMS, "プレス")).toBeUndefined()
  })
})

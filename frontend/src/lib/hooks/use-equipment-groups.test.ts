import { describe, expect, it } from "vitest"

import {
  formatGroupLabel,
  groupDisplayName,
  groupsForManagement,
  routingGroupOptionSections,
} from "./use-equipment-groups"

describe("groupsForManagement", () => {
  const groups = [
    { id: 1, member_count: 0 },
    { id: 2, member_count: 1 },
    { id: 3, member_count: 2 },
    { id: 4, member_count: 5 },
  ]

  it("既定では2台以上のグループだけを返す", () => {
    expect(groupsForManagement(groups, false).map((g) => g.id)).toEqual([3, 4])
  })

  it("includeSmall なら1台以下（0台を含む）のグループも返す", () => {
    expect(groupsForManagement(groups, true).map((g) => g.id)).toEqual([1, 2, 3, 4])
  })
})

const group = (id: number, name: string, member_names: string[], routing_count = 0) => ({
  id,
  name,
  member_names,
  routing_count,
})

describe("groupDisplayName / formatGroupLabel", () => {
  it("1台のグループはメンバーの設備名で出す（グループ名が古くても追従する）", () => {
    const g = group(1, "旧名", ["新しい呼称"])
    expect(groupDisplayName(g)).toBe("新しい呼称")
    expect(formatGroupLabel(g)).toBe("新しい呼称")
  })

  it("複数台のグループはグループ名にメンバーを補足する", () => {
    const g = group(1, "プレス", ["A", "B", "C", "D"])
    expect(groupDisplayName(g)).toBe("プレス")
    expect(formatGroupLabel(g)).toBe("プレス (A / B / C 他1台)")
  })

  it("メンバー0台のグループは設備なしで計画されることを示す", () => {
    expect(formatGroupLabel(group(1, "汎用設備", []))).toBe("汎用設備（メンバー未登録・設備なしで計画）")
  })
})

describe("routingGroupOptionSections", () => {
  const groups = [
    group(1, "プレス", ["プレス1号機", "プレス2号機"]),
    group(2, "旧名", ["ボール盤"]),
    group(3, "アルファ", ["アルファ"]),
    group(4, "汎用設備", [], 5),
    group(5, "残骸", [], 0),
    group(6, "カシメ", ["カシメA", "カシメB"]),
  ]

  it("複数台・設備・メンバー未登録に分けて表示名順に並べ、参照の無い0台のグループは出さない", () => {
    const sections = routingGroupOptionSections(groups, "")
    expect(sections.map((s) => [s.label, s.groups.map((g) => g.id)])).toEqual([
      ["設備グループ（複数台）", [6, 1]],
      ["設備", [3, 2]],
      ["メンバー未登録（設備なしで計画）", [4]],
    ])
  })

  it("編集中の工程が選んでいる0台のグループは参照が無くても残す", () => {
    const sections = routingGroupOptionSections(groups, 5)
    expect(sections.at(-1)?.groups.map((g) => g.id).sort()).toEqual([4, 5])
  })

  it("該当するグループが無い区分は出さない", () => {
    expect(routingGroupOptionSections([group(1, "A", ["A"])], null).map((s) => s.label)).toEqual(["設備"])
  })
})

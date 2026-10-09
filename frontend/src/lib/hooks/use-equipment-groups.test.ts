import { describe, expect, it } from "vitest"

import { groupsForManagement } from "./use-equipment-groups"

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

import { describe, expect, it } from "vitest"
import {
  filterSchedulesByCustomer,
  listScheduleCustomers,
  withSelectedCustomer,
} from "@/lib/schedule-customer-filter"

const A = { customer_id: 1, customer_name: "顧客A株式会社", customer_alias: "A社" }
const B = { customer_id: 2, customer_name: "B工業", customer_alias: null }
const UNKNOWN = { customer_id: null, customer_name: null, customer_alias: null }

describe("listScheduleCustomers", () => {
  it("顧客ごとに1つ、表示名の順で顧客不明は最後", () => {
    const options = listScheduleCustomers([UNKNOWN, B, A, B, A])
    expect(options.map((o) => o.customerId)).toEqual([1, 2, null])
    expect(options.map((o) => o.label)).toEqual(["A社", "B工業", "顧客不明"])
  })

  it("通称・正式名称・顧客不明の表示名で検索できる", () => {
    const [a, b, unknown] = listScheduleCustomers([A, B, UNKNOWN])
    expect(a.keywords).toEqual(["A社", "顧客A株式会社"])
    expect(b.keywords).toEqual(["B工業"])
    expect(unknown.keywords).toEqual(["顧客不明"])
  })

  it("スケジュールが無ければ空", () => {
    expect(listScheduleCustomers([])).toEqual([])
  })
})

describe("withSelectedCustomer", () => {
  const options = listScheduleCustomers([A])

  it("選んでいる顧客が選択肢に無ければ（予定が無くなった）足す", () => {
    expect(withSelectedCustomer(options, { customerId: 2, label: "B工業" }).map((o) => o.customerId)).toEqual([1, 2])
  })

  it("選択肢にあれば・すべてならそのまま", () => {
    expect(withSelectedCustomer(options, { customerId: 1, label: "A社" })).toBe(options)
    expect(withSelectedCustomer(options, null)).toBe(options)
  })
})

describe("filterSchedulesByCustomer", () => {
  const schedules = [
    { id: 1, ...A },
    { id: 2, ...B },
    { id: 3, ...UNKNOWN },
    { id: 4, ...A },
  ]

  it("選んだ顧客のスケジュールだけにする", () => {
    expect(filterSchedulesByCustomer(schedules, { customerId: 1, label: "A社" }).map((s) => s.id)).toEqual([1, 4])
  })

  it("顧客不明で絞り込める", () => {
    expect(filterSchedulesByCustomer(schedules, { customerId: null, label: "顧客不明" }).map((s) => s.id)).toEqual([3])
  })

  it("すべてなら絞り込まない", () => {
    expect(filterSchedulesByCustomer(schedules, null)).toBe(schedules)
  })
})

import { describe, expect, it } from "vitest"
import { format } from "date-fns"
import { scheduleViewRange } from "@/lib/schedule-view-range"

const fmt = (d: Date) => format(d, "yyyy-MM-dd HH:mm")

describe("scheduleViewRange", () => {
  it("月次は基準日の月の1日〜末日（月末の基準日でも翌月に食い込まない）", () => {
    const { start, end } = scheduleViewRange("Month", new Date(2026, 10, 29))
    expect(fmt(start)).toBe("2026-11-01 00:00")
    expect(fmt(end)).toBe("2026-11-30 23:59")
  })

  it("月次は2月の末日も扱う", () => {
    const { start, end } = scheduleViewRange("Month", new Date(2028, 1, 1))
    expect(fmt(start)).toBe("2028-02-01 00:00")
    expect(fmt(end)).toBe("2028-02-29 23:59")
  })

  it("週次は日曜始まり、日次は前日〜翌日", () => {
    const week = scheduleViewRange("Week", new Date(2026, 8, 16))
    expect(fmt(week.start)).toBe("2026-09-13 00:00")
    expect(fmt(week.end)).toBe("2026-09-19 23:59")

    const day = scheduleViewRange("Day", new Date(2026, 8, 16, 10))
    expect(fmt(day.start)).toBe("2026-09-15 00:00")
    expect(fmt(day.end)).toBe("2026-09-17 23:59")
  })
})

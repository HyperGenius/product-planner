import { addDays, endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from "date-fns"
import { ja } from "date-fns/locale"
import type { GanttViewMode } from "@/types/schedule"

/**
 * 生産スケジュールの表示期間。ページのデータ取得とガントの表示で同じ範囲を使う
 * （食い違うと、取得していない期間の列が空のまま出る）
 */
export function scheduleViewRange(viewMode: GanttViewMode, date: Date): { start: Date; end: Date } {
  switch (viewMode) {
    case "Day":
      // 前日0:00〜翌日23:59（計72時間）
      return { start: startOfDay(addDays(date, -1)), end: endOfDay(addDays(date, 1)) }
    case "Week":
      return { start: startOfWeek(date, { locale: ja }), end: endOfWeek(date, { locale: ja }) }
    case "Month":
      // 見出しの「yyyy年M月」と揃えて、その月の1日〜末日
      return { start: startOfMonth(date), end: endOfMonth(date) }
  }
}

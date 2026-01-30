"use client"

import { useState } from "react"
import { format, getDaysInMonth } from "date-fns"
import { ja } from "date-fns/locale"
import { DayPicker } from "react-day-picker"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  useCalendars,
  useUpsertCalendar,
  useBatchUpdateCalendars,
} from "@/hooks/use-calendars"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import "react-day-picker/style.css"

/**
 * 稼働カレンダー編集画面
 * URL: /master/calendar
 */
export default function CalendarPage() {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1) // 1-12
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [note, setNote] = useState("")
  const [isHoliday, setIsHoliday] = useState(false)

  // データ取得・操作のフック
  const { data: calendars = [], isLoading } = useCalendars(currentYear, currentMonth)
  const upsertMutation = useUpsertCalendar()
  const batchMutation = useBatchUpdateCalendars()

  // カレンダーデータをマップに変換
  const calendarMap = new Map(
    calendars.map((cal) => [cal.date, cal])
  )

  // 休日の日付セット
  const holidayDates = calendars
    .filter((cal) => cal.is_holiday)
    .map((cal) => new Date(cal.date))

  // 稼働日（明示的に設定されたもの）の日付セット
  const workdayDates = calendars
    .filter((cal) => !cal.is_holiday && cal.note)
    .map((cal) => new Date(cal.date))

  // 前月へ移動
  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(currentMonth - 1)
    }
  }

  // 翌月へ移動
  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentMonth(currentMonth + 1)
    }
  }

  // 日付をクリック
  const handleDayClick = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd")
    const existing = calendarMap.get(dateStr)

    setSelectedDate(day)
    setIsHoliday(existing?.is_holiday ?? false)
    setNote(existing?.note ?? "")
    setIsEditDialogOpen(true)
  }

  // 日付を更新
  const handleSaveDate = async () => {
    if (!selectedDate) return

    const dateStr = format(selectedDate, "yyyy-MM-dd")

    try {
      await upsertMutation.mutateAsync({
        date: dateStr,
        is_holiday: isHoliday,
        note: note.trim() || null,
      })
      toast.success("カレンダーを更新しました")
      setIsEditDialogOpen(false)
    } catch (error) {
      toast.error("カレンダーの更新に失敗しました")
      console.error(error)
    }
  }

  // 一括設定: 土日を休日に設定
  const handleSetWeekendsAsHolidays = async () => {
    const year = currentYear
    const month = currentMonth
    const daysInMonth = getDaysInMonth(new Date(year, month - 1))
    const dates: string[] = []

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day)
      const dayOfWeek = date.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        // 日曜日または土曜日
        dates.push(format(date, "yyyy-MM-dd"))
      }
    }

    if (dates.length === 0) {
      toast.error("該当する日付がありません")
      return
    }

    try {
      const result = await batchMutation.mutateAsync({
        dates,
        is_holiday: true,
        note: "休日",
      })
      toast.success(`${result.updated_count}件の日付を休日に設定しました`)
    } catch (error) {
      toast.error("一括設定に失敗しました")
      console.error(error)
    }
  }

  // 一括設定: 土曜日を稼働日に設定
  const handleSetSaturdaysAsWorkdays = async () => {
    const year = currentYear
    const month = currentMonth
    const daysInMonth = getDaysInMonth(new Date(year, month - 1))
    const dates: string[] = []

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day)
      const dayOfWeek = date.getDay()
      if (dayOfWeek === 6) {
        // 土曜日
        dates.push(format(date, "yyyy-MM-dd"))
      }
    }

    if (dates.length === 0) {
      toast.error("該当する日付がありません")
      return
    }

    try {
      const result = await batchMutation.mutateAsync({
        dates,
        is_holiday: false,
        note: "稼働日",
      })
      toast.success(`${result.updated_count}件の日付を稼働日に設定しました`)
    } catch (error) {
      toast.error("一括設定に失敗しました")
      console.error(error)
    }
  }

  const monthDate = new Date(currentYear, currentMonth - 1, 1)

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">稼働カレンダー</h1>
        <p className="text-sm text-muted-foreground">
          会社の休日や臨時稼働日を設定できます
        </p>
      </div>

      {/* 一括設定ボタン */}
      <div className="mb-6 flex gap-2">
        <Button
          variant="outline"
          onClick={handleSetWeekendsAsHolidays}
          disabled={batchMutation.isPending}
        >
          土日を休日に設定
        </Button>
        <Button
          variant="outline"
          onClick={handleSetSaturdaysAsWorkdays}
          disabled={batchMutation.isPending}
        >
          土曜日を稼働日に設定
        </Button>
      </div>

      {/* カレンダー表示 */}
      <div className="rounded-lg border p-6">
        {/* 月移動ヘッダー */}
        <div className="mb-4 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={handlePrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">
            {currentYear}年 {currentMonth}月
          </h2>
          <Button variant="outline" size="sm" onClick={handleNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* 凡例 */}
        <div className="mb-4 flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-red-200"></div>
            <span>休日</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-blue-200"></div>
            <span>臨時稼働日</span>
          </div>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            読み込み中...
          </div>
        ) : (
          <DayPicker
            mode="single"
            month={monthDate}
            onDayClick={handleDayClick}
            modifiers={{
              holiday: holidayDates,
              workday: workdayDates,
            }}
            modifiersClassNames={{
              holiday: "bg-red-200 text-red-900 font-bold",
              workday: "bg-blue-200 text-blue-900 font-bold",
            }}
            locale={ja}
            className="mx-auto"
          />
        )}
      </div>

      {/* 編集ダイアログ */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>日付の設定</DialogTitle>
            <DialogDescription>
              {selectedDate && format(selectedDate, "yyyy年MM月dd日 (E)", { locale: ja })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="status">ステータス</Label>
              <Select
                value={isHoliday ? "holiday" : "workday"}
                onValueChange={(value) => setIsHoliday(value === "holiday")}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workday">稼働日</SelectItem>
                  <SelectItem value="holiday">休日</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">備考</Label>
              <Input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例: 創立記念日、臨時出勤"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button onClick={handleSaveDate} disabled={upsertMutation.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

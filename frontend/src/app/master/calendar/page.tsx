"use client"

import { useMemo, useState } from "react"
import { format, getDaysInMonth, isBefore, startOfDay } from "date-fns"
import { ja } from "date-fns/locale"
import { DayPicker } from "react-day-picker"
import { toast } from "sonner"
import { CalendarPlus, ChevronLeft, ChevronRight, Download, X } from "lucide-react"
import {
  useCalendars,
  useUpsertCalendar,
  useBatchUpdateCalendars,
  useImportNationalHolidays,
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

const today = startOfDay(new Date())
const currentYear = new Date().getFullYear()

/**
 * 稼働カレンダー編集画面
 * URL: /master/calendar
 */
export default function CalendarPage() {
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth() + 1) // 1-12

  // 通常編集ダイアログ
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [note, setNote] = useState("")
  const [isHoliday, setIsHoliday] = useState(false)

  // 臨時休日マルチ選択モード
  const [isAdHocMode, setIsAdHocMode] = useState(false)
  const [adHocDates, setAdHocDates] = useState<Date[]>([])
  const [adHocNote, setAdHocNote] = useState("")

  // 祝日インポート
  const [importYear, setImportYear] = useState(currentYear)

  // データ取得・操作
  const { data: calendars = [], isLoading } = useCalendars(viewYear, viewMonth)
  const upsertMutation = useUpsertCalendar()
  const batchMutation = useBatchUpdateCalendars()
  const importMutation = useImportNationalHolidays()

  // カレンダーデータをマップに変換
  const calendarMap = useMemo(
    () => new Map(calendars.map((cal) => [cal.date, cal])),
    [calendars]
  )

  // DBで明示的に稼働日設定された日付セット
  const dbWorkdaySet = useMemo(
    () => new Set(calendars.filter((c) => !c.is_holiday).map((c) => c.date)),
    [calendars]
  )

  // 当月の全土日（DBに稼働日上書きがないもの）→ デフォルト休日として表示
  const effectiveWeekendDates = useMemo(() => {
    const dates: Date[] = []
    const daysInMonth = getDaysInMonth(new Date(viewYear, viewMonth - 1))
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(viewYear, viewMonth - 1, day)
      if (d.getDay() === 0 || d.getDay() === 6) {
        if (!dbWorkdaySet.has(format(d, "yyyy-MM-dd"))) {
          dates.push(d)
        }
      }
    }
    return dates
  }, [viewYear, viewMonth, dbWorkdaySet])

  // DBで明示設定された休日（祝日・臨時休日など）
  const dbHolidayDates = useMemo(
    () => calendars.filter((c) => c.is_holiday).map((c) => new Date(c.date)),
    [calendars]
  )

  // DBで明示設定された稼働日（土日の出勤日など）
  const workdayDates = useMemo(
    () => calendars.filter((c) => !c.is_holiday).map((c) => new Date(c.date)),
    [calendars]
  )

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  // 通常モード: 日付クリック → ダイアログ（過去日付は無効）
  const handleDayClick = (day: Date) => {
    if (isBefore(day, today)) return
    const dateStr = format(day, "yyyy-MM-dd")
    const existing = calendarMap.get(dateStr)
    setSelectedDate(day)
    setIsHoliday(existing?.is_holiday ?? false)
    setNote(existing?.note ?? "")
    setIsEditDialogOpen(true)
  }

  const handleSaveDate = async () => {
    if (!selectedDate) return
    try {
      await upsertMutation.mutateAsync({
        date: format(selectedDate, "yyyy-MM-dd"),
        is_holiday: isHoliday,
        note: note.trim() || null,
      })
      toast.success("カレンダーを更新しました")
      setIsEditDialogOpen(false)
    } catch {
      toast.error("カレンダーの更新に失敗しました")
    }
  }

  // 臨時休日モードの保存
  const handleSaveAdHoc = async () => {
    if (adHocDates.length === 0) return
    const dates = adHocDates.map((d) => format(d, "yyyy-MM-dd"))
    try {
      const result = await batchMutation.mutateAsync({
        dates,
        is_holiday: true,
        note: adHocNote.trim() || "臨時休日",
      })
      toast.success(`${result.updated_count}件の臨時休日を設定しました`)
      setAdHocDates([])
      setAdHocNote("")
      setIsAdHocMode(false)
    } catch {
      toast.error("臨時休日の設定に失敗しました")
    }
  }

  const handleCancelAdHoc = () => {
    setAdHocDates([])
    setAdHocNote("")
    setIsAdHocMode(false)
  }

  const handleRemoveAdHocDate = (dateToRemove: Date) => {
    setAdHocDates((prev) =>
      prev.filter((d) => d.toISOString() !== dateToRemove.toISOString())
    )
  }

  // 祝日インポート
  const handleImportHolidays = async () => {
    try {
      const result = await importMutation.mutateAsync(importYear)
      toast.success(`${importYear}年の国民の祝日を${result.imported_count}件インポートしました`)
    } catch {
      toast.error("祝日のインポートに失敗しました")
    }
  }

  const monthDate = new Date(viewYear, viewMonth - 1, 1)

  const dayPickerModifiers = {
    defaultWeekend: effectiveWeekendDates,
    holiday: dbHolidayDates,
    workday: workdayDates,
  }

  const dayPickerModifiersClassNames = {
    defaultWeekend: "bg-red-100 text-red-800",
    holiday: "bg-red-300 text-red-900 font-bold",
    workday: "bg-blue-200 text-blue-900 font-bold",
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">稼働カレンダー</h1>
        <p className="text-sm text-muted-foreground">
          会社の休日や臨時稼働日を設定できます。土曜・日曜はデフォルトで休日として扱われます。
        </p>
      </div>

      {/* ── 国民の祝日インポート ── */}
      <div className="rounded-lg border p-4 space-y-3 max-w-md">
        <h2 className="font-semibold flex items-center gap-2">
          <Download className="h-4 w-4" />
          国民の祝日インポート
        </h2>
        <p className="text-sm text-muted-foreground">
          総務省（内閣府）が公開する祝日データを取り込みます。
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={String(importYear)}
            onValueChange={(v) => setImportYear(Number(v))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear, currentYear + 1, currentYear + 2].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}年
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleImportHolidays}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? "インポート中..." : "インポート"}
          </Button>
        </div>
      </div>

      {/* ── カレンダー + アクションパネル（横並び） ── */}
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        {/* カレンダーカード */}
        <div className="rounded-lg border p-6 w-fit">
          {/* 月移動ヘッダー + 臨時休日設定ボタン */}
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={handlePrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-base font-semibold px-2 min-w-[7rem] text-center">
                {viewYear}年 {viewMonth}月
              </h2>
              <Button variant="outline" size="sm" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant={isAdHocMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setIsAdHocMode(!isAdHocMode)
                setAdHocDates([])
              }}
            >
              <CalendarPlus className="h-4 w-4 mr-1.5" />
              臨時休日設定
            </Button>
          </div>

          {/* 凡例 */}
          <div className="mb-4 flex flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-4 rounded bg-red-100 border border-red-200"></div>
              <span>土日（デフォルト休日）</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-4 rounded bg-red-300"></div>
              <span>祝日・臨時休日</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-4 rounded bg-blue-200"></div>
              <span>臨時稼働日</span>
            </div>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">読み込み中...</div>
          ) : isAdHocMode ? (
            <DayPicker
              mode="multiple"
              month={monthDate}
              selected={adHocDates}
              onSelect={(dates) => setAdHocDates(dates ?? [])}
              disabled={{ before: today }}
              modifiers={dayPickerModifiers}
              modifiersClassNames={dayPickerModifiersClassNames}
              locale={ja}
              className="px-8"
            />
          ) : (
            <DayPicker
              mode="single"
              month={monthDate}
              onDayClick={handleDayClick}
              disabled={{ before: today }}
              modifiers={dayPickerModifiers}
              modifiersClassNames={dayPickerModifiersClassNames}
              locale={ja}
              className="px-8"
            />
          )}
        </div>

        {/* アクションパネル（臨時休日設定モード時のみ表示） */}
        {isAdHocMode && (
          <div className="rounded-lg border p-4 w-full sm:w-64 space-y-4 sticky top-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <CalendarPlus className="h-4 w-4" />
                臨時休日設定
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                カレンダーから日付を複数選択してください（過去日付は選択不可）
              </p>
            </div>

            {/* 選択済み日付リスト */}
            <div className="space-y-2">
              <p className="text-sm font-medium">選択中: {adHocDates.length}件</p>
              {adHocDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">日付が選択されていません</p>
              ) : (
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {adHocDates
                    .slice()
                    .sort((a, b) => a.getTime() - b.getTime())
                    .map((d) => (
                      <li
                        key={d.toISOString()}
                        className="flex items-center justify-between text-sm py-0.5"
                      >
                        <span>{format(d, "M月d日 (E)", { locale: ja })}</span>
                        <button
                          onClick={() => handleRemoveAdHocDate(d)}
                          className="text-muted-foreground hover:text-foreground transition-colors ml-2 flex-shrink-0"
                          aria-label={`${format(d, "M月d日")}を解除`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {/* 備考 */}
            <div className="space-y-1">
              <Label htmlFor="adHocNote">備考</Label>
              <Input
                id="adHocNote"
                value={adHocNote}
                onChange={(e) => setAdHocNote(e.target.value)}
                placeholder="例: 創立記念日、工場メンテナンス"
              />
            </div>

            {/* アクションボタン */}
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleSaveAdHoc}
                disabled={adHocDates.length === 0 || batchMutation.isPending}
              >
                {batchMutation.isPending ? "保存中..." : "休日に設定"}
              </Button>
              <Button variant="outline" onClick={handleCancelAdHoc}>
                キャンセル
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 通常編集ダイアログ */}
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
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
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

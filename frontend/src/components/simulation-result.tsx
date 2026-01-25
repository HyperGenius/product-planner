"use client"

import * as React from "react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { CheckCircle2, XCircle, Clock } from "lucide-react"
import type { OrderSimulateResponse } from "@/types/order"

interface SimulationResultProps {
  result: OrderSimulateResponse | null
  desiredDeadline?: string
}

/**
 * シミュレーション結果表示コンポーネント
 */
export function SimulationResult({
  result,
  desiredDeadline,
}: SimulationResultProps) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Clock className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p>左側のフォームに入力し、</p>
          <p>「シミュレーション実行」ボタンをクリックしてください</p>
        </div>
      </div>
    )
  }

  // 日付の検証
  const calculatedDate = new Date(result.calculated_deadline)
  if (isNaN(calculatedDate.getTime())) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>日付データが不正です</p>
        </div>
      </div>
    )
  }

  const formattedDate = format(calculatedDate, "yyyy年MM月dd日 HH:mm", { locale: ja })

  // 希望納期と比較
  const isFeasible = desiredDeadline
    ? result.is_feasible
    : true

  return (
    <div className="space-y-6">
      {/* 回答納期 */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          {isFeasible ? (
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          ) : (
            <XCircle className="h-6 w-6 text-red-600" />
          )}
          <h3 className="text-lg font-semibold">回答納期</h3>
        </div>
        <p className="text-3xl font-bold mt-2">{formattedDate}</p>
        {desiredDeadline && (
          <p className={`mt-2 text-sm ${isFeasible ? "text-green-600" : "text-red-600"}`}>
            {isFeasible
              ? "✓ 希望納期に間に合います"
              : "✗ 希望納期に間に合いません"}
          </p>
        )}
      </div>

      {/* 工程プレビュー */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">工程スケジュール</h3>
        <div className="space-y-3">
          {result.process_schedules.map((schedule, index) => {
            const startDate = new Date(schedule.start_time)
            const endDate = new Date(schedule.end_time)

            // 日付の検証
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
              return null
            }

            const startFormatted = format(startDate, "MM/dd HH:mm", { locale: ja })
            const endFormatted = format(endDate, "MM/dd HH:mm", { locale: ja })

            return (
              <div
                key={index}
                className="flex items-start gap-3 p-3 rounded-md bg-muted/50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{schedule.process_name}</p>
                  {schedule.equipment_name && (
                    <p className="text-sm text-muted-foreground">
                      設備: {schedule.equipment_name}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground mt-1">
                    {startFormatted} → {endFormatted}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

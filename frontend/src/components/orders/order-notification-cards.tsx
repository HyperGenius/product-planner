"use client"

import { Card, CardContent } from "@/components/ui/card"

interface OrderNotificationCardsProps {
  draftCount: number
  incompleteCount: number
  noCustomerCount: number
  noDeadlineCount: number
  onDraftClick: () => void
  onIncompleteClick: () => void
}

export function OrderNotificationCards({
  draftCount,
  incompleteCount,
  noCustomerCount,
  noDeadlineCount,
  onDraftClick,
  onIncompleteClick,
}: OrderNotificationCardsProps) {
  if (draftCount === 0 && incompleteCount === 0) return null

  return (
    <div className="mb-4 grid grid-cols-2 gap-4">
      {incompleteCount > 0 && (
        <Card
          className="cursor-pointer border-orange-300 bg-orange-50 hover:bg-orange-100 transition-colors"
          onClick={onIncompleteClick}
        >
          <CardContent className="pt-6">
            <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-1">STEP 1</p>
            <p className="text-2xl font-bold text-orange-800">{incompleteCount}件 情報不足</p>
            <p className="text-sm text-orange-600 mt-1">
              顧客未設定 {noCustomerCount}件 / 希望納期未設定 {noDeadlineCount}件
            </p>
            <p className="text-sm text-orange-700 mt-1">確認する →</p>
          </CardContent>
        </Card>
      )}
      {draftCount > 0 && (
        <Card
          className="cursor-pointer border-yellow-300 bg-yellow-50 hover:bg-yellow-100 transition-colors"
          onClick={onDraftClick}
        >
          <CardContent className="pt-6">
            <p className="text-xs font-semibold text-yellow-500 uppercase tracking-wide mb-1">STEP 2</p>
            <p className="text-2xl font-bold text-yellow-800">{draftCount}件 未確定</p>
            <p className="text-sm text-yellow-700 mt-1">下書きを見る →</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

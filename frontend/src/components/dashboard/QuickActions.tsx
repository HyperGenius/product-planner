"use client"

import { useRouter } from "next/navigation"
import { ClipboardList, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * クイックアクション（新規注文・スケジュール確認）。現行 `app/page.tsx` から移植。
 */
export function QuickActions() {
  const router = useRouter()

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm mb-6">
      <h2 className="text-base font-semibold mb-4">クイックアクション</h2>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => router.push("/orders/new")} size="lg" className="gap-2">
          <Plus className="h-5 w-5" />
          新規注文を入力する
        </Button>
        <Button
          onClick={() => router.push("/schedule")}
          size="lg"
          variant="outline"
          className="gap-2"
        >
          <ClipboardList className="h-5 w-5" />
          生産スケジュールを確認する
        </Button>
      </div>
    </div>
  )
}

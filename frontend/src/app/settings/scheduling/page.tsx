"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  useSchedulingSettings,
  useUpdateSchedulingSettings,
} from "@/hooks/use-scheduling-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function SchedulingSettingsPage() {
  const { data: settings, isLoading } = useSchedulingSettings()
  const updateMutation = useUpdateSchedulingSettings()

  const [guardTime, setGuardTime] = useState("")
  const [minSlot, setMinSlot] = useState("")
  const [maxFragments, setMaxFragments] = useState("")
  const [isFormInitialized, setIsFormInitialized] = useState(false)

  // 設定の取得が完了した最初のレンダーでフォームの初期値を反映する
  // (エフェクトではなくレンダー中の同期更新にすることで、初期化後のユーザー入力を上書きしない)
  if (settings && !isFormInitialized) {
    setIsFormInitialized(true)
    setGuardTime(String(settings.guard_time_minutes))
    setMinSlot(String(settings.min_slot_minutes))
    setMaxFragments(String(settings.max_fragments))
  }

  const handleSave = () => {
    const guard = parseInt(guardTime, 10)
    const slot = parseInt(minSlot, 10)
    const frags = parseInt(maxFragments, 10)

    if (isNaN(guard) || guard < 0) {
      toast.error("ガードタイムは0以上の整数を入力してください")
      return
    }
    if (isNaN(slot) || slot < 0) {
      toast.error("最低時間スロットは0以上の整数を入力してください")
      return
    }
    if (isNaN(frags) || frags < 1) {
      toast.error("最大断片数は1以上の整数を入力してください")
      return
    }

    updateMutation.mutate(
      { guard_time_minutes: guard, min_slot_minutes: slot, max_fragments: frags },
      {
        onSuccess: () => toast.success("スケジューリング設定を保存しました"),
        onError: () => toast.error("保存に失敗しました"),
      }
    )
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">読み込み中...</div>
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-2xl font-bold mb-1">スケジューリング設定</h1>
      <p className="text-sm text-muted-foreground mb-6">
        テナント全体のデフォルト値です。設備グループ・設備単位で上書き可能です。
      </p>

      <Card>
        <CardHeader>
          <CardTitle>グローバルデフォルト</CardTitle>
          <CardDescription>
            設備グループ・設備で値が未設定（空欄）の場合にこの値が適用されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="guard-time">ガードタイム（分）</Label>
            <Input
              id="guard-time"
              type="number"
              min={0}
              value={guardTime}
              onChange={(e) => setGuardTime(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              スケジュール間に設ける最低空白時間（段取り替えバッファ）
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="min-slot">最低時間スロット（分）</Label>
            <Input
              id="min-slot"
              type="number"
              min={0}
              value={minSlot}
              onChange={(e) => setMinSlot(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              利用可能とみなすギャップの最低時間。これ未満のスロットは無視します。
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="max-fragments">最大断片数</Label>
            <Input
              id="max-fragments"
              type="number"
              min={1}
              value={maxFragments}
              onChange={(e) => setMaxFragments(e.target.value)}
              placeholder="10"
            />
            <p className="text-xs text-muted-foreground">
              1工程を分割できる最大セグメント数。超過した場合は末尾追加にフォールバックします。
            </p>
          </div>

          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
          >
            {updateMutation.isPending ? "保存中..." : "保存"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
